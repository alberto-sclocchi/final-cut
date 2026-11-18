<script lang="ts">
  import Router, { push } from "svelte-spa-router";
  import active from "svelte-spa-router/active";
  import { wrap } from "svelte-spa-router/wrap";
  import type { Component } from "svelte";
  import Home from "./routes/Home.svelte";
  import SignUp from "./routes/SignUp.svelte";
  import LogIn from "./routes/LogIn.svelte";
  import Join from "./routes/Join.svelte";
  import WatchList from "./routes/WatchList.svelte";
  import SearchBar from "./components/SearchBar.svelte";
  import Movie from "./routes/Movie.svelte";
  import NewRoom from "./routes/NewRoom.svelte";
  import Room from "./routes/Room.svelte";
  import BanRoom from "./routes/BanRoom.svelte";
  import HypeRoom from "./routes/HypeRoom.svelte";
  import FinalRoom from "./routes/FinalRoom.svelte";
  import Profile from "./routes/Profile.svelte";
  import { auth, loadUser, logOut } from "./lib/auth.svelte";

  // on page load/refresh, check if the cookie still logs us in
  const userLoaded = loadUser();

  // only lets the page open when logged in.
  const protect = (component: Component<any>) =>
    wrap({
      component,
      conditions: [
        async () => {
          await userLoaded;
          return !!auth.user;
        },
      ],
    });

  const routes = {
    "/": Home,
    "/signup": SignUp,
    "/login": LogIn,
    "/join": protect(Join),
    "/watchlist": protect(WatchList),
    "/movie/:id": protect(Movie),
    "/new": protect(NewRoom),
    "/room/:code": protect(Room),
    "/room/:code/ban": protect(BanRoom),
    "/room/:code/hype": protect(HypeRoom),
    "/room/:code/final": protect(FinalRoom),
    "/profile": protect(Profile),
  };

  const links = [
    { href: "/new", label: "Create Room" },
    { href: "/join", label: "Join Room" },
    { href: "/watchlist", label: "Watchlist" },
  ];

  async function handleLogOut() {
    await logOut();
    push("/login");
  }
</script>

<div class="bg-[#B87458] min-h-svh w-full flex flex-col text-neutral-700">
  <nav
    class="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 font-medium sm:h-14 sm:flex-nowrap sm:gap-8 sm:px-6 sm:py-0"
  >
    <a href="#/" class="shrink-0 text-lg font-bold tracking-tight text-stone-100"
      >Final Cut</a
    >
    <div class="flex flex-wrap items-center gap-1">
      {#each links as link (link.href)}
        <a
          href="#{link.href}"
          use:active={{ path: link.href, className: "nav-active" }}
          class="rounded-md px-2 py-1.5 text-stone-100/90 transition-colors hover:bg-stone-200/20 hover:text-stone-100 sm:px-3"
          >{link.label}</a
        >
      {/each}
    </div>
    <div class="ml-auto flex items-center gap-2 sm:gap-3">
      <SearchBar />
      {#if auth.user}
        <span class="text-stone-100"
          >Hi, <a href="#/profile" class="underline underline-offset-2 hover:text-white"
            >{auth.user.username}</a
          ></span
        >
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
    <!-- a protected page was opened while logged out -->
    <Router {routes} onConditionsFailed={() => push("/login")} />
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
