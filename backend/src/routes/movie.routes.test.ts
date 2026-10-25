import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import request from "supertest";
import app from "../app";
import Movie from "../models/Movie";

// the app connects to Mongo on import and there is no db in tests
vi.mock("../db", () => ({}));

// keep the request log out of the test output
vi.mock("morgan", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../models/Movie", () => ({
  default: { find: vi.fn(), findById: vi.fn() },
}));

const find = Movie.find as unknown as Mock;
const findById = Movie.findById as unknown as Mock;

const movieId = "507f1f77bcf86cd799439011";
const movie = {
  _id: movieId,
  tmdbId: 155,
  title: "The Dark Knight",
  genres: ["Action", "Drama"],
  voteCount: 34000,
};

// Movie.find(...).sort(...).limit(...) - the controller chains all three
function mockFindReturning(movies: unknown[]) {
  const limit = vi.fn().mockResolvedValue(movies);
  const sort = vi.fn().mockReturnValue({ limit });
  find.mockReturnValue({ sort });
  return { sort, limit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/movies/search", () => {
  it("searches titles case insensitively and returns the movies", async () => {
    const { sort, limit } = mockFindReturning([movie]);

    const res = await request(app).get("/api/movies/search").query({ q: "dark" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, movies: [movie] });
    expect(find).toHaveBeenCalledWith({
      title: { $regex: "dark", $options: "i" },
    });
    expect(sort).toHaveBeenCalledWith({ voteCount: -1 });
    expect(limit).toHaveBeenCalledWith(10);
  });

  it("searches the user's text literally instead of as a regex", async () => {
    mockFindReturning([]);

    await request(app).get("/api/movies/search").query({ q: "a.*(b)" });

    expect(find).toHaveBeenCalledWith({
      title: { $regex: "a\\.\\*\\(b\\)", $options: "i" },
    });
  });

  it("combines the title and genre filters", async () => {
    mockFindReturning([]);

    await request(app)
      .get("/api/movies/search")
      .query({ q: "dark", genre: "action" });

    expect(find).toHaveBeenCalledWith({
      title: { $regex: "dark", $options: "i" },
      genres: { $regex: "^action$", $options: "i" },
    });
  });

  it("sends no filter when neither q nor genre is given", async () => {
    mockFindReturning([movie]);

    const res = await request(app).get("/api/movies/search");

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith({});
  });

  it("rejects a q that is not plain text", async () => {
    const res = await request(app).get("/api/movies/search?q=dark&q=light");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "q and genre must be text.",
    });
    expect(find).not.toHaveBeenCalled();
  });

  it("passes database errors to the global error handler", async () => {
    find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockRejectedValue(new Error("db is down")),
      }),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).get("/api/movies/search");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: "Internal server error. Check the server console",
    });

    consoleError.mockRestore();
  });
});

describe("GET /api/movies/:movieId", () => {
  it("returns one movie", async () => {
    findById.mockResolvedValue(movie);

    const res = await request(app).get(`/api/movies/${movieId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, movie });
    expect(findById).toHaveBeenCalledWith(movieId);
  });

  it("rejects an id that is not an ObjectId", async () => {
    const res = await request(app).get("/api/movies/not-a-real-id");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Invalid movie id.",
    });
    expect(findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the movie does not exist", async () => {
    findById.mockResolvedValue(null);

    const res = await request(app).get(`/api/movies/${movieId}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Movie not found." });
  });
});
