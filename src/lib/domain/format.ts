export function formatPoints(value: number): string {
	if (!Number.isFinite(value)) return '0';
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function pluralize(count: number, singular: string, plural: string): string {
	return count === 1 ? singular : plural;
}

/** Rounds to two decimals without float noise. */
export function round2(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}
