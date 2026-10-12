import { forwardRef } from 'react';
import type { PrismaCounts } from '../lib/methods/prisma';

// Standard PRISMA 2020 layout (Page et al., BMJ 2021;372:n71): white boxes with
// black outlines, phase labels on the left, arrows down the main column and to the
// side boxes. Literal colours on purpose: the SVG is exported as a stand-alone figure.
const W = 1000, BAND_X = 8, BAND_W = 34, MAIN_X = 60, SIDE_X = 548, BOX_W = 420;
const PAD = 12, LINE = 19, GAP = 42, FONT = 14, CHARS = 52;

const n = (v: number) => `(n\u00a0=\u00a0${v.toLocaleString('en-US')})`; // non-breaking: never split across lines

export function wrap(text: string, max = CHARS): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > max && line) { out.push(line); line = word; } else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out;
}

interface Box { lines: string[]; boldFirst?: boolean }
const box = (text: string, boldFirst = false): Box => ({ lines: wrap(text), boldFirst });
const boxH = (b: Box) => PAD * 2 + b.lines.length * LINE;

function BoxEl({ b, x, y, h }: { b: Box; x: number; y: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={BOX_W} height={h} fill="#ffffff" stroke="#1f2937" strokeWidth="1.5" />
      <text x={x + PAD} y={y + PAD + FONT} fontSize={FONT} fill="#111827" fontFamily="Arial, Helvetica, sans-serif">
        {b.lines.map((l, i) => (
          <tspan key={i} x={x + PAD} dy={i === 0 ? 0 : LINE} fontWeight={b.boldFirst && i === 0 ? 700 : 400}>{l}</tspan>
        ))}
      </text>
    </g>
  );
}

const arrowDown = (x: number, y1: number, y2: number) => <line x1={x} y1={y1} x2={x} y2={y2 - 2} stroke="#1f2937" strokeWidth="1.5" markerEnd="url(#prisma-arrow)" />;
const arrowRight = (y: number) => <line x1={MAIN_X + BOX_W} y1={y} x2={SIDE_X - 2} y2={y} stroke="#1f2937" strokeWidth="1.5" markerEnd="url(#prisma-arrow)" />;

export const PrismaDiagram = forwardRef<SVGSVGElement, { c: PrismaCounts; title?: string }>(function PrismaDiagram({ c, title }, ref) {
  const idLines = [
    'Records identified from*:',
    ...c.databases.map((d) => `${d.name} ${n(d.n)}`),
    `Registers ${n(c.registers)}`,
    ...c.otherSources.map((o) => `${o.name} ${n(o.n)}`),
  ];
  const rows: { phase: 'Identification' | 'Screening' | 'Included'; main: Box; side?: Box }[] = [
    {
      phase: 'Identification',
      main: { lines: idLines.flatMap((l) => wrap(l)), boldFirst: true },
      side: {
        lines: ['Records removed before screening:', ...wrap(`Duplicate records removed ${n(c.duplicates)}`),
          ...wrap(`Records marked as ineligible by automation tools ${n(c.automation)}`),
          ...wrap(`Records removed for other reasons ${n(c.otherRemoved)}`)],
        boldFirst: true,
      },
    },
    { phase: 'Screening', main: box(`Records screened\n${n(c.screened)}`), side: box(`Records excluded**\n${n(c.excludedScreening)}`) },
  ];
  if (c.stage2) {
    rows.push(
      { phase: 'Screening', main: box(`Reports sought for retrieval\n${n(c.sought)}`), side: box(`Reports not retrieved\n${n(c.notRetrieved)}`) },
      {
        phase: 'Screening',
        main: box(`Reports assessed for eligibility\n${n(c.assessed)}`),
        side: { lines: ['Reports excluded:', ...(c.excludedReasons.length ? c.excludedReasons.flatMap((r) => wrap(`${r.reason} ${n(r.n)}`)) : ['None'])], boldFirst: true },
      },
    );
  }
  rows.push({ phase: 'Included', main: box(`Studies included in review\n${n(c.included)}\nReports of included studies\n${n(c.reportsOfIncluded)}`) });

  const top = title ? 44 : 16;
  let y = top;
  const placed = rows.map((r) => {
    const h = Math.max(boxH(r.main), r.side ? boxH(r.side) : 0);
    const out = { ...r, y, h, mainH: boxH(r.main), sideH: r.side ? boxH(r.side) : 0 };
    y += h + GAP;
    return out;
  });
  const notesY = y - GAP + 28;
  const H = notesY + 52;
  const phases = (['Identification', 'Screening', 'Included'] as const).map((p) => {
    const rs = placed.filter((r) => r.phase === p);
    return { p, y1: rs[0].y, y2: rs[rs.length - 1].y + rs[rs.length - 1].h };
  });

  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="h-auto w-full max-w-full bg-white"
      role="img" aria-label={`PRISMA 2020 flow diagram: ${c.identified} records identified, ${c.screened} screened, ${c.included} studies included`}>
      <defs>
        <marker id="prisma-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#1f2937" />
        </marker>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      {title && <text x={W / 2} y={28} textAnchor="middle" fontSize="16" fontWeight="700" fill="#111827" fontFamily="Arial, Helvetica, sans-serif">{title}</text>}

      {phases.map(({ p, y1, y2 }) => (
        <g key={p}>
          <rect x={BAND_X} y={y1} width={BAND_W} height={y2 - y1} rx="6" fill="#cfe0f3" />
          <text transform={`translate(${BAND_X + BAND_W / 2 + 5}, ${(y1 + y2) / 2}) rotate(-90)`} textAnchor="middle" fontSize="14" fontWeight="700" fill="#1e3a5f" fontFamily="Arial, Helvetica, sans-serif">{p}</text>
        </g>
      ))}

      {placed.map((r, i) => {
        const next = placed[i + 1];
        const mid = r.y + r.mainH / 2;
        return (
          <g key={i}>
            <BoxEl b={r.main} x={MAIN_X} y={r.y} h={r.mainH} />
            {r.side && <BoxEl b={r.side} x={SIDE_X} y={r.y} h={r.sideH} />}
            {r.side && arrowRight(Math.min(mid, r.y + r.sideH / 2))}
            {next && arrowDown(MAIN_X + BOX_W / 2, r.y + r.mainH, next.y)}
          </g>
        );
      })}

      <text x={MAIN_X} y={notesY} fontSize="11" fill="#374151" fontFamily="Arial, Helvetica, sans-serif">
        <tspan x={MAIN_X}>*Records identified from each database or register searched. **Excluded by human reviewers; no records were excluded by automation tools</tspan>
        <tspan x={MAIN_X} dy="15">unless stated above. Adapted from: Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement. BMJ 2021;372:n71.</tspan>
      </text>
    </svg>
  );
});

/** Serialise the rendered diagram for download. */
export function svgMarkup(el: SVGSVGElement): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(el);
}

export async function svgToPng(el: SVGSVGElement, scale = 2): Promise<Blob> {
  const w = Number(el.getAttribute('width')), h = Number(el.getAttribute('height'));
  const url = URL.createObjectURL(new Blob([svgMarkup(el)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('render failed')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('png failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
