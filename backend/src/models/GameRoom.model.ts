import { Schema, model, InferSchemaType } from "mongoose";

// "lobby" = waiting for players, "playing" = game started, "completed" = game over (shows in the user's summary)
export const ROOM_STATUSES = ["lobby", "playing", "completed"] as const;

// the rounds of a game, in the order they're played
export const ROUNDS = ["ban", "hype", "headToHead", "wildcard", "final"] as const;

const gameRoomSchema = new Schema(
  {
    // what friends type in to join. 6 uppercase letters, e.g. "QWERTY"
    code: {
      type: String,
      required: [true, 'Room code is required.'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z]{6}$/, 'Room code must be 6 letters.']
    },
    // the user who created the room. Only the host can start or delete it
    host: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, 'Host is required.']
    },
    // everyone in the room, host included
    players: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
      index: true
    },
    // the movies still in the game, filled when the game starts (see services/pool.ts)
    remaining_movies: {
      type: [{ type: Schema.Types.ObjectId, ref: "Movie" }],
      default: []
    },
    // the round being played, see ROUNDS above
    currentRound: {
      type: String,
      enum: ROUNDS,
      default: "ban"
    },
    // the players taking part in the current round, snapshotted when the round began.
    // A player who leaves mid-round still counts here, so the round doesn't stall waiting for them
    round_players: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: []
    },
    // true once the current round has nothing left to collect. Set by the ban that completes it
    round_finished: {
      type: Boolean,
      default: false
    },
    // the movie the group ended up with, set when the game finishes
    winner: {
      type: Schema.Types.ObjectId,
      ref: "Movie",
      default: null
    },
    // where the room is in the game, see ROOM_STATUSES above
    status: {
      type: String,
      enum: ROOM_STATUSES,
      default: "lobby"
    }
  },
  {
    // this second object adds extra properties: `createdAt` and `updatedAt`
    timestamps: true
  }
);

export type IGameRoom = InferSchemaType<typeof gameRoomSchema>;

const GameRoom = model("GameRoom", gameRoomSchema);

export default GameRoom;
