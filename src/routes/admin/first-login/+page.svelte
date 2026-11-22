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
	import Input from '#lib/components/app/Input.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import { getToastContext } from '#lib/components/ui/toast/toast-context.svelte.ts';

	let { data } = $props();
	const toast = getToastContext();
	let isSubmitting = $state(false);

	async function handleChangePassword(event: Event) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget as HTMLFormElement);
		const currentPassword = formData.get('currentPassword') as string;
		const newPassword = formData.get('newPassword') as string;
		const confirmPassword = formData.get('confirmPassword') as string;

		if (!currentPassword || !newPassword || !confirmPassword) {
			toast.toast({ title: 'Error', description: 'Todos los campos son requeridos', variant: 'destructive' });
			return;
		}
		if (newPassword !== confirmPassword) {
			toast.toast({ title: 'Error', description: 'Las contraseñas no coinciden', variant: 'destructive' });
			return;
		}
		if (newPassword.length < 8) {
			toast.toast({ title: 'Error', description: 'La contraseña debe tener al menos 8 caracteres', variant: 'destructive' });
			return;
		}

		isSubmitting = true;
		try {
			const params = new URLSearchParams();
			params.append('currentPassword', currentPassword);
			params.append('newPassword', newPassword);
			params.append('confirmPassword', confirmPassword);

			const res = await fetch('/admin/first-login?/changePassword', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: params
			});

			const result = deserialize(await res.text());

			if (result.type === 'success' && result.data && typeof result.data === 'object' && 'success' in result.data && (result.data as any).success) {
				toast.toast({ title: 'Éxito', description: 'Contraseña actualizada correctamente', variant: 'success' });
				await invalidateAll();
				window.location.href = '/admin';
			} else if (result.type === 'failure' && result.data && typeof result.data === 'object' && 'error' in result.data) {
				const data = result.data as { error: string };
				toast.toast({ title: 'Error', description: data.error || 'Error al cambiar la contraseña', variant: 'destructive' });
			} else {
				toast.toast({ title: 'Error', description: 'Error al cambiar la contraseña', variant: 'destructive' });
			}
		} catch (e) {
			toast.toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
		} finally {
			isSubmitting = false;
		}
	}
</script>

<ToastProvider>
	<div class="flex min-h-screen items-center justify-center bg-muted/30 px-4">
		<Card class="w-full max-w-md">
			<CardHeader class="text-center">
				<CardTitle class="text-2xl">Cambio de contraseña obligatorio</CardTitle>
				<CardDescription>Tu administrador ha requerido que cambies tu contraseña antes de continuar.</CardDescription>
			</CardHeader>
			<CardContent>
				<form onsubmit={handleChangePassword} class="space-y-4">
					<Field label="Contraseña actual">
						<Input type="password" name="currentPassword" required autocomplete="current-password" />
					</Field>
					<Field label="Nueva contraseña">
						<Input type="password" name="newPassword" required minlength={8} autocomplete="new-password" />
					</Field>
					<Field label="Confirmar nueva contraseña">
						<Input type="password" name="confirmPassword" required autocomplete="new-password" />
					</Field>
					<Button type="submit" class="w-full" disabled={isSubmitting}>
						{isSubmitting ? 'Actualizando...' : 'Actualizar contraseña'}
					</Button>
				</form>
			</CardContent>
		</Card>
	</div>
</ToastProvider>