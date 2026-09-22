import { useQuery } from '@tanstack/react-query';
import { getFacets, getProject, getSettings, getStats, listProjectsOverview } from './api/projects';
import { listReasons, listTags } from './api/tags';

export const qk = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  settings: (id: string) => ['settings', id] as const,
  stats: (id: string) => ['stats', id] as const,
  facets: (id: string) => ['facets', id] as const,
  tags: (id: string) => ['tags', id] as const,
  reasons: (id: string) => ['reasons', id] as const,
  refs: (id: string) => ['refs', id] as const,
  activity: (id: string) => ['activity', id] as const,
  dupGroups: (id: string) => ['dupGroups', id] as const,
};

export const useProjectsOverview = () => useQuery({ queryKey: qk.projects, queryFn: listProjectsOverview });
export const useProject = (id: string) => useQuery({ queryKey: qk.project(id), queryFn: () => getProject(id), retry: 1 });
export const useSettings = (id: string) => useQuery({ queryKey: qk.settings(id), queryFn: () => getSettings(id) });
export const useStats = (id: string) => useQuery({ queryKey: qk.stats(id), queryFn: () => getStats(id) });
export const useFacets = (id: string) => useQuery({ queryKey: qk.facets(id), queryFn: () => getFacets(id), staleTime: 60_000 });
export const useTags = (id: string) => useQuery({ queryKey: qk.tags(id), queryFn: () => listTags(id) });
export const useReasons = (id: string) => useQuery({ queryKey: qk.reasons(id), queryFn: () => listReasons(id) });

export function pct(n: number, d: number, digits = 1): string {
  if (!d) return '0%';
  return `${((n / d) * 100).toFixed(digits)}%`;
}

export function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}

export function fmtDate(s: string | null | undefined, withTime = true): string {
  if (!s) return '';
  const d = new Date(s);
  return withTime
    ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
