<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Copy, MoreHorizontal, Pencil, Trash2 } from '@lucide/svelte';
	import type { Activity } from '#lib/domain/types.js';

	let {
		activity,
		subtitle,
		active = false,
		onNavigate
	}: {
		activity: Activity;
		subtitle: string;
		active?: boolean;
		onNavigate?: () => void;
	} = $props();

	const MENU_WIDTH = 176;

	let menuOpen = $state(false);
	let menuTop = $state(0);
	let menuLeft = $state(0);
	let trigger = $state<HTMLButtonElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	let renaming = $state(false);
	let draft = $state('');
	let confirming = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	function openMenu() {
		if (!trigger) return;
		const rect = trigger.getBoundingClientRect();
		menuTop = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 148));
		menuLeft = Math.max(
			8,
			Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)
		);
		menuOpen = true;
	}

	function startRename() {
		menuOpen = false;
		error = null;
		draft = activity.title;
		renaming = true;
	}

	async function commitRename() {
		const title = draft.trim();
		if (!title) {
			error = 'El título no puede quedar vacío';
			return;
		}
		if (title === activity.title) {
			renaming = false;
			return;
		}
		busy = true;
		error = null;
		try {
			const res = await fetch(`/api/activities/${activity.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title })
			});
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(data.error ?? 'No se pudo renombrar');
			renaming = false;
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo renombrar';
		} finally {
			busy = false;
		}
	}

	async function duplicate() {
		menuOpen = false;
		busy = true;
		error = null;
		try {
			const res = await fetch(`/api/activities/${activity.id}/duplicate`, { method: 'POST' });
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(data.error ?? 'No se pudo duplicar');
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo duplicar';
		} finally {
			busy = false;
		}
	}

	async function remove() {
		busy = true;
		error = null;
		try {
			const res = await fetch(`/api/activities/${activity.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(data.error ?? 'No se pudo eliminar');
			}
			confirming = false;
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo eliminar';
		} finally {
			busy = false;
		}
	}

	function onRenameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			renaming = false;
			error = null;
		}
	}

	$effect(() => {
		if (renaming) input?.focus();
	});
</script>

{#if renaming}
	<div class="px-2 py-1.5">
		<input
			bind:this={input}
			bind:value={draft}
			onkeydown={onRenameKeydown}
			disabled={busy}
			aria-label="Nuevo título de la actividad"
			class="w-full rounded-sm border border-border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
		/>
		<div class="mt-1 flex items-center gap-2 text-xs">
			<button
				type="button"
				class="text-primary hover:underline disabled:opacity-50"
				disabled={busy}
				onclick={commitRename}>Guardar</button
			>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground"
				onclick={() => {
					renaming = false;
					error = null;
				}}>Cancelar</button
			>
		</div>
		{#if error}<p class="mt-1 text-xs text-destructive">{error}</p>{/if}
	</div>
{:else if confirming}
	<div class="rounded-sm px-2 py-1.5">
		<p class="text-xs text-muted-foreground">¿Eliminar «{activity.title}»?</p>
		<div class="mt-1 flex items-center gap-2 text-xs">
			<button
				type="button"
				class="font-medium text-destructive hover:underline disabled:opacity-50"
				disabled={busy}
				onclick={remove}>Eliminar</button
			>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground"
				onclick={() => (confirming = false)}>Cancelar</button
			>
		</div>
		{#if error}<p class="mt-1 text-xs text-destructive">{error}</p>{/if}
	</div>
{:else}
	<div
		class="group/item flex items-center gap-1 rounded-md pr-1 transition-colors {active
			? 'bg-sidebar-accent text-sidebar-accent-foreground'
			: 'hover:bg-sidebar-accent/60'}"
	>
		<a
			href={`/revisar/${activity.id}`}
			onclick={() => onNavigate?.()}
			aria-current={active ? 'page' : undefined}
			class="min-w-0 flex-1 px-2 py-1.5"
		>
			<span class="block truncate text-sm">{activity.title}</span>
			<span class="block truncate text-xs text-muted-foreground">{subtitle}</span>
		</a>
		<button
			bind:this={trigger}
			type="button"
			aria-label={`Acciones de ${activity.title}`}
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			disabled={busy}
			onclick={openMenu}
			class="rounded-sm p-1 text-muted-foreground transition-opacity hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 md:opacity-0 md:group-hover/item:opacity-100 md:focus-visible:opacity-100"
		>
			<MoreHorizontal class="size-4" />
		</button>
	</div>
	{#if error}<p class="px-2 pb-1 text-xs text-destructive">{error}</p>{/if}
{/if}

{#if menuOpen}
	<div class="fixed inset-0 z-40" role="presentation" onclick={() => (menuOpen = false)}></div>
	<div
		class="fixed z-50 w-44 rounded-md border border-border bg-popover p-1 shadow-lg"
		style:top={`${menuTop}px`}
		style:left={`${menuLeft}px`}
		role="menu"
	>
		<button
			type="button"
			role="menuitem"
			class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
			onclick={startRename}
		>
			<Pencil class="size-4" /> Renombrar
		</button>
		<button
			type="button"
			role="menuitem"
			class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
			onclick={duplicate}
		>
			<Copy class="size-4" /> Duplicar
		</button>
		<button
			type="button"
			role="menuitem"
			class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
			onclick={() => {
				menuOpen = false;
				confirming = true;
			}}
		>
			<Trash2 class="size-4" /> Eliminar
		</button>
	</div>
{/if}
