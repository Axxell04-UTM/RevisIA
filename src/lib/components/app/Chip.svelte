<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<span
	class="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] leading-4 text-muted-foreground"
>
	{@render children()}
</span>
