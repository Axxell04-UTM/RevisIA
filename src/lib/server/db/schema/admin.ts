import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Provider credentials, encrypted at rest with AES-256-GCM using
 * API_KEY_ENCRYPTION_KEY. `teacherId` null means a global key managed by admin.
 *
 * Binary values are stored as base64 text so they survive both the TCP driver
 * and Neon's HTTP driver unchanged.
 */
export const apiKey = pgTable(
	'api_key',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		teacherId: text('teacher_id').references(() => user.id, { onDelete: 'cascade' }),
		provider: text('provider', { enum: ['openai', 'anthropic', 'google'] }).notNull(),
		label: text('label'),
		ciphertext: text('ciphertext').notNull(),
		iv: text('iv').notNull(),
		authTag: text('auth_tag').notNull(),
		/** Last four characters of the plaintext, the only fragment exposed by the API. */
		lastFour: text('last_four'),
		/**
		 * Model to retry with when the primary one answers a transient failure
		 * (503 high demand, 429, 5xx). Null means "use the provider default".
		 */
		fallbackModel: text('fallback_model'),
		active: boolean('active').notNull().default(true),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('api_key_teacher_provider_idx').on(t.teacherId, t.provider)]
);

export const auditLog = pgTable(
	'audit_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		action: text('action').notNull(),
		entity: text('entity'),
		entityId: text('entity_id'),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('audit_log_user_created_idx').on(t.userId, t.createdAt)]
);
