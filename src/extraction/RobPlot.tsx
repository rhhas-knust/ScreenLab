import { forwardRef, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll, studyDetails, xk, type ProgressRow } from '../lib/api/extraction';
import { studyLabel, type ExtractionForm } from '../lib/extraction/form';
import { robSummary, robTone, trafficLight, TONE_COLOR, TONE_SYMBOL, type TrafficLight } from '../lib/extraction/robPlot';
import { downloadText, safeFileName } from '../lib/export/formats';
import { svgMarkup, svgToPng } from '../methods/PrismaDiagram';
import { Button, Card, EmptyState, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

const FONT = 'Arial, Helvetica, sans-serif';

/** Study × item grid of coloured dots (the "traffic-light" plot used in systematic reviews). */
const TrafficLightSvg = forwardRef<SVGSVGElement, { tl: TrafficLight }>(function TrafficLightSvg({ tl }, ref) {
  const labelW = 210, cell = 34, top = 40, r = 12;
  const W = Math.max(labelW + tl.columns.length * cell + 16, 610);
  const H = top + tl.rows.length * cell + 70;
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Risk-of-bias traffic-light plot" className="h-auto max-w-full">
      <rect width={W} height={H} fill="#ffffff" />
      {tl.columns.map((c, i) => (
        <text key={c.key} x={labelW + i * cell + cell / 2} y={top - 12} textAnchor="middle" fontSize="11" fontWeight={c.key === 'overall' ? 700 : 400} fontFamily={FONT} fill="#111827">{c.short}</text>
      ))}
      {tl.rows.map((row, ri) => {
        const y = top + ri * cell + cell / 2;
        return (
          <g key={ri}>
            <rect x={0} y={y - cell / 2} width={W} height={cell} fill={ri % 2 ? '#f8fafc' : '#ffffff'} />
            <text x={8} y={y + 4} fontSize="11" fontFamily={FONT} fill="#111827">{row.label.length > 32 ? `${row.label.slice(0, 31)}…` : row.label}</text>
            {row.cells.map((v, ci) => {
              const tone = robTone(v);
              const cx = labelW + ci * cell + cell / 2;
              return (
                <g key={ci}>
                  <circle cx={cx} cy={y} r={r} fill={TONE_COLOR[tone]} stroke={tone === 'blank' ? '#cbd5e1' : 'none'} />
                  <text x={cx} y={y + 4.5} textAnchor="middle" fontSize="13" fontWeight="700" fontFamily={FONT} fill="#ffffff">{TONE_SYMBOL[tone]}</text>
                </g>
              );
            })}
          </g>
        );
      })}
      <g transform={`translate(8, ${top + tl.rows.length * cell + 22})`} fontFamily={FONT} fontSize="11" fill="#111827">
        {([['good', 'Yes / Low'], ['some', 'Moderate'], ['unclear', 'Unclear'], ['bad', 'No / High'], ['na', 'Not applicable']] as const).map(([tone, label], i) => (
          <g key={tone} transform={`translate(${i * 118}, 0)`}>
            <circle cx={8} cy={0} r={7} fill={TONE_COLOR[tone]} />
            <text x={20} y={4}>{label}</text>
          </g>
        ))}
        <text x={0} y={26} fontSize="10" fill="#475569">{tl.columns.filter((c) => c.short !== 'Overall').map((c) => c.short).join(', ')}: checklist items (see the key below the plot).</text>
      </g>
    </svg>
  );
});

/** Share of studies with each answer, per item (the "summary" or weighted bar plot). */
const SummarySvg = forwardRef<SVGSVGElement, { form: ExtractionForm; tl: TrafficLight }>(function SummarySvg({ form, tl }, ref) {
  const rows = robSummary(form, tl);
  const labelW = 90, barW = 520, rowH = 26, top = 16;
  const W = labelW + barW + 20, H = top + rows.length * rowH + 40;
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Risk-of-bias summary plot" className="h-auto max-w-full">
      <rect width={W} height={H} fill="#ffffff" />
      {rows.map((r, i) => {
        let x = labelW;
        const y = top + i * rowH;
        return (
          <g key={r.column.key}>
            <text x={labelW - 8} y={y + 15} textAnchor="end" fontSize="11" fontFamily={FONT} fontWeight={r.column.short === 'Overall' ? 700 : 400} fill="#111827">{r.column.short}</text>
            {r.parts.map((p) => {
              const w = r.total ? (p.n / r.total) * barW : 0;
              const el = (
                <g key={p.answer}>
                  <rect x={x} y={y} width={Math.max(w - 1, 0)} height={rowH - 6} fill={TONE_COLOR[p.tone]} />
                  {w > 28 && <text x={x + w / 2} y={y + 14} textAnchor="middle" fontSize="10" fontFamily={FONT} fill={p.tone === 'blank' ? '#334155' : '#ffffff'}>{Math.round((p.n / r.total) * 100)}%</text>}
                </g>
              );
              x += w;
              return el;
            })}
          </g>
        );
      })}
      {[0, 25, 50, 75, 100].map((t) => (
        <text key={t} x={labelW + (t / 100) * barW} y={top + rows.length * rowH + 14} textAnchor="middle" fontSize="10" fontFamily={FONT} fill="#475569">{t}%</text>
      ))}
    </svg>
  );
});

export function RobPlotTab({ projectId, title, form, progress }: { projectId: string; title: string; form: ExtractionForm; progress: ProgressRow[] }) {
  const toast = useToast();
  const all = useQuery({ queryKey: xk.all(projectId, 'rob'), queryFn: () => getAll(projectId, 'rob') });
  const details = useQuery({
    queryKey: ['rob-plot-details', projectId, progress.map((p) => p.reference_id).join()],
    queryFn: () => studyDetails(progress.filter((p) => p.has_final).map((p) => p.reference_id)),
  });
  const tlRef = useRef<SVGSVGElement>(null);
  const sumRef = useRef<SVGSVGElement>(null);
  if (!all.data || !details.data) return <div className="p-6"><Spinner /></div>;

  const bySeq = new Map(progress.map((p) => [p.reference_id, p.seq]));
  const dets = new Map(details.data.map((d) => [d.id, d]));
  const studies = all.data.finals
    .filter((f) => bySeq.has(f.reference_id))
    .sort((a, b) => bySeq.get(a.reference_id)! - bySeq.get(b.reference_id)!)
    .map((f) => {
      const d = dets.get(f.reference_id);
      return { label: d ? `#${d.seq} ${studyLabel(d.authors, d.year)}` : `#${bySeq.get(f.reference_id)}`, data: f.data };
    });
  if (!studies.length) {
    return <EmptyState title="No agreed appraisals yet">The plot shows studies once both reviewers have appraised them and the final judgement is saved.</EmptyState>;
  }
  const tl = trafficLight(form, studies);
  const base = `${safeFileName(title)}_risk_of_bias`;
  const png = async (el: SVGSVGElement | null, name: string) => {
    if (!el) return;
    try {
      const blob = await svgToPng(el, 3);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {
      toast('Could not make the PNG. Download the SVG instead.', { kind: 'error' });
    }
  };

  return (
    <div className="space-y-4" data-testid="rob-plot">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold text-ink-900">Traffic-light plot ({studies.length} stud{studies.length === 1 ? 'y' : 'ies'} with an agreed appraisal)</h3>
          <Button size="sm" variant="secondary" onClick={() => tlRef.current && downloadText(`${base}_traffic_light.svg`, svgMarkup(tlRef.current), 'image/svg+xml')} data-testid="rob-svg">SVG</Button>
          <Button size="sm" variant="secondary" onClick={() => png(tlRef.current, `${base}_traffic_light`)}>PNG</Button>
        </div>
        <div className="overflow-x-auto"><TrafficLightSvg ref={tlRef} tl={tl} /></div>
        <ul className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          {tl.columns.filter((c) => c.short !== 'Overall').map((c) => <li key={c.key}><span className="font-semibold">{c.short}</span> {c.label}</li>)}
        </ul>
      </Card>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold text-ink-900">Summary plot (share of studies per answer)</h3>
          <Button size="sm" variant="secondary" onClick={() => sumRef.current && downloadText(`${base}_summary.svg`, svgMarkup(sumRef.current), 'image/svg+xml')}>SVG</Button>
          <Button size="sm" variant="secondary" onClick={() => png(sumRef.current, `${base}_summary`)}>PNG</Button>
        </div>
        <div className="overflow-x-auto"><SummarySvg ref={sumRef} form={form} tl={tl} /></div>
      </Card>
    </div>
  );
}
