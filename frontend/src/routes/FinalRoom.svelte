<script lang="ts">
  import { onMount } from "svelte";
  import { push, replace } from "svelte-spa-router";
  import MovieCard from "../components/MovieCard.svelte";
  import { getRoom, voteFinal, type GameRoom } from "../lib/rooms";

  let { params }: { params: { code: string } } = $props();

  let room = $state<GameRoom | null>(null);
  let errorMessage = $state("");
  let voteError = $state("");
  let voting = $state(false);
  let inFlight = false;
  let mounted = true;

  const REFRESH_MS = 2000;
  let final = $derived(room?.final ?? null);
  let winnerId = $derived(final?.winner?._id ?? null);

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

    if (res.gameRoom.currentRound !== "final") {
      // sends players to the screen for the round the room is on
      const paths: Record<string, string> = { ban: "/ban", hype: "/hype", headToHead: "/head-to-head" };
      const path = res.gameRoom.status === "playing" ? paths[res.gameRoom.currentRound] ?? "" : "";
      replace("/room/" + params.code + path);
      return;
    }

    errorMessage = "";
    room = res.gameRoom;
    voteError = "";
  }

  async function handleVote(movieId: string) {
    if (voting || !final?.can_vote) return;

    voteError = "";
    voting = true;
    const res = await voteFinal(params.code, movieId);
    voting = false;

    if (!res.success) {
      voteError = res.message ?? "Could not submit your vote.";
      return;
    }

    if (res.gameRoom) room = res.gameRoom;
  }

  function handleLeave() {
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
  <title>Final Cut {params.code} | Final Cut</title>
</svelte:head>

<div class="finale-stage m-1 flex flex-1 flex-col items-center justify-center overflow-hidden rounded-md p-4 sm:p-8">
  {#if errorMessage}
    <p class="m-auto text-lg text-red-600">{errorMessage}</p>
  {:else if !room || !final}
    <p class="m-auto text-lg text-slate-600">Loading...</p>
  {:else}
    <section class="finale-panel relative w-full max-w-4xl overflow-hidden rounded-[2rem] p-5 text-center shadow-2xl sm:p-10">
      <div class="finale-spotlight" aria-hidden="true"></div>
      <div class="relative z-10">
        <p class="text-xs font-bold tracking-[0.35em] text-orange-300 uppercase">
          Final round <span class="mx-1 text-orange-100/50">·</span> Room {params.code.toUpperCase()}
        </p>
        <h1 class="mt-3 text-4xl font-black tracking-tight text-stone-50 sm:text-5xl">
          {final.finished ? "The winner is..." : "The Final Cut"}
        </h1>
      {#if !final.finished}
        <p class="mt-3 text-stone-300">
          {#if final.can_vote}
            Two finalists. One movie night. Cast your vote.
          {:else}
            Your vote is locked in · {final.submitted} of {final.required} votes are in
          {/if}
        </p>
      {:else}
        <p class="mt-3 text-sm font-semibold tracking-[0.2em] text-orange-200 uppercase">
          Tonight's pick
        </p>
      {/if}

      {#if voteError}
        <p class="mx-auto mt-5 max-w-lg rounded-xl bg-red-100 px-4 py-3 text-red-700">{voteError}</p>
      {/if}

      <div class="finalist-grid relative mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-3 sm:gap-8">
        {#each final.finalists as movie, index (movie._id)}
          {@const isWinner = winnerId === movie._id}
          <div
            class="finalist-card rounded-2xl p-2.5 sm:p-4 {final.finished
              ? isWinner
                ? 'finalist-winner'
                : 'finalist-runner-up'
              : ''}"
            style:--card-delay="{index * 150}ms"
          >
            <p class="mb-2 text-[10px] font-bold tracking-[0.25em] text-orange-200 uppercase sm:text-xs">
              {index === 0 ? "Contender one" : "Contender two"}
            </p>
            {#if final.can_vote}
              <button
                type="button"
                onclick={() => handleVote(movie._id)}
                disabled={voting}
                aria-label={"Vote for " + movie.title}
                class="vote-card w-full cursor-pointer rounded-xl text-left transition duration-300 hover:-translate-y-1 hover:scale-[1.02] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-orange-300 disabled:cursor-wait disabled:opacity-60"
              >
                <MovieCard {movie} />
              </button>
            {:else}
              <MovieCard {movie} />
            {/if}
            {#if final.finished}
              <p class="mt-3 rounded-full bg-stone-100/10 px-3 py-1.5 text-sm font-bold text-stone-100">
                {final.votes.find((row) => row.movie._id === movie._id)?.votes ?? 0}
                {#if final.votes.find((row) => row.movie._id === movie._id)?.votes === 1}
                  vote
                {:else}
                  votes
                {/if}
              </p>
            {/if}
          </div>
        {/each}
        <div class="versus-badge" aria-hidden="true">VS</div>
      </div>

      {#if final.finished}
        <p class="winner-title mt-7 text-2xl font-black tracking-tight text-orange-200 sm:text-3xl">
          {final.winner?.title}
        </p>
        <button
          type="button"
          onclick={handleLeave}
          class="mt-7 cursor-pointer rounded-full bg-orange-300 px-7 py-3 font-bold text-slate-900 shadow-lg transition hover:scale-105 hover:bg-orange-200"
        >Back home</button>
      {:else if !final.can_vote}
        <p class="mt-5 text-sm text-stone-400">Waiting for the other players to choose.</p>
      {:else}
        <p class="mt-5 text-xs font-medium tracking-wide text-stone-400">
          Your vote decides what everyone watches.
        </p>
      {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .finale-stage {
    background:
      radial-gradient(ellipse at 50% 0%, rgb(180 83 9 / 18%), transparent 55%),
      linear-gradient(145deg, #1c1917, #292524 55%, #1c1917);
  }

  .finale-panel {
    background: linear-gradient(145deg, rgb(68 64 60 / 96%), rgb(28 25 23 / 98%));
    border: 1px solid rgb(253 186 116 / 18%);
  }

  .finale-spotlight {
    position: absolute;
    inset: -45% 15% auto;
    height: 24rem;
    border-radius: 50%;
    background: rgb(194 65 12 / 16%);
    filter: blur(80px);
    pointer-events: none;
  }

  .finalist-card {
    min-width: 0;
    background: linear-gradient(160deg, rgb(120 113 108 / 42%), rgb(41 37 36 / 75%));
    border: 1px solid rgb(231 229 228 / 12%);
    box-shadow: 0 16px 40px rgb(0 0 0 / 24%);
    animation: contender-arrive 650ms both;
    animation-delay: var(--card-delay);
  }

  .vote-card :global(img) {
    transition: filter 300ms ease;
  }

  .vote-card:hover :global(img) {
    filter: saturate(1.12) contrast(1.04);
  }

  .versus-badge {
    position: absolute;
    z-index: 2;
    top: 50%;
    left: 50%;
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    border: 2px solid rgb(253 186 116 / 80%);
    border-radius: 9999px;
    background: #292524;
    color: #fed7aa;
    font-size: 0.7rem;
    font-weight: 900;
    box-shadow: 0 0 24px rgb(234 88 12 / 35%);
    transform: translate(-50%, -50%);
  }

  .finalist-winner {
    border-color: rgb(253 186 116 / 80%);
    box-shadow: 0 0 0 1px rgb(253 186 116 / 30%), 0 0 36px rgb(234 88 12 / 28%);
    animation: winner-reveal 900ms both;
  }

  .finalist-runner-up {
    opacity: 0.68;
    transform: scale(0.97);
  }

  .winner-title {
    animation: title-reveal 700ms 250ms both;
  }

  @keyframes contender-arrive {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes winner-reveal {
    0% {
      transform: scale(0.96);
    }
    55% {
      transform: scale(1.035);
    }
    100% {
      transform: scale(1);
    }
  }

  @keyframes title-reveal {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
    }
  }
</style>
