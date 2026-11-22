<script lang="ts">
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';

	let { data } = $props();
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Asignaturas</h1>
		<p class="text-sm text-muted-foreground">
			Las materias que tenés asignadas, con sus actividades y entregas.
		</p>
	</div>

	{#if data.rows.length === 0}
		<Card>
			<CardHeader>
				<CardTitle>Sin asignaturas asignadas</CardTitle>
				<CardDescription>
					Cuando un administrador te asigne una materia, va a aparecer acá.
				</CardDescription>
			</CardHeader>
		</Card>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each data.rows as subject (subject.id)}
				<Card class="flex flex-col">
					<CardHeader class="pb-2">
						<CardTitle class="text-base">{subject.name}</CardTitle>
						<CardDescription class="text-xs">
							{subject.code || 'Sin código'}{#if subject.term} · {subject.term}{/if}
						</CardDescription>
					</CardHeader>
					<CardContent class="space-y-2 text-sm">
						<dl class="grid grid-cols-3 gap-2 text-center">
							<div class="rounded-md bg-muted/60 px-2 py-1.5">
								<dt class="text-[11px] uppercase tracking-wide text-muted-foreground">
									Actividades
								</dt>
								<dd class="font-medium tabular-nums">{subject.activityCount}</dd>
							</div>
							<div class="rounded-md bg-muted/60 px-2 py-1.5">
								<dt class="text-[11px] uppercase tracking-wide text-muted-foreground">
									Entregas
								</dt>
								<dd class="font-medium tabular-nums">{subject.submissions}</dd>
							</div>
							<div class="rounded-md bg-muted/60 px-2 py-1.5">
								<dt class="text-[11px] uppercase tracking-wide text-muted-foreground">
									Corregidas
								</dt>
								<dd class="font-medium tabular-nums">{subject.graded}</dd>
							</div>
						</dl>

						{#if subject.recent.length === 0}
							<p class="text-xs text-muted-foreground">Sin actividades todavía.</p>
						{:else}
							<ul class="space-y-0.5 text-xs">
								{#each subject.recent as activity (activity.id)}
									<li>
										<a
											href={`/revisar/${activity.id}`}
											class="block truncate text-muted-foreground transition-colors hover:text-foreground"
										>
											{activity.title}
										</a>
									</li>
								{/each}
							</ul>
							{#if subject.activityCount > subject.recent.length}
								<p class="text-xs text-muted-foreground">
									+{subject.activityCount - subject.recent.length} más en la barra lateral
								</p>
							{/if}
						{/if}
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
