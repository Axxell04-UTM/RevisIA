<script lang="ts">
	import { deserialize } from '$app/forms';
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
	import Pagination from '#lib/components/ui/pagination/pagination.svelte';
	import { getToastContext } from '#lib/components/ui/toast/toast-context.svelte.ts';

	let { data } = $props();
	const toast = getToastContext();

	let showNewSubjectDialog = $state(false);
	let showConfirmDelete = $state('');
	let isSubmitting = $state(false);
	let newSubjectForm = $state({
		name: '',
		code: '',
		term: '',
		description: '',
		teacherIds: [] as string[]
	});

	const teachers = $derived(data.teachers);

	function openNewSubjectDialog() {
		newSubjectForm = { name: '', code: '', term: '', description: '', teacherIds: [] };
		showNewSubjectDialog = true;
	}

	function closeNewSubjectDialog() {
		showNewSubjectDialog = false;
		newSubjectForm = { name: '', code: '', term: '', description: '', teacherIds: [] };
	}

	async function handleCreateSubject() {
		if (!newSubjectForm.name) {
			toast.toast({ title: 'Error', description: 'El nombre es requerido', variant: 'destructive' });
			return;
		}
		isSubmitting = true;
		try {
			const params = new URLSearchParams();
			params.append('name', newSubjectForm.name);
			params.append('code', newSubjectForm.code);
			params.append('term', newSubjectForm.term);
			params.append('description', newSubjectForm.description);
			for (const id of newSubjectForm.teacherIds) {
				params.append('teacherIds', id);
			}
			const res = await fetch('/admin/subjects?/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: params
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' && result.data && typeof result.data === 'object' && 'success' in result.data && (result.data as any).success) {
				toast.toast({ title: 'Asignatura creada', description: 'La asignatura se ha creado correctamente', variant: 'success' });
				closeNewSubjectDialog();
				await invalidateAll();
			} else if (result.type === 'failure' && result.data && typeof result.data === 'object' && 'error' in result.data) {
				const data = result.data as { error: string };
				toast.toast({ title: 'Error', description: data.error || 'Error al crear asignatura', variant: 'destructive' });
			} else {
				toast.toast({ title: 'Error', description: 'Error al crear asignatura', variant: 'destructive' });
			}
		} catch (e) {
			toast.toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
		} finally {
			isSubmitting = false;
		}
	}

	async function handleToggleActive(subjectId: string, active: boolean) {
		try {
			const res = await fetch('/admin/subjects?/toggleActive', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ subjectId, active: String(active) })
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' && result.data && typeof result.data === 'object' && 'success' in result.data && (result.data as any).success) {
				toast.toast({ title: active ? 'Restaurada' : 'Desactivada', description: 'Estado actualizado', variant: 'success' });
				await invalidateAll();
			} else if (result.type === 'failure' && result.data && typeof result.data === 'object' && 'error' in result.data) {
				const data = result.data as { error: string };
				toast.toast({ title: 'Error', description: data.error || 'No se pudo actualizar el estado', variant: 'destructive' });
			} else {
				toast.toast({ title: 'Error', description: 'No se pudo actualizar el estado', variant: 'destructive' });
			}
		} catch (e) {
			toast.toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
		}
	}

	function confirmDelete(subjectId: string) {
		showConfirmDelete = subjectId;
	}

	async function handleDelete() {
		if (!showConfirmDelete) return;
		try {
			const res = await fetch('/admin/subjects?/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ subjectId: showConfirmDelete, delete: 'true' })
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' && result.data && typeof result.data === 'object' && 'success' in result.data && (result.data as any).success) {
				toast.toast({ title: 'Eliminada', description: 'Asignatura desactivada', variant: 'success' });
				showConfirmDelete = '';
				await invalidateAll();
			} else if (result.type === 'failure' && result.data && typeof result.data === 'object' && 'error' in result.data) {
				const data = result.data as { error: string };
				toast.toast({ title: 'Error', description: data.error || 'No se pudo eliminar', variant: 'destructive' });
			} else {
				toast.toast({ title: 'Error', description: 'No se pudo eliminar', variant: 'destructive' });
			}
		} catch (e) {
			toast.toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
		}
	}

	const sortByOptions = [
		{ value: 'createdAt', label: 'Fecha creación' },
		{ value: 'name', label: 'Nombre' },
		{ value: 'code', label: 'Código' }
	] as const;

	const sortOrderOptions = [
		{ value: 'desc', label: 'Descendente' },
		{ value: 'asc', label: 'Ascendente' }
	] as const;
</script>

<ToastProvider>
<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Gestión de Asignaturas</h1>
			<p class="text-muted-foreground">Administra asignaturas, códigos, términos y docentes asignados</p>
		</div>
		<div class="flex items-center gap-2">
			<Button onclick={openNewSubjectDialog}>
				<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
				Nueva asignatura
			</Button>
		</div>
	</div>

	<!-- Filters & Search -->
	<div class="flex flex-col sm:flex-row gap-4">
		<div class="flex-1">
			<Field label="Buscar">
				<Input
					type="search"
					placeholder="Buscar por nombre, código..."
					value={data.search}
					oninput={(e: InputEvent) => {
						const url = new URL(window.location.href);
						const target = e.target as HTMLInputElement;
						url.searchParams.set('search', target.value);
						url.searchParams.set('page', '1');
						window.location.href = url.toString();
					}}
				/>
			</Field>
		</div>
		<div class="flex items-center gap-2">
			<select
				bind:value={data.deleted}
				onchange={(e: Event) => {
					const url = new URL(window.location.href);
					const target = e.target as HTMLSelectElement;
					url.searchParams.set('deleted', target.value);
					url.searchParams.set('page', '1');
					window.location.href = url.toString();
				}}
				class="px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				<option value="false">Activas</option>
				<option value="true">Eliminadas</option>
			</select>
			<select
				bind:value={data.sortBy}
				onchange={(e: Event) => {
					const url = new URL(window.location.href);
					const target = e.target as HTMLSelectElement;
					url.searchParams.set('sortBy', target.value);
					url.searchParams.set('page', '1');
					window.location.href = url.toString();
				}}
				class="px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50 w-40"
			>
				{#each sortByOptions as opt}
				<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			<select
				bind:value={data.sortOrder}
				onchange={(e: Event) => {
					const url = new URL(window.location.href);
					const target = e.target as HTMLSelectElement;
					url.searchParams.set('sortOrder', target.value);
					url.searchParams.set('page', '1');
					window.location.href = url.toString();
				}}
				class="px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50 w-36"
			>
				{#each sortOrderOptions as opt}
				<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Subjects Table -->
	<Card>
		<CardContent class="p-0">
			<div class="overflow-x-auto">
				<table class="w-full caption-bottom text-sm">
					<thead class="[&_tr]:border-b">
						<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Nombre</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Código</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Término</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Docentes</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Estado</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Creado</th>
							<th class="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Acciones</th>
						</tr>
					</thead>
					<tbody class="[&_tr:last-child]:border-0">
						{#each data.subjects as subject}
						<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
							<td class="p-4 align-middle">
								<div class="font-medium">{subject.name}</div>
							</td>
							<td class="p-4 align-middle">
								<div class="font-mono text-sm">{subject.code ?? '—'}</div>
							</td>
							<td class="p-4 align-middle">
								<div class="text-sm">{subject.term ?? '—'}</div>
							</td>
							<td class="p-4 align-middle">
								<div class="flex flex-wrap gap-1">
									{#each subject.teachers as t}
									<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-muted text-muted-foreground">
										{t.name ?? t.email}
									</span>
									{/each}
									{#if subject.teachers.length === 0}
									<span class="text-xs text-muted-foreground">Sin docentes</span>
									{/if}
								</div>
							</td>
							<td class="p-4 align-middle">
								<ToggleSwitch
									checked={!subject.deletedAt}
									onChange={(active) => handleToggleActive(subject.id, active)}
									aria-label={subject.deletedAt ? 'Restaurar' : 'Desactivar'}
									size="sm"
								/>
							</td>
							<td class="p-4 align-middle text-muted-foreground">
								{subject.createdAt.toLocaleDateString('es-AR')}
							</td>
							<td class="p-4 align-middle text-right">
								<div class="flex items-center justify-end gap-2">
									<Button
										variant="ghost"
										size="icon"
										onclick={() => {
											const url = new URL(window.location.href);
											url.pathname = `/admin/subjects/${subject.id}`;
											window.location.href = url.toString();
										}}
										aria-label="Editar"
									>
										<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
											<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5" />
										</svg>
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="text-destructive hover:text-destructive"
										onclick={() => confirmDelete(subject.id)}
										aria-label="Eliminar"
									>
										<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<polyline points="3 6 5 6 21 6" />
											<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
										</svg>
									</Button>
								</div>
							</td>
						</tr>
						{/each}
						{#if data.subjects.length === 0}
						<tr>
							<td colspan="7" class="p-8 text-center text-muted-foreground">
								No hay asignaturas registradas
							</td>
						</tr>
						{/if}
					</tbody>
				</table>
			</div>
		</CardContent>
	</Card>

	<!-- Pagination -->
	{#if data.totalPages > 1}
	<div class="flex justify-center">
		<Pagination
			currentPage={data.page}
			totalPages={data.totalPages}
			onPageChange={(page) => {
				const url = new URL(window.location.href);
				url.searchParams.set('page', String(page));
				window.location.href = url.toString();
			}}
		/>
	</div>
	{/if}

	<!-- New Subject Dialog -->
	{#if showNewSubjectDialog}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={() => showNewSubjectDialog = false}>
		<Card class="w-full max-w-md max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
			<CardHeader>
				<CardTitle>Nueva asignatura</CardTitle>
				<CardDescription>Crea una nueva asignatura y asigna docentes</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<Field label="Nombre">
					<Input
						value={newSubjectForm.name}
						oninput={(e: InputEvent) => newSubjectForm.name = (e.target as HTMLInputElement).value}
						required
						placeholder="Ej: Matemáticas"
					/>
				</Field>
				<Field label="Código">
					<Input
						value={newSubjectForm.code}
						oninput={(e: InputEvent) => newSubjectForm.code = (e.target as HTMLInputElement).value}
						placeholder="Ej: MAT-101"
					/>
				</Field>
				<Field label="Término">
					<Input
						value={newSubjectForm.term}
						oninput={(e: InputEvent) => newSubjectForm.term = (e.target as HTMLInputElement).value}
						placeholder="Ej: 2026-1"
					/>
				</Field>
				<Field label="Descripción">
					<Input
						value={newSubjectForm.description}
						oninput={(e: InputEvent) => newSubjectForm.description = (e.target as HTMLInputElement).value}
						placeholder="Descripción opcional"
					/>
				</Field>
				<Field label="Docentes">
					<MultiSelect
						options={teachers.map(t => ({ value: t.id, label: `${t.name ?? t.email}` }))}
						value={newSubjectForm.teacherIds}
						onChange={(v) => newSubjectForm.teacherIds = v}
						placeholder="Seleccionar docentes..."
					/>
				</Field>
			</CardContent>
			<CardFooter class="flex justify-end gap-2">
				<Button variant="ghost" onclick={closeNewSubjectDialog}>Cancelar</Button>
				<Button onclick={handleCreateSubject} disabled={isSubmitting}>
					{isSubmitting ? 'Creando...' : 'Crear asignatura'}
				</Button>
			</CardFooter>
		</Card>
	</div>
	{/if}

	<!-- Confirm Delete Dialog -->
	{#if showConfirmDelete}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={() => showConfirmDelete = ''}>
		<Card class="w-full max-w-md" onclick={(e) => e.stopPropagation()}>
			<CardHeader>
				<CardTitle class="text-destructive">Confirmar eliminación</CardTitle>
				<CardDescription>La asignatura será desactivada. Esta acción es reversible restaurándola.</CardDescription>
			</CardHeader>
			<CardFooter class="flex justify-end gap-2">
				<Button variant="ghost" onclick={() => showConfirmDelete = ''}>Cancelar</Button>
				<Button variant="destructive" onclick={handleDelete}>Desactivar</Button>
			</CardFooter>
		</Card>
	</div>
	{/if}
</div>
</ToastProvider>