<script lang="ts">
	import { onMount } from 'svelte';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { Button } from '#lib/components/ui/button';

	let { class: className = '' }: { class?: string } = $props();

	let dark = $state(false);

	function apply(theme: 'light' | 'dark') {
		document.documentElement.classList.toggle('dark', theme === 'dark');
		dark = theme === 'dark';
	}

	function toggle() {
		const next = dark ? 'light' : 'dark';
		apply(next);
		localStorage.setItem('theme', next);
	}

	onMount(() => {
		const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		apply(saved ?? (prefersDark ? 'dark' : 'light'));
	});
</script>

<Button
	class={className}
	variant="ghost"
	size="icon-sm"
	onclick={toggle}
	aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
>
	{#if dark}
		<SunIcon />
	{:else}
		<MoonIcon />
	{/if}
</Button>
