import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { fmt, pct, qk, useSettings, useStats } from '../lib/hooks';
import { updateSettings, logActivity } from '../lib/api/projects';
import { friendlyError } from '../lib/errors';
import { Alert, Button, Card, Input, Label, PageLoader, Stat, Textarea } from '../components/ui';
import { BarList } from '../components/BarList';
import { useToast } from '../components/Toast';

function FlowBox({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white px-3 py-2">
      <div className="text-sm text-slate-700">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink-900">{typeof value === 'number' ? fmt(value) : value}</div>
      {note && <div className="text-xs text-slate-500">{note}</div>}
    </div>
  );
}

export function StatisticsPage() {
  const { projectId = '' } = useParams();
  const { data: s, isLoading, error } = useStats(projectId);
  const { data: settings } = useSettings(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const [extra, setExtra] = useState('0');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (settings) {
      setExtra(String(settings.additional_records_other_sources ?? 0));
      setNotes(settings.prisma_notes ?? '');
    }
  }, [settings]);

  if (error) return <div className="mx-auto max-w-lg p-6"><Alert>{friendlyError(error)}</Alert></div>;
  if (isLoading || !s || !settings) return <PageLoader />;

  const stage2 = s.stage2_enabled;
  const imported = s.total;
  const other = s.additional_records_other_sources;
  const included = stage2 ? s.ft_include : s.ta_include;

  const saveManual = async () => {
    const n = Number(extra);
    if (!Number.isInteger(n) || n < 0) {
      toast('Please enter a whole number (0 or more).', { kind: 'error' });
      return;
    }
    setSaving(true);
    try {
      await updateSettings(projectId, { additional_records_other_sources: n, prisma_notes: notes.trim() || null });
      await logActivity(projectId, 'statistics', `Set additional records from other sources to ${n}`);
      await qc.invalidateQueries({ queryKey: qk.stats(projectId) });
      await qc.invalidateQueries({ queryKey: qk.settings(projectId) });
      toast('Saved');
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Screening statistics</h1>
          <p className="text-sm text-slate-600">All counts are calculated from the records and decisions stored in this project. This is a screening statistics dashboard, not a complete PRISMA implementation.</p>
        </div>
        <Link to={`/p/${projectId}/activity`} className="text-sm font-medium text-ink-800 underline">Activity log & audit trail →</Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Records identified" value={fmt(imported + other)} sub={other ? `${fmt(imported)} imported + ${fmt(other)} other` : 'via import'} />
        <Stat label="Duplicates removed" value={fmt(s.duplicates_removed)} sub={s.possible_duplicates ? `${fmt(s.possible_duplicates)} still to review` : undefined} tone="muted" />
        <Stat label="After de-duplication" value={fmt(s.after_dedup)} />
        <Stat label="Screened (T/A)" value={fmt(s.ta_screened)} sub={pct(s.ta_screened, s.after_dedup)} />
        <Stat label="Remaining" value={fmt(s.ta_unscreened)} />
        <Stat label="✓ Studies included" value={fmt(included)} tone="include" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <Card className="p-5">
          <h2 className="font-semibold text-ink-900">Flow of records (PRISMA-style counts)</h2>
          <p className="mb-3 text-xs text-slate-500">Numbers needed for a future PRISMA flow diagram.</p>
          <div className="space-y-2" aria-label="Flow of records">
            <div className="grid grid-cols-2 gap-2">
              <FlowBox label="Records identified from databases (imported)" value={imported} />
              <FlowBox label="Additional records from other sources" value={other} note="manual count" />
            </div>
            <div className="text-center text-slate-400" aria-hidden="true">↓</div>
            <FlowBox label="Duplicate records removed" value={s.duplicates_removed} />
            <div className="text-center text-slate-400" aria-hidden="true">↓</div>
            <FlowBox label="Records screened (title/abstract)" value={s.ta_screened} note={`${fmt(s.after_dedup)} after de-duplication; ${fmt(s.ta_unscreened)} not yet screened`} />
            <FlowBox label="Records excluded at title/abstract" value={s.ta_exclude} note={s.ta_maybe ? `${fmt(s.ta_maybe)} marked Maybe (unresolved)` : undefined} />
            {stage2 && (
              <>
                <div className="text-center text-slate-400" aria-hidden="true">↓</div>
                <FlowBox label="Full texts sought" value={s.ft_pool} note={`${fmt(s.ft_not_available)} with full text not yet available`} />
                <FlowBox label="Full texts assessed for eligibility" value={s.ft_screened} note={`${fmt(s.ft_unscreened)} awaiting assessment`} />
                <FlowBox label="Full texts excluded" value={s.ft_exclude} />
              </>
            )}
            <div className="text-center text-slate-400" aria-hidden="true">↓</div>
            <FlowBox label="Studies included" value={included} />
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <BarList title="Title/abstract exclusion reasons" rows={s.ta_reasons.map((r) => ({ label: r.reason, value: r.count }))} empty="No exclusions yet." />
          {stage2 && <BarList title="Full-text exclusion reasons" rows={s.ft_reasons.map((r) => ({ label: r.reason, value: r.count }))} empty="No full-text exclusions yet." />}
          <BarList title="Records by database source (all imported records)" rows={s.by_source.map((r) => ({ label: r.source, value: r.count }))} />
          <BarList title="Records by publication year (after de-duplication)" rows={[...s.by_year].reverse().slice(0, 30).map((r) => ({ label: String(r.year), value: r.count }))} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold text-ink-900">Manual counts</h2>
          <p className="mt-1 text-sm text-slate-600">For records that did not enter ScreenLab through an import (e.g. citation searching, experts, websites).</p>
          <div className="mt-3 space-y-3">
            <div>
              <Label htmlFor="extra">Additional records identified through other sources</Label>
              <Input id="extra" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value.replace(/\D/g, ''))} className="max-w-40" />
            </div>
            <div>
              <Label htmlFor="pnotes">Notes for your flow diagram</Label>
              <Textarea id="pnotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button variant="primary" onClick={saveManual} loading={saving}>Save manual counts</Button>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-ink-900">Imports</h2>
          {s.imports.length === 0 ? <p className="mt-2 text-sm text-slate-500">No imports yet.</p> : (
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">File</th><th>Source</th><th className="text-right">Records</th></tr></thead>
              <tbody>
                {s.imports.map((i, k) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="max-w-[14rem] truncate py-1 pr-2" title={i.file_name ?? ''}>{i.file_name}<div className="text-xs text-slate-500">{new Date(i.created_at).toLocaleDateString()}</div></td>
                    <td className="pr-2">{i.database_source ?? '—'}</td>
                    <td className="text-right tabular-nums">{fmt(i.records_imported)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
