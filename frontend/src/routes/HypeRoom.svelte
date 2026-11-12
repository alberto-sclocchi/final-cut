<script lang="ts">
  import { onMount } from "svelte";
  import { push, replace } from "svelte-spa-router";
  import MovieCard from "../components/MovieCard.svelte";
  import { getRoom, leaveRoom, submitHype, type GameRoom } from "../lib/rooms";

  // svelte-spa-router passes the room code from /room/:code/hype
  let { params }: { params: { code: string } } = $props();

  let room = $state<GameRoom | null>(null);
  let errorMessage = $state("");
  // Separate from errorMessage, so a successful poll doesn't wipe a submit error.
  let submitError = $state("");
  let submitting = $state(false);
  // The points being handed out right now, keyed by movie id. Nothing is saved until submit.
  let draft = $state<Record<string, number>>({});
  // Which movie rows show their voters on the results list.
  let expanded = $state<string[]>([]);

  // Every player spends exactly this many points.
  const POINTS = 10;
  // How often the page checks for new submissions, in milliseconds.
  const REFRESH_MS = 2000;

  let hype = $derived(room?.hype ?? null);
  let spent = $derived(Object.values(draft).reduce((sum, points) => sum + points, 0));
  let left = $derived(POINTS - spent);
  let locked = $derived(!!hype && hype.my_points.length > 0);
  let sortedTotals = $derived(hype?.totals ?? []);

  // Stops the poller from touching state after the page is gone.
  let mounted = true;
  // Keeps a slow request from overlapping the next tick.
  let inFlight = false;

  // Gets the room and its hype round state from the backend.
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

    // The room can still be on the ban round if this page was opened early.
    if (res.gameRoom.currentRound !== "hype") {
      replace("/room/" + params.code + "/ban");
      return;
    }

    errorMessage = "";
    room = res.gameRoom;
    submitError = "";
  }

  // Adds one point to a movie, if there are points left.
  function addPoint(movieId: string) {
    if (submitting || !hype?.can_submit || left <= 0) return;
    draft[movieId] = (draft[movieId] ?? 0) + 1;
  }

  // Takes one point back from a movie.
  function removePoint(movieId: string) {
    if (submitting || !hype?.can_submit) return;
    const current = draft[movieId] ?? 0;
    if (current <= 0) return;
    draft[movieId] = current - 1;
  }

  // Sends the 10 points. The backend decides if it is allowed and sends back why not.
  async function handleSubmit() {
    if (submitting || left !== 0) return;

    // only send the movies that actually got points
    const points: Record<string, number> = {};
    for (const [movieId, value] of Object.entries(draft)) {
      if (value > 0) points[movieId] = value;
    }

    submitError = "";
    submitting = true;
    const res = await submitHype(params.code, points);
    submitting = false;

    if (!res.success) {
      submitError = res.message ?? "Could not submit your points.";
      return;
    }

    draft = {};
    if (res.gameRoom) room = res.gameRoom;
  }

  // Shows or hides the voters under one movie in the results.
  function toggleExpanded(movieId: string) {
    expanded = expanded.includes(movieId)
      ? expanded.filter((id) => id !== movieId)
      : [...expanded, movieId];
  }

  // True when this movie is one of the four moving on.
  function advanced(movieId: string) {
    return !!hype?.qualifiers.some((movie) => movie._id === movieId);
  }

  // Who gave this movie points, and how many.
  function votersFor(movieId: string) {
    if (!hype) return [];
    return hype.allocations.flatMap((allocation) =>
      allocation.points
        .filter((entry) => entry.movie === movieId)
        .map((entry) => ({ username: allocation.player.username, points: entry.points }))
    );
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

{#snippet scoreboard(live: boolean)}
  <section class="mt-8">
    <h2 class="mb-3 text-xs font-semibold tracking-widest text-orange-700 uppercase">
      Scoreboard
    </h2>
    <ol class="flex flex-col gap-2">
      {#each sortedTotals as row, index (row.movie._id)}
        <li
          class="rounded-2xl bg-stone-100 p-3 shadow-sm {live || advanced(row.movie._id)
            ? ''
            : 'opacity-60'}"
        >
          <div class="flex items-center gap-3">
            <span class="w-6 shrink-0 text-center font-bold text-slate-600">{index + 1}</span>
            {#if row.movie.posterUrl}
              <img class="h-16 w-11 shrink-0 rounded-sm object-cover" src={row.movie.posterUrl} alt="" />
            {/if}
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold">{row.movie.title}</p>
              <p class="text-sm text-neutral-500">{row.points} points</p>
            </div>
            {#if !live}
              <span
                class="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase {advanced(
                  row.movie._id
                )
                  ? 'bg-orange-700/10 text-orange-700'
                  : 'bg-neutral-200 text-neutral-500'}"
              >
                {advanced(row.movie._id) ? "Through" : "Cut"}
              </span>
              <button
                type="button"
                onclick={() => toggleExpanded(row.movie._id)}
                aria-expanded={expanded.includes(row.movie._id)}
                class="shrink-0 cursor-pointer rounded-lg border border-slate-700 px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-stone-200"
              >Voters</button>
            {/if}
          </div>

          {#if live || expanded.includes(row.movie._id)}
            <ul class="mt-2 flex flex-wrap gap-2 border-t border-stone-200 pt-2 text-sm text-neutral-600">
              {#each votersFor(row.movie._id) as voter (voter.username)}
                <li class="rounded-full bg-stone-200 px-2.5 py-0.5">{voter.username} · {voter.points}</li>
              {:else}
                <li class="text-neutral-400">Nobody gave points to this movie.</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>
  </section>
{/snippet}

<svelte:head>
  <title>Hype Room {params.code} | Final Cut</title>
</svelte:head>

<div class="m-1 flex flex-1 flex-col rounded-md bg-stone-200 p-6">
  {#if errorMessage}
    <p class="m-auto text-lg text-red-600">{errorMessage}</p>
  {:else if !room || !hype}
    <p class="m-auto text-lg text-slate-600">Loading...</p>
  {:else}
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="text-xs font-semibold tracking-widest text-orange-700 uppercase">
          Room {params.code.toUpperCase()}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {hype.finished ? "Hype round complete" : "Hype room"}
        </h1>
        <p class="mt-1 text-sm text-neutral-500">
          {#if hype.finished}
            {hype.qualifiers.length} movies move on · {hype.cut_movies.length} cut
          {:else}
            Round 2 · Hype · {room.remaining_movies.length} movies in the pool
          {/if}
        </p>
        {#if !hype.finished}
          <p class="mt-1 text-sm font-semibold text-slate-700">
            {hype.submitted} of {hype.required} players have spent their points
          </p>
        {/if}
      </div>
      <button
        type="button"
        onclick={handleLeave}
        class="cursor-pointer rounded-lg border-2 border-slate-700 px-6 py-2 font-semibold text-slate-700 hover:bg-stone-100"
      >Leave room</button>
    </div>

    {#if hype.finished}
      {#if hype.cutoff_tie}
        <p class="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-800">
          A tie at the cutoff was broken randomly between {hype.tied_movies.length} movies.
        </p>
      {/if}

      {@render scoreboard(false)}

      <h2 class="mt-8 mb-3 text-xs font-semibold tracking-widest text-orange-700 uppercase">
        Moving on
      </h2>
      <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {#each hype.qualifiers as movie (movie._id)}
          <li>
            <MovieCard {movie} />
          </li>
        {/each}
      </ul>

      {#if hype.cut_movies.length > 0}
        <h2 class="mt-8 mb-3 text-xs font-semibold tracking-widest text-slate-600 uppercase">
          Cut
        </h2>
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {#each hype.cut_movies as movie (movie._id)}
            <li class="opacity-70">
              <MovieCard {movie} />
            </li>
          {/each}
        </ul>
      {/if}

      <p class="mt-8 text-center text-sm text-neutral-500">Waiting for the next round...</p>
    {:else}
      {#if submitError}
        <p class="mb-4 rounded-lg bg-red-100 px-4 py-2 text-center text-red-700">{submitError}</p>
      {/if}

      {#if locked}
        <div class="m-auto max-w-md rounded-3xl bg-stone-100 p-8 text-center shadow-lg">
          <p class="text-5xl">🍿</p>
          <h2 class="mt-4 text-xl font-bold">Hype locked in</h2>
          <p class="mt-2 text-neutral-500">Waiting for the other players...</p>
          <p class="mt-4 text-sm font-semibold text-slate-700">
            {hype.submitted} of {hype.required} players have spent their points
          </p>
          <ul class="mt-4 flex flex-wrap justify-center gap-2 text-sm text-neutral-600">
            {#each hype.my_points as entry (entry.movie._id)}
              <li class="rounded-full bg-stone-200 px-2.5 py-0.5">
                {entry.movie.title} · {entry.points}
              </li>
            {/each}
          </ul>
        </div>
      {:else}
        {#if !hype.can_submit && hype.block_reason}
          <p class="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-center text-amber-800">
            {hype.block_reason}
          </p>
        {/if}

        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {#each room.remaining_movies as movie (movie._id)}
            <li class="rounded-md bg-stone-100 p-2">
              <MovieCard {movie} />
              <div class="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onclick={() => removePoint(movie._id)}
                  disabled={!hype.can_submit || submitting || (draft[movie._id] ?? 0) <= 0}
                  aria-label={"Remove a point from " + movie.title}
                  class="size-8 cursor-pointer rounded-lg bg-stone-200 text-lg font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >−</button>
                <span class="text-sm font-semibold text-slate-700">{draft[movie._id] ?? 0} pts</span>
                <button
                  type="button"
                  onclick={() => addPoint(movie._id)}
                  disabled={!hype.can_submit || submitting || left <= 0}
                  aria-label={"Add a point to " + movie.title}
                  class="size-8 cursor-pointer rounded-lg bg-slate-700 text-lg font-bold text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                >+</button>
              </div>
            </li>
          {/each}
        </ul>

        {#if hype.can_submit}
          <div
            class="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-stone-100 p-4 shadow-lg"
          >
            <div>
              <p class="text-sm font-semibold text-slate-700">
                {left} of {POINTS} points left
              </p>
              <p class="text-sm text-neutral-600">
                {#if left > 0}
                  Give movies 0–10 points each. All {POINTS} must be spent.
                {:else}
                  Ready to lock in your points. This can't be undone.
                {/if}
              </p>
            </div>
            <button
              type="button"
              onclick={handleSubmit}
              disabled={left !== 0 || submitting}
              class="cursor-pointer rounded-lg bg-slate-700 px-6 py-2 font-semibold text-stone-100 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >{submitting ? "Submitting..." : "Submit points"}</button>
          </div>
        {/if}
      {/if}

      {@render scoreboard(true)}
    {/if}
  {/if}
</div>
