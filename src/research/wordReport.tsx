// The Word (.docx) findings report: the same numbers as the Summary tab and
// the printable report, with charts as pictures, the AI summary and a methods
// paragraph a student can adapt for a thesis. Loaded only when asked for, so
// the docx library never slows down the rest of ResearchHub.
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { FIELD_LABEL, type DashboardItem, type RhField, type RhProject, type RhResponse, type RhSummary } from '../lib/api/research';
import { fieldStats, overview, round, type FieldStats } from '../lib/research/analytics';
import { buildChart, buildDataset, isNum, type ChartSpec, type Dataset } from '../lib/research/studio';
import { statTile } from '../lib/research/dashboard';
import { refsToDisplay } from '../lib/research/formula';
import type { WeightResult } from '../lib/research/weights';
import { H, StudioFigure, W, markupToPng } from './StudioFigure';

export interface WordReportInput {
  project: RhProject;
  fields: RhField[];
  /** Responses analysed (set-aside ones already removed), in submission order, with scores. */
  responses: RhResponse[];
  setAside: number;
  weights: Map<string, number> | null;
  weighting: WeightResult | null;
  summary: RhSummary | null;
  dashboard: DashboardItem[];
}

const INK = '16325C', MUTED = '64748B';
const IMG_W = 600, IMG_H = Math.round((600 * H) / W);
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const n2 = (v: number | null | undefined) => (v == null ? '—' : String(round(v, 2)));

/** Render a Chart studio chart off-screen and turn it into PNG bytes. */
async function chartPng(spec: ChartSpec, ds: Dataset): Promise<Uint8Array | null> {
  const chart = buildChart(spec, ds);
  if (chart.model.kind === 'empty') return null;
  const html = renderToStaticMarkup(<StudioFigure chart={chart} />);
  const svg = html.match(/<svg[\s\S]*<\/svg>/)?.[0];
  if (!svg) return null;
  try {
    return new Uint8Array(await (await markupToPng(svg, 2)).arrayBuffer());
  } catch {
    return null;
  }
}
const image = (data: Uint8Array) => new Paragraph({ children: [new ImageRun({ type: 'png', data, transformation: { width: IMG_W, height: IMG_H } })], spacing: { after: 200 } });

const p = (text: string, opts: { muted?: boolean; bold?: boolean; italics?: boolean; size?: number } = {}) =>
  new Paragraph({ children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, color: opts.muted ? MUTED : undefined, size: opts.size })], spacing: { after: 120 } });
const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });

function table(rows: (string | number)[][], opts: { firstColWide?: boolean } = {}): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: r.map((c, j) => new TableCell({
        shading: i === 0 ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' } : undefined,
        width: opts.firstColWide && j === 0 ? { size: 45, type: WidthType.PERCENTAGE } : undefined,
        children: [new Paragraph({ alignment: j > 0 && typeof c === 'number' ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: String(c), bold: i === 0, size: 20 })] })],
      })),
    })),
  });
}

function statsTable(s: FieldStats): (string | number)[][] | null {
  const pctHead = s.weighted ? '% (weighted)' : '%';
  switch (s.kind) {
    case 'choice': case 'multi':
      return [['Answer', 'People', pctHead], ...s.bars.map((b) => [b.label, b.count, `${b.pct}%`])];
    case 'numeric':
      return [[s.weighted ? 'Mean (weighted)' : 'Mean', s.weighted ? 'SD (weighted)' : 'SD', 'Median', 'Min', 'Max', 'n'], [n2(s.mean), n2(s.sd), n2(s.median), n2(s.min), n2(s.max), s.answered]];
    case 'grid':
      return [['Statement', ...s.columns, 'n'], ...s.rows.map((r) => [r.label, ...r.cells.map((c) => `${c.count} (${c.pct}%)`), r.answered])];
    case 'ranking':
      return [['Option (best first)', 'Mean rank', 'Ranked first'], ...s.items.map((it) => [it.label, n2(it.meanRank), `${it.first} (${it.firstPct}%)`])];
    case 'date':
      return [['Earliest', 'Latest'], [s.earliest ?? '—', s.latest ?? '—']];
    default:
      return s.themes?.length ? [['Theme (from your coding)', 'Answers', '%'], ...s.themes.map((t) => [t.code, t.count, `${t.pct}%`])] : null;
  }
}

/** A chart that suits each question in the report (bar for choices, histogram for numbers). */
function chartFor(index: number, ds: Dataset): ChartSpec | null {
  const name = `Q${index + 1}`;
  const v = ds.vars.find((x) => x.name === name);
  if (!v) return null;
  if (v.kind === 'categorical' || v.kind === 'multi') return { type: v.categories.length > 6 ? 'barh' : 'bar', x: name, percent: true };
  if (v.scale) return { type: 'bar', x: name, percent: true };
  if (isNum(v)) return { type: 'histogram', x: name };
  return null;
}

function methodsText(input: WordReportInput, ov: ReturnType<typeof overview>): string {
  const { project, responses, setAside, weighting, weights, fields } = input;
  const parts = [`Data were collected with an online questionnaire built in ResearchHub (ScreenLab)${ov.first ? ` between ${date(ov.first)} and ${date(ov.last)}` : ''}.`];
  if (project.consent_text?.trim()) parts.push('Participants read an information sheet and gave consent before seeing the questions; the time of consent was recorded with each response.');
  parts.push(`${responses.length + setAside} responses were received.`);
  if (setAside) parts.push(`${setAside} ${setAside === 1 ? 'was' : 'were'} set aside before analysis after data-quality checks (very short completion times, identical answers to every item, duplicates or mostly blank responses), leaving ${responses.length} for analysis.`);
  parts.push('Percentages are of the respondents who answered each question; respondents who were not shown a question because of skip logic are not counted.');
  if (weights && weighting) {
    const vars = (project.analysis?.weighting?.targets ?? []).map((t) => { const i = fields.findIndex((f) => f.id === t.field); return i >= 0 ? `Q${i + 1} (${fields[i].label})` : null; }).filter(Boolean);
    parts.push(`Results were weighted to known population proportions on ${vars.join(' and ')} by raking (iterative proportional fitting); the design effect was ${weighting.deff}, giving an effective sample size of ${Math.round(weighting.neff)}. Counts of people are unweighted; percentages and means are weighted.`);
  }
  parts.push('Means are reported with the sample standard deviation (SD).');
  return parts.join(' ');
}

export async function buildWordReport(input: WordReportInput): Promise<Blob> {
  const { project, fields: rawFields, responses, weights, summary, dashboard } = input;
  const fields = rawFields.map((f) => ({ ...f, label: refsToDisplay(f.label, rawFields) }));
  const ov = overview(fields, responses);
  const ds = buildDataset(rawFields, responses, weights);
  const body: (Paragraph | Table)[] = [];
  const meta = [project.university, project.department, project.year].filter(Boolean).join(' · ');

  body.push(new Paragraph({ text: project.title, heading: HeadingLevel.TITLE }));
  if (meta) body.push(p(meta, { muted: true }));
  body.push(p(`${responses.length} response${responses.length === 1 ? '' : 's'} analysed${ov.first ? ` · collected ${date(ov.first)}${ov.last && ov.last.slice(0, 10) !== ov.first.slice(0, 10) ? ` to ${date(ov.last)}` : ''}` : ''} · average completion ${ov.completion}%${input.setAside ? ` · ${input.setAside} set aside` : ''}${weights ? ' · weighted' : ''}`, { muted: true }));
  if (project.description) body.push(p(project.description));

  if (summary) {
    body.push(h('Summary of findings', HeadingLevel.HEADING_1));
    body.push(p(summary.summary.headline, { bold: true }));
    summary.summary.key_findings.forEach((k) => body.push(bullet(k)));
    if (summary.summary.open_text_themes.length) {
      body.push(p('Themes in written answers', { bold: true }));
      summary.summary.open_text_themes.forEach((t) => body.push(bullet(`${t.theme}: ${t.detail}`)));
    }
    if (summary.summary.limitations.length) {
      body.push(p('Limitations', { bold: true }));
      summary.summary.limitations.forEach((l) => body.push(bullet(l)));
    }
    body.push(p(`Drafted by AI from ${summary.response_count} responses on ${date(summary.created_at)}; check every statement against the results below.`, { muted: true, italics: true, size: 18 }));
  }

  if (dashboard.length) {
    body.push(h('Dashboard', HeadingLevel.HEADING_1));
    const tiles = dashboard.filter((d): d is Extract<DashboardItem, { kind: 'stat' }> => d.kind === 'stat');
    if (tiles.length) body.push(table([['Measure', 'Value'], ...tiles.map((t) => { const v = statTile(t, ds, ov.completion); return [v.sub ? `${v.label} (${v.sub})` : v.label, v.value]; })], { firstColWide: true }));
    for (const c of dashboard.filter((d): d is Extract<DashboardItem, { kind: 'chart' }> => d.kind === 'chart')) {
      const png = await chartPng(c.spec, ds);
      if (png) body.push(image(png));
    }
  }

  body.push(h('Results by question', HeadingLevel.HEADING_1));
  for (const [i, f] of fields.entries()) {
    const s = fieldStats(rawFields[i], responses, weights);
    body.push(h(`Q${i + 1}. ${f.label}`, HeadingLevel.HEADING_2));
    body.push(p(`${FIELD_LABEL[f.type]} · ${s.answered} of ${s.answered + s.missing} answered`, { muted: true, size: 18 }));
    if (s.answered === 0) { body.push(p('No answers yet.', { muted: true })); continue; }
    if (s.kind === 'files') { body.push(p(`${s.answered} ${f.type === 'signature' ? 'signatures' : 'files'} received (kept privately in ResearchHub).`)); continue; }
    if (f.type === 'email') { body.push(p('Email addresses are not reported.', { muted: true })); continue; }
    const t = statsTable(s);
    if (t) body.push(table(t, { firstColWide: true }));
    else if (s.kind === 'text') body.push(p(`${s.answered} written answers — see the responses download; code them into themes in ResearchHub to summarise them here.`, { muted: true }));
    if (s.kind === 'multi') body.push(p('Respondents could tick more than one option, so percentages can add up to more than 100%.', { muted: true, size: 18 }));
    const spec = chartFor(i, ds);
    if (spec) {
      const png = await chartPng(spec, ds);
      if (png) body.push(image(png));
    }
  }

  body.push(h('Methods note', HeadingLevel.HEADING_1));
  body.push(p(methodsText(input, ov)));
  body.push(p(`Report generated ${new Date().toLocaleString('en-GB')} with ResearchHub (ScreenLab).`, { muted: true, size: 18 }));

  const doc = new Document({
    creator: 'ResearchHub (ScreenLab)',
    title: project.title,
    description: 'Survey findings report',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 40, bold: true, color: INK } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { size: 30, bold: true, color: INK } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { size: 24, bold: true, color: INK } },
      ],
    },
    sections: [{ properties: {}, children: body }],
  });
  return Packer.toBlob(doc);
}
