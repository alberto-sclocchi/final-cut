<script lang="ts">
  import type { Movie } from "../lib/movies.svelte";

  let { movie }: { movie: Movie } = $props();

  // Gets just the year from a date like "2008-07-16".
  let year = $derived(movie.releaseDate ? movie.releaseDate.slice(0, 4) : "");
</script>

<div class="flex flex-col gap-2 rounded-md bg-gray-200 p-2">
  {#if movie.posterUrl}
    <img
      class="aspect-[2/3] w-full rounded-sm object-cover"
      src={movie.posterUrl}
      alt={movie.title + " poster"}
      loading="lazy"
    />
  {:else}
    <div class="flex aspect-[2/3] w-full items-center justify-center rounded-sm bg-gray-300 text-sm text-gray-600">
      No poster
    </div>
  {/if}

  <h3 class="font-semibold leading-tight">{movie.title}</h3>
  <p class="text-sm text-gray-600">{year} · ★ {movie.rating.toFixed(1)}</p>
  <p class="text-xs text-gray-600">{movie.genres.join(", ")}</p>
</div>