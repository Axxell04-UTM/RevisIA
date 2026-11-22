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
	import ToggleSwitch from '#lib/components/ui/toggle-switch/toggle-switch.svelte';
	import Pagination from '#lib/components/ui/pagination/pagination.svelte';
	import { getToastContext } from '#lib/components/ui/toast/toast-context.svelte';

	let { data, form } = $props();
	const toast = getToastContext();

	let showNewKeyDialog = $state(false);
	let showConfirmDelete = $state('');
	let isSubmitting = $state(false);
	let newKeyForm = $state({
		provider: 'openai',
		label: '',
		secret: '',
		teacherId: '',
		fallbackModel: ''
	});

	// Only the create form is submitted through `enhance`, so `form` only ever
	// carries that action's payload. The other actions are dispatched with
	// `fetch` and report their own result where they are called.
	$effect(() => {
		if (!form) return;

		if ('error' in form && form.error) {
			toast.toast({ title: 'Error', description: form.error, variant: 'destructive' });
			return;
		}

		if ('keyId' in form && form.success) {
			toast.toast({ title: 'API Key creada', description: 'La clave se ha guardado correctamente', variant: 'success' });
			showNewKeyDialog = false;
		}
	});

	const teachers = $derived(data.teachers);

	/**
	 * Runs one of the actions dispatched with `fetch` and reports its outcome.
	 *
	 * They bypass `enhance`, so the `form` prop never carries their payload:
	 * each call reads its own response and then re-runs the load, so the table
	 * shows the persisted state instead of the optimistic click.
	 */
	async function runAction(
		action: 'toggleActive' | 'delete' | 'setFallback',
		body: Record<string, string>,
		successMessage: string
	): Promise<boolean> {
		try {
			const res = await fetch(`/admin/api-keys?/${action}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams(body)
			});
			const result = deserialize(await res.text());

			if (result.type !== 'success') {
				const failure = result.type === 'failure' ? (result.data as { error?: string } | null) : null;
				toast.toast({
					title: 'Error',
					description: failure?.error ?? 'No se pudo completar la acción',
					variant: 'destructive'
				});
				return false;
			}

			toast.toast({ title: 'Listo', description: successMessage, variant: 'success' });
			await invalidateAll();
			return true;
		} catch {
			toast.toast({ title: 'Error', description: 'No se pudo completar la acción', variant: 'destructive' });
			return false;
		}
	}

	function openNewKeyDialog() {
		newKeyForm = { provider: 'openai', label: '', secret: '', teacherId: '', fallbackModel: '' };
		showNewKeyDialog = true;
	}

	function closeNewKeyDialog() {
		showNewKeyDialog = false;
		newKeyForm = { provider: 'openai', label: '', secret: '', teacherId: '', fallbackModel: '' };
	}

	/** Provider default shown when a key has no fallback of its own. */
	function defaultFallback(provider: string): string {
		return (data.defaultFallbacks as Record<string, string>)[provider] ?? '';
	}

	/**
	 * Persists the fallback model of one key.
	 *
	 * It is saved on change (blur with a different value) because a model name
	 * is one field, not a document: a button would add a click without adding
	 * safety. An empty value clears the override.
	 */
	async function saveFallback(key: { id: string }, value: string) {
		await runAction(
			'setFallback',
			{ keyId: key.id, fallbackModel: value },
			value.trim() ? 'Modelo de respaldo guardado' : 'Modelo de respaldo restablecido'
		);
		// On failure the input must show what the server actually has.
		await invalidateAll();
	}

	function confirmDelete(keyId: string) {
		showConfirmDelete = keyId;
	}
</script>

<ToastProvider>
<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Gestión de API Keys</h1>
			<p class="text-muted-foreground">Gestiona claves de API por proveedor, globales o por docente</p>
		</div>
		<div class="flex items-center gap-2">
			<Button onclick={openNewKeyDialog}>
				<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
				Nueva API Key
			</Button>
		</div>
	</div>

	<!-- Filters -->
	<div class="flex flex-col sm:flex-row gap-4">
		<div class="flex items-center gap-2">
			<select
				bind:value={data.provider}
				onchange={(e: Event) => {
					const url = new URL(window.location.href);
					const target = e.target as HTMLSelectElement;
					url.searchParams.set('provider', target.value);
					url.searchParams.set('page', '1');
					window.location.href = url.toString();
				}}
				class="px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50 w-48"
			>
				<option value="">Todos los proveedores</option>
				<option value="openai">OpenAI</option>
				<option value="anthropic">Anthropic</option>
				<option value="google">Google</option>
			</select>
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
				class="px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50 w-40"
			>
				<option value="all">Todas</option>
				<option value="true">Activas</option>
				<option value="false">Revocadas</option>
			</select>
		</div>
	</div>

	<!-- Keys Table -->
	<Card>
		<CardContent class="p-0">
			<div class="overflow-x-auto">
				<table class="w-full caption-bottom text-sm">
					<thead class="[&_tr]:border-b">
						<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Proveedor</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Etiqueta</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Últimos 4</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
								Respaldo
								<span class="block text-xs font-normal normal-case text-muted-foreground/70">modelo si el principal falla</span>
							</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Alcance</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Estado</th>
							<th class="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Creada</th>
							<th class="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Acciones</th>
						</tr>
					</thead>
					<tbody class="[&_tr:last-child]:border-0">
						{#each data.keys as key}
						<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
							<td class="p-4 align-middle">
								<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground capitalize">{key.provider}</span>
							</td>
							<td class="p-4 align-middle">
								<div class="font-medium">{key.label ?? '—'}</div>
							</td>
							<td class="p-4 align-middle">
								<code class="text-sm font-mono">{key.lastFour ?? '****'}</code>
							</td>
							<td class="p-4 align-middle">
								<input
									class="w-48 rounded border border-input bg-background px-2 py-1 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
									placeholder={defaultFallback(key.provider)}
									title="Modelo al que se reintenta ante 503/429/5xx. Vacío = predeterminado del proveedor."
									value={key.fallbackModel ?? ''}
									onchange={(e) => saveFallback(key, (e.target as HTMLInputElement).value)}
								/>
								<span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
									{key.fallbackModel ? 'configurado' : `por defecto: ${defaultFallback(key.provider) || 'sin respaldo'}`}
								</span>
							</td>
							<td class="p-4 align-middle">
								{#if key.teacherId}
								<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-muted text-muted-foreground">{key.teacherId}</span>
								{:else}
								<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-primary/10 text-primary text-xs">Global</span>
								{/if}
							</td>
							<td class="p-4 align-middle">
								<ToggleSwitch
									checked={key.active}
									onChange={async (active) => {
										showConfirmDelete = ''; // Reset delete confirmation
										await runAction(
											'toggleActive',
											{ keyId: key.id, active: String(active) },
											active ? 'Clave activada' : 'Clave revocada'
										);
									}}
									aria-label={key.active ? 'Revocar' : 'Activar'}
									size="sm"
								/>
							</td>
							<td class="p-4 align-middle text-muted-foreground">
								{new Date(key.createdAt).toLocaleDateString('es-AR')}
							</td>
							<td class="p-4 align-middle text-right">
								<div class="flex items-center justify-end gap-2">
									<Button
										variant="ghost"
										size="icon"
										class="text-destructive hover:text-destructive"
										onclick={() => confirmDelete(key.id)}
										aria-label="Revocar"
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
						{#if data.keys.length === 0}
						<tr>
							<td colspan="7" class="p-8 text-center text-muted-foreground">
								No hay API Keys registradas
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

	<!-- New Key Dialog -->
	{#if showNewKeyDialog}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={() => showNewKeyDialog = false}>
		<Card class="w-full max-w-md max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
			<CardHeader>
				<CardTitle>Nueva API Key</CardTitle>
				<CardDescription>La clave se cifra y nunca se muestra completa tras guardar</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<form method="POST" action="?/create" use:enhance>
					<input type="hidden" name="provider" value={newKeyForm.provider} />
					<input type="hidden" name="teacherId" value={newKeyForm.teacherId} />
					<Field label="Proveedor">
						<select
							class="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
							onchange={(e) => newKeyForm.provider = (e.target as HTMLSelectElement).value}
						>
							<option value="openai">OpenAI</option>
							<option value="anthropic">Anthropic</option>
							<option value="google">Google</option>
						</select>
					</Field>
					<Field label="Etiqueta (opcional)">
						<Input
							name="label"
							value={newKeyForm.label}
							onin={(e: InputEvent) => newKeyForm.label = (e.target as HTMLInputElement).value}
							placeholder="Ej: GPT-4 para correcciones"
						/>
					</Field>
					<Field label="Clave API">
						<Input
							type="password"
							name="secret"
							value={newKeyForm.secret}
							onin={(e: InputEvent) => newKeyForm.secret = (e.target as HTMLInputElement).value}
							required
							placeholder="sk-... o clave del proveedor"
						/>
						<p class="text-xs text-muted-foreground mt-1">Se cifra AES-256-GCM y nunca se muestra completa</p>
					</Field>
					<Field label="Modelo de respaldo (opcional)">
						<Input
							name="fallbackModel"
							value={newKeyForm.fallbackModel}
							onin={(e: InputEvent) => newKeyForm.fallbackModel = (e.target as HTMLInputElement).value}
							placeholder={`Ej: ${defaultFallback(newKeyForm.provider)}`}
						/>
						<p class="text-xs text-muted-foreground mt-1">
							Se reintenta con este modelo cuando el principal responde 503, 429 o 5xx. Vacío = {defaultFallback(newKeyForm.provider) || 'sin respaldo'}.
						</p>
					</Field>
					<Field label="Alcance">
						<select
							class="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
							onchange={(e) => newKeyForm.teacherId = (e.target as HTMLSelectElement).value}
						>
							<option value="">Global (admin)</option>
							{#each teachers as t}
							<option value={t.id}>{t.name ?? t.email}</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground mt-1">Global = disponible para todos; Docente = solo ese usuario</p>
					</Field>
					<CardFooter class="flex justify-end gap-2">
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? 'Guardando...' : 'Guardar'}
						</Button>
					</CardFooter>
				</form>
			</CardContent>
		</Card>
	</div>
	{/if}

	<!-- Confirm Delete Dialog -->
	{#if showConfirmDelete}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={() => showConfirmDelete = ''}>
		<Card class="w-full max-w-md" onclick={(e) => e.stopPropagation()}>
			<CardHeader>
				<CardTitle class="text-destructive">Confirmar revocación</CardTitle>
				<CardDescription>La clave será revocada permanentemente. No se puede deshacer.</CardDescription>
			</CardHeader>
			<CardFooter class="flex justify-end gap-2">
				<Button variant="ghost" onclick={() => showConfirmDelete = ''}>Cancelar</Button>
				<Button 
					variant="destructive" 
					onclick={async () => {
						if (await runAction('delete', { keyId: showConfirmDelete }, 'API Key revocada')) {
							showConfirmDelete = '';
						}
					}}
				>
					Revocar
				</Button>
			</CardFooter>
		</Card>
	</div>
	{/if}
</div>
</ToastProvider>