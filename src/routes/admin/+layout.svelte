<script lang="ts">
	import { page } from '$app/state';
	import ThemeToggle from '#lib/components/ui/theme-toggle';
	let { children } = $props();

	const adminNav = [
		{ href: '/admin', label: 'Dashboard', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', iconPolyline: '9 22 9 12 15 12' },
		{ href: '/admin/teachers', label: 'Docentes', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', iconCircle: '9 7 4', iconPath: 'M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75' },
		{ href: '/admin/subjects', label: 'Asignaturas', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
		{ href: '/admin/settings', label: 'Configuración', icon: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 1-1.82.33 1.65 1.65 0 0 1-1.82-.33l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 1 1.82.33H21a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-.09a1.65 1.65 0 0 1-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 1 1.82.33H7a2 2 0 0 0-2 2v.09a1.65 1.65 0 0 1-.33 1.82l-.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 1-1.82.33H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h.09a1.65 1.65 0 0 1 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 1-1.82-.33H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h.09a1.65 1.65 0 0 1 .33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06-.06a1.65 1.65 0 0 1 1.82-.33H17a2 2 0 0 1 2 2v.09a1.65 1.65 0 0 1 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 1-1.82.33H7a2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 1-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06-.06a1.65 1.65 0 0 1 1.82-.33H17' }
	];

	function isActive(href: string) {
		return page.url.pathname === href || (href !== '/admin' && page.url.pathname.startsWith(href));
	}
</script>

<div class="min-h-screen bg-background">
	<!-- Sidebar Navigation -->
	<aside class="fixed inset-y-0 left-0 z-40 w-64 bg-card border-r border-border hidden lg:block">
		<nav class="flex flex-col h-full p-4">
			<div class="mb-8">
				<a href="/admin" class="text-lg font-semibold tracking-tight">RevisIA Admin</a>
			</div>
			<ul class="flex-1 space-y-1">
				{#each adminNav as item}
				<li>
					<a
						href={item.href}
						class:active={isActive(item.href)}
						class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						aria-current={isActive(item.href) ? 'page' : undefined}
					>
						<svg class="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d={item.icon} />
							{#if item.iconCircle}
								<circle cx="9" cy="7" r="4" />
							{/if}
							{#if item.iconPolyline}
								<polyline points={item.iconPolyline} />
							{/if}
							{#if item.iconPath}
								<path d={item.iconPath} />
							{/if}
						</svg>
						<span>{item.label}</span>
					</a>
				</li>
				{/each}
			</ul>
			<div class="border-t border-border pt-4">
				<div class="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
					{page.data.user?.name} · <span class="font-medium">Admin</span>
				</div>
				<form action="/logout" method="POST" class="mt-2">
					<button type="submit" class="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
							<polyline points="16 17 21 12 16 7" />
							<line x1="21" y1="12" x2="9" y2="12" />
						</svg>
						Cerrar sesión
					</button>
				</form>
				<ThemeToggle class="mx-3 mt-2" />
			</div>
		</nav>
	</aside>

	<!-- Mobile header -->
	<header class="lg:hidden sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
		<div class="flex h-16 items-center justify-between px-4">
			<a href="/admin" class="text-lg font-semibold tracking-tight">RevisIA Admin</a>
			<div class="flex items-center gap-2">
				<ThemeToggle />
			</div>
		</div>
	</header>

	<!-- Main content -->
	<main class="lg:ml-64 mx-auto w-full max-w-4xl px-6 py-8">
		{@render children()}
	</main>
</div>