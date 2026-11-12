<script lang="ts">
  import { onMount } from "svelte";
  import { push, replace } from "svelte-spa-router";
  import { getRoom, leaveRoom, startRoom, type GameRoom } from "../lib/rooms";
  import { auth } from "../lib/auth.svelte";

  // svelte-spa-router passes the room code from /room/:code
  let { params }: { params: { code: string } } = $props();

  let room = $state<GameRoom | null>(null);
  let errorMessage = $state("");
  // Separate from errorMessage, because every successful refresh clears that one.
  let startError = $state("");
  let starting = $state(false);

  let isHost = $derived(!!room && !!auth.user && auth.user._id === room.host._id);

  // How often the page checks for new players, in milliseconds.
  const REFRESH_MS = 2000;

  // Gets the latest room info from the backend.
  async function loadRoom() {
    // sends the version we already have, so the backend can say nothing changed
    const res = await getRoom(params.code, room ? room.version : undefined);

    // nothing changed, so keep the screen as it is
    if (res.success && res.changed === false) {
      return;
    }
    if (!res.success || !res.gameRoom) {
      errorMessage = res.message ?? "Could not load the room.";
      return;
    }
    errorMessage = "";

    // Everyone moves to the first round as soon as the host starts the game.
    if (res.gameRoom.status === "playing") {
      goToRound(res.gameRoom.currentRound);
      return;
    }

    // "You need at least 2 players" is out of date once someone joins or leaves.
    if (room && room.players.length !== res.gameRoom.players.length) {
      startError = "";
    }
    room = res.gameRoom;
  }

  // replace instead of push so the back button doesn't return to the waiting room
  function goToRound(round: string) {
    const path = round === "hype" ? "/hype" : "/ban";
    replace("/room/" + params.code + path);
  }

  // Starts the game. The backend decides if it can start and sends back why not.
  async function handleStart() {
    startError = "";
    starting = true;
    const res = await startRoom(params.code);
    starting = false;

    if (!res.success) {
      startError = res.message ?? "Could not start the game.";
      return;
    }
    goToRound(res.gameRoom?.currentRound ?? "ban");
  }

  // Leaves the room and goes back home.
  async function handleLeave() {
    await leaveRoom(params.code);
    push("/");
  }

  // Loads the room now, then every 2 seconds so new players show up.
  onMount(() => {
    loadRoom();
    const timer = setInterval(loadRoom, REFRESH_MS);
    // Stops the timer when the user leaves this page.
    return () => clearInterval(timer);
  });
</script>

<svelte:head>
  <title>Room {params.code} | Final Cut</title>
</svelte:head>

<div class="m-1 flex flex-1 items-center justify-center rounded-md bg-stone-200 p-4">
  <section class="w-full max-w-md rounded-3xl bg-stone-100 p-8 shadow-lg">
    <div class="text-center">
      <p class="text-xs font-semibold tracking-widest text-orange-700 uppercase">Room code</p>
      <p class="mt-1 text-3xl font-extrabold tracking-[0.35em]">{params.code.toUpperCase()}</p>
    </div>

    {#if errorMessage}
      <p class="mt-6 text-center text-red-600">{errorMessage}</p>
    {/if}

    {#if room}
      <div class="mt-8 flex items-baseline justify-between">
        <h1 class="text-xs font-semibold tracking-widest text-slate-600 uppercase">Players</h1>
        <p class="text-sm text-neutral-500">{room.players.length} in the room</p>
      </div>

      <ul class="mt-3 flex flex-col gap-2">
        {#each room.players as player (player._id)}
          <li class="flex items-center gap-3 rounded-2xl bg-stone-200 px-3 py-2.5">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-stone-100 uppercase">
              {player.username.slice(0, 1)}
            </span>
            <span class="font-medium">
              {player.username}
              {#if auth.user && auth.user._id === player._id}(you){/if}
            </span>
            {#if room.host._id === player._id}
              <span class="ml-auto rounded-full bg-orange-700/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-orange-700 uppercase">host</span>
            {/if}
          </li>
        {/each}
      </ul>

      <p class="mt-8 flex items-center justify-center gap-2 text-sm text-neutral-500">
        <span class="size-2 animate-pulse rounded-full bg-orange-700"></span>
        Waiting for the {#if auth.user && auth.user._id === room.host._id}YOU{:else}{room.host.username}{/if} to start...
      </p>
    {/if}

    {#if isHost}
      {#if startError}
        <p class="mt-6 text-center text-red-600">{startError}</p>
      {/if}
      <button
        type="button"
        onclick={handleStart}
        disabled={starting}
        class="mt-6 w-full cursor-pointer rounded-lg bg-slate-700 py-2 font-semibold text-stone-100 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
      >{starting ? "Starting..." : "Start game"}</button>
    {/if}

    <button
      type="button"
      onclick={handleLeave}
      class="mt-6 w-full cursor-pointer rounded-lg border-2 border-slate-700 py-2 font-semibold text-slate-700 hover:bg-stone-200"
    >Leave room</button>
  </section>
</div>
