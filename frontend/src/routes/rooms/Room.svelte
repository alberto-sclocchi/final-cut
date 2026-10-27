<script lang="ts">
  // svelte-spa-router passes the room code from /room/:id
  let { params }: { params: { id: string } } = $props();

  const pageTitle = "Room | Final Cut";

  // placeholder content until the room API exists
  const players = [
    { name: "you", host: true },
    { name: "mia", host: false },
    { name: "jonas", host: false },
  ];
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="m-1 flex flex-1 items-center justify-center rounded-md bg-stone-200 p-4">
  <section class="w-full max-w-md rounded-3xl bg-stone-100 p-8 shadow-lg">
    <div class="text-center">
      <p class="text-xs font-semibold tracking-widest text-orange-700 uppercase">
        Room code
      </p>
      <p class="mt-1 text-3xl font-extrabold tracking-[0.35em]">{params.id}</p>
    </div>

    <div class="mt-8 flex items-baseline justify-between">
      <h1 class="text-xs font-semibold tracking-widest text-slate-600 uppercase">
        Players
      </h1>
      <p class="text-sm text-neutral-500">{players.length} in the room</p>
    </div>

    <ul class="mt-3 flex flex-col gap-2">
      {#each players as player (player.name)}
        <li
          class="flex items-center gap-3 rounded-2xl bg-stone-200 px-3 py-2.5"
        >
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-stone-100 uppercase"
            >{player.name.slice(0, 1)}</span
          >
          <span class="font-medium">{player.name}</span>
          {#if player.host}
            <span
              class="ml-auto rounded-full bg-orange-700/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-orange-700 uppercase"
              >host</span
            >
          {/if}
        </li>
      {/each}
    </ul>

    <p
      class="mt-8 flex items-center justify-center gap-2 text-sm text-neutral-500"
    >
      <span class="size-2 animate-pulse rounded-full bg-orange-700"></span>
      Waiting for the host to start...
    </p>
  </section>
</div>
