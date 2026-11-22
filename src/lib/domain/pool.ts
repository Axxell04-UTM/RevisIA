/**
 * Runs `worker` over `items` with at most `limit` calls in flight.
 *
 * Start order follows the list; completion order does not. A rejected call is
 * collected with its item and never stops the remaining items, which is what
 * lets a batch report one bad file without losing the rest.
 *
 * The worker owns progress and state updates; this helper only schedules.
 */
export async function runConcurrently<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<void>
): Promise<Array<{ item: T; error: unknown }>> {
	const failures: Array<{ item: T; error: unknown }> = [];
	if (items.length === 0) return failures;

	const concurrency = Math.max(1, Math.min(limit, items.length));
	let cursor = 0;

	async function runner(): Promise<void> {
		for (;;) {
			const index = cursor++;
			if (index >= items.length) return;
			const item = items[index];
			try {
				await worker(item);
			} catch (error) {
				failures.push({ item, error });
			}
		}
	}

	await Promise.all(Array.from({ length: concurrency }, () => runner()));
	return failures;
}
