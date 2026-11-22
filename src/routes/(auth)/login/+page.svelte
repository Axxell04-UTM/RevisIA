<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/ui/button/button.svelte';
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import Input from '#lib/components/app/Input.svelte';
	import ThemeToggle from '#lib/components/ui/theme-toggle';

	let { data, form } = $props();
</script>

<div class="relative flex min-h-screen items-center justify-center bg-muted/30 px-4">
	<div class="absolute right-4 top-4">
		<ThemeToggle />
	</div>
	<Card class="w-full max-w-md">
		<CardHeader class="text-center">
			<CardTitle class="text-2xl">Iniciar sesión</CardTitle>
			<CardDescription>Ingresá tu email y contraseña</CardDescription>
		</CardHeader>
		<CardContent>
			<form method="POST" use:enhance class="space-y-4">
				{#if form?.error}
					<div class="text-sm text-destructive text-center">{form.error}</div>
				{/if}
				<Field label="Email">
					<Input type="email" name="email" required />
				</Field>
				<Field label="Contraseña">
					<Input type="password" name="password" required />
				</Field>
				<Button type="submit" class="w-full">Entrar</Button>
			</form>
		</CardContent>
	</Card>
</div>