<script lang="ts">
	import ActivityEditor from '#lib/components/app/ActivityEditor.svelte';

	let { data } = $props();
</script>

<ActivityEditor
	activity={data.activity}
	subjects={data.subjects}
	rubrics={data.rubrics}
	sourceDocument={data.sourceDocument}
/>
