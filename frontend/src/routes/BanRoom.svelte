<script lang="ts">
  import { onMount } from "svelte";
  import { push, replace } from "svelte-spa-router";
  import MovieCard from "../components/MovieCard.svelte";
  import type { Movie } from "../lib/movies.svelte";
  import { banMovie, getRoom, leaveRoom, type GameRoom } from "../lib/rooms";

  // svelte-spa-router passes the room code from /room/:code/ban
  let { params }: { params: { code: string } } = $props();

  let room = $state<GameRoom | null>(null);
  let errorMessage = $state("");
  // Separate from errorMessage, so a successful poll doesn't wipe a ban error.
  let banError = $state("");
  let selectedId = $state<string | null>(null);
  let submitting = $state(false);

  // How often the page checks for new bans, in milliseconds.
  const REFRESH_MS = 2000;

  // The ban round state the backend sends with every room read.
  let bans = $derived(room?.bans ?? null);
  let waiting = $derived(!!bans && !!bans.my_movie && !bans.finished);
  let blocked = $derived(!!bans && !bans.can_ban && !bans.my_movie && !bans.finished);
  let selectedMovie = $derived(room?.remaining_movies.find((movie) => movie._id === selectedId) ?? null);

  // Stops the poller from touching state after the page is gone.
  let mounted = true;
  // Keeps a slow request from overlapping the next tick.
  let inFlight = false;

  // Gets the room and its ban round state from the backend.
  async function loadRoom() {
    if (inFlight) return;
    inFlight = true;
    const res = await getRoom(params.code);
    inFlight = false;

    if (!mounted) return;

    if (!res.success || !res.gameRoom) {
      errorMessage = res.message ?? "Could not load the room.";
      return;
    }

    // The game hasn't started, or it is already over: that's the room page's job.
    if (res.gameRoom.status !== "playing") {
      replace("/room/" + params.code);
      return;
    }

    // The ban round is over, the hype round has its own screen.
    if (res.gameRoom.currentRound === "hype") {
      replace("/room/" + params.code + "/hype");
      return;
    }

    errorMessage = "";

    // Someone else can ban the movie you were about to pick, so drop a stale selection.
    if (selectedId && !res.gameRoom.remaining_movies.some((movie) => movie._id === selectedId)) {
      selectedId = null;
    }

    room = res.gameRoom;
    banError = "";
  }

  // Highlights one movie, or un-highlights it if it was already selected.
  function select(movie: Movie) {
    if (submitting || !bans?.can_ban) return;
    selectedId = selectedId === movie._id ? null : movie._id;
  }

  // Sends the ban. The backend decides if it is allowed and sends back why not.
  async function handleBan() {
    if (!selectedId || submitting) return;

    banError = "";
    submitting = true;
    const res = await banMovie(params.code, selectedId);
    submitting = false;

    if (!res.success) {
      banError = res.message ?? "Could not ban that movie.";
      return;
    }

    selectedId = null;
    if (res.gameRoom) room = res.gameRoom;
  }

  // Leaves the room and goes back home.
  async function handleLeave() {
    await leaveRoom(params.code);
    push("/");
  }

  onMount(() => {
    loadRoom();
    const timer = setInterval(loadRoom, REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  });
</script>

<svelte:head>
  <title>Ban Room {params.code} | Final Cut</title>
</svelte:head>

<div class="m-1 flex flex-1 flex-col rounded-md bg-stone-200 p-6">
  {#if errorMessage}
    <p class="m-auto text-lg text-red-600">{errorMessage}</p>
  {:else if !room}
    <p class="m-auto text-lg text-slate-600">Loading...</p>
  {:else}
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="text-xs font-semibold tracking-widest text-orange-700 uppercase">
          Room {params.code.toUpperCase()}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {bans?.finished ? "Ban round complete" : "Ban room"}
        </h1>
        <p class="mt-1 text-sm text-neutral-500">
          {#if bans?.finished}
            {bans.banned_movies.length} banned · {room.remaining_movies.length} movies left
          {:else}
            Round 1 · Ban · {room.remaining_movies.length} movies in the pool
          {/if}
        </p>
      </div>
      <button
        type="button"
        onclick={handleLeave}
        class="cursor-pointer rounded-lg border-2 border-slate-700 px-6 py-2 font-semibold text-slate-700 hover:bg-stone-100"
      >Leave room</button>
    </div>

    {#if bans?.finished}
      {#if bans.banned_movies.length > 0}
        <h2 class="mb-3 text-xs font-semibold tracking-widest text-orange-700 uppercase">Banned</h2>
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {#each bans.banned_movies as movie (movie._id)}
            <li class="opacity-70">
              <MovieCard {movie} />
            </li>
          {/each}
        </ul>
      {/if}

      <h2 class="mt-8 mb-3 text-xs font-semibold tracking-widest text-slate-600 uppercase">
        Still in the running
      </h2>
      <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {#each room.remaining_movies as movie (movie._id)}
          <li>
            <MovieCard {movie} />
          </li>
        {/each}
      </ul>

      <p class="mt-8 text-center text-sm text-neutral-500">
        The ban round is over. Moving to the hype round...
      </p>
    {:else if waiting}
      <!-- Bans are secret, so there is nothing to show but the progress. -->
      <div class="m-auto max-w-md rounded-3xl bg-stone-100 p-8 text-center shadow-lg">
        <p class="text-5xl">🍿</p>
        <h2 class="mt-4 text-xl font-bold">Ban locked in</h2>
        <p class="mt-2 text-neutral-500">Waiting for the other players...</p>
        <p class="mt-4 text-sm font-semibold text-slate-700">
          {bans?.submitted} of {bans?.required} players have banned
        </p>
      </div>
    {:else}
      {#if banError}
        <p class="mb-4 rounded-lg bg-red-100 px-4 py-2 text-center text-red-700">{banError}</p>
      {/if}

      {#if blocked && bans?.block_reason}
        <p class="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-center text-amber-800">
          {bans.block_reason}
        </p>
      {/if}

      <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {#each room.remaining_movies as movie (movie._id)}
          <li>
            <button
              type="button"
              onclick={() => select(movie)}
              disabled={!bans?.can_ban || submitting}
              aria-pressed={selectedId === movie._id}
              aria-label={"Ban " + movie.title}
              class="w-full cursor-pointer rounded-md text-left transition disabled:cursor-not-allowed disabled:opacity-50 {selectedId ===
              movie._id
                ? 'scale-[0.98] ring-4 ring-orange-700'
                : 'hover:scale-[1.02]'}"
            >
              <MovieCard {movie} />
            </button>
          </li>
        {/each}
      </ul>

      {#if bans?.can_ban}
        <div
          class="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-stone-100 p-4 shadow-lg"
        >
          <p class="text-sm text-neutral-600">
            {#if selectedMovie}
              Ban <span class="font-semibold">{selectedMovie.title}</span>? This can't be undone.
            {:else}
              Pick a movie to ban. Everyone bans one, and bans stay secret until the round ends.
            {/if}
          </p>
          <button
            type="button"
            onclick={handleBan}
            disabled={!selectedMovie || submitting}
            class="cursor-pointer rounded-lg bg-slate-700 px-6 py-2 font-semibold text-stone-100 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >{submitting ? "Banning..." : "Ban this movie"}</button>
        </div>
      {/if}
    {/if}
  {/if}
</div>
