import { useEffect, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getAiDisclosure, listDecisions, listSources, mk, prismaManual } from '../lib/api/methods';
import { prosperoFields, prosperoSaved } from '../lib/methods/prospero';
import { buildProtocol, buildSearchStrategy, TO_COMPLETE, type Block } from '../lib/methods/reports';
import { fmtDate, useProject, useSettings, useStats } from '../lib/hooks';
import { Alert, Button, cx, PageLoader } from '../components/ui';

/** Highlights "[to complete]" and other [placeholders] so they are hard to miss before submitting. */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]{4,}\])/g);
  return <>{parts.map((p, i) => (/^\[[^\]]{4,}\]$/.test(p) ? <mark key={i} className="bg-amber-100 px-0.5 text-amber-900">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

/**
 * Print-ready page. The browser's print dialog ("Save as PDF") makes the PDF, so the
 * document looks exactly like the screen and no PDF library ships to every visitor.
 */
function ReportFrame({ projectId, back, docTitle, missing, testid, children }: {
  projectId: string; back: string; docTitle: string; missing: string[]; testid: string; children: ReactNode;
}) {
  useEffect(() => {
    document.title = docTitle;
    return () => { document.title = 'ScreenLab'; };
  }, [docTitle]);
  return (
    <div className="min-h-full bg-slate-100 print:bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 print:hidden">
        <Link to={`/p/${projectId}/methods${back}`} className="text-sm text-slate-600 hover:underline">← Back to Methods</Link>
        <span className="flex-1" />
        <span className="hidden text-xs text-slate-500 sm:inline">In the print dialog choose “Save as PDF”.</span>
        <Button variant="primary" onClick={() => window.print()} data-testid="report-print">Save as PDF</Button>
      </div>
      {missing.length > 0 && (
        <div className="mx-auto max-w-3xl px-4 pt-4 print:hidden">
          <Alert kind="warning">
            <p className="font-medium">Complete these before you submit ({missing.length}):</p>
            <ul className="mt-1 list-disc pl-5" data-testid="report-missing">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </Alert>
        </div>
      )}
      <main className="mx-auto max-w-3xl space-y-5 bg-white p-6 text-[0.95rem] leading-relaxed text-slate-900 sm:my-4 sm:rounded-xl sm:p-10 print:my-0 print:max-w-none print:p-0" data-testid={testid}>
        {children}
      </main>
    </div>
  );
}

const th = 'border border-slate-400 bg-slate-100 px-2 py-1 text-left align-top font-semibold';
const td = 'border border-slate-400 px-2 py-1 align-top';

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case 'text':
      return <p className="whitespace-pre-line"><Marked text={b.text} /></p>;
    case 'fields':
      return (
        <table className="w-full border-collapse text-sm">
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.label} className="break-inside-avoid"><th className={cx(th, 'w-48')}>{r.label}</th><td className={cx(td, 'whitespace-pre-line')}><Marked text={r.text} /></td></tr>
            ))}
          </tbody>
        </table>
      );
    case 'list':
      return (
        <div>
          <p className="font-semibold">{b.title}</p>
          <ol className="list-decimal space-y-0.5 pl-6">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </div>
      );
    case 'table':
      return (
        <table className="w-full border-collapse text-sm">
          <thead><tr>{b.head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i} className="break-inside-avoid">{r.map((c, j) => <td key={j} className={td}><Marked text={c} /></td>)}</tr>)}</tbody>
        </table>
      );
  }
}

export function SearchStrategyPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const settings = useSettings(projectId);
  const sources = useQuery({ queryKey: mk.sources(projectId), queryFn: () => listSources(projectId) });
  if (!project.data || !settings.data || !sources.data) return <PageLoader label="Preparing search strategy…" />;
  const saved = prosperoSaved(settings.data);
  const doc = buildSearchStrategy(sources.data, prismaManual(settings.data).duplicates_before_import);
  const title = saved.answers.title?.trim() || project.data.title;

  return (
    <ReportFrame projectId={projectId} back="?tab=search" docTitle={`${project.data.title} — search strategy`} missing={doc.missing} testid="search-strategy-doc">
      <header className="space-y-1 border-b border-slate-300 pb-3">
        <h1 className="text-2xl font-semibold">Search strategy</h1>
        <p><span className="font-semibold">Review:</span> {title}</p>
        {saved.registration_id && <p><span className="font-semibold">Registration:</span> PROSPERO {saved.registration_id}</p>}
      </header>
      {doc.rows.length === 0 ? (
        <Alert kind="info">No sources yet. Add each database you searched in Methods → Search log.</Alert>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Summary of searches</h2>
            <table className="w-full border-collapse text-sm">
              <thead><tr>{['Source', 'Date searched', 'Limits applied', 'Records'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {doc.rows.map((r) => (
                  <tr key={r.name}><td className={td}>{r.name}{r.kind !== 'database' && <span className="text-slate-500"> ({r.kind})</span>}</td><td className={td}><Marked text={r.date} /></td><td className={td}>{r.limits}</td><td className={cx(td, 'text-right tabular-nums')}><Marked text={r.records} /></td></tr>
                ))}
                {doc.total != null && <tr><td className={cx(td, 'font-semibold')} colSpan={3}>Total records identified</td><td className={cx(td, 'text-right font-semibold tabular-nums')}>{doc.total.toLocaleString('en-US')}</td></tr>}
              </tbody>
            </table>
            {doc.duplicatesNote && <p className="text-sm text-slate-700">{doc.duplicatesNote}</p>}
          </section>
          {doc.details.map((d, i) => (
            <section key={d.name} className="space-y-2">
              <h2 className="border-b border-slate-300 pb-1 text-lg font-semibold">{i + 1}. {d.name}</h2>
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 text-sm">
                <dt className="font-semibold">Date searched</dt><dd><Marked text={d.date} /></dd>
                <dt className="font-semibold">Limits</dt><dd>{d.limits}</dd>
                <dt className="font-semibold">Records</dt><dd><Marked text={d.records} /></dd>
                {d.notes && <><dt className="font-semibold">Notes</dt><dd>{d.notes}</dd></>}
              </dl>
              <pre className="rounded border border-slate-300 bg-slate-50 p-3 font-mono text-[0.8rem] whitespace-pre-wrap" data-testid="strategy-string">{d.strategy === TO_COMPLETE ? <Marked text={d.strategy} /> : d.strategy}</pre>
            </section>
          ))}
          <p className="text-xs text-slate-500">Strategies are reproduced exactly as recorded in the search log. Generated {fmtDate(new Date().toISOString(), false)} with ScreenLab.</p>
        </>
      )}
    </ReportFrame>
  );
}

export function ProtocolPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const settings = useSettings(projectId);
  const stats = useStats(projectId);
  const sources = useQuery({ queryKey: mk.sources(projectId), queryFn: () => listSources(projectId) });
  const decisions = useQuery({ queryKey: mk.decisions(projectId), queryFn: () => listDecisions(projectId) });
  const ai = useQuery({ queryKey: mk.ai(projectId), queryFn: () => getAiDisclosure(projectId) });
  if (!project.data || !settings.data || !stats.data || !sources.data || !decisions.data || ai.isLoading) return <PageLoader label="Preparing protocol…" />;
  const saved = prosperoSaved(settings.data);
  const fields = prosperoFields({ project: project.data, stats: stats.data, sources: sources.data, decisions: decisions.data, ai: ai.data ?? null, screeningMode: settings.data.screening_mode });
  const doc = buildProtocol(project.data, fields, saved, sources.data, decisions.data);

  return (
    <ReportFrame projectId={projectId} back="?tab=prospero" docTitle={`${project.data.title} — protocol`} missing={doc.missing} testid="protocol-doc">
      <header className="space-y-1 border-b border-slate-300 pb-3">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Systematic review protocol</p>
        <h1 className="text-2xl font-semibold"><Marked text={doc.title} /></h1>
        {doc.registration && <p>{doc.registration}</p>}
        <p className="text-sm text-slate-600">Version of {fmtDate(new Date().toISOString(), false)}</p>
      </header>
      {doc.sections.map((s, i) => (
        <section key={s.heading} className="space-y-2">
          <h2 className="text-lg font-semibold">{i + 1}. {s.heading}</h2>
          {s.blocks.map((b, j) => <BlockView key={j} b={b} />)}
        </section>
      ))}
      <p className="text-xs text-slate-500 print:hidden">
        Built from Methods → PROSPERO (your saved answers, or ScreenLab’s drafts), the protocol fields in Settings, the search log and the decision log. Edit the answers there, then come back here.
      </p>
    </ReportFrame>
  );
}
