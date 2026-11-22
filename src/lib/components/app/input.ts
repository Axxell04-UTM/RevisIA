export const inputClass =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export const textareaClass =
	'min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export const labelClass =
	'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';

export { default as Input } from './Input.svelte';
export { default as Field } from './Field.svelte';