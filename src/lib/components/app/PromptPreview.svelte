<script lang="ts">
	let { prompt }: { prompt: string } = $props();
</script>

<details class="group rounded-md border border-border bg-muted/40">
	<summary
		class="cursor-pointer list-none px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground select-none hover:text-foreground"
	>
		Vista previa del prompt
	</summary>
	<pre
		class="max-h-96 overflow-auto border-t border-border px-4 py-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{prompt}</pre>
</details>
