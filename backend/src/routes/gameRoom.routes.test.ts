import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../app";
import GameRoom from "../models/GameRoom.model";
import User from "../models/User.model";
import Movie from "../models/Movie.model";
import { buildPool } from "../services/pool";
import { makeRoomCode } from "../controllers/gameRoom.controller";

// the app connects to Mongo on import and there is no db in tests
vi.mock("../db", () => ({}));

// keep the request log out of the test output
vi.mock("morgan", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// keep the real ROOM_STATUSES, only fake the db calls
vi.mock("../models/GameRoom.model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../models/GameRoom.model")>()),
  default: {
    create: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    find: vi.fn(),
    deleteOne: vi.fn(),
  },
}));

vi.mock("../models/User.model", () => ({ default: { find: vi.fn() } }));
vi.mock("../models/Movie.model", () => ({ default: { find: vi.fn() } }));

// the pool is random, so fake it and only check what it gets called with
vi.mock("../services/pool", () => ({ buildPool: vi.fn() }));

const create = GameRoom.create as unknown as Mock;
const findOne = GameRoom.findOne as unknown as Mock;
const findOneAndUpdate = GameRoom.findOneAndUpdate as unknown as Mock;
const findByIdAndUpdate = GameRoom.findByIdAndUpdate as unknown as Mock;
const find = GameRoom.find as unknown as Mock;
const deleteOne = GameRoom.deleteOne as unknown as Mock;
const findUsers = User.find as unknown as Mock;
const findMovies = Movie.find as unknown as Mock;
const buildPoolMock = buildPool as unknown as Mock;

const secret = "test-secret";
const originalSecret = process.env.TOKEN_SECRET;

const hostId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();
const roomId = new mongoose.Types.ObjectId();

const authCookie = (userId: mongoose.Types.ObjectId) =>
  `authToken=${jwt.sign({ _id: userId.toString() }, secret)}`;

// fake mongoose query: .select/.sort/.populate can be chained in any order, and awaiting it gives `result`
function mockQuery(result: unknown) {
  const query = {
    select: vi.fn(() => query),
    sort: vi.fn(() => query),
    populate: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_SECRET = secret;
});

afterAll(() => {
  process.env.TOKEN_SECRET = originalSecret;
});

describe("makeRoomCode", () => {
  it("makes 6 uppercase letters", () => {
    for (let i = 0; i < 50; i++) {
      expect(makeRoomCode()).toMatch(/^[A-Z]{6}$/);
    }
  });
});

describe("game room routes need a logged in user", () => {
  it.each([
    ["get", "/api/game-rooms"],
    ["post", "/api/game-rooms"],
    ["post", "/api/game-rooms/join"],
    ["get", "/api/game-rooms/ABCDEF"],
    ["post", "/api/game-rooms/ABCDEF/leave"],
    ["post", "/api/game-rooms/ABCDEF/start"],
    ["delete", "/api/game-rooms/ABCDEF"],
  ] as const)("%s %s returns 401 without a token", async (method, url) => {
    const res = await request(app)[method](url);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe("POST /api/game-rooms", () => {
  it("creates a room with the user as host and first player", async () => {
    create.mockImplementation(async (data: Record<string, unknown>) => ({ _id: roomId.toString(), ...data, status: "lobby" }));

    const res = await request(app).post("/api/game-rooms").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.gameRoom.code).toMatch(/^[A-Z]{6}$/);
    expect(res.body.gameRoom.host).toBe(hostId.toString());
    expect(res.body.gameRoom.players).toEqual([hostId.toString()]);
    expect(res.body.gameRoom.status).toBe("lobby");
  });

  it("tries a new code when the first one is already taken", async () => {
    create
      .mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: 11000 }))
      .mockImplementation(async (data: Record<string, unknown>) => ({ _id: roomId.toString(), ...data }));

    const res = await request(app).post("/api/game-rooms").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("gives up with a 500 after too many code collisions", async () => {
    create.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: 11000 }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).post("/api/game-rooms").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(create).toHaveBeenCalledTimes(5);

    consoleError.mockRestore();
  });
});

describe("POST /api/game-rooms/join", () => {
  it("adds the user to a lobby, looking the code up in uppercase", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, players: [hostId], status: "lobby" }));
    const joinedRoom = { _id: roomId.toString(), code: "ABCDEF", players: [] };
    const updateQuery = mockQuery(joinedRoom);
    findOneAndUpdate.mockReturnValue(updateQuery);

    const res = await request(app)
      .post("/api/game-rooms/join")
      .set("Cookie", authCookie(otherId))
      .send({ code: " abcdef " });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, gameRoom: joinedRoom });
    expect(findOne).toHaveBeenCalledWith({ code: "ABCDEF" });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: roomId, status: "lobby", "players.11": { $exists: false } },
      { $addToSet: { players: otherId.toString() } },
      { new: true }
    );
    expect(updateQuery.populate).toHaveBeenCalledWith("players", "name username");
  });

  it("lets a player who is already in a started game rejoin", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, players: [hostId, otherId], status: "playing" }));
    findOneAndUpdate.mockReturnValue(mockQuery({ _id: roomId.toString() }));

    const res = await request(app)
      .post("/api/game-rooms/join")
      .set("Cookie", authCookie(otherId))
      .send({ code: "ABCDEF" });

    expect(res.status).toBe(200);
    expect(findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: roomId });
  });

  it("returns 400 without a code", async () => {
    const res = await request(app).post("/api/game-rooms/join").set("Cookie", authCookie(otherId)).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Please enter a room code." });
    expect(findOne).not.toHaveBeenCalled();
  });

  it.each(["ABC", "ABCDEFG", "ABC123", "AB CD!"])("returns 400 for a badly formatted code (%s)", async (code) => {
    const res = await request(app).post("/api/game-rooms/join").set("Cookie", authCookie(otherId)).send({ code });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Room codes are 6 letters, like ABCDEF." });
    expect(findOne).not.toHaveBeenCalled();
  });

  it("returns 404 when no room has that code", async () => {
    findOne.mockReturnValue(mockQuery(null));

    const res = await request(app)
      .post("/api/game-rooms/join")
      .set("Cookie", authCookie(otherId))
      .send({ code: "ZZZZZZ" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "No room found with code ZZZZZZ. Check the code and try again.",
    });
  });

  it("returns 409 when the room is full", async () => {
    const fullRoom = Array.from({ length: 12 }, () => new mongoose.Types.ObjectId());
    findOne.mockReturnValue(mockQuery({ _id: roomId, players: fullRoom, status: "lobby" }));

    const res = await request(app)
      .post("/api/game-rooms/join")
      .set("Cookie", authCookie(otherId))
      .send({ code: "ABCDEF" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "This room is full (12/12 players)." });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["playing", "This game has already started."],
    ["completed", "This game is already over."],
  ])("returns 409 for new players when the room is %s", async (status, message) => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, players: [hostId], status }));

    const res = await request(app)
      .post("/api/game-rooms/join")
      .set("Cookie", authCookie(otherId))
      .send({ code: "ABCDEF" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 when the room fills or the game starts between the lookup and the update", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, players: [hostId], status: "lobby" }));
    findOneAndUpdate.mockReturnValue(mockQuery(null));

    const res = await request(app)
      .post("/api/game-rooms/join")
      .set("Cookie", authCookie(otherId))
      .send({ code: "ABCDEF" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "The room just filled up or the game started. Try another room.",
    });
  });
});

describe("GET /api/game-rooms", () => {
  it("returns the user's rooms newest first with their status", async () => {
    const rooms = [
      { code: "ABCDEF", status: "completed" },
      { code: "GHIJKL", status: "lobby" },
    ];
    const query = mockQuery(rooms);
    find.mockReturnValue(query);

    const res = await request(app).get("/api/game-rooms").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, gameRooms: rooms });
    expect(find).toHaveBeenCalledWith({ players: hostId.toString() });
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it("filters by ?status", async () => {
    find.mockReturnValue(mockQuery([]));

    await request(app).get("/api/game-rooms?status=completed").set("Cookie", authCookie(hostId));

    expect(find).toHaveBeenCalledWith({ players: hostId.toString(), status: "completed" });
  });

  it("returns 400 for an unknown ?status", async () => {
    const res = await request(app).get("/api/game-rooms?status=done").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "status must be one of: lobby, playing, completed." });
    expect(find).not.toHaveBeenCalled();
  });
});

describe("GET /api/game-rooms/:code", () => {
  const room = {
    _id: roomId,
    code: "ABCDEF",
    host: { _id: hostId, username: "ada" },
    players: [{ _id: hostId, username: "ada" }],
    status: "lobby",
  };

  it("returns the room to a player in it", async () => {
    const query = mockQuery(room);
    findOne.mockReturnValue(query);

    const res = await request(app).get("/api/game-rooms/abcdef").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.gameRoom.code).toBe("ABCDEF");
    expect(findOne).toHaveBeenCalledWith({ code: "ABCDEF" });
    expect(query.populate).toHaveBeenCalledWith("players", "name username");
    expect(query.populate).toHaveBeenCalledWith("pool");
  });

  it("returns 403 to someone who isn't in the room", async () => {
    findOne.mockReturnValue(mockQuery(room));

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(otherId));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: "You are not in this room." });
  });

  it("returns 404 when no room has that code", async () => {
    findOne.mockReturnValue(mockQuery(null));

    const res = await request(app).get("/api/game-rooms/ZZZZZZ").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Room not found." });
  });
});

describe("POST /api/game-rooms/:code/leave", () => {
  it("removes a player and keeps the host", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, host: hostId, players: [hostId, otherId], status: "lobby" }));
    findByIdAndUpdate.mockResolvedValue({});

    const res = await request(app).post("/api/game-rooms/ABCDEF/leave").set("Cookie", authCookie(otherId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "You left the room." });
    expect(findByIdAndUpdate).toHaveBeenCalledWith(roomId, {
      $pull: { players: otherId.toString() },
      $set: { host: hostId },
    });
  });

  it("makes the next player host when the host leaves", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, host: hostId, players: [hostId, otherId], status: "playing" }));
    findByIdAndUpdate.mockResolvedValue({});

    const res = await request(app).post("/api/game-rooms/ABCDEF/leave").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(findByIdAndUpdate).toHaveBeenCalledWith(roomId, {
      $pull: { players: hostId.toString() },
      $set: { host: otherId },
    });
  });

  it("deletes the room when the last player leaves", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, host: hostId, players: [hostId], status: "lobby" }));
    deleteOne.mockResolvedValue({ deletedCount: 1 });

    const res = await request(app).post("/api/game-rooms/ABCDEF/leave").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "You left the room. It was empty, so it was deleted." });
    expect(deleteOne).toHaveBeenCalledWith({ _id: roomId });
    expect(findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when the user isn't in the room", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, host: hostId, players: [hostId], status: "lobby" }));

    const res = await request(app).post("/api/game-rooms/ABCDEF/leave").set("Cookie", authCookie(otherId));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "You are not in this room." });
  });

  it("returns 409 for a completed game, so it stays in the summary", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, host: hostId, players: [hostId, otherId], status: "completed" }));

    const res = await request(app).post("/api/game-rooms/ABCDEF/leave").set("Cookie", authCookie(otherId));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "This game is already over." });
    expect(findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when no room has that code", async () => {
    findOne.mockReturnValue(mockQuery(null));

    const res = await request(app).post("/api/game-rooms/ZZZZZZ/leave").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(404);
  });
});

describe("POST /api/game-rooms/:code/start", () => {
  const movieA = new mongoose.Types.ObjectId();
  const movieB = new mongoose.Types.ObjectId();
  const deletedMovie = new mongoose.Types.ObjectId();

  const lobby = { _id: roomId, host: hostId, players: [hostId, otherId], status: "lobby" };

  it("builds the pool from the players' watchlists and starts the game", async () => {
    findOne.mockReturnValue(mockQuery(lobby));
    findUsers.mockReturnValue(mockQuery([{ watchlist: [movieA, deletedMovie] }, { watchlist: [movieB] }]));
    findMovies.mockReturnValue(mockQuery([{ _id: movieA }, { _id: movieB }]));
    buildPoolMock.mockReturnValue([movieA.toString(), movieB.toString()]);
    const startedRoom = { _id: roomId.toString(), status: "playing", pool: [] };
    findOneAndUpdate.mockReturnValue(mockQuery(startedRoom));

    const res = await request(app).post("/api/game-rooms/abcdef/start").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, gameRoom: startedRoom });
    expect(findUsers).toHaveBeenCalledWith({ _id: { $in: [hostId, otherId] } });
    // the deleted movie is dropped from the watchlist before building the pool
    expect(buildPoolMock).toHaveBeenCalledWith(
      [[movieA.toString()], [movieB.toString()]],
      [movieA.toString(), movieB.toString()]
    );
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: roomId, status: "lobby" },
      { $set: { pool: [movieA.toString(), movieB.toString()], status: "playing" } },
      { new: true }
    );
  });

  it("returns 403 when someone other than the host tries", async () => {
    findOne.mockReturnValue(mockQuery(lobby));

    const res = await request(app).post("/api/game-rooms/ABCDEF/start").set("Cookie", authCookie(otherId));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: "Only the host can start the game." });
    expect(buildPoolMock).not.toHaveBeenCalled();
  });

  it("returns 409 when there aren't enough players", async () => {
    findOne.mockReturnValue(mockQuery({ ...lobby, players: [hostId] }));

    const res = await request(app).post("/api/game-rooms/ABCDEF/start").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "You need at least 2 players to start (1/2)." });
    expect(buildPoolMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the game has already started", async () => {
    findOne.mockReturnValue(mockQuery({ ...lobby, status: "playing" }));

    const res = await request(app).post("/api/game-rooms/ABCDEF/start").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "This game has already started." });
    expect(buildPoolMock).not.toHaveBeenCalled();
  });

  it("returns 409 when start is clicked twice at the same time", async () => {
    findOne.mockReturnValue(mockQuery(lobby));
    findUsers.mockReturnValue(mockQuery([]));
    findMovies.mockReturnValue(mockQuery([{ _id: movieA }]));
    buildPoolMock.mockReturnValue([movieA.toString()]);
    findOneAndUpdate.mockReturnValue(mockQuery(null));

    const res = await request(app).post("/api/game-rooms/ABCDEF/start").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(409);
  });

  it("returns 500 when there are no movies to build a pool from", async () => {
    findOne.mockReturnValue(mockQuery(lobby));
    findUsers.mockReturnValue(mockQuery([]));
    findMovies.mockReturnValue(mockQuery([]));
    buildPoolMock.mockReturnValue([]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).post("/api/game-rooms/ABCDEF/start").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(500);
    expect(findOneAndUpdate).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

describe("DELETE /api/game-rooms/:code", () => {
  it("lets the host delete the room", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, host: hostId }));
    deleteOne.mockResolvedValue({ deletedCount: 1 });

    const res = await request(app).delete("/api/game-rooms/abcdef").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Room deleted." });
    expect(findOne).toHaveBeenCalledWith({ code: "ABCDEF" });
    expect(deleteOne).toHaveBeenCalledWith({ _id: roomId });
  });

  it("returns 403 when someone other than the host tries", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, host: hostId }));

    const res = await request(app).delete("/api/game-rooms/ABCDEF").set("Cookie", authCookie(otherId));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: "Only the host can delete this room." });
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("returns 404 when no room has that code", async () => {
    findOne.mockReturnValue(mockQuery(null));

    const res = await request(app).delete("/api/game-rooms/ZZZZZZ").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Room not found." });
  });
});
