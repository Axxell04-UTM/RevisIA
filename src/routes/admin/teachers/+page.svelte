<script lang="ts">
	import { page } from '$app/state';
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
	import Pagination from '#lib/components/ui/pagination/pagination.svelte';
	import DropdownMenu from '#lib/components/ui/dropdown-menu/dropdown-menu.svelte';
	import { getToastContext } from '#lib/components/ui/toast/toast-context.svelte.ts';

	let { data } = $props();
	const toast = getToastContext();

	let showNewTeacherDialog = $state(false);
	let showConfirmDelete = $state('');
	let exportMenuOpen = $state(false);
	let newTeacherForm = $state({
		email: '',
		name: '',
		password: '',
		subjectIds: [] as string[]
	});
	let isSubmitting = $state(false);

	$effect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (exportMenuOpen && !(event.target as HTMLElement).closest('.relative.inline-flex')) {
				exportMenuOpen = false;
			}
		}
		document.addEventListener('click', handleClickOutside)
		return () => document.removeEventListener('click', handleClickOutside)
	})

	const subjects = $derived(data.subjects);

	function generatePassword(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
		let password = '';
		for (let i = 0; i < 12; i++) {
			password += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return password;
	}

	function openNewTeacherDialog() {
		newTeacherForm = {
			email: '',
			name: '',
			password: generatePassword(),
			subjectIds: []
		};
		showNewTeacherDialog = true;
	}

	function closeNewTeacherDialog() {
		showNewTeacherDialog = false;
		newTeacherForm = { email: '', name: '', password: '', subjectIds: [] };
	}

	async function handleCreateTeacher() {
		if (!newTeacherForm.email || !newTeacherForm.name || !newTeacherForm.password) {
			toast.toast({ title: 'Error', description: 'Email, nombre y contraseña son requeridos', variant: 'destructive' });
			return;
		}
		isSubmitting = true;
		try {
			const params = new URLSearchParams();
			params.append('email', newTeacherForm.email);
			params.append('name', newTeacherForm.name);
			params.append('password', newTeacherForm.password);
			for (const id of newTeacherForm.subjectIds) {
				params.append('subjectIds', id);
			}
			const res = await fetch('/admin/teachers?/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: params
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' && result.data && typeof result.data === 'object' && 'success' in result.data && (result.data as any).success) {
				const data = result.data as { success: boolean; tempPassword: string };
				toast.toast({
					title: 'Docente creado',
					description: `Contraseña temporal: ${data.tempPassword}`,
					variant: 'success',
					duration: 10000,
					action: {
						label: 'Copiar',
						onClick: () => navigator.clipboard.writeText(data.tempPassword)
					}
				});
				closeNewTeacherDialog();
				await invalidateAll();
			} else if (result.type === 'failure' && result.data && typeof result.data === 'object' && 'error' in result.data) {
				const data = result.data as { error: string };
				toast.toast({ title: 'Error', description: data.error || 'Error al crear docente', variant: 'destructive' });
			} else {
				toast.toast({ title: 'Error', description: 'Error al crear docente', variant: 'destructive' });
			}
		} catch (e) {
			toast.toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
		} finally {
			isSubmitting = false;
		}
	}

	async function handleToggleActive(teacherId: string, active: boolean) {
		try {
			const res = await fetch('/admin/teachers?/toggleActive', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ teacherId, active: String(active) })
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' && result.data && typeof result.data === 'object' && 'success' in result.data && (result.data as any).success) {
				toast.toast({ title: active ? 'Activado' : 'Desactivado', description: 'Estado del docente actualizado', variant: 'success' });
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

	function confirmDelete(teacherId: string) {
		showConfirmDelete = teacherId;
	}

	async function handleDelete() {
		if (!showConfirmDelete) return;
		try {
			const res = await fetch('/admin/teachers?/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ teacherId: showConfirmDelete, delete: 'true' })
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' && result.data && typeof result.data === 'object' && 'success' in result.data && (result.data as any).success) {
				toast.toast({ title: 'Eliminado', description: 'Docente desactivado', variant: 'success' });
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

	async function handleExportCsv() {
		const res = await fetch('/admin/teachers?/exportCsv', { method: 'POST' });
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `teachers-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleExportExcel() {
		const res = await fetch('/admin/teachers?/exportExcel', { method: 'POST' });
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `teachers-${new Date().toISOString().split('T')[0]}.xlsx`;
		a.click();
		URL.revokeObjectURL(url);
	}

	const sortByOptions = [
		{ value: 'createdAt', label: 'Fecha creación' },
		{ value: 'name', label: 'Nombre' },
		{ value: 'email', label: 'Email' }
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
			<h1 class="text-3xl font-bold tracking-tight">Gestión de Docentes</h1>
			<p class="text-muted-foreground">Administra docentes, asignaturas y accesos</p>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative inline-flex">
				<Button variant="outline" aria-expanded={exportMenuOpen} aria-haspopup="true">
					<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="7 10 12 15 17 10" />
						<line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					Exportar
				</Button>
				{#if exportMenuOpen}
				<div class="absolute right-0 mt-1 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-lg z-50">
					<button
						type="button"
						class="w-full flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent rounded-sm"
						onclick={handleExportCsv}
					>
						<svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
							<polyline points="14 2 14 8 20 8"/>
							<line x1="16" y1="13" x2="8" y2="13"/>
							<line x1="16" y1="17" x2="8" y2="17"/>
							<polyline points="10 9 9 9 8 9"/>
						</svg>
						<span>CSV</span>
					</button>
					<button
						type="button"
						class="w-full flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent rounded-sm"
						onclick={handleExportExcel}
					>
						<svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
							<polyline points="14 2 14 8 20 8"/>
							<line x1="16" y1="13" x2="8" y2="13"/>
							<line x1="16" y1="17" x2="8" y2="17"/>
							<polyline points="10 9 9 9 8 9"/>
						</svg>
						<span>Excel</span>
					</button>
				</div>
				{/if}
			</div>
			<Button onclick={openNewTeacherDialog} disabled={isSubmitting}>
				<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
				Nuevo docente
			</Button>
		</div>
	</div>

	<!-- Filters & Search -->
	<div class="flex flex-col sm:flex-row gap-4">
		<div class="flex-1">
			<Field label="Buscar">
				<Input
					type="search"
					placeholder="Buscar por email..."
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
				bind:value={data.active}
				onchange={(e: Event) => {
					const url = new URL(window.location.href);
					const target = e.target as HTMLSelectElement;
					if (target.value === 'all') {
						url.searchParams.delete('active');
					} else {
						url.searchParams.set('active', target.value);
					}
					url.searchParams.set('page', '1');
					window.location.href = url.toString();
				}}
				class="px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				<option value="all">Todos</option>
				<option value="true">Activos</option>
				<option value="false">Inactivos</option>
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

	<!-- Teachers Table -->
	<Card>
		<CardContent class="p-0">
			<div class="overflow-x-auto">
				<table class="w-full caption-bottom text-sm">
					<thead class="[&_tr]:border-b">
						<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Email</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Nombre</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Activo</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Asignaturas</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Creado</th>
							<th class="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Acciones</th>
						</tr>
					</thead>
					<tbody class="[&_tr:last-child]:border-0">
						{#each data.teachers as teacher}
						<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
							<td class="p-4 align-middle">
								<div class="font-medium">{teacher.email}</div>
							</td>
							<td class="p-4 align-middle">
								<div class="font-medium">{teacher.name ?? '—'}</div>
							</td>
							<td class="p-4 align-middle">
								<ToggleSwitch
									checked={teacher.active}
									onChange={(active) => handleToggleActive(teacher.id, active)}
									aria-label={teacher.active ? 'Desactivar docente' : 'Activar docente'}
									size="sm"
								/>
							</td>
							<td class="p-4 align-middle">
								<div class="flex flex-wrap gap-1">
									{#each teacher.subjects as subj}
									<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-muted text-muted-foreground">
										{subj.code}
									</span>
									{/each}
									{#if teacher.subjects.length === 0}
									<span class="text-xs text-muted-foreground">Sin asignaturas</span>
									{/if}
								</div>
							</td>
							<td class="p-4 align-middle text-muted-foreground">
								{teacher.createdAt.toLocaleDateString('es-AR')}
							</td>
							<td class="p-4 align-middle text-right">
								<div class="flex items-center justify-end gap-2">
									<Button
										variant="ghost"
										size="icon"
										onclick={() => {
											const url = new URL(window.location.href);
											url.pathname = `/admin/teachers/${teacher.id}`;
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
										onclick={() => {
											const tempPassword = crypto.randomUUID().slice(0, 12);
											fetch('/admin/teachers/' + teacher.id, {
												method: 'POST',
												headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
												body: new URLSearchParams({ resetPassword: 'true', tempPassword })
											}).then(r => r.json()).then(d => {
												if (d.success) {
													const toast = window.dispatchEvent(new CustomEvent('toast', { detail: { title: 'Contraseña reseteada', description: `Nueva temporal: ${d.tempPassword}`, variant: 'success', duration: 10000 } }));
												}
											});
										}}
										aria-label="Resetear contraseña"
									>
										<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<rect x="2" y="4" width="20" height="16" rx="2" />
											<path d="M8 12h12" />
											<path d="M12 8v12" />
										</svg>
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="text-destructive hover:text-destructive"
										onclick={() => confirmDelete(teacher.id)}
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
						{#if data.teachers.length === 0}
						<tr>
							<td colspan="6" class="p-8 text-center text-muted-foreground">
								No hay docentes registrados
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

	<!-- New Teacher Dialog -->
	{#if showNewTeacherDialog}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={closeNewTeacherDialog}>
		<Card class="w-full max-w-md max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
			<CardHeader>
				<CardTitle>Nuevo docente</CardTitle>
				<CardDescription>Los datos de acceso se mostrarán solo una vez al crear</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<Field label="Email">
					<Input
						type="email"
						value={newTeacherForm.email}
						oninput={(e: InputEvent) => newTeacherForm.email = (e.target as HTMLInputElement).value}
						required
						placeholder="docente@ejemplo.com"
					/>
				</Field>
				<Field label="Nombre">
					<Input
						value={newTeacherForm.name}
						oninput={(e: InputEvent) => newTeacherForm.name = (e.target as HTMLInputElement).value}
						required
						placeholder="Nombre completo"
					/>
				</Field>
				<Field label="Contraseña temporal">
					<div class="flex gap-2">
						<Input
							type="password"
							value={newTeacherForm.password}
							oninput={(e: InputEvent) => newTeacherForm.password = (e.target as HTMLInputElement).value}
							required
							class="flex-1"
						/>
						<Button variant="outline" size="sm" onclick={() => newTeacherForm.password = generatePassword()}>
							Generar
						</Button>
					</div>
					<p class="text-xs text-muted-foreground mt-1">Se mostrará solo una vez. Cópiela y entréguela al docente.</p>
				</Field>
				<Field label="Asignaturas">
					<MultiSelect
						options={subjects.map(s => ({ value: s.id, label: `${s.code} - ${s.name}` }))}
						value={newTeacherForm.subjectIds}
						onChange={(v) => newTeacherForm.subjectIds = v}
						placeholder="Seleccionar asignaturas..."
					/>
				</Field>
			</CardContent>
			<CardFooter class="flex justify-end gap-2">
				<Button variant="ghost" onclick={closeNewTeacherDialog}>Cancelar</Button>
				<Button onclick={handleCreateTeacher} disabled={isSubmitting}>
					{isSubmitting ? 'Creando...' : 'Crear docente'}
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
				<CardDescription>El docente será desactivado y sus sesiones revocadas. Esta acción es reversible reactivándolo.</CardDescription>
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