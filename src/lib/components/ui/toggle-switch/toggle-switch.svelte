<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const toggleVariants = tv({
		base: "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
		variants: {
			variant: {
				default: "bg-muted data-[state=checked]:bg-primary",
				success: "bg-muted data-[state=checked]:bg-green-500",
				warning: "bg-muted data-[state=checked]:bg-yellow-500",
				destructive: "bg-muted data-[state=checked]:bg-destructive"
			},
			size: {
				default: "",
				sm: "h-5 w-9",
				lg: "h-7 w-13"
			}
		},
		defaultVariants: {
			variant: "default",
			size: "default"
		}
	});

	export type ToggleVariant = VariantProps<typeof toggleVariants>["variant"];
	export type ToggleSize = VariantProps<typeof toggleVariants>["size"];
</script>

<script lang="ts">
	import { cn } from "#lib/utils.js";

	let {
		checked = false,
		onChange,
		disabled = false,
		class: className,
		variant = "default",
		size = "default",
		id,
		name,
		required = false,
		"aria-label": ariaLabel,
		"aria-labelledby": ariaLabelledby
	}: {
		checked?: boolean;
		onChange?: (checked: boolean) => void;
		disabled?: boolean;
		class?: string;
		variant?: ToggleVariant;
		size?: ToggleSize;
		id?: string;
		name?: string;
		required?: boolean;
		"aria-label"?: string;
		"aria-labelledby"?: string;
	} = $props();

	function handleClick() {
		if (disabled) return;
		const newChecked = !checked;
		onChange?.(newChecked);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			handleClick();
		}
	}
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-disabled={disabled}
	aria-label={ariaLabel}
	aria-labelledby={ariaLabelledby}
	data-state={checked ? "checked" : "unchecked"}
	data-disabled={disabled}
	class={cn(toggleVariants({ variant, size }), className)}
	onclick={handleClick}
	onkeydown={handleKeydown}
	{disabled}
	{id}
	{name}
>
	<span
		class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-ring transition-transform"
		data-state={checked ? "checked" : "unchecked"}
		style="transform: translateX({checked ? 'calc(100% + 2px)' : '0'})"
	>
		<span class="sr-only">{checked ? "Activado" : "Desactivado"}</span>
	</span>
</button>

<style>
	/* Fallback for browsers that don't support :has() */
	button[data-state="checked"] > span {
		transform: translateX(calc(100% + 2px));
	}
	button[data-state="unchecked"] > span {
		transform: translateX(0);
	}
</style>