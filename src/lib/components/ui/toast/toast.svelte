<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const toastVariants = tv({
		base: "pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:smoke-in",
		variants: {
			variant: {
				default: "border-border bg-background text-foreground",
				success: "border-green-500/30 bg-green-500/10 text-green-900 dark:text-green-100",
				warning: "border-yellow-500/30 bg-yellow-500/10 text-yellow-900 dark:text-yellow-100",
				destructive: "border-destructive/30 bg-destructive/10 text-destructive dark:text-destructive/90"
			}
		},
		defaultVariants: {
			variant: "default"
		}
	});

	export type ToastVariant = VariantProps<typeof toastVariants>["variant"];
</script>

<script lang="ts">
	import { cn } from "#lib/utils.js";

	interface ToastProps {
		open: boolean;
		title?: string;
		description?: string;
		variant?: ToastVariant;
		action?: {
			label: string;
			onClick: () => void;
		};
		onClose: () => void;
		class?: string;
		duration?: number;
	}

	let { open, title, description, variant = "default", action, onClose, class: className, duration = 5000 }: ToastProps = $props();

	$effect(() => {
		if (!open) return;
		const timer = setTimeout(() => {
			onClose();
		}, duration);
		return () => clearTimeout(timer);
	});
</script>

{#if open}
<div
	data-state={open ? "open" : "closed"}
	class={cn(toastVariants({ variant }), "group", className)}
	onclick={(e) => e.stopPropagation()}
>
	<div class="grid gap-1">
		{#if title}
		<div data-slot="toast-title" class="font-medium leading-none">{title}</div>
		{/if}
		{#if description}
		<div data-slot="toast-description" class="text-sm opacity-90">{description}</div>
		{/if}
	</div>

	{#if action}
	<div class="ml-auto flex-shrink-0">
		<button
			type="button"
			class="text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3 text-muted-foreground transition-colors"
			onclick={action.onClick}
		>
			{action.label}
		</button>
	</div>
	{/if}

	<button
		type="button"
		class="absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 group-hover:opacity-100"
		onclick={onClose}
		aria-label="Closing"
	>
		<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M18 6 6 18M6 6l12 12" />
		</svg>
	</button>
</div>
{/if}