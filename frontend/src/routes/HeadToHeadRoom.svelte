<script lang="ts">
  import { onMount } from "svelte";
  import { push, replace } from "svelte-spa-router";
  import MovieCard from "../components/MovieCard.svelte";
  import TransitionCountdown from "../components/TransitionCountdown.svelte";
  import { getRoom, leaveRoom, voteHeadToHead, type GameRoom } from "../lib/rooms";
  import type { Movie } from "../lib/movies.svelte";

  // svelte-spa-router passes the room code from /room/:code/head-to-head
  let { params }: { params: { code: string } } = $props();

  let room = $state<GameRoom | null>(null);
  let errorMessage = $state("");
  let voteError = $state("");
  let voting = $state(false);
  // The movie picked in each matchup, before submitting.
  let picks = $state<string[]>([]);

  // How often the page checks for new votes, in milliseconds.
  const REFRESH_MS = 2000;

  let h2h = $derived(room?.headToHead ?? null);
  let allPicked = $derived(!!h2h && h2h.matchups.every((_, index) => !!picks[index]));

  // Stops the poller from touching state after the page is gone.
  let mounted = true;
  // Keeps a slow request from overlapping the next one.
  let inFlight = false;
  let transitionTimer: ReturnType<typeof setTimeout> | null = null;

  // Checks again right when the final is due to start.
  function scheduleFinalTransition(nextRoom: GameRoom) {
    if (transitionTimer) clearTimeout(transitionTimer);
    if (!nextRoom.headToHead?.finished || !nextRoom.final_starts_at) return;

    const delay = Math.max(0, new Date(nextRoom.final_starts_at).getTime() - Date.now());
    transitionTimer = setTimeout(loadRoom, delay);
  }

  // Gets the room and its head to head state from the backend.
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

    // Sends players to the right screen if the room isn't on head to head.
    if (res.gameRoom.currentRound === "final") {
      replace("/room/" + params.code + "/final");
      return;
    }
    if (res.gameRoom.status !== "playing") {
      replace("/room/" + params.code);
      return;
    }
    if (res.gameRoom.currentRound === "hype") {
      replace("/room/" + params.code + "/hype");
      return;
    }
    if (res.gameRoom.currentRound !== "headToHead") {
      replace("/room/" + params.code + "/ban");
      return;
    }

    errorMessage = "";
    room = res.gameRoom;
    scheduleFinalTransition(res.gameRoom);
  }

  // Picks one movie in a matchup.
  function pick(index: number, movieId: string) {
    if (voting || !h2h?.can_vote) return;
    picks[index] = movieId;
  }

  // Sends one pick per matchup. The backend decides if it is allowed and sends back why not.
  async function handleSubmit() {
    if (voting || !allPicked) return;

    voteError = "";
    voting = true;
    const res = await voteHeadToHead(params.code, picks);
    voting = false;

    if (!res.success) {
      voteError = res.message ?? "Could not submit your votes.";
      return;
    }

    picks = [];
    if (res.gameRoom) {
      room = res.gameRoom;
      scheduleFinalTransition(res.gameRoom);
    }
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
      if (transitionTimer) clearTimeout(transitionTimer);
    };
  });
</script>

{#snippet contender(index: number, movie: Movie, voters: string[], winner: string | null)}
  {@const picked = picks[index] === movie._id || h2h?.my_picks[index] === movie._id}
  {@const lost = !!winner && winner !== movie._id}
  <div class="mx-auto flex w-full max-w-[200px] flex-col gap-2 {lost ? 'opacity-50' : ''}">
    {#if h2h?.can_vote}
      <button
        type="button"
        onclick={() => pick(index, movie._id)}
        disabled={voting}
        aria-pressed={picked}
        aria-label={"Pick " + movie.title}
        class="cursor-pointer rounded-xl border-4 text-left transition {picked
          ? 'border-orange-700'
          : 'border-transparent hover:border-stone-300'}"
      >
        <MovieCard {movie} />
      </button>
    {:else}
      <div
        class="rounded-xl border-4 {winner === movie._id || (!winner && picked)
          ? 'border-orange-700'
          : 'border-transparent'}"
      >
        <MovieCard {movie} />
      </div>
    {/if}

    {#if winner === movie._id}
      <span class="self-center rounded-full bg-orange-700/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-orange-700 uppercase">
        Through
      </span>
    {/if}

    <p class="text-center text-sm font-semibold text-slate-700">
      {voters.length} {voters.length === 1 ? "vote" : "votes"}
    </p>
    {#if voters.length > 0}
      <ul class="flex flex-wrap justify-center gap-1 text-xs text-neutral-600">
        {#each voters as voter (voter)}
          <li class="rounded-full bg-stone-200 px-2 py-0.5">{voter}</li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

<svelte:head>
  <title>Head to Head {params.code} | Final Cut</title>
</svelte:head>

<div class="m-1 flex flex-1 flex-col rounded-md bg-stone-200 p-6">
  {#if errorMessage}
    <p class="m-auto text-lg text-red-600">{errorMessage}</p>
  {:else if !room || !h2h}
    <p class="m-auto text-lg text-slate-600">Loading...</p>
  {:else}
    {#if h2h.finished}
      <TransitionCountdown endsAt={room.final_starts_at} label="Final Cut starts" />
    {/if}

    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="text-xs font-semibold tracking-widest text-orange-700 uppercase">
          Room {params.code.toUpperCase()}
        </p>
        <h1 class="text-3xl font-bold tracking-tight">
          {h2h.finished ? "Head to Head complete" : "Head to Head"}
        </h1>
        <p class="mt-1 text-sm text-neutral-500">
          {#if h2h.finished}
            The winners move on to the Final Cut
          {:else}
            Round 3 · Pick one movie in each matchup · Votes are public
          {/if}
        </p>
        {#if !h2h.finished}
          <p class="mt-1 text-sm font-semibold text-slate-700">
            {h2h.submitted} of {h2h.required} players have voted
          </p>
        {/if}
      </div>
      <button
        type="button"
        onclick={handleLeave}
        class="cursor-pointer rounded-lg border-2 border-slate-700 px-6 py-2 font-semibold text-slate-700 hover:bg-stone-100"
      >Leave room</button>
    </div>

    {#if voteError}
      <p class="mb-4 rounded-lg bg-red-100 px-4 py-2 text-center text-red-700">{voteError}</p>
    {/if}

    <div class="flex flex-col gap-6">
      {#each h2h.matchups as matchup, index (index)}
        <section class="rounded-3xl bg-stone-100 p-4 shadow-sm">
          <h2 class="mb-3 text-xs font-semibold tracking-widest text-orange-700 uppercase">
            Matchup {index + 1}
          </h2>
          <div class="mx-auto grid max-w-xl grid-cols-[1fr_auto_1fr] items-center gap-4">
            {@render contender(index, matchup.a, matchup.voters_a, matchup.winner)}
            <span class="text-sm font-black text-slate-500">VS</span>
            {@render contender(index, matchup.b, matchup.voters_b, matchup.winner)}
          </div>
        </section>
      {/each}
    </div>

    {#if h2h.can_vote}
      <div class="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-stone-100 p-4 shadow-lg">
        <p class="text-sm text-neutral-600">
          {allPicked ? "Ready to lock in your picks. This can't be undone." : "Pick one movie in every matchup."}
        </p>
        <button
          type="button"
          onclick={handleSubmit}
          disabled={!allPicked || voting}
          class="cursor-pointer rounded-lg bg-slate-700 px-6 py-2 font-semibold text-stone-100 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
        >{voting ? "Submitting..." : "Submit votes"}</button>
      </div>
    {:else if !h2h.finished && h2h.my_picks.length > 0}
      <p class="mt-6 text-center text-sm text-neutral-500">
        Your votes are locked in. Waiting for the other players...
      </p>
    {/if}
  {/if}
</div>
