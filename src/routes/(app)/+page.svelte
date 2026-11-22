<script lang="ts">
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';
	import CardFooter from '#lib/components/ui/card/card-footer.svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import { Plus } from '@lucide/svelte';
	import type { ActivityStatus } from '#lib/domain/types.js';
	import {
		ACTIVITY_STATUS_LABEL,
		formatDueDate,
		groupActivitiesBySubject
	} from '#lib/domain/activity-groups.js';

	let { data } = $props();

	let groups = $derived(groupActivitiesBySubject(data.activities, data.subjects));

	const STATUS_CLASS: Record<ActivityStatus, string> = {
		draft: 'bg-muted text-muted-foreground',
		open: 'bg-success/15 text-success',
		closed: 'bg-secondary text-secondary-foreground'
	};

	function countsFor(id: string) {
		return data.counts[id] ?? { total: 0, graded: 0 };
	}
</script>

<div class="space-y-8">
	<div class="flex items-baseline justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Actividades</h1>
			<p class="text-sm text-muted-foreground">
				Tus actividades de revisión, agrupadas por asignatura.
			</p>
		</div>
		<div class="flex items-center gap-3">
			<span class="text-sm tabular-nums text-muted-foreground">
				{data.activities.length} en total
			</span>
			<Button size="sm" href="/actividades/nueva">
				<Plus class="size-4" />
				Nueva actividad
			</Button>
		</div>
	</div>

	{#if groups.length === 0}
		<Card>
			<CardHeader>
				<CardTitle>Todavía no hay actividades</CardTitle>
				<CardDescription>
					Creá tu primera actividad de revisión: va a aparecer acá y en la barra lateral.
				</CardDescription>
			</CardHeader>
			<CardFooter>
				<Button href="/actividades/nueva">
					<Plus class="size-4" />
					Nueva actividad
				</Button>
			</CardFooter>
		</Card>
	{:else}
		{#each groups as group (group.key)}
			<section class="space-y-3">
				<div class="flex items-baseline gap-2 border-b border-border/60 pb-2">
					<h2 class="text-base font-medium tracking-tight">{group.name}</h2>
					{#if group.code}
						<span class="text-xs text-muted-foreground">{group.code}</span>
					{/if}
					<span class="ml-auto text-xs tabular-nums text-muted-foreground">
						{group.activities.length}
					</span>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					{#each group.activities as activity (activity.id)}
						{@const counts = countsFor(activity.id)}
						{@const due = formatDueDate(activity.dueAt)}
						<Card class="flex flex-col">
							<CardHeader class="pb-2">
								<div class="flex items-start justify-between gap-2">
									<CardTitle class="text-base leading-snug">{activity.title}</CardTitle>
									<span
										class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium {STATUS_CLASS[
											activity.status
										]}"
									>
										{ACTIVITY_STATUS_LABEL[activity.status]}
									</span>
								</div>
								<CardDescription class="text-xs">
									{#if due}Entrega {due}{:else}Sin fecha de entrega{/if}
									{#if activity.maxPoints !== null}
										· {activity.maxPoints} pts
									{/if}
								</CardDescription>
							</CardHeader>
							<CardContent class="pb-2 text-xs text-muted-foreground">
								{counts.total} {counts.total === 1 ? 'entrega' : 'entregas'} ·
								{counts.graded}
								{counts.graded === 1 ? 'corregida' : 'corregidas'}
							</CardContent>
							<CardFooter class="mt-auto gap-2">
								<Button size="sm" href={`/revisar/${activity.id}`}>Abrir revisión</Button>
								<Button size="sm" variant="outline" href={`/actividades/${activity.id}`}>
									Editar
								</Button>
							</CardFooter>
						</Card>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>
