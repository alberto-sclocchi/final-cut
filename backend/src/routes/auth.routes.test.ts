import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../app";
import User from "../models/User.model";

// the app connects to Mongo on import and there is no db in tests
vi.mock("../db", () => ({}));

// keep the request log out of the test output
vi.mock("morgan", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../models/User.model", () => ({
  default: { findOne: vi.fn(), findById: vi.fn(), create: vi.fn() },
}));

// hashing for real would slow every test down, so we only check it is used
vi.mock("bcrypt", () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
}));

const findOne = User.findOne as unknown as Mock;
const findById = User.findById as unknown as Mock;
const create = User.create as unknown as Mock;
const hash = bcrypt.hash as unknown as Mock;
const compare = bcrypt.compare as unknown as Mock;

const secret = "test-secret";
const originalSecret = process.env.TOKEN_SECRET;

const ada = {
  _id: "user123",
  name: "Ada Lovelace",
  username: "ada",
  email: "ada@example.com",
  password: "hashed-password",
};

const publicAda = {
  _id: "user123",
  name: "Ada Lovelace",
  username: "ada",
  email: "ada@example.com",
};

// User.findOne(...).select("+password")
function mockFindOneWithPassword(user: unknown) {
  const select = vi.fn().mockResolvedValue(user);
  findOne.mockReturnValue({ select });
  return { select };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_SECRET = secret;
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.TOKEN_SECRET;
  } else {
    process.env.TOKEN_SECRET = originalSecret;
  }
});

describe("POST /api/auth/signup", () => {
  const signup = (body: Record<string, unknown>) =>
    request(app).post("/api/auth/signup").send(body);

  it("creates the user and never sends the password back", async () => {
    findOne.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-password");
    create.mockResolvedValue(publicAda);

    const res = await signup({
      name: "Ada Lovelace",
      username: "ada",
      email: "ada@example.com",
      password: "secret123",
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, user: publicAda });
    expect(res.body.user.password).toBeUndefined();
    expect(hash).toHaveBeenCalledWith("secret123", 10);
    expect(create).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      username: "ada",
      email: "ada@example.com",
      password: "hashed-password",
    });
  });

  it("checks for an existing email or username", async () => {
    findOne.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-password");
    create.mockResolvedValue(publicAda);

    await signup({
      name: "Ada Lovelace",
      username: "ada",
      email: "  ADA@example.com ",
      password: "secret123",
    });

    expect(findOne).toHaveBeenCalledWith({
      $or: [{ email: "ada@example.com" }, { username: "ada" }],
    });
  });

  it("asks for every field", async () => {
    const res = await signup({ name: "Ada Lovelace" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Please provide name, username, email and password.",
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it("rejects values that are not text", async () => {
    const res = await signup({
      name: "Ada Lovelace",
      username: "ada",
      email: { $ne: null },
      password: "secret123",
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "All fields must be text.",
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await signup({
      name: "Ada Lovelace",
      username: "ada",
      email: "ada@example.com",
      password: "short",
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Password must be at least 8 characters.",
    });
  });

  it("rejects an email that is already taken", async () => {
    findOne.mockResolvedValue(ada);

    const res = await signup({
      name: "Someone Else",
      username: "someone",
      email: "ada@example.com",
      password: "secret123",
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "Email is already taken.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a username that is already taken", async () => {
    findOne.mockResolvedValue(ada);

    const res = await signup({
      name: "Someone Else",
      username: "ada",
      email: "someone@example.com",
      password: "secret123",
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "Username is already taken.",
    });
  });

  it("returns the first model validation message", async () => {
    findOne.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-password");
    create.mockRejectedValue(
      Object.assign(new mongoose.Error.ValidationError(), {
        errors: { email: { message: "Please provide a valid email address." } },
      }),
    );

    const res = await signup({
      name: "Ada Lovelace",
      username: "ada",
      email: "not-an-email",
      password: "secret123",
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Please provide a valid email address.",
    });
  });

  it("returns 409 when the unique index rejects a duplicate", async () => {
    findOne.mockResolvedValue(null);
    hash.mockResolvedValue("hashed-password");
    create.mockRejectedValue({
      code: 11000,
      keyValue: { email: "ada@example.com" },
    });

    const res = await signup({
      name: "Ada Lovelace",
      username: "ada",
      email: "ada@example.com",
      password: "secret123",
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message: "email is already taken.",
    });
  });

  it("passes unexpected errors to the global error handler", async () => {
    findOne.mockResolvedValue(null);
    hash.mockRejectedValue(new Error("bcrypt is unhappy"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await signup({
      name: "Ada Lovelace",
      username: "ada",
      email: "ada@example.com",
      password: "secret123",
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: "Internal server error. Check the server console",
    });

    consoleError.mockRestore();
  });
});

describe("POST /api/auth/login", () => {
  const login = (body: Record<string, unknown>) =>
    request(app).post("/api/auth/login").send(body);

  it("logs the user in, sets the auth cookie and hides the password", async () => {
    const { select } = mockFindOneWithPassword(ada);
    compare.mockResolvedValue(true);

    const res = await login({ email: "  ADA@example.com ", password: "secret123" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, user: publicAda });
    expect(findOne).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(select).toHaveBeenCalledWith("+password");
    expect(compare).toHaveBeenCalledWith("secret123", "hashed-password");

    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies[0]).toContain("authToken=");
    expect(cookies[0]).toContain("HttpOnly");

    // the cookie holds a token with the user id, signed with TOKEN_SECRET
    const token = cookies[0].split(";")[0].split("=")[1];
    expect(jwt.verify(token, secret)).toMatchObject({ _id: "user123" });
  });

  it("asks for both email and password", async () => {
    const res = await login({ email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Please provide email and password.",
    });
  });

  it("rejects a wrong password", async () => {
    mockFindOneWithPassword(ada);
    compare.mockResolvedValue(false);

    const res = await login({ email: "ada@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Invalid email or password.",
    });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects an email that is not registered", async () => {
    mockFindOneWithPassword(null);

    const res = await login({ email: "nobody@example.com", password: "secret123" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Invalid email or password.",
    });
    expect(compare).not.toHaveBeenCalled();
  });

  it("fails when TOKEN_SECRET is missing", async () => {
    delete process.env.TOKEN_SECRET;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await login({ email: "ada@example.com", password: "secret123" });

    expect(res.status).toBe(500);
    expect(findOne).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

describe("GET /api/auth/verify", () => {
  function tokenFor(userId: string) {
    return jwt.sign({ _id: userId }, secret);
  }

  it("returns the logged in user", async () => {
    findById.mockResolvedValue(ada);

    const res = await request(app)
      .get("/api/auth/verify")
      .set("Cookie", `authToken=${tokenFor("user123")}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, user: publicAda });
    expect(findById).toHaveBeenCalledWith("user123");
  });

  it("rejects a request without the auth cookie", async () => {
    const res = await request(app).get("/api/auth/verify");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Not logged in." });
    expect(findById).not.toHaveBeenCalled();
  });

  it("rejects a tampered token", async () => {
    const res = await request(app)
      .get("/api/auth/verify")
      .set("Cookie", "authToken=not-a-valid-token");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Session expired or invalid. Please log in again.",
    });
    expect(findById).not.toHaveBeenCalled();
  });

  it("rejects a token whose user was deleted", async () => {
    findById.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/auth/verify")
      .set("Cookie", `authToken=${tokenFor("user123")}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "User no longer exists.",
    });
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the auth cookie", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Logged out." });

    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies[0]).toContain("authToken=");
    expect(cookies[0]).toContain("Expires=Thu, 01 Jan 1970");
  });
});
