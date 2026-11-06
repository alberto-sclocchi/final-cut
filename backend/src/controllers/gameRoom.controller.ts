import { Request, Response, NextFunction } from "express";
import GameRoom, { ROOM_STATUSES } from "../models/GameRoom.model";
import User from "../models/User.model";
import Movie from "../models/Movie.model";
import Submission from "../models/Submission.model";
import { buildPool } from "../services/pool";
import { MIN_POOL_SIZE, banRefusal, isBanRoundFinished } from "../services/ban";

const CODE_LENGTH = 6;
const CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// a new code can collide with an existing room, so try a few times before giving up
const MAX_CODE_ATTEMPTS = 5;

// a game needs at least 2 people to start, and a room holds at most 8
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

// what the client gets back about the people in a room (no email, no password)
const PLAYER_FIELDS = "name username";

export const makeRoomCode = () => {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  }
  return code;
};

// codes are saved uppercase, so every lookup uppercases too. Returns null if there's no usable code
const normalizeCode = (code: unknown) =>
  typeof code === "string" && code.trim() ? code.trim().toUpperCase() : null;

// mongo throws error 11000 when a unique field already exists (a room code, or a second ban)
const isDuplicateKey = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

// a movie id sent by the client. Returns null if it isn't one
const normalizeMovieId = (value: unknown) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value.trim()) ? value.trim() : null;

// populated mongoose documents have to be flattened before extra fields are added.
// Test doubles are already plain objects
const asPlain = (doc: any) => (typeof doc?.toObject === "function" ? doc.toObject() : doc);

// What the ban screen needs to know: the progress, whether you can ban, and the reveal.
// Other players' picks stay secret until the round is over
async function getBanState(room: any, userId: any, roundFinished = !!room.round_finished) {
  const [submitted, mySubmission] = await Promise.all([
    Submission.countDocuments({ room: room._id, round: "ban" }),
    Submission.findOne({ room: room._id, round: "ban", player: userId }).populate("choices.movie"),
  ]);

  const myMovie = mySubmission?.choices?.[0]?.movie ?? null;

  const blockReason = banRefusal({
    status: room.status,
    currentRound: room.currentRound,
    roundFinished,
    alreadyBanned: !!myMovie,
    poolSize: room.remaining_movies?.length ?? 0,
  });

  // once the round is over the bans are public, but only as movies: no usernames
  let bannedMovies: unknown[] = [];
  if (roundFinished) {
    const bans = await Submission.find({ room: room._id, round: "ban" })
      .select("choices")
      .populate("choices.movie");

    bannedMovies = bans
      .flatMap((ban: any) => ban.choices.map((choice: any) => choice.movie))
      .filter(Boolean);
  }

  return {
    submitted: submitted ?? 0,
    required: room.round_players?.length ?? 0,
    finished: roundFinished,
    can_ban: blockReason === null,
    block_reason: blockReason,
    my_movie: myMovie,
    banned_movies: bannedMovies,
  };
}

// POST /api/game-rooms
export const createGameRoom = async (req: Request, res: Response, next: NextFunction) => {
  // isAuthenticated runs before this, so payload is always set
  const userId = req.payload!._id;

  try {
    // let the unique index catch collisions instead of checking first, so two rooms created at the same time can't get the same code
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      try {
        const createdRoom = await GameRoom.create({ code: makeRoomCode(), host: userId, players: [userId] });
        res.status(201).json({ success: true, gameRoom: createdRoom });
        return;
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }

    next(new Error(`Could not generate a unique room code after ${MAX_CODE_ATTEMPTS} attempts`));
  } catch (err) {
    next(err);
  }
};

// POST /api/game-rooms/join   
// adds the logged in user to the room with that code. Only works while the room is still in the lobby
export const joinGameRoom = async (req: Request, res: Response, next: NextFunction) => {
  const code = normalizeCode(req.body?.code);
  const userId = req.payload!._id;

  if (!code) {
    res.status(400).json({ success: false, message: "Please enter a room code." });
    return;
  }

  // catch typos before going to the db
  if (!new RegExp(`^[A-Z]{${CODE_LENGTH}}$`).test(code)) {
    res.status(400).json({ success: false, message: `Room codes are ${CODE_LENGTH} letters, like ABCDEF.` });
    return;
  }

  try {
    const foundRoom = await GameRoom.findOne({ code }).select("players status");

    if (!foundRoom) {
      res.status(404).json({ success: false, message: `No room found with code ${code}. Check the code and try again.` });
      return;
    }

    // players already in the room (refresh, rejoin) just get the room back, whatever the status
    const alreadyIn = foundRoom.players.some((id) => id.equals(userId));

    if (!alreadyIn && foundRoom.status !== "lobby") {
      const message = foundRoom.status === "playing" ? "This game has already started." : "This game is already over.";
      res.status(409).json({ success: false, message });
      return;
    }

    if (!alreadyIn && foundRoom.players.length >= MAX_PLAYERS) {
      res.status(409).json({ success: false, message: `This room is full (${MAX_PLAYERS}/${MAX_PLAYERS} players).` });
      return;
    }

    // the filter re-checks status and size so nobody slips in if the game starts or the room fills at the same moment
    const updatedRoom = await GameRoom.findOneAndUpdate(
      alreadyIn
        ? { _id: foundRoom._id }
        : { _id: foundRoom._id, status: "lobby", [`players.${MAX_PLAYERS - 1}`]: { $exists: false } },
      { $addToSet: { players: userId } },
      { new: true }
    ).populate("players", PLAYER_FIELDS);

    if (!updatedRoom) {
      res.status(409).json({ success: false, message: "The room just filled up or the game started. Try another room." });
      return;
    }

    res.status(200).json({ success: true, gameRoom: updatedRoom });
  } catch (err) {
    next(err);
  }
};

// GET /api/game-rooms?status=completed
export const getMyGameRooms = async (req: Request, res: Response, next: NextFunction) => {
  const { status } = req.query;

  if (status !== undefined && !ROOM_STATUSES.includes(status as (typeof ROOM_STATUSES)[number])) {
    res.status(400).json({ success: false, message: `status must be one of: ${ROOM_STATUSES.join(", ")}.` });
    return;
  }

  const filter: Record<string, unknown> = { players: req.payload!._id };
  if (status !== undefined) {
    filter.status = status;
  }

  try {
    const gameRooms = await GameRoom.find(filter)
      .select("code host players winner status createdAt")
      .sort({ createdAt: -1 })
      .populate("host", PLAYER_FIELDS)
      .populate("players", PLAYER_FIELDS)
      .populate("winner", "title posterUrl");

    res.status(200).json({ success: true, gameRooms });
  } catch (err) {
    next(err);
  }
};

// GET /api/game-rooms/:code
// the full state of one room. The lobby/game screen polls this to see new players and status changes
export const getGameRoom = async (req: Request, res: Response, next: NextFunction) => {
  const code = normalizeCode(req.params.code);

  if (!code) {
    res.status(400).json({ success: false, message: "Please provide a room code." });
    return;
  }

  try {
    const foundRoom = await GameRoom.findOne({ code })
      .populate("host", PLAYER_FIELDS)
      .populate("players", PLAYER_FIELDS)
      .populate("remaining_movies")
      .populate("winner");

    if (!foundRoom) {
      res.status(404).json({ success: false, message: "Room not found." });
      return;
    }

    // players are populated here, so compare their _id
    if (!foundRoom.players.some((player) => player._id.equals(req.payload!._id))) {
      res.status(403).json({ success: false, message: "You are not in this room." });
      return;
    }

    // only a started game has a ban round, so the lobby poll doesn't need the extra queries
    if (foundRoom.status !== "playing") {
      res.status(200).json({ success: true, gameRoom: foundRoom });
      return;
    }

    const bans = await getBanState(foundRoom, req.payload!._id);

    res.status(200).json({ success: true, gameRoom: { ...asPlain(foundRoom), bans } });
  } catch (err) {
    next(err);
  }
};

// POST /api/game-rooms/:code/leave
// removes the logged in user from the room. If the host leaves, the next player becomes host.
export const leaveGameRoom = async (req: Request, res: Response, next: NextFunction) => {
  const code = normalizeCode(req.params.code);
  const userId = req.payload!._id;

  if (!code) {
    res.status(400).json({ success: false, message: "Please provide a room code." });
    return;
  }

  try {
    const foundRoom = await GameRoom.findOne({ code }).select("host players status");

    if (!foundRoom) {
      res.status(404).json({ success: false, message: "Room not found." });
      return;
    }

    if (!foundRoom.players.some((id) => id.equals(userId))) {
      res.status(400).json({ success: false, message: "You are not in this room." });
      return;
    }

    // finished games stay in everyone's summary, so you can't leave them
    if (foundRoom.status === "completed") {
      res.status(409).json({ success: false, message: "This game is already over." });
      return;
    }

    const remainingPlayers = foundRoom.players.filter((id) => !id.equals(userId));

    if (remainingPlayers.length === 0) {
      await GameRoom.deleteOne({ _id: foundRoom._id });
      res.status(200).json({ success: true, message: "You left the room. It was empty, so it was deleted." });
      return;
    }

    // players are kept in join order, so the next host is whoever joined right after
    const newHost = foundRoom.host.equals(userId) ? remainingPlayers[0] : foundRoom.host;

    await GameRoom.findByIdAndUpdate(foundRoom._id, {
      $pull: { players: userId }, // remove player from the array
      $set: { host: newHost }, // set new host if the leaving player was the host
    });

    res.status(200).json({ success: true, message: "You left the room." });
  } catch (err) {
    next(err);
  }
};

// POST /api/game-rooms/:code/start
export const startGameRoom = async (req: Request, res: Response, next: NextFunction) => {
  const code = normalizeCode(req.params.code);

  if (!code) {
    res.status(400).json({ success: false, message: "Please provide a room code." });
    return;
  }

  try {
    const foundRoom = await GameRoom.findOne({ code }).select("host players status");

    if (!foundRoom) {
      res.status(404).json({ success: false, message: "Room not found." });
      return;
    }

    if (!foundRoom.host.equals(req.payload!._id)) {
      res.status(403).json({ success: false, message: "Only the host can start the game." });
      return;
    }

    if (foundRoom.status !== "lobby") {
      res.status(409).json({ success: false, message: "This game has already started." });
      return;
    }

    if (foundRoom.players.length < MIN_PLAYERS) {
      res.status(409).json({
        success: false,
        message: `You need at least ${MIN_PLAYERS} players to start (${foundRoom.players.length}/${MIN_PLAYERS}).`,
      });
      return;
    }

    const [players, catalog] = await Promise.all([
      User.find({ _id: { $in: foundRoom.players } }).select("watchlist"),
      Movie.find().select("_id"),
    ]);

    const catalogIds = catalog.map((movie) => movie._id.toString());

    // skip watchlist movies that were deleted from the catalog, so the pool only has real movies
    const inCatalog = new Set(catalogIds);
    const watchlists = players.map((player) =>
      player.watchlist.map((id) => id.toString()).filter((id) => inCatalog.has(id))
    );

    const pool = buildPool(watchlists, catalogIds);

    if (pool.length === 0) {
      next(new Error("Could not build a movie pool: the movie catalog is empty"));
      return;
    }

    // status: "lobby" in the filter so a double click on start can't build two pools
    const startedRoom = await GameRoom.findOneAndUpdate(
      { _id: foundRoom._id, status: "lobby" },
      {
        $set: {
          remaining_movies: pool,
          status: "playing",
          // a game always opens in the ban round
          currentRound: "ban",
          // everyone playing now owes exactly one ban, so remember who that is. The count is
          // what ends the round, even if someone leaves or the room fills up later
          round_players: foundRoom.players,
          // a pool already at the floor can't be banned from, so don't hang the round
          round_finished: pool.length <= MIN_POOL_SIZE,
          winner: null,
        },
      },
      { new: true }
    )
    .populate("players", PLAYER_FIELDS)
    .populate("remaining_movies");

    if (!startedRoom) {
      res.status(409).json({ success: false, message: "This game has already started." });
      return;
    }

    res.status(200).json({ success: true, gameRoom: startedRoom });
  } catch (err) {
    next(err);
  }
};

// POST /api/game-rooms/:code/ban
// removes one movie from the pool for the logged in player. One locked ban per player per round
export const banMovie = async (req: Request, res: Response, next: NextFunction) => {
  const code = normalizeCode(req.params.code);
  const userId = req.payload!._id;

  if (!code) {
    res.status(400).json({ success: false, message: "Please provide a room code." });
    return;
  }

  const movieId = normalizeMovieId(req.body?.movieId);

  if (!movieId) {
    res.status(400).json({ success: false, message: "Please pick a movie to ban." });
    return;
  }

  try {
    const foundRoom = await GameRoom.findOne({ code }).select(
      "host players status currentRound round_finished round_players remaining_movies"
    );

    if (!foundRoom) {
      res.status(404).json({ success: false, message: "Room not found." });
      return;
    }

    if (!foundRoom.players.some((id) => id.equals(userId))) {
      res.status(403).json({ success: false, message: "You are not in this room." });
      return;
    }

    if (foundRoom.status !== "playing") {
      const message = foundRoom.status === "lobby" ? "This game has not started." : "This game is already over.";
      res.status(409).json({ success: false, message });
      return;
    }

    if (foundRoom.currentRound !== "ban") {
      res.status(409).json({ success: false, message: "It is not the ban round." });
      return;
    }

    if (foundRoom.round_finished) {
      res.status(409).json({ success: false, message: "The ban round is already over." });
      return;
    }

    // the later rounds need something to play with, so the pool can't shrink past the floor
    if (foundRoom.remaining_movies.length <= MIN_POOL_SIZE) {
      res.status(409).json({
        success: false,
        message: `The pool is at its minimum of ${MIN_POOL_SIZE} movies, so no more bans are allowed.`,
      });
      return;
    }

    if (!foundRoom.remaining_movies.some((id) => id.toString() === movieId)) {
      res.status(400).json({ success: false, message: "That movie is not in the pool." });
      return;
    }

    // the filter only matches while the movie is still in the pool, so two players banning the
    // same movie at the same moment can't both take it. This is also the round-finished guard
    const roomAfterBan: any = await GameRoom.findOneAndUpdate(
      {
        _id: foundRoom._id,
        status: "playing",
        currentRound: "ban",
        round_finished: false,
        remaining_movies: movieId,
      },
      { $pull: { remaining_movies: movieId } },
      { new: true }
    )
      .populate("players", PLAYER_FIELDS)
      .populate("remaining_movies");

    if (!roomAfterBan) {
      res.status(409).json({ success: false, message: "That movie was just banned by another player." });
      return;
    }

    // the unique index on (room, round, player) is what actually locks the ban
    try {
      await Submission.create({
        room: foundRoom._id,
        round: "ban",
        player: userId,
        choices: [{ movie: movieId }],
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;

      // a refused second ban must not leave a hole in the pool
      await GameRoom.updateOne({ _id: foundRoom._id }, { $addToSet: { remaining_movies: movieId } });
      res.status(409).json({ success: false, message: "You have already banned a movie in this round." });
      return;
    }

    const submitted = await Submission.countDocuments({ room: foundRoom._id, round: "ban" });

    // the round ends when everyone in the snapshot has banned, or when the pool hits the floor
    const finished = isBanRoundFinished(
      submitted,
      roomAfterBan.round_players?.length ?? 0,
      roomAfterBan.remaining_movies.length
    );

    if (finished) {
      await GameRoom.updateOne(
        { _id: foundRoom._id, round_finished: false },
        { $set: { round_finished: true } }
      );
    }

    const bans = await getBanState(roomAfterBan, userId, finished);

    res.status(200).json({ success: true, gameRoom: { ...asPlain(roomAfterBan), bans } });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/game-rooms/:code
export const deleteGameRoom = async (req: Request, res: Response, next: NextFunction) => {
  const code = normalizeCode(req.params.code);

  if (!code) {
    res.status(400).json({ success: false, message: "Please provide a room code." });
    return;
  }

  try {
    const foundRoom = await GameRoom.findOne({ code }).select("host");

    if (!foundRoom) {
      res.status(404).json({ success: false, message: "Room not found." });
      return;
    }

    if (!foundRoom.host.equals(req.payload!._id)) {
      res.status(403).json({ success: false, message: "Only the host can delete this room." });
      return;
    }

    await GameRoom.deleteOne({ _id: foundRoom._id });

    res.status(200).json({ success: true, message: "Room deleted." });
  } catch (err) {
    next(err);
  }
};
