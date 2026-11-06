import type { Movie } from "./movies.svelte";

// A player as the room endpoints send it back.
export interface Player {
  _id: string;
  name: string;
  username: string;
}

// A game room as GET /api/game-rooms/:code sends it back.
export interface GameRoom {
  _id: string;
  code: string;
  host: Player;
  players: Player[];
  remaining_movies: Movie[]; // empty until the game starts
  status: "lobby" | "playing" | "completed";
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

// Leaves the room.
export function leaveRoom(code: string) {
  return request("/" + code + "/leave", "POST");
}
