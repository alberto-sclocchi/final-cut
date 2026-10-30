import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Movie from "../models/Movie.model";

// the navbar search dropdown only shows the top 10, so don't send more than that
const MAX_RESULTS = 10;

// escapes characters like . * ( ) so the user's text is searched literally and can't break the regex
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/movies/search?q=dark&genre=Action
export const searchMovies = async (req: Request, res: Response, next: NextFunction) => {
  const { q, genre } = req.query;

  // only accept plain strings (?q[$ne]=x would otherwise arrive as an object)
  if ((q !== undefined && typeof q !== "string") || (genre !== undefined && typeof genre !== "string")) {
    res.status(400).json({ success: false, message: "q and genre must be text." });
    return;
  }

  // regex instead of the text index so partial words match while typing ("interst" finds "Interstellar")
  const filter: Record<string, unknown> = {};
  if (q?.trim()) {
    filter.title = { $regex: escapeRegex(q.trim()), $options: "i" };
  }
  if (genre?.trim()) {
    // exact genre name but case insensitive, so "action" matches "Action"
    filter.genres = { $regex: `^${escapeRegex(genre.trim())}$`, $options: "i" };
  }

  try {
    // most voted first, so the popular movie shows up before obscure ones with the same title
    const movies = await Movie.find(filter).sort({ voteCount: -1 }).limit(MAX_RESULTS);

    res.status(200).json({ success: true, movies });
  } catch (err) {
    next(err);
  }
};

// GET /api/movies/:movieId
export const getMovie = async (req: Request, res: Response, next: NextFunction) => {
  const { movieId } = req.params;

  // findById throws on ids that aren't a valid ObjectId, so check first and send a clean 400
  if (typeof movieId !== "string" || !mongoose.isValidObjectId(movieId)) {
    res.status(400).json({ success: false, message: "Invalid movie id." });
    return;
  }

  try {
    const foundMovie = await Movie.findById(movieId);

    if (!foundMovie) {
      res.status(404).json({ success: false, message: "Movie not found." });
      return;
    }

    res.status(200).json({ success: true, movie: foundMovie });
  } catch (err) {
    next(err);
  }
};
