import { hashPassword } from 'better-auth/crypto';
import { db } from '#lib/server/db/index.js';
import { account, user } from '#lib/server/db/schema/auth.js';
import { subject, subjectTeachers } from '#lib/server/db/schema/academic.js';
import { eq } from 'drizzle-orm';

/**
 * Seed: admin from env, starter subject + teacher.
 * Idempotent — safe to run on every deploy.
 */
async function seed() {
	const adminEmail = process.env.SEED_ADMIN_EMAIL;
	const adminName = process.env.SEED_ADMIN_NAME ?? 'Administrador';
	const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234';

	if (!adminEmail) {
		console.log('SEED_ADMIN_EMAIL no definido — seed omitido');
		return;
	}

	const existing = await db.query.user.findFirst({ where: eq(user.email, adminEmail) });
	if (existing) {
		console.log('Admin ya existe:', adminEmail);
	} else {
		const hash = await hashPassword(adminPassword);
		const userId = crypto.randomUUID();
		await db.insert(user).values({
			id: userId,
			name: adminName,
			email: adminEmail,
			emailVerified: true,
			role: 'admin',
			active: true
		});
		await db.insert(account).values({
			id: crypto.randomUUID(),
			accountId: userId,
			providerId: 'credential',
			userId,
			password: hash
		});
		console.log('Admin creado:', adminEmail);
	}

	const subjectName = process.env.SEED_SUBJECT_NAME ?? 'Tecnologías Avanzadas Empresariales';
	const [subj] = await db
		.insert(subject)
		.values({
			name: subjectName,
			code: process.env.SEED_SUBJECT_CODE,
			term: process.env.SEED_TERM
		})
		.onConflictDoNothing()
		.returning();
	const subjectId =
		subj?.id ??
		(await db.query.subject.findFirst({ where: eq(subject.name, subjectName) }))!.id;

	const teacherEmail = process.env.SEED_TEACHER_EMAIL;
	if (teacherEmail) {
		const [teacher] = await db
			.insert(user)
			.values({
				id: crypto.randomUUID(),
				name: process.env.SEED_TEACHER_NAME ?? 'Docente',
				email: teacherEmail,
				emailVerified: true,
				role: 'teacher',
				active: true
			})
			.onConflictDoNothing()
			.returning();
		const teacherId =
			teacher?.id ??
			(await db.query.user.findFirst({ where: eq(user.email, teacherEmail) }))!.id;
		await db
			.insert(subjectTeachers)
			.values({ subjectId, teacherId })
			.onConflictDoNothing();
		console.log('Asignatura:', subjectName, '→ docente:', teacherEmail);
	}
}

seed().catch((e) => {
	console.error('Seed falló:', e);
	process.exit(1);
});