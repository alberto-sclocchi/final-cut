import { Schema, model, InferSchemaType } from "mongoose";

// "lobby" = waiting for players, "playing" = game started, "completed" = game over (shows in the user's summary)
export const ROOM_STATUSES = ["lobby", "playing", "completed"] as const;

// the rounds of a game, in the order they're played
export const ROUNDS = ["ban", "hype", "headToHead", "wildcard", "final"] as const;

// The hype round's final scoreboard. Written once when the round ends, so a refresh never re-rolls it
const hypeResultsSchema = new Schema(
  {
    // every movie that was in the pool, including the ones nobody gave points to
    totals: {
      type: [
        {
          _id: false,
          movie: { type: Schema.Types.ObjectId, ref: "Movie", required: true },
          points: { type: Number, default: 0 }
        }
      ],
      default: []
    },
    // true when a random draw had to break a tie at the top 4 cutoff
    cutoff_tie: {
      type: Boolean,
      default: false
    },
    // the movies that were tied at the cutoff, so the screen can explain the draw
    tied_movies: {
      type: [{ type: Schema.Types.ObjectId, ref: "Movie" }],
      default: []
    }
  },
  { _id: false }
);

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
    // movies cut by the hype round, kept so a future revival round can bring one back.
    // Ban-round bans are not here, they only live in the ban submissions
    eliminated_movies: {
      type: [{ type: Schema.Types.ObjectId, ref: "Movie" }],
      default: []
    },
    // the hype scoreboard, filled once when that round ends (see services/hype.ts)
    hype_results: {
      type: hypeResultsSchema,
      default: null
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
    // goes up by 1 every time the room changes, so screens know when to refresh
    version: {
      type: Number,
      default: 0
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
