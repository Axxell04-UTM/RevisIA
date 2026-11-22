<script lang="ts">
	import { page } from '$app/state';
	import {
		BookOpen,
		ChevronDown,
		FileText,
		Home,
		Plus,
		Shield,
		LayoutTemplate
	} from '@lucide/svelte';
	import ThemeToggle from '#lib/components/ui/theme-toggle';
	import SidebarActivityItem from './SidebarActivityItem.svelte';
	import type { Activity, SubjectSummary } from '#lib/domain/types.js';
	import {
		ACTIVITY_STATUS_LABEL,
		groupActivitiesBySubject
	} from '#lib/domain/activity-groups.js';

	let {
		activities,
		subjects,
		user,
		onNavigate
	}: {
		activities: Activity[];
		subjects: SubjectSummary[];
		user: { name: string | null; role: string | null };
		onNavigate?: () => void;
	} = $props();

	const ROLE_LABEL: Record<string, string> = {
		teacher: 'Docente',
		admin: 'Administrador'
	};

	let collapsed = $state<Record<string, boolean>>({});
	let groups = $derived(groupActivitiesBySubject(activities, subjects));
	let pathname = $derived(page.url.pathname);

	const links = $derived([
		{ href: '/', label: 'Inicio', icon: Home },
		{ href: '/rubricas', label: 'Rúbricas', icon: LayoutTemplate },
		{ href: '/asignaturas', label: 'Asignaturas', icon: BookOpen },
		...(user.role === 'admin' ? [{ href: '/admin', label: 'Admin', icon: Shield }] : [])
	]);

	function isActive(href: string, exact: boolean) {
		if (exact) return pathname === href;
		return pathname === href || pathname.startsWith(`${href}/`);
	}

	/** Subtitle of an item: the subject, or the status when there is none (S4). */
	function subtitleFor(activity: Activity, groupName: string) {
		return groupName === 'Sin asignatura' || !activity.subjectId
			? ACTIVITY_STATUS_LABEL[activity.status]
			: groupName;
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground">
	<div class="flex h-12 shrink-0 items-center border-b border-sidebar-border px-3">
		<a href="/" onclick={() => onNavigate?.()} class="flex items-center gap-2">
			<FileText class="size-4 text-primary" />
			<span class="text-sm font-semibold tracking-tight">RevisIA</span>
		</a>
	</div>

	<nav class="shrink-0 space-y-0.5 px-2 py-2" aria-label="Navegación principal">
		{#each links as link}
			{@const active = isActive(link.href, link.href === '/')}
			{@const Icon = link.icon}
			<a
				href={link.href}
				onclick={() => onNavigate?.()}
				aria-current={active ? 'page' : undefined}
				class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors {active
					? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
					: 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'}"
			>
				<Icon class="size-4" />
				{link.label}
			</a>
		{/each}
	</nav>

	<div class="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
		<h2 class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
			Actividades
		</h2>
		<span class="ml-auto text-xs tabular-nums text-muted-foreground">{activities.length}</span>
		<a
			href="/actividades/nueva"
			onclick={() => onNavigate?.()}
			title="Nueva actividad"
			aria-label="Nueva actividad"
			class="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
		>
			<Plus class="size-4" />
		</a>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
		{#if groups.length === 0}
			<p class="px-2 py-2 text-xs text-muted-foreground">
				Todavía no tenés actividades de revisión.
				<a
					href="/actividades/nueva"
					onclick={() => onNavigate?.()}
					class="font-medium text-primary hover:underline">Creá la primera</a
				>.
			</p>
		{:else}
			{#each groups as group (group.key)}
				{@const isCollapsed = collapsed[group.key] ?? false}
				<section class="mt-1">
					<button
						type="button"
						aria-expanded={!isCollapsed}
						onclick={() => (collapsed[group.key] = !isCollapsed)}
						class="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
					>
						<ChevronDown
							class="size-3 shrink-0 transition-transform {isCollapsed ? '-rotate-90' : ''}"
						/>
						<span class="truncate">{group.name}</span>
						<span class="ml-auto tabular-nums">{group.activities.length}</span>
					</button>

					{#if !isCollapsed}
						<div class="mt-0.5 space-y-0.5">
							{#each group.activities as activity (activity.id)}
								<SidebarActivityItem
									{activity}
									subtitle={subtitleFor(activity, group.name)}
									active={pathname === `/revisar/${activity.id}`}
									{onNavigate}
								/>
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		{/if}
	</div>

	<div class="shrink-0 border-t border-sidebar-border p-3">
		<div class="mb-2 min-w-0">
			<p class="truncate text-sm">{user.name ?? 'Sin nombre'}</p>
			<p class="text-xs text-muted-foreground">
				{ROLE_LABEL[user.role ?? ''] ?? user.role ?? ''}
			</p>
		</div>
		<div class="flex items-center justify-between">
			<form action="/logout" method="POST">
				<button
					type="submit"
					class="text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					Cerrar sesión
				</button>
			</form>
			<ThemeToggle />
		</div>
	</div>
</div>
