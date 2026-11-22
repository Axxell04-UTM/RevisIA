import { describe, expect, it, beforeEach, vi } from 'vitest';
import { testDb, resetDb } from '../helpers/db.js';
import { auditLog } from '#lib/server/db/schema/admin.js';
import { user } from '#lib/server/db/schema/auth.js';
import { eq } from 'drizzle-orm';
import { logAudit } from '#lib/server/repositories/audit.js';
import { randomUUID } from 'node:crypto';

vi.mock('#lib/server/db/index.js', () => ({
	getDb: () => testDb
}));

const TEST_ADMIN = randomUUID();

describe('audit repository', () => {
	beforeEach(async () => {
		await resetDb();
		// Create a test user for FK constraint
		await testDb.insert(user).values({
			id: TEST_ADMIN,
			email: 'admin@test.com',
			name: 'Test Admin',
			role: 'admin',
			active: true,
			mustChangePassword: false,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	});

	describe('logAudit', () => {
		it('inserts audit log entry with all fields', async () => {
			await logAudit({
				action: 'teacher.create',
				entity: 'user',
				entityId: 'teacher-123',
				metadata: { email: 'test@test.com', name: 'Test Teacher' },
				userId: TEST_ADMIN
			});
			
			const logs = await testDb.select().from(auditLog).where(eq(auditLog.entityId, 'teacher-123'));
			expect(logs).toHaveLength(1);
			expect(logs[0].action).toBe('teacher.create');
			expect(logs[0].entity).toBe('user');
			expect(logs[0].entityId).toBe('teacher-123');
			expect(logs[0].userId).toBe(TEST_ADMIN);
			expect(logs[0].metadata).toEqual({ email: 'test@test.com', name: 'Test Teacher' });
			expect(logs[0].createdAt).toBeInstanceOf(Date);
		});

		it('inserts audit log entry without metadata', async () => {
			await logAudit({
				action: 'teacher.delete',
				entity: 'user',
				entityId: 'teacher-456',
				userId: TEST_ADMIN
			});
			
			const logs = await testDb.select().from(auditLog).where(eq(auditLog.entityId, 'teacher-456'));
			expect(logs).toHaveLength(1);
			expect(logs[0].metadata).toBeNull();
		});

		it('generates unique id', async () => {
			await logAudit({ action: 'a', entity: 'b', entityId: '1', userId: TEST_ADMIN });
			await logAudit({ action: 'c', entity: 'd', entityId: '2', userId: TEST_ADMIN });
			
			const logs = await testDb.select().from(auditLog).orderBy(auditLog.createdAt);
			expect(logs).toHaveLength(2);
			expect(logs[0].id).not.toBe(logs[1].id);
		});
	});
});