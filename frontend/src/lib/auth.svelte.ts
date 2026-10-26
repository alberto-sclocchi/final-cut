import { watchlist, loadWatchlist } from "./movies.svelte";

// same shape the backend sends back (without the password)
export interface User {
  _id: string;
  name: string;
  username: string;
  email: string;
}

// every backend response has `success`, plus a `message` or a `user`
export interface AuthResponse {
  success: boolean;
  message?: string;
  user?: User;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: object;
}

export const auth = $state<{ user: User | null }>({ user: null });

// calls the backend auth routes. Vite proxies /api to the backend (see vite.config.js)
async function request(path: string, { method = "GET", body }: RequestOptions = {}): Promise<AuthResponse> {
  try {
    const res = await fetch(`/api/auth${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      // send/receive the authToken cookie
      credentials: "include",
    });
    return await res.json();
  } catch {
    // backend is down or didn't send json
    return { success: false, message: "Could not reach the server. Try again." };
  }
}

export const signup = (data: { name: string; username: string; email: string; password: string }) => {
  return request("/signup", { method: "POST", body: data });
};

// on success the backend sets the authToken cookie, we save the user so the nav updates right away
export async function login(data: { email: string; password: string }) {
  const res = await request("/login", { method: "POST", body: data });
  if (res.success) {
    auth.user = res.user ?? null;
    loadWatchlist();
  }
  return res;
}

// asks the backend who we are. The cookie is httpOnly, so JS can't read it directly
export async function loadUser() {
  const res = await request("/verify");
  auth.user = res.success ? (res.user ?? null) : null;
  // load the watchlist with the user, so the + buttons show a check after a refresh too
  if (auth.user) loadWatchlist();
}

export async function logOut() {
  await request("/logout", { method: "POST" });
  auth.user = null;
  watchlist.ids = [];
  watchlist.movies = [];
}
