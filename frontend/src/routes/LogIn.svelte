<script lang="ts">
  import { push } from "svelte-spa-router";
  import { login } from "../lib/auth.svelte";

  const pageTitle = "Log in | Final Cut";

  let email = $state("");
  let password = $state("");
  let errorMessage = $state("");
  let loading = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    errorMessage = "";
    loading = true;

    const res = await login({ email, password });
    loading = false;

    if (!res.success) {
      errorMessage = res.message ?? "Log in failed.";
      return;
    }

    push("/");
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div
  class="m-1 flex flex-1 items-center justify-center rounded-md bg-stone-200 p-4"
>
  <form class="flex w-full max-w-xs flex-col gap-3" onsubmit={handleSubmit}>
    <input
      class="border-b-2 border-gray-400 bg-stone-300/30 px-3 py-3 text-neutral-700 outline-none transition
             placeholder:text-slate-600/60 focus:border-orange-700"
      type="email"
      name="email"
      placeholder="Email"
      aria-label="Email"
      autocomplete="email"
      bind:value={email}
      required
    />
    <input
      class="border-b-2 border-gray-400 bg-stone-300/30 px-3 py-3 text-neutral-700 outline-none transition
             placeholder:text-slate-600/60 focus:border-orange-700"
      type="password"
      name="password"
      placeholder="Password"
      aria-label="Password"
      autocomplete="current-password"
      bind:value={password}
      required
    />

    {#if errorMessage}
      <p class="text-red-600">{errorMessage}</p>
    {/if}

    <button
      class="mt-3 cursor-pointer bg-slate-600 py-3 font-medium text-stone-200 transition
             hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2
             focus-visible:outline-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
      disabled={loading}
    >
      Log in
    </button>

    <p class="mt-1 text-center text-sm text-slate-600">
      Need an account?
      <a href="/#/signup" class="font-medium transition hover:text-orange-700"
        >Sign up</a
      >
    </p>
  </form>
</div>
