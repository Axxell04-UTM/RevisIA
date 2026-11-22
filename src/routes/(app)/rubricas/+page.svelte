<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';
	import CardFooter from '#lib/components/ui/card/card-footer.svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import { store } from '#lib/domain/store.svelte.js';
	import { STARTER_PRESETS, templateTotal } from '#lib/domain/defaults.js';
	import type { Template } from '#lib/domain/types.js';

	interface Props {
		data: { usage: Record<string, number> };
	}

	let { data }: Props = $props();

	onMount(() => {
		store.load();
	});

	/** Each preset previewed once, so the picker can show its criteria. */
	const presets = STARTER_PRESETS.map((preset) => ({ ...preset, preview: preset.create() }));

	let busy = $state(false);
	let creatingKey = $state<string | null>(null);
	let pickerOpen = $state(false);
	let deleteTarget = $state<{ id: string; name: string; used: number } | null>(null);
	let deleting = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);

	function openPicker() {
		error = null;
		notice = null;
		pickerOpen = true;
	}

	async function createFrom(preset: { key: string; create: () => Template }) {
		busy = true;
		creatingKey = preset.key;
		error = null;
		try {
			const saved = await store.saveTemplate(preset.create());
			goto(`/rubricas/${saved.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo crear la rúbrica';
		} finally {
			busy = false;
			creatingKey = null;
		}
	}

	async function duplicate(id: string) {
		error = null;
		notice = null;
		try {
			const copy = await store.duplicateTemplate(id);
			notice = copy ? `Copia creada: ${copy.name}.` : null;
			if (copy) await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo duplicar la rúbrica';
		}
	}

	function askDelete(row: Template) {
		error = null;
		notice = null;
		deleteTarget = { id: row.id, name: row.name, used: data.usage[row.id] ?? 0 };
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		deleting = true;
		error = null;
		try {
			const unbound = await store.deleteTemplate(deleteTarget.id);
			notice =
				unbound > 0
					? `Rúbrica eliminada. ${unbound} actividad(es) quedaron sin rúbrica.`
					: 'Rúbrica eliminada.';
			deleteTarget = null;
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo eliminar la rúbrica';
		} finally {
			deleting = false;
		}
	}

	function closeOverlays() {
		if (busy || deleting) return;
		pickerOpen = false;
		deleteTarget = null;
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') closeOverlays();
	}}
/>

<div class="space-y-6">
	<div class="flex items-baseline justify-between gap-4 flex-wrap">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Rúbricas</h1>
			<p class="text-sm text-muted-foreground">
				Cada rúbrica define los criterios con los que se califica una actividad.
			</p>
		</div>
		<Button disabled={busy} onclick={openPicker}>Nueva rúbrica</Button>
	</div>

	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}
	{#if notice}
		<p class="text-sm text-muted-foreground">{notice}</p>
	{/if}

	{#if !store.loaded}
		<Card>
			<CardHeader>
				<CardTitle>Cargando…</CardTitle>
				<CardDescription>Trayendo tus rúbricas del servidor.</CardDescription>
			</CardHeader>
		</Card>
	{:else if store.templates.length === 0}
		<Card>
			<CardHeader>
				<CardTitle>Primer paso</CardTitle>
				<CardDescription>Creá una rúbrica para empezar a corregir.</CardDescription>
			</CardHeader>
			<CardContent class="text-sm text-muted-foreground">
				Elegí una plantilla de partida (resumen de ensayo, informe de laboratorio o resolución de
				problema) y ajustala a lo que necesites.
			</CardContent>
			<CardFooter class="flex gap-2">
				<Button onclick={openPicker}>Elegir plantilla</Button>
			</CardFooter>
		</Card>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each store.templates as t (t.id)}
				<Card>
					<CardHeader class="pb-3">
						<CardTitle class="text-base">{t.name}</CardTitle>
						<CardDescription class="text-xs">
							{t.criteria.length} criterios · Total {templateTotal(t)} pts
							{#if (data.usage[t.id] ?? 0) > 0}
								<br />
								<span class="text-foreground">
									{data.usage[t.id]} actividad(es) la usan
								</span>
							{/if}
						</CardDescription>
					</CardHeader>
					<CardContent class="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
						{t.instruction || 'Sin instrucción'}
					</CardContent>
					<CardFooter class="gap-2 flex-wrap">
						<Button size="sm" onclick={() => goto(`/rubricas/${t.id}`)}>Editar</Button>
						<Button size="sm" variant="ghost" onclick={() => duplicate(t.id)}>Duplicar</Button>
						<Button size="sm" variant="destructive" onclick={() => askDelete(t)}>Eliminar</Button>
					</CardFooter>
				</Card>
			{/each}
		</div>
	{/if}
</div>

{#if pickerOpen}
	<div class="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4">
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="picker-title"
			class="mx-auto my-8 w-full max-w-3xl rounded-lg border border-border bg-background shadow-lg"
		>
			<div class="flex items-start justify-between gap-4 border-b border-border p-4">
				<div>
					<h2 id="picker-title" class="text-lg font-semibold tracking-tight">Nueva rúbrica</h2>
					<p class="text-sm text-muted-foreground">
						Elegí un punto de partida. Después podés cambiar criterios, puntajes y contexto.
					</p>
				</div>
				<Button variant="ghost" size="sm" disabled={busy} onclick={closeOverlays}>Cerrar</Button>
			</div>
			<div class="grid gap-3 p-4 sm:grid-cols-2">
				{#each presets as preset (preset.key)}
					<div class="flex flex-col rounded-md border border-border p-3">
						<div class="flex items-baseline justify-between gap-2">
							<p class="text-sm font-medium">{preset.name}</p>
							<span class="text-xs text-muted-foreground shrink-0">
								{templateTotal(preset.preview)} pts
							</span>
						</div>
						<p class="mt-1 text-xs text-muted-foreground">{preset.description}</p>
						<ul class="mt-2 space-y-1">
							{#each preset.preview.criteria as criterion (criterion.id)}
								<li class="flex items-baseline justify-between gap-2 text-[11px]">
									<span class="truncate">{criterion.name}</span>
									<span class="text-muted-foreground shrink-0">{criterion.maxPoints}</span>
								</li>
							{/each}
						</ul>
						<div class="mt-auto pt-3">
							<Button size="sm" class="w-full" disabled={busy} onclick={() => createFrom(preset)}>
								{creatingKey === preset.key ? 'Creando…' : 'Usar esta'}
							</Button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

{#if deleteTarget}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-title"
			class="w-full max-w-md rounded-lg border border-border bg-background shadow-lg"
		>
			<div class="border-b border-border p-4">
				<h2 id="delete-title" class="text-lg font-semibold tracking-tight">
					Eliminar «{deleteTarget.name}»
				</h2>
			</div>
			<div class="space-y-2 p-4 text-sm text-muted-foreground">
				{#if deleteTarget.used > 0}
					<p>
						La usan <strong class="text-foreground">{deleteTarget.used} actividad(es)</strong>.
						Quedarán sin rúbrica y no se podrán calificar hasta que les asignes otra.
					</p>
				{:else}
					<p>Ninguna actividad la está usando.</p>
				{/if}
				<p>Las calificaciones ya guardadas se conservan.</p>
			</div>
			<div class="flex justify-end gap-2 border-t border-border p-4">
				<Button variant="ghost" disabled={deleting} onclick={closeOverlays}>Cancelar</Button>
				<Button variant="destructive" disabled={deleting} onclick={confirmDelete}>
					{deleting ? 'Eliminando…' : 'Eliminar rúbrica'}
				</Button>
			</div>
		</div>
	</div>
{/if}
