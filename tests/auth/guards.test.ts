import { describe, expect, it, vi } from 'vitest';
import { load as appLayout } from '../../src/routes/(app)/+layout.server.ts';
import { load as adminLayout } from '../../src/routes/admin/+layout.server.ts';

/**
 * Route guards are the last line of defence: the layout `load` decides whether
 * a request reaches the app or the admin panel at all. They are tested as plain
 * functions because that is exactly how SvelteKit calls them.
 *
 * A `user` with extra columns (image, defaultProvider, ...) is used on purpose:
 * the guard must return an explicit allowlist, never the raw row.
 */

// The app layout also loads the sidebar data; the guard tests own no database.
vi.mock('#lib/server/repositories/activity.js', () => ({
	listActivities: vi.fn(async () => []),
	listSubjects: vi.fn(async () => [])
}));

const teacher = {
	id: 'user-teacher',
	name: 'Docente',
	email: 'docente@revisia.test',
	role: 'teacher' as const,
	active: true,
	image: 'https://example.test/avatar.png',
	defaultProvider: 'openai',
	defaultModel: 'gpt-4.1-mini'
};

const admin = { ...teacher, id: 'user-admin', role: 'admin' as const };

const appEvent = (user: typeof teacher) => ({
	locals: { user },
	url: new URL('http://localhost/')
});

describe('(app) layout guard', () => {
	it('sends anonymous requests to the login page', async () => {
		await expect(appLayout({ locals: {} } as never)).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});

	it('returns only the fields the client needs, plus the sidebar lists', async () => {
		const data = await appLayout(appEvent(teacher) as never);

		expect(data).toEqual({
			user: {
				id: 'user-teacher',
				name: 'Docente',
				email: 'docente@revisia.test',
				role: 'teacher',
				active: true
			},
			activities: [],
			subjects: []
		});
	});

	it('scopes the sidebar lists to the signed-in teacher', async () => {
		const { listActivities, listSubjects } = await import(
			'#lib/server/repositories/activity.js'
		);

		await appLayout(appEvent(teacher) as never);

		expect(listActivities).toHaveBeenCalledWith('user-teacher');
		expect(listSubjects).toHaveBeenCalledWith('user-teacher');
	});
});

describe('admin layout guard', () => {
	it('sends anonymous requests to the login page', async () => {
		await expect(adminLayout({ locals: {} } as never)).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});

	it('sends authenticated teachers back to the app root', async () => {
		await expect(
			adminLayout({ locals: { user: teacher }, url: new URL('http://localhost/admin') } as never)
		).rejects.toMatchObject({
			status: 302,
			location: '/'
		});
	});

	it('lets an admin through with the same allowlisted payload', async () => {
		const data = await adminLayout({ locals: { user: admin } } as never);

		expect(data).toEqual({
			user: {
				id: 'user-admin',
				name: 'Docente',
				email: 'docente@revisia.test',
				role: 'admin',
				active: true
			}
		});
	});
});
