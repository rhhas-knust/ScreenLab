import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { useProject } from '../lib/hooks';
import { LogoMark } from './Logo';
import { SyncIndicator } from './SyncIndicator';
import { cx } from './ui';
import { outbox } from '../lib/outbox';

const PROJECT_NAV = [
  { to: '', label: 'Dashboard', end: true },
  { to: 'screening', label: 'Screening' },
  { to: 'references', label: 'References' },
  { to: 'duplicates', label: 'Duplicates' },
  { to: 'statistics', label: 'Statistics' },
  { to: 'settings', label: 'Settings' },
];

function ProjectTitle({ id }: { id: string }) {
  const { data } = useProject(id);
  return <span className="truncate">{data?.title ?? '…'}</span>;
}

export function AppShell({ children, fullHeight = false }: { children: ReactNode; fullHeight?: boolean }) {
  const { projectId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);

  const signOut = async () => {
    if (outbox.getState().pending.length && !window.confirm('Some changes have not reached the server yet. They are kept on this device and will sync the next time you sign in here. Sign out anyway?')) return;
    await supabase.auth.signOut();
    nav('/login');
  };

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium', isActive ? 'bg-ink-900 text-white' : 'text-ink-800 hover:bg-ink-50');

  return (
    <div className={cx('flex flex-col', fullHeight ? 'h-full' : 'min-h-full')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="z-30 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
          <Link to="/projects" className="flex shrink-0 items-center gap-2" aria-label="ScreenLab — my projects">
            <LogoMark className="h-7 w-7" />
            <span className="hidden text-base font-bold tracking-tight text-ink-900 sm:inline">Screen<span className="text-lens-700">Lab</span></span>
          </Link>
          {projectId && (
            <div className="hidden min-w-0 max-w-xs items-center text-sm text-slate-600 md:flex">
              <span aria-hidden="true" className="mx-1 text-slate-300">/</span>
              <Link to={`/p/${projectId}`} className="truncate font-medium text-ink-900 hover:underline"><ProjectTitle id={projectId} /></Link>
            </div>
          )}
          <nav aria-label="Main" className="hidden flex-1 items-center gap-1 overflow-x-auto lg:flex">
            <NavLink to="/projects" end className={linkCls}>Projects</NavLink>
            {projectId && PROJECT_NAV.map((n) => (
              <NavLink key={n.label} to={`/p/${projectId}${n.to ? `/${n.to}` : ''}`} end={n.end} className={linkCls}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SyncIndicator />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu((m) => !m)}
                aria-expanded={menu}
                aria-haspopup="menu"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-sm font-semibold text-ink-900 hover:bg-ink-200"
                aria-label="Account and navigation menu"
              >
                {(user?.email ?? '?').slice(0, 1).toUpperCase()}
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg" onClick={() => setMenu(false)}>
                  <div className="truncate px-3 py-2 text-xs text-slate-500">Signed in as<br /><span className="text-sm text-slate-800">{user?.email}</span></div>
                  <div className="border-t border-slate-100 lg:hidden">
                    <Link role="menuitem" to="/projects" className="block px-3 py-2 text-sm hover:bg-slate-50">Projects</Link>
                    {projectId && PROJECT_NAV.map((n) => (
                      <Link role="menuitem" key={n.label} to={`/p/${projectId}${n.to ? `/${n.to}` : ''}`} className="block px-3 py-2 text-sm hover:bg-slate-50">{n.label}</Link>
                    ))}
                  </div>
                  <div className="border-t border-slate-100">
                    <Link role="menuitem" to="/account" className="block px-3 py-2 text-sm hover:bg-slate-50">Account settings</Link>
                    <button role="menuitem" type="button" onClick={signOut} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Sign out</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {projectId && (
          <nav aria-label="Project" className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1 lg:hidden">
            {PROJECT_NAV.map((n) => (
              <NavLink key={n.label} to={`/p/${projectId}${n.to ? `/${n.to}` : ''}`} end={n.end} className={linkCls}>{n.label}</NavLink>
            ))}
          </nav>
        )}
      </header>
      <main id="main" className={cx('flex-1', fullHeight && 'min-h-0')}>{children}</main>
    </div>
  );
}
