/**
 * When a provider refuses a request, only some answers are worth a second try.
 *
 * A 503 "high demand" (Google's `UNAVAILABLE`), a 429 rate limit or a 5xx is
 * transient or model-specific: retrying the same prompt with another model of
 * the same provider usually works. A 401/403 is a credential problem and a 400
 * is a malformed request — another model does not fix either, and retrying
 * would just double the wait before the same error surfaces.
 *
 * 404 is retryable on purpose: all three providers answer "model not found"
 * that way, and a fallback model is exactly the fix.
 */

export type ProviderAttemptRole = 'primary' | 'fallback';

export type ProviderAttempt = {
	model: string;
	role: ProviderAttemptRole;
};

const RETRYABLE_STATUSES = new Set([404, 408, 409, 425, 429]);

export function isRetryableStatus(status: number): boolean {
	if (RETRYABLE_STATUSES.has(status)) return true;
	return status >= 500 && status <= 599;
}

/**
 * Ordered models to try: the configured one, then the fallback when it is a
 * different name. Repeating the same model after a 503 would only burn time.
 */
export function buildModelAttempts(
	primary: string,
	fallback: string | null | undefined
): ProviderAttempt[] {
	const attempts: ProviderAttempt[] = [{ model: primary.trim(), role: 'primary' }];
	const candidate = fallback?.trim();
	if (candidate && candidate !== primary.trim()) {
		attempts.push({ model: candidate, role: 'fallback' });
	}
	return attempts;
}

/**
 * Final message when every attempt failed.
 *
 * It names the models that were tried, because "Google 503" alone leaves the
 * teacher wondering whether the fallback was even configured.
 */
export function exhaustedMessage(failures: { model: string; message: string }[]): string {
	if (failures.length === 0) return 'No se pudo consultar al modelo';
	const last = failures[failures.length - 1];
	if (failures.length === 1) return last.message;
	const tried = failures.map((failure) => failure.model).join(' → ');
	return `${last.message} (se intentó con ${tried})`;
}
