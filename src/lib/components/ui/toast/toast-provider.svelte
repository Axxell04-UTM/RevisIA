<script lang="ts">
	import { setToastContext } from "./toast-context.svelte.ts";
	import Toast from "./toast.svelte";

	let { children } = $props();
	const ctx = setToastContext();
</script>

{@render children?.()}

<div class="toast-container" aria-live="polite" aria-atomic="true">
	{#each ctx.toasts as toast (toast.id)}
		<div class="w-full max-w-sm">
			<Toast
				open={toast.open}
				title={toast.title}
				description={toast.description}
				variant={toast.variant}
				action={toast.action}
				duration={toast.duration}
				onClose={() => ctx.dismiss(toast.id)}
			/>
		</div>
	{/each}
</div>