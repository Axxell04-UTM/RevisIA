<script lang="ts">
	import { enhance } from '$app/forms';
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

	let showResetPasswordDialog = $state(false);
	let isResetting = $state(false);
	let tempPassword = $state('');

	const { teacher, subjects } = data;

	function handleUpdate() {
		// Form is submitted via enhance
	}

	async function handleResetPassword() {
		isResetting = true;
		try {
			const res = await fetch(`/admin/teachers/${teacher.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ resetPassword: 'true' })
			});
			const data = await res.json();
			if (data.success) {
				tempPassword = data.tempPassword;
				showResetPasswordDialog = true;
			} else {
				toast.toast({ title: 'Error', description: 'No se pudo resetear la contraseña', variant: 'destructive' });
			}
		} catch (e) {
			toast.toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
		} finally {
			isResetting = false;
		}
	}
</script>

<ToastProvider>
<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Editar docente</h1>
			<p class="text-muted-foreground">{teacher.email}</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="ghost" size="icon" onclick={() => history.back()} aria-label="Volver">
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M19 12H5M12 19l-7-7 7-7" />
				</svg>
			</Button>
			<Button variant="destructive" onclick={handleResetPassword} disabled={isResetting}>
				<svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="2" y="4" width="20" height="16" rx="2" />
					<path d="M8 12h12" />
					<path d="M12 8v12" />
				</svg>
				{isResetting ? 'Reseteando...' : 'Resetear contraseña'}
			</Button>
		</div>
	</div>

	<!-- Teacher Form -->
	<Card>
		<CardHeader>
			<CardTitle>Datos del docente</CardTitle>
			<CardDescription>Edita la información del docente</CardDescription>
		</CardHeader>
		<CardContent>
			<form method="POST" use:enhance class="space-y-6">
				<Field label="Email">
					<Input type="email" value={teacher.email} disabled />
					<p class="text-xs text-muted-foreground mt-1">El email no se puede cambiar</p>
				</Field>

				<Field label="Nombre">
					<Input name="name" value={teacher.name} required />
				</Field>

				<Field label="Estado">
					<ToggleSwitch
						checked={teacher.active}
						onChange={(active) => teacher.active = active}
						aria-label={teacher.active ? 'Desactivar docente' : 'Activar docente'}
					/>
					<p class="text-xs text-muted-foreground mt-1">
						{teacher.active ? 'El docente puede acceder al sistema' : 'El docente no puede acceder al sistema'}
					</p>
				</Field>

				<Field label="Asignaturas">
					<MultiSelect
						options={teacher.subjects.map(s => ({ value: s.id, label: `${s.code} - ${s.name}` }))}
						value={teacher.subjects.map(s => s.id)}
						onChange={(v) => teacher.subjects = v.map(id => teacher.subjects.find(s => s.id === id)).filter(Boolean as any)}
						placeholder="Seleccionar asignaturas..."
					/>
				</Field>

				<Button type="submit" class="w-full sm:w-auto">Guardar cambios</Button>
			</form>
		</CardContent>
	</Card>

	<!-- Reset Password Dialog -->
	{#if showResetPasswordDialog}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={() => showResetPasswordDialog = false}>
		<Card class="w-full max-w-md" onclick={(e) => e.stopPropagation()}>
			<CardHeader>
				<CardTitle class="text-success">Contraseña reseteada</CardTitle>
				<CardDescription>La nueva contraseña temporal se muestra a continuación. Cópiala y entréguela al docente.</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex items-center gap-2">
					<Input
						type="password"
						value={tempPassword}
						readonly
						class="flex-1 font-mono"
					/>
					<Button variant="outline" size="sm" onclick={() => navigator.clipboard.writeText(tempPassword)}>
						Copiar
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">Se mostrará solo una vez. Cópiela y entréguela al docente.</p>
			</CardContent>
			<CardFooter class="flex justify-end">
				<Button onclick={() => showResetPasswordDialog = false}>Entendido</Button>
			</CardFooter>
		</Card>
	</div>
	{/if}
</div>
</ToastProvider>