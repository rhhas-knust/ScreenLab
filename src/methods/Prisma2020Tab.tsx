import { Fragment, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveSettingsKey } from '../lib/api/methods';
import { checklistCsv, checklistProgress, PRISMA_2020, readChecklist } from '../lib/methods/prisma2020';
import { wordDoc } from '../lib/synthesis/tables';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { qk, useSettings } from '../lib/hooks';
import { Button, Input, ProgressBar, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

export function Prisma2020Tab({ projectId, title }: { projectId: string; title: string }) {
  const settings = useSettings(projectId);
  if (!settings.data) return <div className="p-6"><Spinner /></div>;
  return <Checklist key={settings.data.updated_at} projectId={projectId} title={title} initial={readChecklist(settings.data)} />;
}

function Checklist({ projectId, title, initial }: { projectId: string; title: string; initial: Record<string, string> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [where, setWhere] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = checklistProgress(where);
  const save = async () => {
    setBusy(true);
    try {
      await saveSettingsKey(projectId, 'prisma2020', where);
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      setDirty(false);
      toast('Checklist saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const base = `${safeFileName(title)}_PRISMA_2020_checklist`;
  let section = '';
  return (
    <div className="space-y-3" data-testid="prisma2020">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-ink-900">PRISMA 2020 checklist</h2>
          <p className="text-sm text-slate-600">For the finished review: note the page or section where each item is reported. Journals ask for this file at submission. Page MJ et al. BMJ 2021;372:n71.</p>
        </div>
        <Button variant="secondary" onClick={() => downloadText(`${base}.csv`, checklistCsv(where), 'text/csv')}>CSV</Button>
        <Button variant="secondary" onClick={() => downloadText(`${base}.doc`, wordDoc('PRISMA 2020 checklist', [{
          heading: title, head: ['Section / topic', 'Item', 'Checklist item', 'Location where item is reported'],
          rows: PRISMA_2020.map((i) => [`${i.section}: ${i.topic}`, i.id, i.text, where[i.id] ?? '']),
        }]), 'application/msword')} data-testid="prisma2020-word">Word</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty} data-testid="prisma2020-save">Save</Button>
      </div>
      <ProgressBar value={done} max={PRISMA_2020.length} label={`${done} of ${PRISMA_2020.length} items have a location`} />
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="p-2">Item</th><th className="p-2">Checklist item</th><th className="w-56 p-2">Where reported</th></tr></thead>
          <tbody>
            {PRISMA_2020.map((i) => {
              const head = i.section !== section ? (section = i.section) : null;
              return (
                <Fragment key={i.id}>
                  {head && <tr><th colSpan={3} className="bg-slate-50 p-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">{head}</th></tr>}
                  <tr className="border-t border-slate-100 align-top">
                    <td className="p-2 font-semibold tabular-nums">{i.id}</td>
                    <td className="p-2">
                      <span className="font-medium">{i.topic}.</span> {i.text}
                      {i.help && <span className="block text-xs text-lens-700">In ScreenLab: {i.help}</span>}
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Where item ${i.id} is reported`} value={where[i.id] ?? ''} placeholder="e.g. Methods, p. 6"
                        onChange={(e) => { setWhere({ ...where, [i.id]: e.target.value }); setDirty(true); }} />
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
