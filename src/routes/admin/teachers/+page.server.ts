import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth/index.js';
import { listTeachers, createTeacher, setTeacherActive, deleteTeacherSoft } from '#lib/server/repositories/teacher.js';
import { getSubjects } from '#lib/server/repositories/subject.js';
import { logAudit } from '#lib/server/repositories/audit.js';
import { resolveExcelJs } from '#lib/server/exceljs-module.js';

export const load: PageServerLoad = async ({ url, locals }) => {
	const page = Number(url.searchParams.get('page')) || 1;
	const limit = 20;
	const offset = (page - 1) * limit;
	const search = url.searchParams.get('search') || undefined;
	const active = url.searchParams.get('active');
	const sortBy = url.searchParams.get('sortBy') || 'createdAt';
	const sortOrder = url.searchParams.get('sortOrder') || 'desc';

	const [{ items, total }, subjects] = await Promise.all([
		listTeachers({ limit, offset, search, active: active ? active === 'true' : undefined, sortBy: sortBy as any, sortOrder: sortOrder as any }),
		getSubjects()
	]);

	return {
		teachers: items,
		total,
		page,
		totalPages: Math.ceil(total / limit),
		search,
		active: active ?? 'all',
		sortBy,
		sortOrder,
		subjects
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const name = formData.get('name') as string;
		const password = formData.get('password') as string;
		const subjectIds = formData.getAll('subjectIds') as string[];

		if (!email || !name || !password) {
			return fail(400, { error: 'Email, nombre y contraseña son requeridos' });
		}

		try {
			const teacherId = await createTeacher({ email, name, password, subjectIds, createdBy: locals.user.id });
			await logAudit({ action: 'teacher.create', entity: 'user', entityId: teacherId, metadata: { email, name, subjectIds }, userId: locals.user.id });
			return { success: true, teacherId, tempPassword: password };
		} catch (e: any) {
			return fail(400, { error: e.message || 'Error al crear docente' });
		}
	},

	toggleActive: async ({ request, locals }) => {
		const formData = await request.formData();
		const teacherId = formData.get('teacherId') as string;
		const active = formData.get('active') === 'true';

		await setTeacherActive(teacherId, active);
		if (!active) {
			try {
				await (auth.api as any).revokeUserSessions({ userId: teacherId, headers: request.headers });
			} catch (e) {
				// No rompemos la respuesta si la revocación de sesiones falla
				// La acción principal (cambiar active) ya se completó
				console.warn('Failed to revoke sessions for teacher', teacherId, e);
			}
		}
		await logAudit({ action: active ? 'teacher.activate' : 'teacher.deactivate', entity: 'user', entityId: teacherId, userId: locals.user.id });
		return { success: true };
	},

	delete: async ({ request, locals }) => {
		const formData = await request.formData();
		const teacherId = formData.get('teacherId') as string;

		await deleteTeacherSoft(teacherId);
		try {
			await (auth.api as any).revokeUserSessions({ userId: teacherId, headers: request.headers });
		} catch (e) {
			console.warn('Failed to revoke sessions for teacher', teacherId, e);
		}
		await logAudit({ action: 'teacher.delete', entity: 'user', entityId: teacherId, userId: locals.user.id });
		return { success: true };
	},

	exportCsv: async ({ request, locals }) => {
		const teachers = await listTeachers({ limit: 10000, offset: 0 });
		const csv = [
			['ID', 'Email', 'Nombre', 'Rol', 'Activo', 'Creado', 'Asignaturas'].join(','),
			...teachers.items.map(t => [
				t.id,
				t.email,
				t.name ?? '',
				t.role,
				t.active ? 'Sí' : 'No',
				t.createdAt.toISOString().split('T')[0],
				t.subjects.map(s => s.code).join(';')
			].map(v => `"${v}"`).join(','))
		].join('\n');

		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="teachers-${new Date().toISOString().split('T')[0]}.csv"`
			}
		});
	},

	exportExcel: async ({ request, locals }) => {
		const ExcelJS = resolveExcelJs(await import('exceljs'));
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet('Docentes');
		sheet.columns = [
			{ header: 'ID', key: 'id', width: 36 },
			{ header: 'Email', key: 'email', width: 40 },
			{ header: 'Nombre', key: 'name', width: 30 },
			{ header: 'Rol', key: 'role', width: 12 },
			{ header: 'Activo', key: 'active', width: 10 },
			{ header: 'Creado', key: 'createdAt', width: 20 },
			{ header: 'Asignaturas', key: 'subjects', width: 40 }
		];

		const teachers = await listTeachers({ limit: 10000, offset: 0 });
		teachers.items.forEach(t => sheet.addRow({
			id: t.id,
			email: t.email,
			name: t.name ?? '',
			role: t.role,
			active: t.active ? 'Sí' : 'No',
			createdAt: t.createdAt.toISOString().split('T')[0],
			subjects: t.subjects.map(s => s.code).join(', ')
		}));

		const buffer = await workbook.xlsx.writeBuffer();
		return new Response(buffer, {
			headers: {
				'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'Content-Disposition': `attachment; filename="teachers-${new Date().toISOString().split('T')[0]}.xlsx"`
			}
		});
	}
};