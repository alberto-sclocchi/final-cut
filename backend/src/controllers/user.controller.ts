import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import User from "../models/User.model";
import Movie from "../models/Movie";

// GET /api/users/:username
// public profile: what other people see when they open someone's page (no email, no password)
export const getUserProfile = async (req: Request, res: Response, next: NextFunction) => {
  const { username } = req.params;

  if (typeof username !== "string" || !username.trim()) {
    res.status(400).json({ success: false, message: "Please provide a username." });
    return;
  }

  try {
    // usernames are saved lowercase, so lowercase the search too
    // populate swaps the watchlist ids for the actual movie documents
    const foundUser = await User.findOne({ username: username.trim().toLowerCase() })
      .select("name username watchlist createdAt")
      .populate("watchlist");

    if (!foundUser) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    res.status(200).json({
      success: true,
      user: {
        _id: foundUser._id,
        name: foundUser.name,
        username: foundUser.username,
        watchlist: foundUser.watchlist,
        createdAt: foundUser.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/users/watchlist/:movieId
// toggles a movie in the logged in user's watchlist: adds it if it's missing, removes it if it's there
export const toggleWatchlist = async (req: Request, res: Response, next: NextFunction) => {
  const { movieId } = req.params;

  // same check as getMovie, so a bad id gets a clean 400 instead of a cast error
  if (typeof movieId !== "string" || !mongoose.isValidObjectId(movieId)) {
    res.status(400).json({ success: false, message: "Invalid movie id." });
    return;
  }

  try {
    const foundUser = await User.findById(req.payload?._id).select("watchlist");

    // token is valid but the user was deleted in the meantime
    if (!foundUser) {
      res.status(401).json({ success: false, message: "User no longer exists." });
      return;
    }

    const inWatchlist = foundUser.watchlist.some((id) => id.equals(movieId));

    // only check the movie exists when adding, so a movie deleted from the db can still be removed
    if (!inWatchlist && !(await Movie.exists({ _id: movieId }))) {
      res.status(404).json({ success: false, message: "Movie not found." });
      return;
    }

    // $pull removes the id, $addToSet adds it only if it isn't there yet (safe on double clicks)
    const updatedUser = await User.findByIdAndUpdate(
      foundUser._id,
      inWatchlist ? { $pull: { watchlist: movieId } } : { $addToSet: { watchlist: movieId } },
      { new: true }
    );

    res.status(200).json({ success: true, added: !inWatchlist, watchlist: updatedUser?.watchlist ?? [] });
  } catch (err) {
    next(err);
  }
};

// GET /api/users/watchlist
// the logged in user's watchlist, with the full movies instead of just ids
export const getWatchlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const foundUser = await User.findById(req.payload?._id).select("watchlist").populate("watchlist");

    // token is valid but the user was deleted in the meantime
    if (!foundUser) {
      res.status(401).json({ success: false, message: "User no longer exists." });
      return;
    }

    res.status(200).json({ success: true, watchlist: foundUser.watchlist });
  } catch (err) {
    next(err);
  }
};
