// Same fields the backend Movie model sends back.
export interface Movie {
  _id: string;
  tmdbId: number;
  title: string;
  overview: string;
  releaseDate?: string;
  genres: string[];
  posterUrl: string | null;
  rating: number;
  voteCount: number;
}

// What the search endpoint sends back.
interface SearchResponse {
  success: boolean;
  message?: string;
  movies?: Movie[];
}

// TMDb genre names, used for the genre dropdown.
export const GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Mystery",
  "Romance", "Science Fiction", "Thriller", "War", "Western",
];

// Searches movies by title and genre. Both are optional.
export async function searchMovies(
  q: string,
  genre: string,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams();
  if (q.trim()) {
    params.set("q", q.trim());
  }
  if (genre) {
    params.set("genre", genre);
  }

  try {
    const res = await fetch("/api/movies/search?" + params.toString(), { signal });
    return await res.json();
  } catch {
    return { success: false, message: "Could not reach the server. Try again." };
  }
}

// What the single movie endpoint sends back.
interface MovieResponse {
  success: boolean;
  message?: string;
  movie?: Movie;
}

// The movie shown on the details page.
export const movieState = $state<{ movie: Movie | null; loading: boolean; error: string }>({
  movie: null,
  loading: false,
  error: "",
});

// id of the last movie asked for, so a slow older request can't overwrite a newer one
let currentId = "";

// Loads one movie by its id into movieState.
export async function loadMovie(id: string) {
  currentId = id;
  movieState.movie = null;
  movieState.loading = true;
  movieState.error = "";

  let res: MovieResponse;
  try {
    const r = await fetch(`/api/movies/${encodeURIComponent(id)}`);
    res = await r.json();
  } catch {
    res = { success: false, message: "Could not reach the server. Try again." };
  }

  // a newer movie was opened while this one was loading, ignore this response
  if (id !== currentId) return;

  movieState.movie = res.success ? (res.movie ?? null) : null;
  movieState.error = res.success ? "" : (res.message ?? "Could not load the movie.");
  movieState.loading = false;
}
