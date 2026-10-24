<script lang="ts">
  import MovieCard from "../components/MovieCard.svelte";
  import { watchlist, loadWatchlist } from "../lib/movies.svelte";

  const pageTitle = "Watchlist | Final Cut";

  // load fresh every time the page opens, so movies added from the search bar show up
  loadWatchlist();
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="m-1 flex flex-1 flex-col rounded-md bg-stone-200 p-6">
  {#if watchlist.loading}
    <p class="m-auto text-lg text-slate-600">Loading...</p>
  {:else if watchlist.error}
    <p class="m-auto text-lg text-red-600">{watchlist.error}</p>
  {:else if !watchlist.movies.length}
    <p class="m-auto text-lg text-slate-600">
      Your watchlist is empty. Use the + in the search bar to add movies.
    </p>
  {:else}
    <h1 class="mb-6 text-3xl font-bold tracking-tight">Your watchlist</h1>
    <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {#each watchlist.movies as movie (movie._id)}
        <li>
          <a href="#/movie/{movie._id}" class="block transition hover:-translate-y-0.5">
            <MovieCard {movie} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
