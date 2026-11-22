<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const dropdownVariants = tv({
		base: "relative inline-flex",
		variants: {
			align: {
				start: "",
				end: "justify-end",
				center: "justify-center"
			}
		}
	});

	export type DropdownAlign = VariantProps<typeof dropdownVariants>["align"];
</script>

<script lang="ts">
	import { cn } from "#lib/utils.js";
	import { createEventDispatcher } from "svelte";

	interface DropdownItem {
		label: string;
		action: () => void;
		disabled?: boolean;
		destructive?: boolean;
		icon?: string; // SVG string
		shortcut?: string;
	}

	let {
		trigger,
		items = [],
		align = "end",
		class: className,
		disabled = false
	}: {
		trigger: any; // Snippet
		items: DropdownItem[];
		align?: DropdownAlign;
		class?: string;
		disabled?: boolean;
	} = $props();

	let isOpen = $state(false);
	const dispatch = createEventDispatcher<{
		open: void;
		close: void;
	}>();

	function toggleOpen() {
		if (disabled) return;
		isOpen = !isOpen;
		if (isOpen) dispatch("open");
		else dispatch("close");
	}

	function handleItemClick(item: DropdownItem) {
		if (item.disabled) return;
		item.action();
		isOpen = false;
	}

	function handleClickOutside(event: MouseEvent) {
		if (!isOpen) return;
		const target = event.target as HTMLElement;
		if (!target.closest(".dropdown-menu")) {
			isOpen = false;
		}
	}

	$effect(() => {
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen) return;
		if (event.key === "Escape") {
			isOpen = false;
		}
	}
</script>

<div class={cn("dropdown-menu", dropdownVariants({ align }), className)} onkeydown={handleKeydown}>
	<div class="inline-flex" onclick={toggleOpen}>
		{@render trigger?.({ open: isOpen, disabled })}
	</div>

	{#if isOpen}
	<div class="absolute z-50 mt-1 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg" role="menu" aria-orientation="vertical">
		{#each items as item}
		<button
			type="button"
			role="menuitem"
			class="w-full flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground transition-colors rounded-sm
				{item.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent hover:text-accent-foreground'}
				{item.destructive ? 'text-destructive hover:bg-destructive/10' : ''}
			"
			disabled={item.disabled}
			onclick={() => handleItemClick(item)}
		>
			{#if item.icon}
			<span class="shrink-0 size-4">{@html item.icon}</span>
			{/if}
			<span class="flex-1 text-left">{item.label}</span>
			{#if item.shortcut}
			<span class="ml-auto text-xs text-muted-foreground">{item.shortcut}</span>
			{/if}
		</button>
		{/each}
	</div>
	{/if}
</div>

<style>
	.dropdown-menu {
		position: relative;
		display: inline-flex;
	}
</style>