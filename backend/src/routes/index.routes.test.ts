import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";

// the app connects to Mongo on import and there is no db in tests
vi.mock("../db", () => ({}));

// keep the request log out of the test output
vi.mock("morgan", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe("GET /api", () => {
  it("confirms the api is up", async () => {
    const res = await request(app).get("/api");

    expect(res.status).toBe(200);
    expect(res.body).toBe("All good in here");
  });

  it("returns the 404 json for unknown routes", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "This route does not exist",
    });
  });
});
