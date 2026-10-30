import { Request, Response, NextFunction } from "express";
import GameRoom, { ROOM_STATUSES } from "../models/GameRoom.model";
import User from "../models/User.model";
import Movie from "../models/Movie.model";
import { buildPool } from "../services/pool";

const CODE_LENGTH = 6;
const CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// a new code can collide with an existing room, so try a few times before giving up
const MAX_CODE_ATTEMPTS = 5;

// a game needs at least 2 people to start, and a room holds at most 12
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

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

// mongo throws error 11000 when a unique field (here: code) already exists
const isDuplicateCode = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

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
        if (!isDuplicateCode(err)) throw err;
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
      .populate("pool")
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

    res.status(200).json({ success: true, gameRoom: foundRoom });
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
      { $set: { pool, status: "playing" } },
      { new: true }
    )
    .populate("players", PLAYER_FIELDS)
    .populate("pool");

    if (!startedRoom) {
      res.status(409).json({ success: false, message: "This game has already started." });
      return;
    }

    res.status(200).json({ success: true, gameRoom: startedRoom });
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
