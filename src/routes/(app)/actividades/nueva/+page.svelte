<script lang="ts">
	import ActivityEditor from '#lib/components/app/ActivityEditor.svelte';

	let { data } = $props();
</script>

<ActivityEditor activity={null} subjects={data.subjects} rubrics={data.rubrics} />
