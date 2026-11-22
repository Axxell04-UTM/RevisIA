<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Menu, PanelLeftClose, PanelLeftOpen } from '@lucide/svelte';
	import { store } from '#lib/domain/store.svelte.js';
	import AppSidebar from '#lib/components/app/AppSidebar.svelte';

	let { children, data } = $props();

	const STORAGE_KEY = 'revisia:sidebar';

	// Desktop: the sidebar is in the flow and remembers its last state.
	// Mobile: it is an overlay, closed by default, and never persisted.
	let desktopOpen = $state(true);
	let mobileOpen = $state(false);

	onMount(() => {
		store.load();
		try {
			if (localStorage.getItem(STORAGE_KEY) === 'closed') desktopOpen = false;
		} catch {
			// Storage blocked (private mode, hardened settings): keep the default.
		}
	});

	function toggleDesktop() {
		desktopOpen = !desktopOpen;
		try {
			localStorage.setItem(STORAGE_KEY, desktopOpen ? 'open' : 'closed');
		} catch {
			// Same as above: the preference just does not persist.
		}
	}

	// The drawer covers the page, so any navigation closes it.
	let lastPath = page.url.pathname;
	$effect(() => {
		const path = page.url.pathname;
		if (path !== lastPath) {
			lastPath = path;
			mobileOpen = false;
		}
	});
</script>

<div class="min-h-dvh md:flex">
	{#if desktopOpen}
		<aside
			class="hidden border-r border-sidebar-border md:sticky md:top-0 md:flex md:h-dvh md:w-72 md:shrink-0 md:flex-col"
			aria-label="Actividades y navegación"
		>
			<AppSidebar activities={data.activities} subjects={data.subjects} user={data.user} />
		</aside>
	{/if}

	{#if mobileOpen}
		<div
			class="fixed inset-0 z-40 bg-black/50 md:hidden"
			role="presentation"
			onclick={() => (mobileOpen = false)}
		></div>
		<aside
			class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border shadow-xl md:hidden"
			aria-label="Actividades y navegación"
		>
			<AppSidebar
				activities={data.activities}
				subjects={data.subjects}
				user={data.user}
				onNavigate={() => (mobileOpen = false)}
			/>
		</aside>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col">
		<header
			class="sticky top-0 z-30 flex h-12 items-center gap-1 border-b border-border/60 bg-background/85 px-2 backdrop-blur md:px-4"
		>
			<button
				type="button"
				class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
				onclick={() => (mobileOpen = true)}
				aria-label="Abrir navegación"
			>
				<Menu class="size-5" />
			</button>
			<button
				type="button"
				class="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
				onclick={toggleDesktop}
				aria-label={desktopOpen ? 'Ocultar barra lateral' : 'Mostrar barra lateral'}
				aria-expanded={desktopOpen}
			>
				{#if desktopOpen}
					<PanelLeftClose class="size-5" />
				{:else}
					<PanelLeftOpen class="size-5" />
				{/if}
			</button>
			<span class="text-sm font-semibold tracking-tight md:hidden">RevisIA</span>
		</header>

		<main class="mx-auto w-full max-w-4xl px-4 pb-10 pt-6 md:px-8">
			{@render children()}
		</main>
	</div>
</div>
