<script lang="ts">
  import { push } from "svelte-spa-router";
  import { searchMovies, addToWatchlist, watchlist, type Movie } from "../lib/movies.svelte";
  import { auth } from "../lib/auth.svelte";

  let query = $state("");
  let focused = $state(false);
  let loading = $state(false);
  let results: Movie[] = $state([]);
  // index of the result picked with the arrow keys, -1 means none
  let highlighted = $state(-1);
  let input: HTMLInputElement;

  const open = $derived(focused || !!query);

  // Debounced fetch; cleanup cancels the timer and any in-flight request
  $effect(() => {
    if (!focused) return;
    const q = query.trim();
    const ctrl = new AbortController();
    loading = true;
    const timer = setTimeout(async () => {
      // empty query returns the most popular movies
      const res = await searchMovies(q, "", ctrl.signal);
      if (ctrl.signal.aborted) return;
      results = res.success ? (res.movies ?? []) : [];
      highlighted = -1;
      loading = false;
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });

  function done() {
    query = "";
    input.blur();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") done();
    else if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      highlighted = (highlighted + 1) % results.length;
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      highlighted = (highlighted - 1 + results.length) % results.length;
    } else if (e.key === "Enter" && highlighted >= 0) {
      push(`/movie/${results[highlighted]._id}`);
      done();
    }
  }
</script>

<div class="relative flex items-center">
  <div
    class="flex items-center rounded-full transition-colors duration-300
      {open ? 'bg-stone-200' : 'hover:bg-stone-200/20'}"
  >
    <button
      type="button"
      aria-label="Search"
      class="cursor-pointer rounded-full p-1.5 transition-colors
        {open ? 'text-neutral-500' : 'text-stone-100'}"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => input.focus()}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="2"
        stroke="currentColor"
        class="size-5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>
    </button>

    <input
      bind:this={input}
      bind:value={query}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
      onkeydown={onKeydown}
      placeholder="Search movies..."
      autocomplete="off"
      class="bg-transparent py-1 outline-none transition-all duration-300 placeholder:text-neutral-500
        {open ? 'w-56 pr-3 opacity-100' : 'w-0 pr-0 opacity-0'}"
    />
  </div>

  {#if focused}
    <div
      class="absolute right-0 top-full z-10 mt-2 w-80 overflow-hidden rounded-lg bg-stone-100 shadow-xl ring-1 ring-black/5"
    >
      <p
        class="px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-500"
      >
        {query.trim() ? "Results" : "Popular now"}
      </p>

      {#if loading && !results.length}
        <p class="px-3 pb-3 pt-1 text-sm text-neutral-500">Searching...</p>
      {:else if !results.length}
        <p class="px-3 pb-3 pt-1 text-sm text-neutral-500">
          No movies match "{query.trim()}"
        </p>
      {:else}
        <ul
          class="max-h-[70vh] overflow-y-auto pb-1.5 transition-opacity
            {loading ? 'opacity-60' : ''}"
        >
          {#each results as r, i (r._id)}
            <li
              onmouseenter={() => (highlighted = i)}
              class="flex items-center pr-3 transition-colors
                {i === highlighted ? 'bg-stone-200' : ''}"
            >
              <a
                href="#/movie/{r._id}"
                onmousedown={(e) => e.preventDefault()}
                onclick={done}
                class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2"
              >
                {#if r.posterUrl}
                  <img
                    src={r.posterUrl}
                    alt=""
                    class="h-14 w-10 shrink-0 rounded bg-stone-300 object-cover shadow-sm"
                  />
                {:else}
                  <div class="h-14 w-10 shrink-0 rounded bg-stone-300"></div>
                {/if}
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-neutral-800">{r.title}</p>
                  <p class="text-xs text-neutral-500">
                    {r.releaseDate?.slice(0, 4) ?? "—"} · ★ {r.rating.toFixed(1)}
                  </p>
                </div>
              </a>
              {#if auth.user}
                {@const added = watchlist.ids.includes(r._id)}
                <!-- preventDefault on mousedown keeps the input focused so the dropdown stays open -->
                <button
                  type="button"
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => addToWatchlist(r._id)}
                  disabled={added}
                  aria-label={added ? "In your watchlist" : `Add ${r.title} to watchlist`}
                  title={added ? "In your watchlist" : "Add to watchlist"}
                  class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-lg text-neutral-600 transition-colors
                    hover:bg-stone-300 disabled:cursor-default disabled:text-orange-700 disabled:hover:bg-transparent"
                >
                  {added ? "✓" : "+"}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
