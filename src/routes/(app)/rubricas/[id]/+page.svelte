<script lang="ts">
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import { store } from '#lib/domain/store.svelte.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { renderPrompt } from '#lib/domain/prompt.js';
	import { slugify } from '#lib/domain/types.js';
	import type { Criterion, RubricLevel } from '#lib/domain/types.js';

	const id = $derived(page.params.id);
	const template = $derived(store.find(id));

	$effect(() => {
		if (store.loaded && !template) goto('/rubricas');
	});

	let name = $state('');
	let instruction = $state('');
	let answerTag = $state('');
	let answerLabel = $state('');
	let criteria = $state<Criterion[]>([]);
	let loaded = $state(false);

	// The template arrives asynchronously from the server: hydrate the form once.
	$effect(() => {
		if (!template || loaded) return;
		name = template.name;
		instruction = template.instruction;
		answerTag = template.answerTag;
		answerLabel = template.answerLabel;
		criteria = template.criteria.map(c => ({ ...c }));
		loaded = true;
	});

	let saving = $state(false);
	let status = $state<string | null>(null);
	let saveError = $state<string | null>(null);

	async function save() {
		if (!template || !loaded) return;
		saving = true;
		status = null;
		saveError = null;
		try {
			const now = Date.now();
			const saved = await store.saveTemplate({
				...template,
				name,
				instruction,
				answerTag: slugify(answerTag) || template.answerTag,
				answerLabel,
				criteria,
				updatedAt: now,
			});
			criteria = saved.criteria.map(c => ({ ...c }));
			status = 'Guardado';
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'No se pudo guardar';
		} finally {
			saving = false;
		}
	}

	function addCriterion() {
		criteria.push({
			id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
			name: 'Nuevo criterio',
			description: '',
			maxPoints: 5,
			weight: 1,
			levels: [
				{ id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2), label: 'Excelente', points: 5, description: 'Cumple completamente', position: 0 },
				{ id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2), label: 'Bueno', points: 2, description: 'Cumple parcialmente', position: 1 },
				{ id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2), label: 'Deficiente', points: 0, description: 'No cumple', position: 2 }
			]
		});
	}
	function removeCriterion(i: number) {
		if (criteria.length <= 1) return;
		criteria.splice(i, 1);
	}

	const totalPoints = $derived(criteria.reduce((a,c)=>a+Math.max(0, Number(c.maxPoints)||0),0));

	const preview = $derived(() => {
		if (!template) return '';
		return renderPrompt(
			{ ...template, name, instruction, answerTag, answerLabel, criteria },
			Object.fromEntries(template.contexts.map(c => [c.tag, `Texto de ejemplo para ${c.label}`])),
			[{ student: 'Estudiante 1', text: 'Resumen de ejemplo para ver el formato.' }, { student: 'Estudiante 2', text: 'Otro resumen de ejemplo.' }]
		);
	});

	let showPreview = $state(false);
</script>

<svelte:head>
	<title>{template ? `${name} — RevisIA` : 'RevisIA'}</title>
</svelte:head>

{#if template}
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Editar rúbrica</h1>
			<p class="text-sm text-muted-foreground">Define la estructura de la corrección con roles y criterios.</p>
		</div>
		<div class="flex gap-2 items-center">
			{#if status}<span class="text-xs text-muted-foreground">{status}</span>{/if}
			{#if saveError}<span class="text-xs text-destructive">{saveError}</span>{/if}
			<Button disabled={saving} onclick={save}>{saving ? 'Guardando…' : 'Guardar'}</Button>
			<Button variant="outline" onclick={() => goto('/rubricas')}>Volver</Button>
		</div>
	</div>

	<Card>
		<CardHeader><CardTitle>Identidad</CardTitle></CardHeader>
		<CardContent class="space-y-4">
			<div>
				<div class="text-xs font-medium text-muted-foreground mb-1">Nombre</div>
				<input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={name} />
			</div>
			<div>
				<div class="text-xs font-medium text-muted-foreground mb-1">Instrucción</div>
				<textarea class="w-full min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={instruction} placeholder="Describe la tarea..."></textarea>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<CardTitle>Criterios</CardTitle>
				<Button size="sm" variant="outline" onclick={addCriterion}>+ Agregar</Button>
			</div>
			<CardDescription>Total: {totalPoints} puntos</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			{#each criteria as c, i}
				<div class="space-y-2 rounded-md border border-border p-3">
					<div class="flex flex-wrap gap-2">
						<input class="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={c.name} placeholder="Nombre del criterio" />
						<input class="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-right" type="number" min="0" step="0.5" bind:value={c.maxPoints} />
						<input class="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm text-right" type="number" min="0.1" step="0.1" bind:value={c.weight} />
					</div>
					<input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={c.description} placeholder="Descripción opcional" />
					<details class="group border-t pt-3 mt-2">
						<summary class="cursor-pointer text-sm font-medium text-muted-foreground flex items-center gap-1">
							Niveles de calificación
							<svg class="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</summary>
						<div class="space-y-2 mt-3 p-3 rounded-md bg-muted/50">
							{#each c.levels as lvl, li}
								<div class="flex flex-wrap gap-2 items-center">
									<input class="flex-1 min-w-[150px] rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={lvl.label} placeholder="Etiqueta (ej. Excelente)" />
									<input class="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm text-right" type="number" min="0" step="0.5" max={c.maxPoints} bind:value={lvl.points} />
									<input class="w-16 rounded-md border border-input bg-background px-3 py-2 text-sm text-right" type="number" min="0" step="1" bind:value={lvl.position} />
									<input class="flex-1 min-w-[150px] rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={lvl.description} placeholder="Descripción" />
									<Button size="sm" variant="ghost" onclick={() => c.levels.splice(li, 1)} disabled={c.levels.length <= 1}>Eliminar</Button>
								</div>
							{/each}
							<Button size="sm" variant="outline" onclick={() => c.levels.push({ id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2), label: 'Nuevo nivel', points: 0, description: '', position: c.levels.length })}>+ Nivel</Button>
						</div>
					</details>
					<div class="flex justify-end">
						<Button size="sm" variant="ghost" onclick={() => removeCriterion(i)}>Eliminar criterio</Button>
					</div>
				</div>
			{/each}
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle>Respuesta del estudiante</CardTitle></CardHeader>
		<CardContent class="grid gap-4 sm:grid-cols-2">
			<div>
				<div class="text-xs font-medium text-muted-foreground mb-1">Etiqueta visual</div>
				<input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={answerLabel} />
			</div>
			<div>
				<div class="text-xs font-medium text-muted-foreground mb-1">Tag base</div>
				<input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono" value={answerTag} oninput={(e)=> answerTag = slugify(e.currentTarget.value)} />
				<p class="mt-1 text-xs text-muted-foreground">Se usará como {answerTag}_1, {answerTag}_2, ...</p>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<CardTitle>Vista previa del prompt</CardTitle>
				<Button size="sm" variant="outline" onclick={() => showPreview = !showPreview}>{showPreview ? 'Ocultar' : 'Mostrar'}</Button>
			</div>
		</CardHeader>
		{#if showPreview}
			<CardContent>
				<pre class="max-h-[360px] overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap">{preview}</pre>
			</CardContent>
		{/if}
	</Card>
</div>
{/if}
