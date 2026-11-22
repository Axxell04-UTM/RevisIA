export type Toast = {
	id: string;
	title?: string;
	description?: string;
	variant?: 'default' | 'success' | 'warning' | 'destructive';
	action?: {
		label: string;
		onClick: () => void;
	};
	duration?: number;
	open: boolean;
};

/**
 * Toast state is a module-level store, not a Svelte context.
 *
 * Pages call `getToastContext()` in their own `<script>` while rendering
 * `<ToastProvider>` as a *child*, so `getContext()` could never reach the
 * provider's context. A shared store keeps the existing call sites working.
 */
let toasts = $state<Toast[]>([]);

function addToast(input: Omit<Toast, 'id' | 'open'>) {
	const id = crypto.randomUUID();
	toasts.push({ ...input, id, open: true });
	return id;
}

function removeToast(id: string) {
	const index = toasts.findIndex((t) => t.id === id);
	if (index === -1) return;
	toasts[index].open = false;
	setTimeout(() => {
		toasts = toasts.filter((t) => t.id !== id);
	}, 300);
}

export type ToastContext = {
	readonly toasts: Toast[];
	toast: typeof addToast;
	dismiss: typeof removeToast;
};

const context: ToastContext = {
	get toasts() {
		return toasts;
	},
	toast: addToast,
	dismiss: removeToast
};

export function getToastContext(): ToastContext {
	return context;
}

/** Kept for compatibility: the provider no longer owns the state. */
export function setToastContext(): ToastContext {
	return context;
}
