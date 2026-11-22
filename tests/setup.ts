/**
 * Environment for every test file. Runs before the test module graph is
 * imported, so modules that read `process.env` at import time (r2.ts) or on
 * first use (crypto.ts, auth/index.ts) see the test values.
 *
 * Values are fake on purpose: presigning is local, so no network call happens,
 * and nothing here may ever point at a real bucket or database.
 */

// 32 ASCII bytes -> a valid AES-256 key for crypto.ts.
const TEST_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

process.env.BETTER_AUTH_SECRET ??= 'revisia-test-secret-not-for-production';
process.env.BETTER_AUTH_URL ??= 'http://localhost:5173';
process.env.API_KEY_ENCRYPTION_KEY ??= TEST_ENCRYPTION_KEY;
process.env.R2_ACCOUNT_ID ??= 'test-account-id';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key-id';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-access-key';
process.env.R2_BUCKET ??= 'revisia-test';
// Override Filebase vars so tests use the fake R2-compatible endpoint
process.env.FILEBASE_ENDPOINT = 'https://test-account-id.r2.cloudflarestorage.com';
process.env.FILEBASE_BUCKET = 'revisia-test';
process.env.FILEBASE_ACCESS_KEY_ID = 'test-access-key-id';
process.env.FILEBASE_SECRET_ACCESS_KEY = 'test-secret-access-key';

// Mock SvelteKit's $env/dynamic/private for Vitest
vi.mock('$env/dynamic/private', () => ({
	env: {
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
		API_KEY_ENCRYPTION_KEY: process.env.API_KEY_ENCRYPTION_KEY,
		FILEBASE_ENDPOINT: process.env.FILEBASE_ENDPOINT,
		FILEBASE_BUCKET: process.env.FILEBASE_BUCKET,
		FILEBASE_ACCESS_KEY_ID: process.env.FILEBASE_ACCESS_KEY_ID,
		FILEBASE_SECRET_ACCESS_KEY: process.env.FILEBASE_SECRET_ACCESS_KEY,
		R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
		R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
		R2_BUCKET: process.env.R2_BUCKET,
		NODE_ENV: 'test',
		DATABASE_URL: 'postgresql://test:test@localhost:5432/test'
	}
}));
