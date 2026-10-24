import { Router } from "express";
import { getUserProfile, addToWatchlist } from "../controllers/user.controller";
import { isAuthenticated } from "../middleware/isAuthenticated";

// routes only map URL -> controller function, the logic lives in controllers/user.controller.ts
const router = Router();

// POST /api/users/watchlist/:movieId
router.post("/watchlist/:movieId", isAuthenticated, addToWatchlist);

// GET /api/users/:username
router.get("/:username", getUserProfile);

export default router;
