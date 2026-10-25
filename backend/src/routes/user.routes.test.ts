import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import request from "supertest";
import app from "../app";
import User from "../models/User.model";

// the app connects to Mongo on import and there is no db in tests
vi.mock("../db", () => ({}));

// keep the request log out of the test output
vi.mock("morgan", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../models/User.model", () => ({ default: { findOne: vi.fn() } }));

const findOne = User.findOne as unknown as Mock;

const profile = {
  _id: "user123",
  name: "Ada Lovelace",
  username: "ada",
  watchlist: [
    { _id: "507f1f77bcf86cd799439011", title: "The Dark Knight" },
  ],
  createdAt: "2026-10-01T12:00:00.000Z",
};

// User.findOne(...).select(...).populate(...)
function mockFindOneReturning(user: unknown) {
  const populate = vi.fn().mockResolvedValue(user);
  const select = vi.fn().mockReturnValue({ populate });
  findOne.mockReturnValue({ select });
  return { select, populate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/users/:username", () => {
  it("returns the public profile with the watchlist populated", async () => {
    const { select, populate } = mockFindOneReturning(profile);

    const res = await request(app).get("/api/users/ada");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, user: profile });
    expect(res.body.user.email).toBeUndefined();
    expect(res.body.user.password).toBeUndefined();
    expect(findOne).toHaveBeenCalledWith({ username: "ada" });
    expect(select).toHaveBeenCalledWith("name username watchlist createdAt");
    expect(populate).toHaveBeenCalledWith("watchlist");
  });

  it("looks usernames up in lowercase", async () => {
    mockFindOneReturning(profile);

    await request(app).get("/api/users/ADA");

    expect(findOne).toHaveBeenCalledWith({ username: "ada" });
  });

  it("returns 404 when no user has that username", async () => {
    mockFindOneReturning(null);

    const res = await request(app).get("/api/users/nobody");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "User not found." });
  });

  it("passes database errors to the global error handler", async () => {
    findOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        populate: vi.fn().mockRejectedValue(new Error("db is down")),
      }),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).get("/api/users/ada");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: "Internal server error. Check the server console",
    });

    consoleError.mockRestore();
  });
});
