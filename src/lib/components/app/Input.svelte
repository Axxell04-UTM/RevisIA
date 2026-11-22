<script lang="ts">
	import { inputClass } from './input.js';

	let {
		type = 'text',
		class: className = '',
		required,
		...rest
	}: { type?: string; class?: string; required?: boolean } & Record<string, any> = $props();
</script>

<input
	class={inputClass + ' ' + className}
	type={type}
	required={required}
	{...rest}
/>