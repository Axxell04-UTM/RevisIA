<script lang="ts">
	import { enhance } from '$app/forms';
	import ToastProvider from '#lib/components/ui/toast/toast-provider.svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';

	let { data } = $props();
</script>

<ToastProvider>
<div class="space-y-6">
	<!-- Header -->
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Panel de administración</h1>
		<p class="text-muted-foreground">Visión general del sistema</p>
	</div>

	<!-- Metrics Grid -->
	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Docentes totales</CardTitle>
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{data.metrics.totalTeachers}</div>
				<p class="text-xs text-muted-foreground">Registrados en el sistema</p>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Docentes activos</CardTitle>
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{data.metrics.activeTeachers}</div>
				<p class="text-xs text-muted-foreground">Con acceso al sistema</p>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Entregas esta semana</CardTitle>
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{data.metrics.recentSubmissions}</div>
				<p class="text-xs text-muted-foreground">Últimos 7 días</p>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Total entregas</CardTitle>
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{data.metrics.totalSubmissions}</div>
				<p class="text-xs text-muted-foreground">Histórico</p>
			</CardContent>
		</Card>
	</div>

	<!-- Quick Actions -->
	<div class="space-y-6">
		<Card>
			<CardHeader>
				<CardTitle>Accesos rápidos</CardTitle>
				<CardDescription>Acciones frecuentes de administración</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-4 md:grid-cols-4">
				<Button
					variant="outline"
					class="h-auto w-full py-6 flex flex-col items-start gap-2 whitespace-normal text-left"
					onclick={() => window.location.href = '/admin/teachers'}
				>
					<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
						<circle cx="9" cy="7" r="4" />
						<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
						<path d="M16 3.13a4 4 0 0 1 0 7.75" />
					</svg>
					<span class="font-medium">Gestionar docentes</span>
					<span class="block text-sm text-muted-foreground">Crear, editar, desactivar docentes</span>
				</Button>

				<Button
					variant="outline"
					class="h-auto w-full py-6 flex flex-col items-start gap-2 whitespace-normal text-left"
					onclick={() => window.location.href = '/admin/subjects'}
				>
					<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477 4.5 1.253" />
					</svg>
					<span class="font-medium">Gestionar asignaturas</span>
					<span class="block text-sm text-muted-foreground">Crear, editar, asignar docentes</span>
				</Button>

				<Button
					variant="outline"
					class="h-auto w-full py-6 flex flex-col items-start gap-2 whitespace-normal text-left"
					onclick={() => window.location.href = '/admin/settings'}
				>
					<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 1-1.82.33 1.65 1.65 0 0 1-1.82-.33l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 1 1.82.33H21a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-.09a1.65 1.65 0 0 1-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 1 1.82.33H7a2 2 0 0 0-2 2v.09a1.65 1.65 0 0 1-.33 1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 1-1.82.33H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h.09a1.65 1.65 0 0 1 .33 1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l-.06-.06a1.65 1.65 0 0 1-1.82-.33H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h.09a1.65 1.65 0 0 1 .33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06-.06a1.65 1.65 0 0 1 1.82-.33H17a2 2 0 0 1 2 2v.09a1.65 1.65 0 0 1 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06.06a1.65 1.65 0 0 1-1.82.33H7a2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 1-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06-.06a1.65 1.65 0 0 1 1.82-.33H17" />
					</svg>
					<span class="font-medium">Configuración</span>
					<span class="block text-sm text-muted-foreground">API keys, proveedores, modelo</span>
				</Button>

				<Button
					variant="outline"
					class="h-auto w-full py-6 flex flex-col items-start gap-2 whitespace-normal text-left"
					onclick={() => window.location.href = '/'}
				>
					<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
						<polyline points="9 22 9 12 15 12" />
					</svg>
					<span class="font-medium">Volver a la app</span>
					<span class="block text-sm text-muted-foreground">Vista principal</span>
				</Button>
			</CardContent>
		</Card>

		<!-- System Info -->
		<Card>
			<CardHeader>
				<CardTitle>Información del sistema</CardTitle>
				<CardDescription>Estadísticas adicionales</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-4 md:grid-cols-3">
				<div class="flex items-center gap-4">
					<svg class="h-8 w-8 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
						<circle cx="9" cy="7" r="4" />
						<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
						<path d="M16 3.13a4 4 0 0 1 0 7.75" />
					</svg>
					<div>
						<p class="text-sm text-muted-foreground">Docentes totales</p>
						<p class="text-2xl font-bold">{data.metrics.totalTeachers}</p>
					</div>
				</div>
			</CardContent>
		</Card>
	</div>
</ToastProvider>