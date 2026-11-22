import { user } from '#lib/server/db/schema/auth.js';
import { testDb } from './db.js';

let counter = 0;

/**
 * Minimal `user` row. Better Auth owns real accounts; repositories only need a
 * valid owner for their foreign keys.
 */
export async function createUser(
	overrides: Partial<typeof user.$inferInsert> = {}
): Promise<typeof user.$inferSelect> {
	const id = overrides.id ?? `test-user-${Date.now()}-${counter++}`;
	const [row] = await testDb
		.insert(user)
		.values({ id, name: 'Docente de prueba', email: `${id}@revisia.test`, ...overrides })
		.returning();
	return row;
}
