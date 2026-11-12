import type { Movie } from "./movies.svelte";

// A player as the room endpoints send it back.
export interface Player {
  _id: string;
  name: string;
  username: string;
}

// The ban round info GET /api/game-rooms/:code adds once the game has started.
export interface BanState {
  submitted: number; // how many players have banned
  required: number; // how many bans the round needs
  finished: boolean;
  can_ban: boolean;
  block_reason: string | null; // why you can't ban, null when you can
  my_movie: Movie | null; // your own locked ban
  banned_movies: Movie[]; // only filled in once the round is over
}

// One player's points in the hype round, as the backend stores them.
export interface HypeAllocation {
  player: Player;
  points: { movie: string; points: number }[]; // movie ids
}

// One row of the hype scoreboard.
export interface HypeTotal {
  movie: Movie;
  points: number;
}

// The hype round info GET /api/game-rooms/:code adds while that round is being played.
export interface HypeState {
  submitted: number; // how many players have spent their points
  required: number; // how many players the round is waiting for
  finished: boolean;
  can_submit: boolean;
  block_reason: string | null; // why you can't submit, null when you can
  my_points: { movie: Movie; points: number }[]; // your own locked allocation
  allocations: HypeAllocation[]; // everyone's points, public this round
  totals: HypeTotal[]; // sorted by points, highest first
  qualifiers: Movie[]; // the four moving on, only filled in once finished
  cut_movies: Movie[]; // the movies that lost, only filled in once finished
  cutoff_tie: boolean; // true when a random draw decided the last spot
  tied_movies: Movie[]; // the movies that had to be drawn from
}

// A game room as GET /api/game-rooms/:code sends it back.
export interface GameRoom {
  _id: string;
  code: string;
  host: Player;
  players: Player[];
  remaining_movies: Movie[]; // empty until the game starts
  status: "lobby" | "playing" | "completed";
  currentRound: "ban" | "hype" | "headToHead" | "wildcard" | "final";
  round_finished: boolean;
  eliminated_movies?: Movie[]; // hype cuts, kept for a possible revival round
  bans?: BanState; // only sent while the room is playing the ban round
  hype?: HypeState; // only sent while the room is playing the hype round
  version: number;
}

// What every room endpoint sends back.
interface RoomResponse {
  success: boolean;
  message?: string;
  gameRoom?: GameRoom;
  changed?: boolean;
  version?: number;
}

// Calls a room endpoint and returns the JSON.
async function request(path: string, method: "GET" | "POST", body?: object): Promise<RoomResponse> {
  try {
    const res = await fetch("/api/game-rooms" + path, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });
    return await res.json();
  } catch {
    return { success: false, message: "Could not reach the server. Try again." };
  }
}

// Makes a new room with the logged in user as host.
export function createRoom() {
  return request("", "POST");
}

// Joins the room with this code.
export function joinRoom(code: string) {
  return request("/join", "POST", { code: code });
}

// Gets the room's latest info (players, host, status).
export function getRoom(code: string, version?: number) {
  let path = "/" + code;
  // sends the version we already have, if any
  if (version !== undefined) {
    path = path + "?version=" + version;
  }
  return request(path, "GET");
}

// Starts the game and builds the movie pool. Only works for the host.
export function startRoom(code: string) {
  return request("/" + code + "/start", "POST");
}

// Bans a movie in the ban round. Only works once per player, and can't be undone.
export function banMovie(code: string, movieId: string) {
  return request("/" + code + "/ban", "POST", { movieId: movieId });
}

// Spends the player's 10 points in the hype round. Only works once per player, and can't be undone.
export function submitHype(code: string, points: Record<string, number>) {
  return request("/" + code + "/hype", "POST", { points: points });
}

// Leaves the room.
export function leaveRoom(code: string) {
  return request("/" + code + "/leave", "POST");
}
