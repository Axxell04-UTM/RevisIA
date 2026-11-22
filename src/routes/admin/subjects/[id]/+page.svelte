<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ToastProvider from '#lib/components/ui/toast/toast-provider.svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';
	import CardFooter from '#lib/components/ui/card/card-footer.svelte';
	import Input from '#lib/components/app/Input.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import MultiSelect from '#lib/components/ui/multi-select/multi-select.svelte';
	import ToggleSwitch from '#lib/components/ui/toggle-switch/toggle-switch.svelte';
	import { getToastContext } from '#lib/components/ui/toast/toast-context.svelte.ts';

	let { data } = $props();
	const toast = getToastContext();

	let subject = $derived(data.subject);
	let teachers = $derived(data.teachers);

	let showAssignDialog = $state(false);
	let selectedTeacherIds = $state<string[]>([]);
	let isActive = $state(true);

	$effect(() => {
		selectedTeacherIds = subject.teachers.map((t) => t.id);
		isActive = !subject.deletedAt;
	});

	async function handleAssignTeachers() {
		try {
			const params = new URLSearchParams();
			for (const id of selectedTeacherIds) {
				params.append('teacherIds', id);
			}
			const res = await fetch(`/admin/subjects/${subject.id}?/assignTeachers`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: params
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' && (result.data as any)?.success) {
				toast?.toast({ title: 'Docentes actualizados', description: 'Docentes asignados correctamente', variant: 'success' });
				showAssignDialog = false;
				await invalidateAll();
			} else if (result.type === 'failure') {
				toast?.toast({ title: 'Error', description: (result.data as any)?.error || 'No se pudo actualizar', variant: 'destructive' });
			} else {
				toast?.toast({ title: 'Error', description: 'No se pudo actualizar', variant: 'destructive' });
			}
		} catch (e) {
			toast?.toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
		}
	}
</script>

<ToastProvider>
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold tracking-tight">Editar asignatura</h1>
				<p class="text-muted-foreground">{subject.name} ({subject.code ?? 'sin código'})</p>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="ghost" size="icon" onclick={() => history.back()} aria-label="Volver">
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M19 12H5M12 19l-7-7 7-7" />
					</svg>
				</Button>
				<Button variant="outline" onclick={() => (showAssignDialog = true)}>
					<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 1-4-4v-2" />
						<circle cx="9" cy="7" r="4" />
						<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
						<path d="M16 3.13a4 4 0 0 1 0 7.75" />
					</svg>
					Asignar docentes
				</Button>
			</div>
		</div>

		<!-- Subject Form -->
		<Card>
			<CardHeader>
				<CardTitle>Datos de la asignatura</CardTitle>
				<CardDescription>Edita la información básica de la asignatura</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					method="POST"
					action="?/update"
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'success') {
								toast?.toast({ title: 'Guardado', description: 'Asignatura actualizada', variant: 'success' });
								await update();
							} else if (result.type === 'failure') {
								toast?.toast({ title: 'Error', description: (result.data as any)?.error || 'Error al guardar', variant: 'destructive' });
							}
						};
					}}
					class="space-y-6"
				>
					<Field label="Nombre">
						<Input name="name" value={subject.name} required />
					</Field>

					<Field label="Código">
						<Input name="code" value={subject.code ?? ''} placeholder="Ej: MAT-101" />
					</Field>

					<Field label="Término">
						<Input name="term" value={subject.term ?? ''} placeholder="Ej: 2026-1" />
					</Field>

					<Field label="Descripción">
						<Input name="description" value={subject.description ?? ''} placeholder="Descripción opcional" />
					</Field>

					{#each selectedTeacherIds as id}
						<input type="hidden" name="teacherIds" value={id} />
					{/each}

					<Field label="Estado">
						<ToggleSwitch
							checked={isActive}
							onChange={(active) => (isActive = active)}
							aria-label={isActive ? 'Desactivar' : 'Restaurar'}
						/>
						<p class="text-xs text-muted-foreground mt-1">
							{isActive ? 'La asignatura está activa' : 'La asignatura está desactivada'}
						</p>
					</Field>

					<Button type="submit" class="w-full sm:w-auto">Guardar cambios</Button>
				</form>
			</CardContent>
		</Card>

		<!-- Assigned Teachers -->
		<Card>
			<CardHeader class="flex flex-row items-center justify-between">
				<CardTitle>Docentes asignados</CardTitle>
				<Button variant="outline" size="sm" onclick={() => (showAssignDialog = true)}>
					<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 1-4-4v-2" />
						<circle cx="9" cy="7" r="4" />
						<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
						<path d="M16 3.13a4 4 0 0 1 0 7.75" />
					</svg>
					Gestionar docentes
				</Button>
			</CardHeader>
			<CardContent>
				{#if subject.teachers.length === 0}
					<p class="text-muted-foreground text-center py-4">No hay docentes asignados</p>
				{:else}
					<div class="flex flex-wrap gap-2">
						{#each subject.teachers as t}
							<span class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs bg-muted text-muted-foreground">
								{t.name ?? t.email}
							</span>
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Assign Teachers Dialog -->
		{#if showAssignDialog}
			<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={() => (showAssignDialog = false)}>
				<Card class="w-full max-w-md max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
					<CardHeader>
						<CardTitle>Asignar docentes</CardTitle>
						<CardDescription>Selecciona los docentes que impartirán esta asignatura</CardDescription>
					</CardHeader>
					<CardContent>
						<MultiSelect
							options={teachers.map((t) => ({ value: t.id, label: `${t.name ?? t.email}` }))}
							value={selectedTeacherIds}
							onChange={(v) => (selectedTeacherIds = v)}
							placeholder="Seleccionar docentes..."
						/>
					</CardContent>
					<CardFooter class="flex justify-end gap-2">
						<Button
							variant="ghost"
							onclick={() => {
								showAssignDialog = false;
								selectedTeacherIds = subject.teachers.map((t) => t.id);
							}}
						>
							Cancelar
						</Button>
						<Button onclick={handleAssignTeachers}>Asignar</Button>
					</CardFooter>
				</Card>
			</div>
		{/if}
	</div>
</ToastProvider>