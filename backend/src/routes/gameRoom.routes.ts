import { Router } from "express";
import {
  createGameRoom,
  joinGameRoom,
  getMyGameRooms,
  getGameRoom,
  leaveGameRoom,
  startGameRoom,
  deleteGameRoom,
} from "../controllers/gameRoom.controller";
import { isAuthenticated } from "../middleware/isAuthenticated";

// routes only map URL -> controller function, the logic lives in controllers/gameRoom.controller.ts
const router = Router();

// GET /api/game-rooms
router.get("/", isAuthenticated, getMyGameRooms);

// POST /api/game-rooms
router.post("/", isAuthenticated, createGameRoom);

// POST /api/game-rooms/join
router.post("/join", isAuthenticated, joinGameRoom);

// GET /api/game-rooms/:code
router.get("/:code", isAuthenticated, getGameRoom);

// POST /api/game-rooms/:code/leave
router.post("/:code/leave", isAuthenticated, leaveGameRoom);

// POST /api/game-rooms/:code/start
router.post("/:code/start", isAuthenticated, startGameRoom);

// DELETE /api/game-rooms/:code
router.delete("/:code", isAuthenticated, deleteGameRoom);

export default router;
