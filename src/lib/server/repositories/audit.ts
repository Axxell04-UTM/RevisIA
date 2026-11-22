import { getDb } from '#lib/server/db/index.js';
import { auditLog } from '#lib/server/db/schema/admin.js';

export interface AuditLogEntry {
	action: string;
	entity: string;
	entityId: string;
	metadata?: Record<string, unknown>;
	userId: string;
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
	const db = getDb();
	await db.insert(auditLog).values({
		id: crypto.randomUUID(),
		userId: entry.userId,
		action: entry.action,
		entity: entry.entity,
		entityId: entry.entityId,
		metadata: entry.metadata ?? null,
		createdAt: new Date()
	});
}