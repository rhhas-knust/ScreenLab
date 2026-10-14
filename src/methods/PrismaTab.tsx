import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listSources, mk, prismaManual, savePrismaManual, type PrismaManual } from '../lib/api/methods';
import { prismaCounts } from '../lib/methods/prisma';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { qk, useSettings, useStats } from '../lib/hooks';
import { Alert, Button, Card, Input, Label, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { PrismaDiagram, svgMarkup, svgToPng } from './PrismaDiagram';
import { getProgress, xk } from '../lib/api/extraction';
import { readForm, tierCounts } from '../lib/extraction/form';

const FIELDS: { key: keyof PrismaManual; label: string; hint: string }[] = [
  { key: 'duplicates_before_import', label: 'Duplicates removed before import', hint: 'e.g. removed in Rayyan, EndNote or Zotero before the records reached ScreenLab' },
  { key: 'automation_excluded', label: 'Records excluded by automation tools', hint: 'Leave 0: ScreenLab’s AI only suggests; people decide' },
  { key: 'other_removed', label: 'Records removed for other reasons', hint: 'Before screening, e.g. retracted papers' },
  { key: 'reports_not_retrieved_extra', label: 'Extra reports not retrieved', hint: 'Only if not already excluded as “full text unavailable”' },
  { key: 'reports_of_included', label: 'Reports of included studies', hint: 'Leave empty if each study has one report' },
];

export function PrismaTab({ projectId, title }: { projectId: string; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const stats = useStats(projectId);
  const settings = useSettings(projectId);
  const sources = useQuery({ queryKey: mk.sources(projectId), queryFn: () => listSources(projectId) });
  const progress = useQuery({ queryKey: xk.progress(projectId), queryFn: () => getProgress(projectId) });
  const [manual, setManual] = useState<PrismaManual | null>(null);
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { if (settings.data && !manual) setManual(prismaManual(settings.data)); }, [settings.data, manual]);
  const counts = useMemo(
    () => (stats.data && sources.data && manual ? prismaCounts(stats.data, sources.data, manual) : null),
    [stats.data, sources.data, manual],
  );
  const tiers = useMemo(
    () => tierCounts(readForm(settings.data), (progress.data ?? []).map((p) => (p.has_final ? p.final_tier : null))),
    [settings.data, progress.data],
  );
  if (!counts || !manual) return <div className="p-6"><Spinner /></div>;
  const unassigned = tiers?.find((t) => t.name === 'Tier not yet assigned')?.n ?? 0;
  const warnings = unassigned
    ? [...counts.warnings, `${unassigned} included stud${unassigned === 1 ? 'y has' : 'ies have'} no agreed Tier yet. Finalise their extraction (Extraction page) to split the included box by tier.`]
    : counts.warnings;

  const save = async () => {
    setSaving(true);
    try {
      await savePrismaManual(projectId, manual);
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      toast('Saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const base = `${safeFileName(title)}_PRISMA_2020`;
  const downloadSvg = () => svgRef.current && downloadText(`${base}.svg`, svgMarkup(svgRef.current), 'image/svg+xml');
  const downloadPng = async () => {
    if (!svgRef.current) return;
    try {
      const blob = await svgToPng(svgRef.current, 3);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {
      toast('Could not make the PNG. Download the SVG instead.', { kind: 'error' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <div className="flex-1">
          <h2 className="font-semibold text-ink-900">PRISMA 2020 flow diagram</h2>
          <p className="text-sm text-slate-600">Drawn from the records and decisions in this project and your search log. It updates as you screen.</p>
        </div>
        <Button variant="secondary" onClick={downloadSvg} data-testid="prisma-svg">Download SVG</Button>
        <Button variant="secondary" onClick={downloadPng}>Download PNG</Button>
        <Button variant="ghost" onClick={() => window.print()}>Print</Button>
      </div>

      {warnings.length > 0 && (
        <Alert kind="warning" className="print:hidden">
          <ul className="list-disc space-y-0.5 pl-4" data-testid="prisma-warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Alert>
      )}

      <Card className="overflow-x-auto p-3" >
        <div className="min-w-[40rem]" data-testid="prisma-diagram">
          <PrismaDiagram ref={svgRef} c={counts} tiers={tiers?.some((t) => t.n > 0 && t.name !== 'Tier not yet assigned') ? tiers : null} />
        </div>
      </Card>

      <Card className="space-y-3 p-4 print:hidden">
        <h3 className="text-sm font-semibold text-ink-900">Numbers ScreenLab cannot see</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`pm-${f.key}`} hint={f.hint}>{f.label}</Label>
              <Input id={`pm-${f.key}`} inputMode="numeric" className="max-w-40"
                value={manual[f.key] ?? ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  setManual({ ...manual, [f.key]: v === '' ? (f.key === 'reports_of_included' ? null : 0) : Number(v) });
                }} />
            </div>
          ))}
        </div>
        <Button variant="primary" onClick={save} loading={saving} data-testid="prisma-save">Save numbers</Button>
        <p className="text-xs text-slate-500">
          Full-text exclusions with reasons such as “Full text unavailable” are shown as reports not retrieved, as PRISMA 2020 asks.
          Records from other sources counted on the Statistics page appear under identification.
        </p>
      </Card>
    </div>
  );
}
