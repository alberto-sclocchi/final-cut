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
// adds a movie to the logged in user's watchlist
export const addToWatchlist = async (req: Request, res: Response, next: NextFunction) => {
  const { movieId } = req.params;

  // same check as getMovie, so a bad id gets a clean 400 instead of a cast error
  if (typeof movieId !== "string" || !mongoose.isValidObjectId(movieId)) {
    res.status(400).json({ success: false, message: "Invalid movie id." });
    return;
  }

  try {
    const movieExists = await Movie.exists({ _id: movieId });
    if (!movieExists) {
      res.status(404).json({ success: false, message: "Movie not found." });
      return;
    }

    // $addToSet only adds the id if it isn't there yet, so adding twice is harmless
    const updatedUser = await User.findByIdAndUpdate(
      req.payload?._id,
      { $addToSet: { watchlist: movieId } },
      { new: true }
    );

    // token is valid but the user was deleted in the meantime
    if (!updatedUser) {
      res.status(401).json({ success: false, message: "User no longer exists." });
      return;
    }

    res.status(200).json({ success: true, watchlist: updatedUser.watchlist });
  } catch (err) {
    next(err);
  }
};
