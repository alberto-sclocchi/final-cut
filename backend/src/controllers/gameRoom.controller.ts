import { Request, Response, NextFunction } from "express";
import GameRoom, { ROOM_STATUSES } from "../models/GameRoom.model";
import User from "../models/User.model";
import Movie from "../models/Movie.model";
import Submission from "../models/Submission.model";
import { buildPool } from "../services/pool";
import { MIN_POOL_SIZE, banRefusal, isBanRoundFinished } from "../services/ban";
import {
  hypeRefusal,
  isHypeRoundFinished,
  pickQualifiers,
  totalHypePoints,
  validateHypePoints,
  type HypePoints,
} from "../services/hype";

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

// a movie id, whether it arrives as an id or as a populated document
const movieIdOf = (movie: any) => String(movie?._id ?? movie);

// a player id, whether it arrives as an id or as a populated document
const playerIdOf = (player: any) => String(player?._id ?? player);

// the movie id -> points map the hype endpoint accepts. Returns null when it isn't an object
const normalizePoints = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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

// What the hype screen needs to know: the progress, everyone's allocations, the live totals,
// and the survivours once the round is over. Unlike bans, these points are public.
async function getHypeState(room: any, userId: any, roundFinished = !!room.round_finished) {
  const submissions: any[] = await Submission.find({ room: room._id, round: "hype" })
    .populate("player", PLAYER_FIELDS)
    .populate("choices.movie");

  const poolIds: string[] = (room.remaining_movies ?? []).map(movieIdOf);

  // the pool was trimmed and the losers moved here when the round ended
  const moviesById = new Map<string, any>();
  for (const movie of [...(room.remaining_movies ?? []), ...(room.eliminated_movies ?? [])]) {
    moviesById.set(movieIdOf(movie), movie);
  }

  const mySubmission = submissions.find((submission) => playerIdOf(submission.player) === String(userId));

  const myPoints = (mySubmission?.choices ?? []).map((choice: any) => ({
    movie: choice.movie,
    points: choice.points ?? 0,
  }));

  const pointsByPlayer = submissions.map((submission) =>
    Object.fromEntries(
      (submission.choices ?? []).map((choice: any) => [movieIdOf(choice.movie), choice.points ?? 0])
    ) as HypePoints
  );

  // the saved scoreboard is the truth once the round is over, so a refresh can't change it
  const savedTotals = roundFinished ? room.hype_results?.totals ?? null : null;

  const totalsFor: HypePoints = savedTotals?.length
    ? Object.fromEntries(savedTotals.map((row: any) => [movieIdOf(row.movie), row.points ?? 0]))
    : totalHypePoints(pointsByPlayer, poolIds);

  const totals = Object.entries(totalsFor)
    .map(([movieId, points]) => ({ movie: moviesById.get(movieId) ?? { _id: movieId }, points }))
    .sort((a, b) => b.points - a.points);

  const blockReason = hypeRefusal({
    status: room.status,
    currentRound: room.currentRound,
    roundFinished,
    alreadySubmitted: !!mySubmission,
  });

  return {
    submitted: submissions.length,
    required: room.round_players?.length ?? 0,
    finished: roundFinished,
    can_submit: blockReason === null,
    block_reason: blockReason,
    my_points: myPoints,
    allocations: submissions.map((submission) => ({
      player: submission.player,
      points: (submission.choices ?? []).map((choice: any) => ({
        movie: movieIdOf(choice.movie),
        points: choice.points ?? 0,
      })),
    })),
    totals,
    qualifiers: roundFinished ? room.remaining_movies ?? [] : [],
    cut_movies: roundFinished ? room.eliminated_movies ?? [] : [],
    cutoff_tie: !!room.hype_results?.cutoff_tie,
    tied_movies: roundFinished
      ? (room.hype_results?.tied_movies ?? []).map((movie: any) => moviesById.get(movieIdOf(movie)) ?? movie)
      : [],
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
      { $addToSet: { players: userId }, $inc: { version: 1 } },
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
      .populate("eliminated_movies")
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

    // the screen already has this version, so just say nothing changed
    if (foundRoom.version === Number(req.query.version)) {
      res.status(200).json({ success: true, changed: false, version: foundRoom.version });
      return;
    }

    // only a started game has a round state, so the lobby poll doesn't need the extra queries
    if (foundRoom.status !== "playing") {
      res.status(200).json({ success: true, gameRoom: foundRoom });
      return;
    }

    // each round sends its own state block, so a screen only gets what it can use
    const roundState =
      foundRoom.currentRound === "hype"
        ? { hype: await getHypeState(foundRoom, req.payload!._id) }
        : { bans: await getBanState(foundRoom, req.payload!._id) };

    res.status(200).json({ success: true, changed: true, gameRoom: { ...asPlain(foundRoom), ...roundState } });
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
      $inc: { version: 1 }, // tells everyone the room changed
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
          // a game opens in the ban round, unless the pool is already too small to ban from
          currentRound: pool.length <= MIN_POOL_SIZE ? "hype" : "ban",
          // everyone playing now owes exactly one submission, so remember who that is. The count
          // is what ends the round, even if someone leaves or the room fills up later
          round_players: foundRoom.players,
          round_finished: false,
          winner: null,
          // a fresh game has no cuts and no hype scoreboard yet
          eliminated_movies: [],
          hype_results: null,
        },
        $inc: { version: 1 },
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
      // the ban round hands over to the hype round in the same update, so nobody sits between
      // rounds. The guard makes sure only one ban can re-snapshot the players
      const nextRoom: any = await GameRoom.findOneAndUpdate(
        { _id: foundRoom._id, currentRound: "ban", round_finished: false },
        {
          $set: {
            currentRound: "hype",
            round_finished: false,
            // only the players still in the room owe points, so a leaver doesn't block hype
            round_players: roomAfterBan.players.map((player: any) => playerIdOf(player)),
          },
          $inc: { version: 1 },
        },
        { new: true }
      )
        .populate("players", PLAYER_FIELDS)
        .populate("remaining_movies");

      if (nextRoom) {
        // the ban reveal is still part of this response, the room just already says hype
        const bans = await getBanState(roomAfterBan, userId, true);
        res.status(200).json({ success: true, gameRoom: { ...asPlain(nextRoom), bans } });
        return;
      }
    }

    const bans = await getBanState(roomAfterBan, userId, finished);

    res.status(200).json({ success: true, gameRoom: { ...asPlain(roomAfterBan), bans } });
  } catch (err) {
    next(err);
  }
};

// POST /api/game-rooms/:code/hype
// records the logged in player's 10 points. Once everyone has spent theirs, the pool is cut to
// the top four and the losers are kept in eliminated_movies for a future revival round
export const hypeMovie = async (req: Request, res: Response, next: NextFunction) => {
  const code = normalizeCode(req.params.code);
  const userId = req.payload!._id;

  if (!code) {
    res.status(400).json({ success: false, message: "Please provide a room code." });
    return;
  }

  const rawPoints = normalizePoints(req.body?.points);

  if (!rawPoints) {
    res.status(400).json({ success: false, message: "Please enter your points." });
    return;
  }

  try {
    const foundRoom: any = await GameRoom.findOne({ code })
      .select("host players status currentRound round_finished round_players remaining_movies eliminated_movies hype_results")
      .populate("remaining_movies")
      .populate("eliminated_movies");

    if (!foundRoom) {
      res.status(404).json({ success: false, message: "Room not found." });
      return;
    }

    if (!foundRoom.players.some((player: any) => playerIdOf(player) === String(userId))) {
      res.status(403).json({ success: false, message: "You are not in this room." });
      return;
    }

    const blockReason = hypeRefusal({
      status: foundRoom.status,
      currentRound: foundRoom.currentRound,
      roundFinished: !!foundRoom.round_finished,
      alreadySubmitted: false,
    });

    if (blockReason) {
      res.status(409).json({ success: false, message: blockReason });
      return;
    }

    const poolIds: string[] = (foundRoom.remaining_movies ?? []).map(movieIdOf);

    // every key has to be a real movie in the pool before the point rules run
    const points: HypePoints = {};
    for (const [movieId, value] of Object.entries(rawPoints)) {
      if (!/^[a-f\d]{24}$/i.test(movieId) || !poolIds.includes(movieId)) {
        res.status(400).json({ success: false, message: "That movie is not in the pool." });
        return;
      }

      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        res.status(400).json({ success: false, message: "Points must be whole numbers 0 or higher" });
        return;
      }

      points[movieId] = value;
    }

    // catches the total, and anything the checks above let through
    const invalid = validateHypePoints(points, poolIds);
    if (invalid) {
      res.status(400).json({ success: false, message: invalid });
      return;
    }

    // only movies that got points are stored, so the rows stay small
    const choices = Object.entries(points)
      .filter(([, value]) => value > 0)
      .map(([movieId, value]) => ({ movie: movieId, points: value }));

    // the unique index on (room, round, player) is what locks the submission
    try {
      await Submission.create({ room: foundRoom._id, round: "hype", player: userId, choices });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      res.status(409).json({ success: false, message: "You already spent your points in this round." });
      return;
    }

    const submitted = await Submission.countDocuments({ room: foundRoom._id, round: "hype" });
    const finished = isHypeRoundFinished(submitted, foundRoom.round_players?.length ?? 0);

    if (!finished) {
      const hype = await getHypeState(foundRoom, userId, false);
      res.status(200).json({ success: true, gameRoom: { ...asPlain(foundRoom), hype } });
      return;
    }

    // the cutoff needs the whole table, not just this player's row
    const allSubmissions: any[] = await Submission.find({ room: foundRoom._id, round: "hype" });
    const pointsByPlayer = allSubmissions.map((submission) =>
      Object.fromEntries(
        (submission.choices ?? []).map((choice: any) => [movieIdOf(choice.movie), choice.points ?? 0])
      )
    ) as HypePoints[];

    const totals = totalHypePoints(pointsByPlayer, poolIds);
    const { qualifiers, cutoffTie, tied } = pickQualifiers(totals, poolIds);
    const survivorIds = new Set(qualifiers);
    const cutIds = poolIds.filter((movieId) => !survivorIds.has(movieId));

    // the guard means only one request can finish the round, so the tiebreak is only drawn once
    const finishedRoom: any = await GameRoom.findOneAndUpdate(
      { _id: foundRoom._id, currentRound: "hype", round_finished: false },
      {
        $set: {
          round_finished: true,
          remaining_movies: poolIds.filter((movieId) => survivorIds.has(movieId)),
          hype_results: {
            totals: poolIds.map((movieId) => ({ movie: movieId, points: totals[movieId] ?? 0 })),
            cutoff_tie: cutoffTie,
            tied_movies: tied,
          },
        },
        $addToSet: { eliminated_movies: { $each: cutIds } },
        $inc: { version: 1 },
      },
      { new: true }
    )
      .populate("players", PLAYER_FIELDS)
      .populate("remaining_movies")
      .populate("eliminated_movies");

    if (!finishedRoom) {
      // another player finished the round first, so read the results they saved
      const savedRoom: any = await GameRoom.findOne({ _id: foundRoom._id })
        .populate("players", PLAYER_FIELDS)
        .populate("remaining_movies")
        .populate("eliminated_movies");

      const hype = await getHypeState(savedRoom, userId, true);
      res.status(200).json({ success: true, gameRoom: { ...asPlain(savedRoom), hype } });
      return;
    }

    const hype = await getHypeState(finishedRoom, userId, true);
    res.status(200).json({ success: true, gameRoom: { ...asPlain(finishedRoom), hype } });
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
