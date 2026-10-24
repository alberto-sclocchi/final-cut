<script lang="ts">
  import { push } from "svelte-spa-router";
  import { signup } from "../lib/auth.svelte";

  const pageTitle = "Sign up | Final Cut";

  let firstName = $state("");
  let lastName = $state("");
  let username = $state("");
  let email = $state("");
  let password = $state("");
  let errorMessage = $state("");
  let loading = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    errorMessage = "";
    loading = true;

    const name = `${firstName.trim()} ${lastName.trim()}`;
    const res = await signup({ name, username, email, password });
    loading = false;

    if (!res.success) {
      errorMessage = res.message ?? "Sign up failed.";
      return;
    }

    push("/login");
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div
  class="m-1 flex flex-1 items-center justify-center rounded-md bg-stone-200 p-4"
>
  <form class="flex w-full max-w-xs flex-col gap-3" onsubmit={handleSubmit}>
    <div class="flex gap-3">
      <input
        class="min-w-0 flex-1 border-b-2 border-gray-400 bg-stone-300/30 px-3 py-3 text-neutral-700 outline-none transition
               placeholder:text-slate-600/60 focus:border-orange-700"
        type="text"
        name="firstname"
        placeholder="First name"
        aria-label="First name"
        autocomplete="given-name"
        bind:value={firstName}
        required
      />
      <input
        class="min-w-0 flex-1 border-b-2 border-gray-400 bg-stone-300/30 px-3 py-3 text-neutral-700 outline-none transition
               placeholder:text-slate-600/60 focus:border-orange-700"
        type="text"
        name="lastname"
        placeholder="Last name"
        aria-label="Last name"
        autocomplete="family-name"
        bind:value={lastName}
        required
      />
    </div>

    <input
      class="border-b-2 border-gray-400 bg-stone-300/30 px-3 py-3 text-neutral-700 outline-none transition
             placeholder:text-slate-600/60 focus:border-orange-700"
      type="text"
      name="username"
      placeholder="Username"
      aria-label="Username"
      autocomplete="username"
      bind:value={username}
      required
    />
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
      autocomplete="new-password"
      minlength="8"
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
      Sign up
    </button>

    <p class="mt-1 text-center text-sm text-slate-600">
      Already have an account?
      <a href="/#/login" class="font-medium transition hover:text-orange-700"
        >Log in</a
      >
    </p>
  </form>
</div>
