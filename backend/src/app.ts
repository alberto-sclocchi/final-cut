// ℹ️ Gets access to environment variables/settings
// https://www.npmjs.com/package/dotenv
import "dotenv/config";

// ℹ️ Connects to the database
import "./db";

// Handles http requests (express is node js framework)
// https://www.npmjs.com/package/express
import express from "express";

import config from "./config";
import indexRoutes from "./routes/index.routes";
import authRoutes from "./routes/auth.routes";
import movieRoutes from "./routes/movie.routes";
import userRoutes from "./routes/user.routes";
import createRoom from "./routes/createRoom.routes";
import errorHandling from "./error-handling";

const app = express();

// ℹ️ This function is getting exported from the config folder. It runs most pieces of middleware
config(app);

// 👇 Start handling routes here
app.use("/api", indexRoutes);
app.use("/api/create-room", createRoom);

// Auth routes: /api/auth/signup (more coming: login, verify, logout)
app.use("/api/auth", authRoutes);

// Movie routes: /api/movies/search, /api/movies/:movieId
app.use("/api/movies", movieRoutes);

// User routes: /api/users/:username
app.use("/api/users", userRoutes);

// ❗ To handle errors. Routes that don't exist or errors that you handle in specific routes
errorHandling(app);

export default app;
