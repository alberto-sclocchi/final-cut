<script lang="ts">
  import Router, { push } from "svelte-spa-router";
  import active from "svelte-spa-router/active";
  import Home from "./routes/Home.svelte";
  import SignUp from "./routes/SignUp.svelte";
  import LogIn from "./routes/LogIn.svelte";
  import Join from "./routes/Join.svelte";
  import WatchList from "./routes/WatchList.svelte";
  import SearchBar from "./components/SearchBar.svelte";
  import Movie from "./routes/Movie.svelte";
  import { auth, loadUser, logOut } from "./lib/auth.svelte";

  const routes = {
    "/": Home,
    "/signup": SignUp,
    "/login": LogIn,
    "/join": Join,
    "/watchlist": WatchList,
    "/movie/:id": Movie,
  };

  const links = [
    { href: "/join", label: "Join Room" },
    { href: "/watchlist", label: "Watchlist" },
  ];

  // on page load/refresh, check if the cookie still logs us in
  loadUser();

  async function handleLogOut() {
    await logOut();
    push("/login");
  }
</script>

<div class="bg-[#B87458] min-h-svh w-full flex flex-col text-neutral-700">
  <nav class="flex h-14 w-full items-center gap-8 px-6 font-medium">
    <a href="#/" class="text-lg font-bold tracking-tight text-stone-100"
      >Final Cut</a
    >
    <div class="flex items-center gap-1">
      {#each links as link (link.href)}
        <a
          href="#{link.href}"
          use:active={{ path: link.href, className: "nav-active" }}
          class="rounded-md px-3 py-1.5 text-stone-100/90 transition-colors hover:bg-stone-200/20 hover:text-stone-100"
          >{link.label}</a
        >
      {/each}
    </div>
    <div class="ml-auto flex items-center gap-3">
      <SearchBar />
      {#if auth.user}
        <span class="text-stone-100">Hi, {auth.user.username}</span>
        <button
          type="button"
          onclick={handleLogOut}
          class="cursor-pointer rounded-md px-3 py-1.5 text-stone-100/90 transition-colors hover:bg-stone-200/20 hover:text-stone-100"
          >Log out</button
        >
      {:else}
        <a
          href="#/login"
          class="rounded-md px-3 py-1.5 text-stone-100/90 transition-colors hover:bg-stone-200/20 hover:text-stone-100"
          >Log in</a
        >
        <a
          href="#/signup"
          class="rounded-md bg-stone-200 px-3 py-1.5 transition-colors hover:bg-stone-100"
          >Sign up</a
        >
      {/if}
    </div>
  </nav>
  <main class="flex-1 min-h-0 flex flex-col">
    <Router {routes} />
  </main>
</div>

<style>
  :global(.nav-active) {
    background-color: var(--color-stone-200);
    color: var(--color-neutral-700);
  }
  :global(.nav-active:hover) {
    background-color: var(--color-stone-100);
    color: var(--color-neutral-700);
  }
</style>
