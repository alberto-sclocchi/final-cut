<script lang="ts">
  import { onMount } from "svelte";

  const pageTitle = "Join Room | Final Cut";
  const length = 6;

  let form: HTMLFormElement;
  let inputs: HTMLInputElement[] = $state([]);

  onMount(() => inputs[0]?.focus());

  function onInput(e: Event, i: number) {
    const el = e.currentTarget as HTMLInputElement;
    el.value = el.value.replace(/\D/g, "");
    if (!el.value) return;
    if (i < length - 1) inputs[i + 1].focus();
    else if (inputs.every((input) => input.value)) form.requestSubmit();
  }

  function onKeydown(e: KeyboardEvent, i: number) {
    const el = inputs[i];

    if (e.key === "Backspace" && !el.value && i > 0) inputs[i - 1].focus();

    if (e.key === "ArrowLeft" && el.selectionStart === 0 && i > 0) {
      e.preventDefault();
      inputs[i - 1].focus();
    }
    if (
      e.key === "ArrowRight" &&
      el.selectionEnd === el.value.length &&
      i < length - 1
    ) {
      e.preventDefault();
      inputs[i + 1].focus();
    }
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    const digits = (e.clipboardData?.getData("text") ?? "")
      .replace(/\D/g, "")
      .slice(0, length);
    digits.split("").forEach((d, i) => (inputs[i].value = d));
    inputs[Math.min(digits.length, length - 1)].focus();
    if (digits.length === length) form.requestSubmit();
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div
  class="m-1 flex flex-1 items-center justify-center rounded-md bg-stone-200 p-4"
>
  <form
    bind:this={form}
    class="flex flex-col items-center gap-6"
    onpaste={onPaste}
  >
    <p id="pin-label" class="text-sm font-medium tracking-wide text-slate-600">
      Enter your room code to join
    </p>

    <div class="flex gap-3" role="group" aria-labelledby="pin-label">
      {#each { length } as _, i}
        <input
          bind:this={inputs[i]}
          class="size-12 rounded-full border-2 border-gray-400 bg-stone-300/30 text-center text-lg font-semibold
                 text-neutral-700 outline-none transition
                 focus:border-orange-700 not-placeholder-shown:border-slate-600"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="1"
          placeholder=" "
          name={`pin${i + 1}`}
          aria-label={`Digit ${i + 1}`}
          autocomplete="off"
          oninput={(e) => onInput(e, i)}
          onkeydown={(e) => onKeydown(e, i)}
          onfocus={(e) => e.currentTarget.select()}
          onclick={(e) => e.currentTarget.select()}
          required
        />
      {/each}
    </div>
  </form>
</div>
