import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { useProject } from '../lib/hooks';
import { LogoMark } from './Logo';
import { SyncIndicator } from './SyncIndicator';
import { cx } from './ui';
import { outbox } from '../lib/outbox';
import { promptInstall, useInstallOption } from '../lib/install';
import { useToast } from './Toast';
import {
  IconActivity, IconChart, IconChevronLeft, IconChevronRight, IconClipboard, IconCopy, IconDoc, IconFolder, IconHome, IconLayers,
  IconList, IconLogout, IconMenu, IconScreen, IconSettings, IconShield, IconTable, IconUpload, IconUser, IconX,
} from './icons';

type Item = { to: string; label: string; icon: ComponentType<{ size?: number }>; end?: boolean };
/** The project's sections in the order a review is done. */
const PROJECT_NAV: { group: string; items: Item[] }[] = [
  { group: '', items: [{ to: '', label: 'Dashboard', icon: IconHome, end: true }] },
  { group: 'Records', items: [
    { to: 'import', label: 'Import', icon: IconUpload },
    { to: 'references', label: 'References', icon: IconList },
    { to: 'duplicates', label: 'Duplicates', icon: IconCopy },
  ] },
  { group: 'Screen', items: [{ to: 'screening', label: 'Screening', icon: IconScreen }] },
  { group: 'Review', items: [
    { to: 'extraction', label: 'Extraction', icon: IconTable },
    { to: 'risk-of-bias', label: 'Risk of bias', icon: IconShield },
    { to: 'synthesis', label: 'Synthesis', icon: IconLayers },
  ] },
  { group: 'Report', items: [
    { to: 'statistics', label: 'Statistics', icon: IconChart },
    { to: 'methods', label: 'Methods', icon: IconDoc },
  ] },
  { group: 'Project', items: [
    { to: 'activity', label: 'Activity', icon: IconActivity },
    { to: 'settings', label: 'Settings', icon: IconSettings },
  ] },
];

const COLLAPSE_KEY = 'screenlab.sidebar';

function ProjectNav({ projectId, collapsed, onNavigate }: { projectId: string; collapsed: boolean; onNavigate?: () => void }) {
  const { data } = useProject(projectId);
  return (
    <nav aria-label="Project" className="flex flex-col gap-4">
      <Link to={`/p/${projectId}`} onClick={onNavigate} title={collapsed ? data?.title : undefined}
        className={cx('block rounded-lg hover:bg-white/60', collapsed ? 'mx-auto grid h-9 w-9 place-items-center bg-ink-100 text-sm font-bold text-ink-900' : 'px-2 py-1')}>
        {collapsed ? (data?.title ?? '?').slice(0, 1).toUpperCase() : (
          <>
            <span className="block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Review</span>
            <span className="line-clamp-2 text-sm font-semibold leading-snug text-ink-900">{data?.title ?? '…'}</span>
          </>
        )}
      </Link>
      {PROJECT_NAV.map((g) => (
        <div key={g.group || 'top'} className="space-y-0.5">
          {g.group && !collapsed && <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{g.group}</div>}
          {g.group && collapsed && <div className="mx-auto mb-1 h-px w-6 bg-slate-200" aria-hidden="true" />}
          {g.items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={label} to={`/p/${projectId}${to ? `/${to}` : ''}`} end={end} onClick={onNavigate}
              title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}
              className={({ isActive }) => cx(
                'relative flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors',
                collapsed ? 'mx-auto h-9 w-9 justify-center' : 'px-2 py-1.5',
                isActive ? 'bg-white text-ink-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-ink-900',
              )}>
              {({ isActive }) => (
                <>
                  {isActive && !collapsed && <span aria-hidden="true" className="absolute inset-y-1.5 -left-2 w-1 rounded-r bg-lens-500" />}
                  <span className={cx('shrink-0', isActive ? 'text-lens-700' : 'text-slate-500')}><Icon size={18} /></span>
                  {!collapsed && <span className="truncate">{label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children, fullHeight = false }: { children: ReactNode; fullHeight?: boolean }) {
  const { projectId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // The sidebar folds to icons on request, and by default on the screening page where the paper needs the room.
  const [pref, setPref] = useState<'open' | 'closed' | null>(() => { try { return localStorage.getItem(COLLAPSE_KEY) as 'open' | 'closed' | null; } catch { return null; } });
  const collapsed = pref ? pref === 'closed' : fullHeight;
  const toggle = () => {
    const next = collapsed ? 'open' : 'closed';
    setPref(next);
    try { localStorage.setItem(COLLAPSE_KEY, next); } catch { /* private mode */ }
  };
  useEffect(() => setDrawer(false), [loc.pathname]);
  const installOption = useInstallOption();
  const toast = useToast();
  const install = async () => {
    if (installOption === 'ios') toast('In Safari, tap the Share button, then “Add to Home Screen”.');
    else if (await promptInstall()) toast('ScreenLab is installed. Open it from your home screen or app list.');
  };

  const signOut = async () => {
    if (outbox.getState().pending.length && !window.confirm('Some changes have not reached the server yet. They are kept on this device and will sync the next time you sign in here. Sign out anyway?')) return;
    await supabase.auth.signOut();
    nav('/login');
  };

  const topLink = ({ isActive }: { isActive: boolean }) =>
    cx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors', isActive ? 'bg-ink-50 text-ink-900' : 'text-slate-600 hover:bg-slate-100 hover:text-ink-900');

  return (
    <div className={cx('flex flex-col', fullHeight ? 'h-full' : 'min-h-full')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
          {projectId && (
            <button type="button" onClick={() => setDrawer(true)} className="grid h-9 w-9 place-items-center rounded-lg text-ink-900 hover:bg-slate-100 lg:hidden"
              aria-label="Open project menu" aria-expanded={drawer} data-testid="project-menu">
              <IconMenu size={20} />
            </button>
          )}
          <Link to="/projects" className="flex shrink-0 items-center gap-2" aria-label="ScreenLab — my projects">
            <LogoMark className="h-7 w-7" />
            <span className="hidden text-base font-bold tracking-tight text-ink-900 sm:inline">Screen<span className="text-lens-700">Lab</span></span>
          </Link>
          <nav aria-label="Main" className="ml-2 hidden items-center gap-1 sm:flex">
            <NavLink to="/projects" end className={topLink}>Projects</NavLink>
            <NavLink to="/research" className={topLink}>ResearchHub</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SyncIndicator />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu((m) => !m)}
                aria-expanded={menu}
                aria-haspopup="menu"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold text-white ring-2 ring-white hover:bg-ink-800"
                aria-label="Account and navigation menu"
              >
                {(user?.email ?? '?').slice(0, 1).toUpperCase()}
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setMenu(false)} />
                  <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg" onClick={() => setMenu(false)}>
                    <div className="truncate px-3 py-2 text-xs text-slate-500">Signed in as<br /><span className="text-sm text-slate-800">{user?.email}</span></div>
                    <div className="border-t border-slate-100 sm:hidden">
                      <Link role="menuitem" to="/projects" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><IconFolder size={16} /> Projects</Link>
                      <Link role="menuitem" to="/research" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><IconClipboard size={16} /> ResearchHub</Link>
                    </div>
                    <div className="border-t border-slate-100">
                      {installOption && (
                        <button role="menuitem" type="button" onClick={install} className="block w-full px-3 py-2 text-left text-sm font-medium text-lens-700 hover:bg-slate-50" data-testid="install-app">
                          Install ScreenLab app
                        </button>
                      )}
                      <Link role="menuitem" to="/account" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><IconUser size={16} /> Account settings</Link>
                      <button role="menuitem" type="button" onClick={signOut} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"><IconLogout size={16} /> Sign out</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className={cx('flex flex-1', fullHeight && 'min-h-0')}>
        {projectId && (
          <aside aria-label="Project sections"
            className={cx('hidden shrink-0 flex-col border-r border-slate-200 bg-slate-100/70 lg:flex', collapsed ? 'w-16' : 'w-60',
              fullHeight ? 'overflow-y-auto' : 'sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto')}>
            <div className={cx('flex-1 py-4', collapsed ? 'px-2' : 'px-3')}><ProjectNav projectId={projectId} collapsed={collapsed} /></div>
            <button type="button" onClick={toggle} data-testid="sidebar-toggle"
              className="flex items-center gap-2 border-t border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-white hover:text-ink-900"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <IconChevronRight size={16} /> : <><IconChevronLeft size={16} /> Collapse</>}
            </button>
          </aside>
        )}
        <main id="main" className={cx('min-w-0 flex-1', fullHeight && 'min-h-0')}>{children}</main>
      </div>

      {projectId && drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Project menu">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col overflow-y-auto bg-slate-50 p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <Link to="/projects" className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-ink-900"><IconChevronLeft size={16} /> All projects</Link>
              <button type="button" onClick={() => setDrawer(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-200" aria-label="Close project menu"><IconX size={18} /></button>
            </div>
            <ProjectNav projectId={projectId} collapsed={false} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
