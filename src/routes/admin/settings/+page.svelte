<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import ToastProvider from '#lib/components/ui/toast/toast-provider.svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import { getToastContext } from '#lib/components/ui/toast/toast-context.svelte';

	let { data, form } = $props();
	const toast = getToastContext();
	let isSubmitting = $state(false);

	// Sync form result from server action
	$effect(() => {
		if (form?.success) {
			toast.toast({ title: 'Guardado', description: 'Configuración actualizada correctamente', variant: 'success' });
		}
		if (form?.error) {
			toast.toast({ title: 'Error', description: form.error, variant: 'destructive' });
		}
	});

	const providers = [
		{ value: 'openai', label: 'OpenAI', models: ['gpt-4.1-mini', 'gpt-4o', 'gpt-4.1', 'gpt-3.5-turbo'] },
		{ value: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-5', 'claude-opus-4.1', 'claude-3.5-sonnet'] },
		{ value: 'google', label: 'Google', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro'] }
	] as const;

	let selectedProvider = $state(data.defaultProvider ?? 'openai');
	let selectedModel = $state(data.defaultModel ?? 'gpt-4.1-mini');

	const availableModels = $derived(
		providers.find(p => p.value === selectedProvider)?.models ?? []
	);
</script>

<ToastProvider>
<div class="space-y-6">
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Configuración</h1>
			<p class="text-muted-foreground">Configuración global del sistema de evaluación</p>
		</div>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Configuración de IA</CardTitle>
			<CardDescription>Proveedor y modelo por defecto para la evaluación automática</CardDescription>
		</CardHeader>
		<CardContent>
			<form method="POST" action="?/defaults" use:enhance>
				<div class="grid gap-4 md:grid-cols-2">
					<div>
						<Field label="Proveedor por defecto">
							<input type="hidden" name="defaultProvider" value={selectedProvider} />
							<select
								class="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
								onchange={(e) => {
									const target = e.target as HTMLSelectElement;
									selectedProvider = target.value;
									const newProvider = providers.find(p => p.value === target.value);
									if (newProvider && newProvider.models.length > 0) {
										selectedModel = newProvider.models[0];
									}
								}}
							>
								{#each providers as p}
									<option value={p.value} selected={p.value === selectedProvider}>{p.label}</option>
								{/each}
							</select>
							<p class="text-xs text-muted-foreground mt-1">
								Proveedor de modelos para calificaciones automáticas
							</p>
						</Field>
					</div>
					<div>
						<Field label="Modelo por defecto">
							<input type="hidden" name="defaultModel" value={selectedModel} />
							<select
								class="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
								onchange={(e) => {
									const target = e.target as HTMLSelectElement;
									selectedModel = target.value;
								}}
							>
								{#each availableModels as m}
									<option value={m} selected={m === selectedModel}>{m}</option>
								{/each}
							</select>
							<p class="text-xs text-muted-foreground mt-1">
								Modelo usado por defecto en evaluaciones
							</p>
						</Field>
					</div>
				</div>

				<Card class="mt-6">
					<CardHeader>
						<CardTitle>Claves de API</CardTitle>
						<CardDescription>Gestión de claves de acceso a los proveedores de IA</CardDescription>
					</CardHeader>
					<CardContent>
						<p class="text-sm text-muted-foreground mb-4">
							Las claves de API se gestionan en la sección 
							<a href="/admin/api-keys" class="text-primary hover:underline">Gestión de API Keys</a>.
						</p>
					</CardContent>
				</Card>

				<div class="flex justify-end pt-4">
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting ? 'Guardando...' : 'Guardar configuración'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Variables de entorno</CardTitle>
			<CardDescription>Valores por defecto del sistema</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="grid gap-4 md:grid-cols-2 text-sm">
				<div>
					<span class="text-muted-foreground">Proveedor (.env): </span>
					<span class="font-mono text-xs">{data.envProvider}</span>
				</div>
				<div>
					<span class="text-muted-foreground">Modelo (.env): </span>
					<span class="font-mono text-xs">{data.envModel || '(no configurado)'}</span>
				</div>
			</div>
			<p class="text-xs text-muted-foreground mt-2">
				Los valores mostrados arriba son los defaults del sistema. Al guardar configuración personalizada, 
				estos valores se aplican solo a tu cuenta.
			</p>
		</CardContent>
	</Card>
</div>
</ToastProvider>