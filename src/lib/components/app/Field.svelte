<script lang="ts">
	import type { Snippet } from 'svelte';
	import { labelClass } from './input';

	let {
		label,
		description,
		for: htmlFor,
		children
	}: {
		label: string;
		description?: string;
		for?: string;
		children: Snippet;
	} = $props();
</script>

<div class="flex flex-col gap-1.5">
	<label class={labelClass} for={htmlFor}>{label}</label>
	{@render children()}
	{#if description}
		<p class="text-xs leading-relaxed text-muted-foreground">{description}</p>
	{/if}
</div>
