import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { deleteProject, logActivity, updateProject, updateSettings } from '../lib/api/projects';
import { createReason, createTag, deleteReason, deleteTag, TAG_COLORS, updateReason, updateTag } from '../lib/api/tags';
import { friendlyError } from '../lib/errors';
import { qk, useProject, useReasons, useSettings, useTags } from '../lib/hooks';
import type { ExclusionReason, ProjectSettings, Tag } from '../lib/types';
import { Alert, Button, Card, Input, Kbd, Modal, PageLoader, Select } from '../components/ui';
import { ProjectForm } from '../components/ProjectForm';
import { ExportPanel } from '../components/ExportPanel';
import { TagChip } from '../components/Decision';
import { useToast } from '../components/Toast';
import { AccountSection } from './AccountPage';

const SECTIONS = [
  ['account', 'Account'], ['project', 'Project settings'], ['screening', 'Screening settings'], ['shortcuts', 'Keyboard shortcuts'],
  ['reasons', 'Exclusion reasons'], ['tags', 'Tags'], ['export', 'Data export & backup'], ['delete', 'Delete project'], ['about', 'About ScreenLab'],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card className="scroll-mt-20 p-5" as="section">
      <h2 id={id} className="mb-3 text-lg font-semibold text-ink-900">{title}</h2>
      {children}
    </Card>
  );
}

function ReasonsEditor({ projectId, reasons }: { projectId: string; reasons: ExclusionReason[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: qk.reasons(projectId) });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };
  const move = (i: number, dir: -1 | 1) => run(async () => {
    const a = reasons[i];
    const b = reasons[i + dir];
    if (!a || !b) return;
    await updateReason(a.id, { sort_order: b.sort_order === a.sort_order ? a.sort_order + dir : b.sort_order });
    await updateReason(b.id, { sort_order: a.sort_order });
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">The first nine reasons can be chosen with keys 1–9 while screening. Deleting or renaming a reason does not change decisions already recorded.</p>
      <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {reasons.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="w-6 text-xs text-slate-500">{i < 9 ? <Kbd>{i + 1}</Kbd> : ''}</span>
            <Input aria-label="Reason label" defaultValue={r.label} className="max-w-xs flex-1 py-1"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.label) void run(() => updateReason(r.id, { label: v })); }} />
            <Select aria-label="Applies to stage" value={r.stage} className="w-44 py-1 text-xs" onChange={(e) => run(() => updateReason(r.id, { stage: e.target.value as ExclusionReason['stage'] }))}>
              <option value="both">Both stages</option><option value="title_abstract">Title/abstract only</option><option value="full_text">Full text only</option>
            </Select>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.is_active} onChange={(e) => run(() => updateReason(r.id, { is_active: e.target.checked }))} /> Active</label>
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" aria-label={`Move ${r.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
              <Button size="sm" variant="ghost" aria-label={`Move ${r.label} down`} disabled={i === reasons.length - 1} onClick={() => move(i, 1)}>↓</Button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${r.label}`} onClick={() => { if (window.confirm(`Delete the reason "${r.label}"?`)) void run(() => deleteReason(r)); }}>✕</Button>
            </div>
          </li>
        ))}
      </ol>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) void run(async () => { await createReason(projectId, label, (reasons.at(-1)?.sort_order ?? 0) + 1); setLabel(''); }); }}>
        <label htmlFor="new-reason" className="sr-only">New exclusion reason</label>
        <Input id="new-reason" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New exclusion reason…" className="max-w-sm" />
        <Button type="submit" disabled={!label.trim()}>Add reason</Button>
      </form>
    </div>
  );
}

function TagsEditor({ projectId, tags }: { projectId: string; tags: Tag[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: qk.tags(projectId) });
      await qc.invalidateQueries({ queryKey: qk.refs(projectId) });
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };
  return (
    <div className="space-y-3">
      {tags.length === 0 ? <p className="text-sm text-slate-500">No tags yet.</p> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {tags.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <TagChip name={t.name} color={t.color} />
              <Input aria-label="Tag name" defaultValue={t.name} className="max-w-xs flex-1 py-1"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) void run(() => updateTag(t, { name: v })); }} />
              <Select aria-label="Tag colour" value={t.color} className="w-32 py-1 text-xs" onChange={(e) => run(() => updateTag(t, { color: e.target.value }))}>
                {TAG_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Delete tag ${t.name}`}
                onClick={() => { if (window.confirm(`Delete the tag "${t.name}"? It will be removed from all references.`)) void run(() => deleteTag(t)); }}>✕</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(async () => { await createTag(projectId, name); setName(''); }); }}>
        <label htmlFor="new-tag" className="sr-only">New tag</label>
        <Input id="new-tag" value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag, e.g. Needs Full Text" className="max-w-sm" />
        <Button type="submit" disabled={!name.trim()}>Create tag</Button>
      </form>
    </div>
  );
}

export function SettingsPage() {
  const { projectId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: project } = useProject(projectId);
  const { data: settings } = useSettings(projectId);
  const { data: reasons = [] } = useReasons(projectId);
  const { data: tags = [] } = useTags(projectId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  if (!project || !settings) return <PageLoader />;

  const saveSetting = async (patch: Partial<ProjectSettings>, msg: string) => {
    try {
      await updateSettings(projectId, patch);
      await logActivity(projectId, 'settings', msg);
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      await qc.invalidateQueries({ queryKey: qk.stats(projectId) });
      toast('Setting saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProject(projectId);
      qc.removeQueries({ queryKey: qk.project(projectId) });
      await qc.invalidateQueries({ queryKey: qk.projects });
      nav('/projects', { replace: true });
      toast('Project deleted');
    } catch (e) {
      setDeleteError(friendlyError(e));
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="Settings sections" className="lg:sticky lg:top-4 lg:self-start">
        <h1 className="mb-2 text-2xl font-semibold text-ink-900">Settings</h1>
        <ul className="flex flex-wrap gap-1 text-sm lg:flex-col">
          {SECTIONS.map(([id, l]) => <li key={id}><a href={`#${id}`} className="block rounded px-2 py-1 text-ink-800 hover:bg-ink-50">{l}</a></li>)}
        </ul>
      </nav>
      <div className="min-w-0 space-y-6">
        <Section id="account" title="Account"><AccountSection /></Section>
        <Section id="project" title="Project settings">
          <ProjectForm initial={project} submitLabel="Save project details" onSubmit={async (v) => {
            try {
              await updateProject(projectId, v);
              await qc.invalidateQueries({ queryKey: qk.project(projectId) });
              await qc.invalidateQueries({ queryKey: qk.projects });
              toast('Project details saved');
            } catch (e) {
              throw new Error(friendlyError(e));
            }
          }} />
        </Section>
        <Section id="screening" title="Screening settings">
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={settings.stage2_enabled}
                onChange={(e) => saveSetting({ stage2_enabled: e.target.checked }, `${e.target.checked ? 'Enabled' : 'Disabled'} full-text screening (stage 2)`)} />
              <span><strong>Enable Stage 2 — full-text screening.</strong> Records included at title/abstract move to full-text screening (Include / Exclude with a required reason). Turning this off hides stage 2 but keeps any full-text decisions.</span>
            </label>
            <p className="text-slate-600">Stage 1 (title/abstract: Include / Exclude / Maybe) is always enabled. Screening mode: single reviewer (the database is ready for multiple reviewers in a future version).</p>
          </div>
        </Section>
        <Section id="shortcuts" title="Keyboard shortcuts">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.keyboard_shortcuts_enabled}
              onChange={(e) => saveSetting({ keyboard_shortcuts_enabled: e.target.checked }, `${e.target.checked ? 'Enabled' : 'Disabled'} keyboard shortcuts`)} />
            Enable keyboard shortcuts on the screening page
          </label>
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {[['I', 'Include'], ['E', 'Exclude, then 1–9 for a reason'], ['M', 'Maybe'], ['N', 'Next'], ['P', 'Previous'], ['U', 'Undo'], ['/', 'Search'], ['C', 'Review criteria'], ['?', 'Shortcut help']].map(([k, d]) => (
              <li key={k}><Kbd>{k}</Kbd> {d}</li>
            ))}
          </ul>
        </Section>
        <Section id="reasons" title="Exclusion reasons"><ReasonsEditor projectId={projectId} reasons={reasons} /></Section>
        <Section id="tags" title="Tags"><TagsEditor projectId={projectId} tags={tags} /></Section>
        <Section id="export" title="Data export & project backup"><ExportPanel project={project} stage2Enabled={settings.stage2_enabled} /></Section>
        <Section id="delete" title="Delete project">
          <p className="text-sm text-slate-700">This will permanently delete this review project and its screening data: all references, decisions, notes, tags, history and uploaded PDFs. <strong>Download a project backup first</strong> if you might need it.</p>
          <Button variant="danger" className="mt-3" onClick={() => { setConfirmText(''); setDeleteOpen(true); }}>Delete this project…</Button>
        </Section>
        <Section id="about" title="About ScreenLab">
          <div className="space-y-2 text-sm text-slate-700">
            <p><strong>ScreenLab</strong> — Systematic Review Screening, Simplified. Version 1.0.</p>
            <p><strong>Your research data belongs to you.</strong> Export your screening data (CSV, JSON, RIS) or a complete project backup at any time and take it anywhere. Nothing is locked in.</p>
            <p><strong>Human decisions only.</strong> ScreenLab never includes or excludes a record automatically. Every decision is made by you and recorded with a timestamp and full change history.</p>
            <p>Data is stored in your own Supabase database, protected by row-level security so that only your account can read your projects.</p>
          </div>
        </Section>
      </div>
      <Modal open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} dismissable={!deleting} title="Delete project permanently?"
        footer={<>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
          <Button variant="danger" onClick={doDelete} loading={deleting} disabled={confirmText.trim() !== project.title.trim()}>Permanently delete</Button>
        </>}>
        <div className="space-y-3 text-sm">
          <Alert kind="warning">This will permanently delete this review project and its screening data. This cannot be undone.</Alert>
          <p>To confirm, type the project title: <strong className="break-words">{project.title}</strong></p>
          <label htmlFor="confirm-delete" className="sr-only">Project title</label>
          <Input id="confirm-delete" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          {deleteError && <Alert>{deleteError}</Alert>}
        </div>
      </Modal>
    </div>
  );
}
