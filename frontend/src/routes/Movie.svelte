<script lang="ts">
  import { movieState, loadMovie, watchlist, toggleWatchlist } from "../lib/movies.svelte";
  import { auth } from "../lib/auth.svelte";

  // svelte-spa-router passes the :id from /movie/:id
  let { params }: { params: { id: string } } = $props();

  // reload when the id changes, e.g. picking another movie from the search bar
  $effect(() => {
    loadMovie(params.id);
  });

  const movie = $derived(movieState.movie);
  const year = $derived(movie?.releaseDate ? movie.releaseDate.slice(0, 4) : "");
  const votes = $derived(movie?.voteCount ?? 0);
  const added = $derived(!!movie && watchlist.ids.includes(movie._id));
</script>

<svelte:head>
  <title>{movie ? `${movie.title} | Final Cut` : "Final Cut"}</title>
</svelte:head>

<div
  class="flex flex-1 items-center justify-center bg-slate-600 rounded-md m-1"
>
  {#if movieState.loading}
    <p class="text-slate-200 text-lg">Loading...</p>
  {:else if movieState.error || !movie}
    <p class="text-red-200 text-lg">{movieState.error || "Movie not found."}</p>
  {:else}
  <div
    class="flex gap-10 p-10 bg-slate-900 text-slate-100 rounded-xl shadow-2xl w-3/4 aspect-video"
  >
    {#if movie.posterUrl}
      <img
        alt="{movie.title} poster"
        src={movie.posterUrl}
        class="h-full aspect-2/3 object-cover rounded-lg shadow-lg"
      />
    {:else}
      <div
        class="h-full aspect-2/3 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 text-base"
      >
        No poster
      </div>
    {/if}
    <div class="flex flex-col justify-center gap-5 min-w-0">
      <div class="flex items-start gap-4">
        <div class="min-w-0">
          <h1 class="text-5xl font-bold tracking-tight">{movie.title}</h1>
          <p class="text-slate-400 text-lg mt-2">{year}</p>
        </div>
        {#if auth.user}
          <button
            type="button"
            onclick={() => movie && toggleWatchlist(movie._id)}
            aria-label={added ? "Remove from watchlist" : "Add to watchlist"}
            title={added ? "Remove from watchlist" : "Add to watchlist"}
            class="ml-auto shrink-0 flex size-12 cursor-pointer items-center justify-center rounded-full border border-slate-700 text-2xl transition
                   hover:bg-red-900/60 {added ? 'bg-red-900/60 text-red-200' : 'bg-slate-800 text-slate-100'}"
          >
            {added ? "✓" : "+"}
          </button>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <span class="text-amber-400 text-2xl">★</span>
        <span class="text-3xl font-semibold">{movie.rating.toFixed(1)}</span>
        <span class="text-slate-400 text-base">/ 10 · {votes} votes</span>
      </div>
      <div class="flex flex-wrap gap-2">
        {#each movie.genres as genre}
          <span
            class="px-4 py-1.5 rounded-full bg-red-900/60 text-red-200 text-base"
          >
            {genre}
          </span>
        {/each}
      </div>
      <p
        class="text-slate-300 text-lg leading-relaxed text-pretty max-w-prose line-clamp-5"
      >
        {movie.overview}
      </p>
    </div>
  </div>
  {/if}
</div>
