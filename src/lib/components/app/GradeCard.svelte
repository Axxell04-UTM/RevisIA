<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { formatPoints } from '#lib/domain/format';
	import type { StudentGrade } from '#lib/domain/types';
	import { cn } from '#lib/utils.js';

	let { grade, class: className }: { grade: StudentGrade; class?: string } = $props();

	let copied = $state(false);

	const percent = $derived(
		grade.maxTotal > 0 ? Math.min(100, Math.round((grade.total / grade.maxTotal) * 100)) : 0
	);

	function buildReport(): string {
		const lines: string[] = [
			`${grade.student} — ${formatPoints(grade.total)} / ${formatPoints(grade.maxTotal)}`
		];

		for (const score of grade.scores) {
			lines.push(
				`${score.criterionName}: ${formatPoints(score.points)} / ${formatPoints(score.maxPoints)}`
			);
			if (score.feedback.trim().length > 0) {
				lines.push(`  ${score.feedback.trim()}`);
			}
		}

		if (grade.summary.trim().length > 0) {
			lines.push('', grade.summary.trim());
		}

		return lines.join('\n');
	}

	async function copyReport(): Promise<void> {
		const report = buildReport();

		try {
			await navigator.clipboard.writeText(report);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			copied = false;
		}
	}
</script>

<Card.Root class={cn('gap-5', className)}>
	<Card.Header>
		<Card.Title class="text-base">{grade.student}</Card.Title>
		<Card.Description>
			{formatPoints(grade.total)} de {formatPoints(grade.maxTotal)} puntos
		</Card.Description>
		<Card.Action>
			<Button variant="ghost" size="sm" onclick={copyReport}>
				{copied ? 'Copiado' : 'Copiar'}
			</Button>
		</Card.Action>
	</Card.Header>

	<Card.Content class="gap-4">
		<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
			<div class="h-full rounded-full bg-primary transition-[width]" style="width: {percent}%"></div>
		</div>

		<ul class="flex flex-col divide-y divide-border">
			{#each grade.scores as score (score.criterionId)}
				<li class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
					<div class="flex items-start justify-between gap-4">
						<span class="text-sm leading-snug">{score.criterionName}</span>
						<span class="shrink-0 font-mono text-xs text-muted-foreground">
							{formatPoints(score.points)} / {formatPoints(score.maxPoints)}
						</span>
					</div>
					{#if score.feedback.trim().length > 0}
						<p class="text-xs leading-relaxed text-muted-foreground">{score.feedback}</p>
					{/if}
				</li>
			{/each}
		</ul>

		{#if grade.summary.trim().length > 0}
			<p class="border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
				{grade.summary}
			</p>
		{/if}
	</Card.Content>
</Card.Root>
