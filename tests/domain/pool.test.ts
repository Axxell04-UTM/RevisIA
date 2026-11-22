import { describe, expect, it } from 'vitest';
import { runConcurrently } from '#lib/domain/pool.js';

describe('runConcurrently', () => {
	it('runs every item exactly once', async () => {
		const seen: number[] = [];

		const failures = await runConcurrently([1, 2, 3, 4, 5], 3, async (item) => {
			seen.push(item);
		});

		expect(failures).toEqual([]);
		expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
	});

	it('never keeps more than the limit in flight', async () => {
		let inFlight = 0;
		let peak = 0;

		await runConcurrently(
			Array.from({ length: 10 }, (_, index) => index),
			3,
			async () => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight--;
			}
		);

		expect(peak).toBe(3);
	});

	it('reports a failed item and keeps processing the rest', async () => {
		const seen: number[] = [];

		const failures = await runConcurrently([1, 2, 3, 4], 2, async (item) => {
			seen.push(item);
			if (item === 2) throw new Error('boom');
		});

		expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
		expect(failures).toHaveLength(1);
		expect(failures[0].item).toBe(2);
		expect((failures[0].error as Error).message).toBe('boom');
	});

	it('does nothing with an empty list', async () => {
		const failures = await runConcurrently([], 3, async () => {});

		expect(failures).toEqual([]);
	});
});
