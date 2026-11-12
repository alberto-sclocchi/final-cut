import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../app";
import GameRoom from "../models/GameRoom.model";
import User from "../models/User.model";
import Movie from "../models/Movie.model";
import Submission from "../models/Submission.model";
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
    updateOne: vi.fn(),
  },
}));

vi.mock("../models/User.model", () => ({ default: { find: vi.fn() } }));
vi.mock("../models/Movie.model", () => ({ default: { find: vi.fn() } }));
vi.mock("../models/Submission.model", () => ({
  default: { create: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn(), find: vi.fn() },
}));

// the pool is random, so fake it and only check what it gets called with
vi.mock("../services/pool", () => ({ buildPool: vi.fn() }));

const create = GameRoom.create as unknown as Mock;
const findOne = GameRoom.findOne as unknown as Mock;
const findOneAndUpdate = GameRoom.findOneAndUpdate as unknown as Mock;
const findByIdAndUpdate = GameRoom.findByIdAndUpdate as unknown as Mock;
const find = GameRoom.find as unknown as Mock;
const deleteOne = GameRoom.deleteOne as unknown as Mock;
const updateOne = GameRoom.updateOne as unknown as Mock;
const findUsers = User.find as unknown as Mock;
const findMovies = Movie.find as unknown as Mock;
const createSubmission = Submission.create as unknown as Mock;
const countSubmissions = Submission.countDocuments as unknown as Mock;
const findSubmission = Submission.findOne as unknown as Mock;
const findSubmissions = Submission.find as unknown as Mock;
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
  // defaults so the ban state reads don't blow up in tests that don't care about them
  countSubmissions.mockResolvedValue(0);
  findSubmission.mockReturnValue(mockQuery(null));
  findSubmissions.mockReturnValue(mockQuery([]));
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
    ["post", "/api/game-rooms/ABCDEF/ban"],
    ["post", "/api/game-rooms/ABCDEF/hype"],
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
      { _id: roomId, status: "lobby", "players.7": { $exists: false } },
      { $inc: { version: 1 }, $addToSet: { players: otherId.toString() } },
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
    const fullRoom = Array.from({ length: 8 }, () => new mongoose.Types.ObjectId());
    findOne.mockReturnValue(mockQuery({ _id: roomId, players: fullRoom, status: "lobby" }));

    const res = await request(app)
      .post("/api/game-rooms/join")
      .set("Cookie", authCookie(otherId))
      .send({ code: "ABCDEF" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "This room is full (8/8 players)." });
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
    expect(query.populate).toHaveBeenCalledWith("remaining_movies");
  });

  it("returns changed=false when the client already has the latest version", async () => {
    findOne.mockReturnValue(mockQuery({ ...room, version: 3 }));

    const res = await request(app).get("/api/game-rooms/ABCDEF?version=3").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, changed: false, version: 3 });
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
      $inc: { version: 1 }, $pull: { players: otherId.toString() },
      $set: { host: hostId },
    });
  });

  it("makes the next player host when the host leaves", async () => {
    findOne.mockReturnValue(mockQuery({ _id: roomId, host: hostId, players: [hostId, otherId], status: "playing" }));
    findByIdAndUpdate.mockResolvedValue({});

    const res = await request(app).post("/api/game-rooms/ABCDEF/leave").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(findByIdAndUpdate).toHaveBeenCalledWith(roomId, {
      $inc: { version: 1 }, $pull: { players: hostId.toString() },
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
    // a real pool is bigger than the ban round's floor, so the round starts collecting
    const poolIds = Array.from({ length: 12 }, () => new mongoose.Types.ObjectId().toString());
    buildPoolMock.mockReturnValue(poolIds);
    const startedRoom = { _id: roomId.toString(), status: "playing", remaining_movies: [] };
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
      {
        $set: {
          remaining_movies: poolIds,
          status: "playing",
          currentRound: "ban",
          round_players: [hostId, otherId],
          round_finished: false,
          winner: null,
          eliminated_movies: [],
          hype_results: null,
        },
        $inc: { version: 1 },
      },
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

  it("starts the ban round already finished when the pool is at the floor", async () => {
    findOne.mockReturnValue(mockQuery(lobby));
    findUsers.mockReturnValue(mockQuery([]));
    findMovies.mockReturnValue(mockQuery([]));
    const sixMovies = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId());
    buildPoolMock.mockReturnValue(sixMovies.map((id) => id.toString()));
    findOneAndUpdate.mockReturnValue(mockQuery({ _id: roomId.toString(), status: "playing" }));

    const res = await request(app).post("/api/game-rooms/ABCDEF/start").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    // nothing can be banned from a pool at the floor, so the game opens on the hype round
    expect(findOneAndUpdate.mock.calls[0][1].$set.round_finished).toBe(false);
    expect(findOneAndUpdate.mock.calls[0][1].$set.currentRound).toBe("hype");
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

describe("POST /api/game-rooms/:code/ban", () => {
  // a full 12-movie pool, like a real game
  const pool = Array.from({ length: 12 }, () => new mongoose.Types.ObjectId());
  const banned = pool[0];

  const playingRoom = (overrides: Record<string, unknown> = {}) => ({
    _id: roomId,
    host: hostId,
    players: [hostId, otherId],
    status: "playing",
    currentRound: "ban",
    round_finished: false,
    round_players: [hostId, otherId],
    remaining_movies: [...pool],
    ...overrides,
  });

  // the room as it comes back after the movie was pulled from the pool
  const banResponse = (movies = pool.slice(1)) => mockQuery({ ...playingRoom(), remaining_movies: movies });

  it("bans a movie and records it as a ban round submission", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom()));
    findOneAndUpdate.mockReturnValue(banResponse());
    createSubmission.mockResolvedValue({});
    countSubmissions.mockResolvedValue(1);
    findSubmission.mockReturnValue(mockQuery({ choices: [{ movie: { _id: banned, title: "A" } }] }));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // the filter re-checks everything, so a second player can't take the same movie
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: roomId,
        status: "playing",
        currentRound: "ban",
        round_finished: false,
        remaining_movies: banned.toString(),
      },
      { $pull: { remaining_movies: banned.toString() } },
      { new: true }
    );
    expect(createSubmission).toHaveBeenCalledWith({
      room: roomId,
      round: "ban",
      player: hostId.toString(),
      choices: [{ movie: banned.toString() }],
    });
    expect(res.body.gameRoom.remaining_movies).toHaveLength(11);
    expect(res.body.gameRoom.bans).toMatchObject({
      submitted: 1,
      required: 2,
      finished: false,
      can_ban: false,
      block_reason: "You already banned a movie.",
      banned_movies: [],
    });
    expect(res.body.gameRoom.bans.my_movie.title).toBe("A");
  });

  it("returns 409 and writes nothing when the pool is at the floor", async () => {
    const movies = pool.slice(0, 6);
    findOne.mockReturnValue(mockQuery(playingRoom({ remaining_movies: movies })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: movies[0].toString() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "The pool is at its minimum of 6 movies, so no more bans are allowed.",
    });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns 400 for a movie that is not in the pool", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom()));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: new mongoose.Types.ObjectId().toString() });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "That movie is not in the pool." });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([["missing", {}], ["not an id", { movieId: "nope" }]])(
    "returns 400 when the movie id is %s",
    async (_label, body) => {
      const res = await request(app)
        .post("/api/game-rooms/ABCDEF/ban")
        .set("Cookie", authCookie(hostId))
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: "Please pick a movie to ban." });
      expect(findOne).not.toHaveBeenCalled();
    }
  );

  it("returns 403 to someone who isn't in the room", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom({ players: [hostId] })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(otherId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: "You are not in this room." });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when no room has that code", async () => {
    findOne.mockReturnValue(mockQuery(null));

    const res = await request(app)
      .post("/api/game-rooms/ZZZZZZ/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(404);
  });

  it.each([
    ["lobby", "This game has not started."],
    ["completed", "This game is already over."],
  ])("returns 409 for a %s room", async (status, message) => {
    findOne.mockReturnValue(mockQuery(playingRoom({ status })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns 409 when it is not the ban round", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom({ currentRound: "hype" })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "It is not the ban round." });
  });

  it("returns 409 when the ban round is already over", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom({ round_finished: true })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "The ban round is already over." });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 when another player just banned that movie", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom()));
    findOneAndUpdate.mockReturnValue(mockQuery(null));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "That movie was just banned by another player.",
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns 409 and puts the movie back when the player already banned", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom()));
    findOneAndUpdate.mockReturnValue(banResponse());
    createSubmission.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: 11000 }));
    updateOne.mockResolvedValue({});

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "You have already banned a movie in this round.",
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: roomId },
      { $addToSet: { remaining_movies: banned.toString() } }
    );
  });

  it("finishes the ban round and hands over to the hype round", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom()));
    findOneAndUpdate
      .mockReturnValueOnce(banResponse())
      .mockReturnValueOnce(mockQuery({ ...playingRoom(), currentRound: "hype", remaining_movies: pool.slice(1) }));
    createSubmission.mockResolvedValue({});
    countSubmissions.mockResolvedValue(2);

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(200);
    // the handover uses the same guard, so two last bans can't re-snapshot the players
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: roomId, currentRound: "ban", round_finished: false },
      {
        $set: {
          currentRound: "hype",
          round_finished: false,
          round_players: [hostId.toString(), otherId.toString()],
        },
        $inc: { version: 1 },
      },
      { new: true }
    );
    expect(res.body.gameRoom.bans.finished).toBe(true);
    expect(res.body.gameRoom.status).toBe("playing");
    expect(res.body.gameRoom.currentRound).toBe("hype");
  });

  it("hands over to the hype round when the pool reaches the floor", async () => {
    const movies = pool.slice(0, 7);
    findOne.mockReturnValue(mockQuery(playingRoom({ remaining_movies: movies, round_players: [hostId, otherId, hostId] })));
    findOneAndUpdate
      .mockReturnValueOnce(banResponse(movies.slice(1)))
      .mockReturnValueOnce(mockQuery({ ...playingRoom({ remaining_movies: movies.slice(1) }), currentRound: "hype" }));
    createSubmission.mockResolvedValue({});
    countSubmissions.mockResolvedValue(1);

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: movies[0].toString() });

    expect(res.status).toBe(200);
    expect(findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: roomId, currentRound: "ban", round_finished: false },
      {
        $set: {
          currentRound: "hype",
          round_finished: false,
          round_players: [hostId.toString(), otherId.toString()],
        },
        $inc: { version: 1 },
      },
      { new: true }
    );
    expect(res.body.gameRoom.bans.finished).toBe(true);
  });

  it("keeps the round open while bans are missing", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom({ round_players: [hostId, otherId, hostId] })));
    findOneAndUpdate.mockReturnValue(banResponse());
    createSubmission.mockResolvedValue({});
    countSubmissions.mockResolvedValue(1);

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/ban")
      .set("Cookie", authCookie(hostId))
      .send({ movieId: banned.toString() });

    expect(res.status).toBe(200);
    expect(updateOne).not.toHaveBeenCalled();
    expect(res.body.gameRoom.bans.finished).toBe(false);
  });
});

describe("GET /api/game-rooms/:code ban state", () => {
  const pool = Array.from({ length: 12 }, () => new mongoose.Types.ObjectId());

  const playingRoom = (overrides: Record<string, unknown> = {}) => ({
    _id: roomId,
    code: "ABCDEF",
    host: { _id: hostId, username: "ada" },
    players: [
      { _id: hostId, username: "ada" },
      { _id: otherId, username: "bob" },
    ],
    status: "playing",
    currentRound: "ban",
    round_finished: false,
    round_players: [hostId, otherId],
    remaining_movies: [...pool],
    ...overrides,
  });

  it("returns the progress without revealing other players' bans", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom()));
    countSubmissions.mockResolvedValue(1);

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body.gameRoom.bans).toEqual({
      submitted: 1,
      required: 2,
      finished: false,
      can_ban: true,
      block_reason: null,
      my_movie: null,
      banned_movies: [],
    });
    // only a count, never the rows of the other players
    expect(findSubmissions).not.toHaveBeenCalled();
  });

  it("tells a player who already banned that they are locked in", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom()));
    countSubmissions.mockResolvedValue(1);
    findSubmission.mockReturnValue(mockQuery({ choices: [{ movie: { _id: pool[0], title: "A" } }] }));

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(hostId));

    expect(res.body.gameRoom.bans.can_ban).toBe(false);
    expect(res.body.gameRoom.bans.block_reason).toBe("You already banned a movie.");
    expect(res.body.gameRoom.bans.my_movie.title).toBe("A");
  });

  it("tells a player when the pool is at its minimum", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom({ remaining_movies: pool.slice(0, 6) })));

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(hostId));

    expect(res.body.gameRoom.bans.can_ban).toBe(false);
    expect(res.body.gameRoom.bans.block_reason).toBe("The pool is at its minimum of 6 movies.");
  });

  it("reveals the banned movies after the round, without who banned them", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom({ round_finished: true })));
    countSubmissions.mockResolvedValue(2);
    findSubmissions.mockReturnValue(
      mockQuery([
        { choices: [{ movie: { _id: pool[0], title: "A" } }] },
        { choices: [{ movie: { _id: pool[1], title: "B" } }] },
      ])
    );

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(hostId));

    expect(res.body.gameRoom.bans.finished).toBe(true);
    expect(res.body.gameRoom.bans.banned_movies.map((movie: { title: string }) => movie.title)).toEqual([
      "A",
      "B",
    ]);
    expect(res.body.gameRoom.bans.banned_movies[0]).not.toHaveProperty("player");
  });

  it("does not look at bans while the room is still a lobby", async () => {
    findOne.mockReturnValue(
      mockQuery({ _id: roomId, code: "ABCDEF", players: [{ _id: hostId }], status: "lobby" })
    );

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body.gameRoom).not.toHaveProperty("bans");
    expect(countSubmissions).not.toHaveBeenCalled();
  });
});

describe("POST /api/game-rooms/:code/hype", () => {
  // a full hype pool: six movies, so the round has two to cut
  const pool = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId());
  const movieObjects = pool.map((id, index) => ({ _id: id, title: `Movie ${index}` }));

  const hypeRoom = (overrides: Record<string, unknown> = {}) => ({
    _id: roomId,
    host: hostId,
    players: [hostId, otherId],
    status: "playing",
    currentRound: "hype",
    round_finished: false,
    round_players: [hostId, otherId],
    remaining_movies: movieObjects,
    eliminated_movies: [],
    hype_results: null,
    ...overrides,
  });

  // both players' points add up to 9, 8, 2, 1, 0, 0, so the top four are clear
  const allSubmissions = [
    {
      player: { _id: hostId, username: "ada" },
      choices: [
        { movie: movieObjects[0], points: 5 },
        { movie: movieObjects[1], points: 3 },
        { movie: movieObjects[2], points: 2 },
      ],
    },
    {
      player: { _id: otherId, username: "bob" },
      choices: [
        { movie: movieObjects[0], points: 4 },
        { movie: movieObjects[1], points: 5 },
        { movie: movieObjects[3], points: 1 },
      ],
    },
  ];

  const finishedRoom = {
    ...hypeRoom(),
    round_finished: true,
    remaining_movies: movieObjects.slice(0, 4),
    eliminated_movies: movieObjects.slice(4),
    hype_results: {
      totals: pool.map((id, index) => ({ movie: id, points: [9, 8, 2, 1, 0, 0][index] })),
      cutoff_tie: false,
      tied_movies: [],
    },
  };

  it("records the player's points as a hype submission", async () => {
    findOne.mockReturnValue(mockQuery(hypeRoom()));
    createSubmission.mockResolvedValue({});
    countSubmissions.mockResolvedValue(1);
    findSubmissions.mockReturnValue(
      mockQuery([
        {
          player: { _id: hostId, username: "ada" },
          choices: [
            { movie: movieObjects[0], points: 4 },
            { movie: movieObjects[1], points: 6 },
          ],
        },
      ])
    );

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send({ points: { [pool[0].toString()]: 4, [pool[1].toString()]: 6 } });

    expect(res.status).toBe(200);
    expect(createSubmission).toHaveBeenCalledWith({
      room: roomId,
      round: "hype",
      player: hostId.toString(),
      choices: [
        { movie: pool[0].toString(), points: 4 },
        { movie: pool[1].toString(), points: 6 },
      ],
    });
    expect(res.body.gameRoom.hype).toMatchObject({
      submitted: 1,
      required: 2,
      finished: false,
      can_submit: false,
      block_reason: "You already spent your points in this round.",
      qualifiers: [],
      cut_movies: [],
    });
    expect(res.body.gameRoom.hype.my_points[0].movie.title).toBe("Movie 0");
  });

  it.each([
    ["missing points", {}, "Please enter your points."],
    ["points that aren't an object", { points: [] }, "Please enter your points."],
    [
      "a movie outside the pool",
      { points: { [new mongoose.Types.ObjectId().toString()]: 10 } },
      "That movie is not in the pool.",
    ],
    ["a badly formatted movie id", { points: { nope: 10 } }, "That movie is not in the pool."],
    [
      "negative points",
      { points: { [pool[0].toString()]: -1, [pool[1].toString()]: 11 } },
      "Points must be whole numbers 0 or higher",
    ],
    [
      "fractional points",
      { points: { [pool[0].toString()]: 2.5, [pool[1].toString()]: 7.5 } },
      "Points must be whole numbers 0 or higher",
    ],
    [
      "a total that isn't 10",
      { points: { [pool[0].toString()]: 4, [pool[1].toString()]: 5 } },
      "Points must add up to exactly 10, got 9",
    ],
  ])("returns 400 for %s", async (_label, body, message) => {
    findOne.mockReturnValue(mockQuery(hypeRoom()));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns 403 to someone who isn't in the room", async () => {
    findOne.mockReturnValue(mockQuery(hypeRoom({ players: [hostId] })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(otherId))
      .send({ points: { [pool[0].toString()]: 10 } });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: "You are not in this room." });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns 404 when no room has that code", async () => {
    findOne.mockReturnValue(mockQuery(null));

    const res = await request(app)
      .post("/api/game-rooms/ZZZZZZ/hype")
      .set("Cookie", authCookie(hostId))
      .send({ points: { [pool[0].toString()]: 10 } });

    expect(res.status).toBe(404);
  });

  it.each([
    ["lobby", "This game has not started."],
    ["completed", "This game is already over."],
  ])("returns 409 for a %s room", async (status, message) => {
    findOne.mockReturnValue(mockQuery(hypeRoom({ status })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send({ points: { [pool[0].toString()]: 10 } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns 409 when it is not the hype round", async () => {
    findOne.mockReturnValue(mockQuery(hypeRoom({ currentRound: "ban" })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send({ points: { [pool[0].toString()]: 10 } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "It is not the hype round." });
  });

  it("returns 409 when the hype round is already over", async () => {
    findOne.mockReturnValue(mockQuery(hypeRoom({ round_finished: true })));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send({ points: { [pool[0].toString()]: 10 } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "The hype round is over." });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns 409 when the player already submitted", async () => {
    findOne.mockReturnValue(mockQuery(hypeRoom()));
    createSubmission.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: 11000 }));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send({ points: { [pool[0].toString()]: 10 } });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "You already spent your points in this round.",
    });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("cuts the pool to the top four when the last player submits", async () => {
    findOne.mockReturnValue(mockQuery(hypeRoom()));
    createSubmission.mockResolvedValue({});
    countSubmissions.mockResolvedValue(2);
    findSubmissions.mockReturnValue(mockQuery(allSubmissions));
    findOneAndUpdate.mockReturnValue(mockQuery(finishedRoom));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send({
        points: {
          [pool[0].toString()]: 5,
          [pool[1].toString()]: 3,
          [pool[2].toString()]: 2,
        },
      });

    expect(res.status).toBe(200);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: roomId, currentRound: "hype", round_finished: false },
      {
        $set: {
          round_finished: true,
          remaining_movies: pool.slice(0, 4).map((id) => id.toString()),
          hype_results: {
            totals: [
              { movie: pool[0].toString(), points: 9 },
              { movie: pool[1].toString(), points: 8 },
              { movie: pool[2].toString(), points: 2 },
              { movie: pool[3].toString(), points: 1 },
              { movie: pool[4].toString(), points: 0 },
              { movie: pool[5].toString(), points: 0 },
            ],
            cutoff_tie: false,
            tied_movies: [],
          },
        },
        $addToSet: { eliminated_movies: { $each: [pool[4].toString(), pool[5].toString()] } },
        $inc: { version: 1 },
      },
      { new: true }
    );
    expect(res.body.gameRoom.hype.finished).toBe(true);
    expect(res.body.gameRoom.hype.qualifiers.map((movie: { title: string }) => movie.title)).toEqual([
      "Movie 0",
      "Movie 1",
      "Movie 2",
      "Movie 3",
    ]);
    expect(res.body.gameRoom.hype.cut_movies.map((movie: { title: string }) => movie.title)).toEqual([
      "Movie 4",
      "Movie 5",
    ]);
    expect(res.body.gameRoom.hype.totals[0]).toMatchObject({ points: 9 });
  });

  it("reads the saved results when another request finished the round first", async () => {
    findOne
      .mockReturnValueOnce(mockQuery(hypeRoom()))
      .mockReturnValueOnce(mockQuery(finishedRoom));
    createSubmission.mockResolvedValue({});
    countSubmissions.mockResolvedValue(2);
    findSubmissions.mockReturnValue(mockQuery(allSubmissions));
    findOneAndUpdate.mockReturnValue(mockQuery(null));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send({
        points: {
          [pool[0].toString()]: 5,
          [pool[1].toString()]: 3,
          [pool[2].toString()]: 2,
        },
      });

    expect(res.status).toBe(200);
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(res.body.gameRoom.hype.finished).toBe(true);
    expect(res.body.gameRoom.hype.qualifiers).toHaveLength(4);
  });

  it("keeps the round open while submissions are missing", async () => {
    findOne.mockReturnValue(mockQuery(hypeRoom({ round_players: [hostId, otherId, hostId] })));
    createSubmission.mockResolvedValue({});
    countSubmissions.mockResolvedValue(1);
    findSubmissions.mockReturnValue(mockQuery([allSubmissions[0]]));

    const res = await request(app)
      .post("/api/game-rooms/ABCDEF/hype")
      .set("Cookie", authCookie(hostId))
      .send({
        points: {
          [pool[0].toString()]: 5,
          [pool[1].toString()]: 3,
          [pool[2].toString()]: 2,
        },
      });

    expect(res.status).toBe(200);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(res.body.gameRoom.hype.finished).toBe(false);
  });
});

describe("GET /api/game-rooms/:code hype state", () => {
  const pool = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId());
  const movieObjects = pool.map((id, index) => ({ _id: id, title: `Movie ${index}` }));

  const playingRoom = (overrides: Record<string, unknown> = {}) => ({
    _id: roomId,
    code: "ABCDEF",
    host: { _id: hostId, username: "ada" },
    players: [
      { _id: hostId, username: "ada" },
      { _id: otherId, username: "bob" },
    ],
    status: "playing",
    currentRound: "hype",
    round_finished: false,
    round_players: [hostId, otherId],
    remaining_movies: movieObjects,
    eliminated_movies: [],
    hype_results: null,
    ...overrides,
  });

  it("returns the progress, live allocations and totals", async () => {
    findOne.mockReturnValue(mockQuery(playingRoom()));
    findSubmissions.mockReturnValue(
      mockQuery([
        {
          player: { _id: otherId, username: "bob" },
          choices: [
            { movie: movieObjects[0], points: 6 },
            { movie: movieObjects[1], points: 4 },
          ],
        },
      ])
    );

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body.gameRoom.hype).toMatchObject({
      submitted: 1,
      required: 2,
      finished: false,
      can_submit: true,
      block_reason: null,
      my_points: [],
      qualifiers: [],
      cut_movies: [],
      cutoff_tie: false,
    });
    expect(res.body.gameRoom.hype.allocations).toEqual([
      {
        player: { _id: otherId.toString(), username: "bob" },
        points: [
          { movie: pool[0].toString(), points: 6 },
          { movie: pool[1].toString(), points: 4 },
        ],
      },
    ]);
    // someone else's points are visible, and totals start at zero for every pool movie
    expect(res.body.gameRoom.hype.totals).toHaveLength(6);
    expect(res.body.gameRoom.hype.totals[0]).toMatchObject({ points: 6 });
    expect(res.body.gameRoom.hype.totals[0].movie.title).toBe("Movie 0");
    expect(res.body.gameRoom).not.toHaveProperty("bans");
  });

  it("does not add hype state during the ban round", async () => {
    findOne.mockReturnValue(mockQuery({ ...playingRoom(), currentRound: "ban" }));

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(hostId));

    expect(res.status).toBe(200);
    expect(res.body.gameRoom).not.toHaveProperty("hype");
    expect(res.body.gameRoom).toHaveProperty("bans");
  });

  it("returns the survivors, cuts and tiebreak once the round is over", async () => {
    findOne.mockReturnValue(
      mockQuery(
        playingRoom({
          round_finished: true,
          remaining_movies: movieObjects.slice(0, 4),
          eliminated_movies: movieObjects.slice(4),
          hype_results: {
            totals: pool.map((id, index) => ({ movie: id, points: [9, 8, 2, 1, 0, 0][index] })),
            cutoff_tie: true,
            tied_movies: [pool[3], pool[4]],
          },
        })
      )
    );
    findSubmissions.mockReturnValue(mockQuery([]));

    const res = await request(app).get("/api/game-rooms/ABCDEF").set("Cookie", authCookie(hostId));

    expect(res.body.gameRoom.hype.finished).toBe(true);
    expect(res.body.gameRoom.hype.qualifiers.map((movie: { title: string }) => movie.title)).toEqual([
      "Movie 0",
      "Movie 1",
      "Movie 2",
      "Movie 3",
    ]);
    expect(res.body.gameRoom.hype.cut_movies.map((movie: { title: string }) => movie.title)).toEqual([
      "Movie 4",
      "Movie 5",
    ]);
    expect(res.body.gameRoom.hype.cutoff_tie).toBe(true);
    expect(res.body.gameRoom.hype.tied_movies.map((movie: { title: string }) => movie.title)).toEqual([
      "Movie 3",
      "Movie 4",
    ]);
    expect(res.body.gameRoom.hype.can_submit).toBe(false);
    expect(res.body.gameRoom.hype.block_reason).toBe("The hype round is over.");
  });
});
