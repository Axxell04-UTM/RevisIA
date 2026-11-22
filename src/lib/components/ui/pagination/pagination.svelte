<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const paginationVariants = tv({
		base: "flex items-center gap-1",
		variants: {
			size: {
				default: "",
				sm: "gap-0.5",
				lg: "gap-2"
			}
		}
	});

	export type PaginationSize = VariantProps<typeof paginationVariants>["size"];
</script>

<script lang="ts">
	import { cn } from "#lib/utils.js";

	let {
		currentPage = 1,
		totalPages = 1,
		onPageChange,
		class: className,
		size = "default",
		showFirstLast = true,
		showPrevNext = true,
		maxVisiblePages = 5
	}: {
		currentPage: number;
		totalPages: number;
		onPageChange: (page: number) => void;
		class?: string;
		size?: PaginationSize;
		showFirstLast?: boolean;
		showPrevNext?: boolean;
		maxVisiblePages?: number;
	} = $props();

	const visiblePages = $derived.by(() => {
		if (totalPages <= maxVisiblePages) {
			return Array.from({ length: totalPages }, (_, i) => i + 1);
		}

		const half = Math.floor(maxVisiblePages / 2);
		let start = Math.max(1, currentPage - half);
		let end = Math.min(totalPages, start + maxVisiblePages - 1);

		if (end - start + 1 < maxVisiblePages) {
			start = Math.max(1, end - maxVisiblePages + 1);
		}

		return Array.from({ length: end - start + 1 }, (_, i) => start + i);
	});

	function handlePageChange(page: number) {
		if (page < 1 || page > totalPages) return;
		onPageChange(page);
	}
</script>

<nav class={cn(paginationVariants({ size }), className)} aria-label="Paginación">
	{#if showFirstLast}
	<button
		type="button"
		class="p-1.5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		onclick={() => handlePageChange(1)}
		disabled={currentPage === 1}
		aria-label="Primera página"
		title="Primera página"
	>
		<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
		</svg>
	</button>
	{/if}

	{#if showPrevNext}
	<button
		type="button"
		class="p-1.5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		onclick={() => handlePageChange(currentPage - 1)}
		disabled={currentPage === 1}
		aria-label="Página anterior"
		title="Página anterior"
	>
		<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M15 18l-6-6 6-6" />
		</svg>
	</button>
	{/if}

	<div class="flex items-center gap-0.5">
		{#each visiblePages as page}
		<button
			type="button"
			class={`
				min-w-[36px] h-8 rounded-md border text-sm font-medium transition-colors
				${page === currentPage
					? 'bg-primary text-primary-foreground border-primary'
					: 'bg-background border-input hover:bg-accent hover:text-accent-foreground'
				}
				disabled:opacity-50 disabled:cursor-not-allowed
			`}
			onclick={() => handlePageChange(page)}
			disabled={page === currentPage}
			aria-current={page === currentPage ? "page" : undefined}
			aria-label={`Página ${page}`}
		>
			{page}
		</button>
		{/each}
	</div>

	{#if showPrevNext}
	<button
		type="button"
		class="p-1.5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		onclick={() => handlePageChange(currentPage + 1)}
		disabled={currentPage === totalPages}
		aria-label="Página siguiente"
		title="Página siguiente"
	>
		<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M9 18l6-6-6-6" />
		</svg>
	</button>
	{/if}

	{#if showFirstLast}
	<button
		type="button"
		class="p-1.5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		onclick={() => handlePageChange(totalPages)}
		disabled={currentPage === totalPages}
		aria-label="Última página"
		title="Última página"
	>
		<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
		</svg>
	</button>
	{/if}
</nav>