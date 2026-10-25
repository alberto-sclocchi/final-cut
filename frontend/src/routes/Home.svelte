<script lang="ts">
  const steps = [
    {
      title: "Make a new room",
      text: "Share your room code.",
      href: "#/new",
      cta: "Create Room",
    },
    {
      title: "Friends join",
      text: "Everyone enters the code.",
      href: "#/join",
      cta: "Join Room",
    },
    {
      title: "Form the pool",
      text: "Film options are taken from everyone's watchlist.",
      href: "#/movies",
      cta: "Browse movies",
    },
  ];

  const rounds = [
    { name: "BAN", text: "Silently ban a film you don't want." },
    { name: "HYPE", text: "Films with the most points move on." },
    { name: "HEAD TO HEAD", text: "Vote between the remaining four." },
    { name: "WILDCARD", text: "Cut films have a chance for revival." },
    { name: "FINAL CUT", text: "A final secret vote decides the victor." },
  ];

  const section = "reveal rounded-3xl p-8 shadow-lg sm:p-10";
</script>

<svelte:head>
  <title>Home | Final Cut</title>
</svelte:head>

{#snippet ctas()}
  <div class="flex flex-wrap justify-center gap-3">
    <a
      href="#/new"
      class="rounded-lg px-8 py-3 font-semibold transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 bg-slate-700 text-stone-100 shadow-md hover:bg-neutral-800"
      >Create Room</a
    >
    <a
      href="#/join"
      class="rounded-lg px-8 py-3 font-semibold transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 border-2 border-slate-700 text-slate-700 hover:bg-stone-200"
      >Join Room</a
    >
  </div>
{/snippet}
<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
  <section
    class="flex flex-col items-center gap-6 rounded-3xl bg-stone-100 px-6 py-16 text-center shadow-lg"
  >
    <span
      class="rounded-full bg-orange-700/10 px-4 py-1 text-sm font-semibold tracking-wide text-orange-700"
    >
      MOVIE NIGHT, DECIDED
    </span>
    <h1
      class="text-5xl leading-tight font-extrabold tracking-tight sm:text-6xl"
    >
      Stop arguing.<br />
      <span class="text-orange-700">Pick the movie.</span>
    </h1>
    <p class="max-w-xl text-lg text-neutral-600">
      Final Cut turns arguments over films to watch into round-based voting.
    </p>
    {@render ctas()}
  </section>
  <section class="{section} bg-neutral-800 text-center text-stone-100">
    <h2 class="text-sm font-semibold tracking-widest text-orange-400 uppercase">
      The problem
    </h2>
    <p class="mx-auto mt-4 max-w-2xl text-2xl leading-snug font-medium">
      The most persistent person decides, leaving the rest of you to compromise.
    </p>
  </section>
  <section class="{section} bg-stone-200">
    <h2 class="mb-8 text-center text-3xl font-bold tracking-tight">
      Get started
    </h2>
    <ol class="grid gap-4 md:grid-cols-3">
      {#each steps as s, i (s.title)}
        <li class="flex flex-col gap-3 rounded-2xl bg-stone-100 p-6 shadow-sm">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange-700 font-bold text-stone-100"
            >{i + 1}</span
          >
          <h3 class="text-lg font-semibold">{s.title}</h3>
          <p class="flex-1 text-sm text-neutral-600">{s.text}</p>
          <a href={s.href} class="font-semibold text-orange-700 hover:underline"
            >{s.cta} →</a
          >
        </li>
      {/each}
    </ol>
  </section>
  <section class="{section} bg-stone-200">
    <h2 class="mb-8 text-center text-3xl font-bold tracking-tight">
      One film to rule them all
    </h2>
    <ol class="mx-auto flex max-w-2xl flex-col gap-3">
      {#each rounds as r, i (r.name)}
        <li
          class="flex items-center gap-4 rounded-2xl bg-stone-100 p-4 shadow-sm"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange-700 font-bold text-stone-100"
            >{i + 1}</span
          >
          <div>
            <h3 class="font-bold tracking-widest">{r.name}</h3>
            <p class="text-sm text-neutral-600">{r.text}</p>
          </div>
        </li>
      {/each}
    </ol>
  </section>
  <section
    class="{section} flex flex-col items-center gap-4 bg-stone-100 text-center"
  >
    <h2 class="text-3xl font-bold tracking-tight">Ready for movie night?</h2>
    {@render ctas()}
  </section>
</div>

<style>
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(5rem);
    }
  }

  @supports (animation-timeline: view()) {
    .reveal {
      animation: rise linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 60%;
    }
  }
</style>
