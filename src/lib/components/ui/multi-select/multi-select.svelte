<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const multiSelectVariants = tv({
		base: "relative flex flex-col gap-1.5",
		variants: {
			size: {
				default: "",
				sm: "",
				lg: ""
			}
		}
	});

	export type MultiSelectVariant = VariantProps<typeof multiSelectVariants>["size"];

	export interface MultiSelectProps {
		options?: { value: string; label: string }[];
		value?: string[];
		onChange?: (value: string[]) => void;
		placeholder?: string;
		disabled?: boolean;
		class?: string;
		size?: MultiSelectVariant;
		name?: string;
	}
</script>

<script lang="ts" generics="Props extends MultiSelectProps">
	import { cn } from "#lib/utils.js";
	import { createEventDispatcher } from "svelte";

	interface Option {
		value: string;
		label: string;
	}

	let {
		options = [],
		value = [],
		onChange,
		placeholder = "Seleccionar...",
		disabled = false,
		class: className,
		size = "default",
		name
	}: MultiSelectProps = $props();

	let isOpen = $state(false);
	let searchQuery = $state("");

	const dispatch = createEventDispatcher<{
		change: string[];
		open: void;
		close: void;
	}>();

	const selectedOptions = $derived(options.filter((o) => value.includes(o.value)));
	const filteredOptions = $derived(
		options.filter(
			(o) =>
				!value.includes(o.value) &&
				o.label.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	function toggleOpen() {
		if (disabled) return;
		isOpen = !isOpen;
		if (isOpen) dispatch("open");
		else dispatch("close");
	}

	function selectOption(opt: Option) {
		if (disabled) return;
		const newValue = [...value, opt.value];
		onChange?.(newValue);
		dispatch("change", newValue);
		searchQuery = "";
	}

	function removeOption(val: string) {
		if (disabled) return;
		const newValue = value.filter((v) => v !== val);
		onChange?.(newValue);
		dispatch("change", newValue);
	}

	function handleClickOutside(event: MouseEvent) {
		if (!isOpen) return;
		const target = event.target as HTMLElement;
		if (!target.closest(".multi-select")) {
			isOpen = false;
			dispatch("close");
		}
	}

	// Global click handler
	$effect(() => {
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	});

	const baseClasses = $derived(cn(multiSelectVariants({ size }), className));
	const triggerClasses = $derived(cn(
		"flex flex-wrap gap-1.5 min-h-[38px] px-3 py-2 bg-background border border-input rounded-md text-sm placeholder:text-muted-foreground focus-within:ring-2 focus-within:ring-ring/50 transition-all",
		isOpen && "ring-2 ring-ring/50"
	));
</script>

<div class={baseClasses}>
	<div
		class={triggerClasses}
		role="combobox"
		aria-expanded={isOpen}
		aria-haspopup="listbox"
		aria-disabled={disabled}
		onclick={toggleOpen}
	>
		{#each selectedOptions as opt}
		<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
			{opt.label}
			<button
				type="button"
				class="text-primary hover:text-primary/80"
				onclick={(e: MouseEvent) => { e.stopPropagation(); removeOption(opt.value); }}
				aria-label={`Quitar ${opt.label}`}
			>
				<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
			<input type="hidden" name={name} value={opt.value} />
		</span>
		{/each}

		{#if isOpen}
		<input
			type="text"
			class="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm"
			placeholder={value.length === 0 && !isOpen ? placeholder : "Buscar..."}
			bind:value={searchQuery}
			onclick={(e: MouseEvent) => e.stopPropagation()}
			onkeydown={(e: KeyboardEvent) => {
				if (e.key === "Enter") {
					e.preventDefault();
					const match = filteredOptions[0];
					if (match) {
						selectOption(match);
					}
				}
				if (e.key === "Escape") {
					isOpen = false;
				}
			}}
			disabled={disabled}
		/>
		{:else if (value.length === 0)}
		<span class="text-muted-foreground text-sm">{placeholder}</span>
		{/if}

		<svg class="size-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="m6 9 6 6 6-6" />
		</svg>
	</div>

	{#if isOpen}
	<div class="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
		{#if filteredOptions.length === 0}
		<div class="px-3 py-2 text-sm text-muted-foreground">No hay opciones disponibles</div>
		{:else}
		{#each filteredOptions as opt}
		<button
			type="button"
			class="w-full flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent rounded transition-colors"
			onclick={(e: MouseEvent) => { e.stopPropagation(); selectOption(opt); }}
		>
			{opt.label}
		</button>
		{/each}
		{/if}
	</div>
	{/if}
</div>