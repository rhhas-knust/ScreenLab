// Calculated scores and piping. Researchers write Q2 + Q3 or {Q2}; we store
// stable field ids (@<id> and {@<id>}) so moving questions never breaks a
// formula. Evaluation is a small arithmetic parser — never eval().
import { isFileAnswer, type AnswerValue, type RhField } from '../api/research';

type Ref = Pick<RhField, 'id' | 'type' | 'options' | 'settings'>;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// ---------------------------------------------------------------------------
// Q-number ⇄ field-id references
// ---------------------------------------------------------------------------

/** Stored → shown: {@id} → {Q2} in labels; @id_3 → Q2_3 in formulas. Unknown ids show as {deleted question}. */
export function refsToDisplay(text: string, fields: Pick<RhField, 'id'>[]): string {
  const n = (id: string) => fields.findIndex((f) => f.id === id);
  return text
    .replace(new RegExp(`\\{@(${UUID})\\}`, 'gi'), (_, id) => (n(id) < 0 ? '{deleted question}' : `{Q${n(id) + 1}}`))
    .replace(new RegExp(`@(${UUID})(_\\d+)?`, 'gi'), (_, id, part = '') => (n(id) < 0 ? 'Q?' : `Q${n(id) + 1}${part}`));
}

/** Shown → stored. `formula` mode turns bare Q2 into @id; label mode only touches {Q2}. Q numbers that do not exist are left as typed. */
export function refsToStored(text: string, fields: Pick<RhField, 'id'>[], formula = false): string {
  const id = (q: string) => fields[Number(q) - 1]?.id;
  let out = text.replace(/\{Q(\d+)\}/gi, (m, q) => (id(q) ? `{@${id(q)}}` : m));
  if (formula) out = out.replace(/\bQ(\d+)(_\d+)?\b/gi, (m, q, part = '') => (id(q) ? `@${id(q)}${part}` : m));
  return out;
}

/** Field ids a formula or label refers to. */
export function referencedIds(text: string): string[] {
  return [...new Set([...text.matchAll(new RegExp(`@(${UUID})`, 'gi'))].map((m) => m[1].toLowerCase()))];
}

// ---------------------------------------------------------------------------
// Values of answers inside a formula
// ---------------------------------------------------------------------------

/**
 * The number an answer counts as: numbers as they are; a single choice by its
 * number if the option is one ("4") or else its position (1 = first option);
 * checkboxes by how many were ticked; grid rows by the column's position;
 * rankings (Q5_2) by the rank of that option. Blank → null.
 */
export function numericValue(f: Ref, v: AnswerValue | undefined, part?: number): number | null {
  if (v == null || v === '' || isFileAnswer(v)) return null;
  const pos = (o: string) => { const i = f.options.indexOf(o); return i < 0 ? null : Number.isFinite(Number(o)) && o.trim() !== '' ? Number(o) : i + 1; };
  switch (f.type) {
    case 'number': case 'scale': case 'calc': { const n = Number(v); return Number.isFinite(n) ? n : null; }
    case 'radio': return pos(String(v));
    case 'checkbox': return Array.isArray(v) ? v.length : null;
    case 'grid': {
      if (typeof v !== 'object' || Array.isArray(v)) return null;
      const rows = f.settings?.rows ?? [];
      const g = v as Record<string, string>;
      if (part) { const c = g[rows[part - 1]]; return c == null ? null : pos(c); }
      const xs = rows.map((r) => (g[r] == null ? null : pos(g[r]))).filter((x): x is number => x != null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
    }
    case 'ranking': {
      if (!Array.isArray(v)) return null;
      if (!part) return null;
      const k = v.indexOf(f.options[part - 1]);
      return k < 0 ? null : k + 1;
    }
    default: { const n = Number(v); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; }
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type Tok = { t: 'num'; v: number } | { t: 'ref'; id: string; part?: number } | { t: 'fn'; v: string } | { t: 'op'; v: string };
type Node =
  | { k: 'num'; v: number }
  | { k: 'ref'; id: string; part?: number }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

const FNS = ['sum', 'mean', 'avg', 'min', 'max', 'count', 'round', 'abs', 'if'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = new RegExp(`\\s*(?:(\\d+(?:\\.\\d+)?)|@(${UUID})(?:_(\\d+))?|([A-Za-z][A-Za-z0-9_]*)|(<=|>=|==|!=|[-+*/^(),<>]))`, 'giy');
  let i = 0;
  while (i < src.length) {
    if (/^\s+$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`Cannot read “${src.slice(i).trim().slice(0, 12)}”`);
    i = re.lastIndex;
    if (m[1] != null) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] != null) out.push({ t: 'ref', id: m[2].toLowerCase(), part: m[3] ? Number(m[3]) : undefined });
    else if (m[4] != null) {
      const w = m[4].toLowerCase();
      if (/^q\d+(_\d+)?$/.test(w)) throw new Error(`${m[4].toUpperCase()} is not a question in this form`);
      if (!FNS.includes(w)) throw new Error(`Unknown word “${m[4]}”. Use question numbers (Q2), numbers and sum, mean, min, max, count, round, abs, if`);
      out.push({ t: 'fn', v: w });
    } else out.push({ t: 'op', v: m[5] });
  }
  return out;
}

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  if (!toks.length) throw new Error('The formula is empty');
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`Expected “${v}”`); p++; };
  const cmp = (): Node => {
    let a = add();
    while (peek()?.t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes((peek() as { v: string }).v)) { const op = (toks[p++] as { v: string }).v; a = { k: 'bin', op, a, b: add() }; }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (isOp('+') || isOp('-')) { const op = (toks[p++] as { v: string }).v; a = { k: 'bin', op, a, b: mul() }; }
    return a;
  };
  const mul = (): Node => {
    let a = pow();
    while (isOp('*') || isOp('/')) { const op = (toks[p++] as { v: string }).v; a = { k: 'bin', op, a, b: pow() }; }
    return a;
  };
  const pow = (): Node => {
    const a = unary();
    if (isOp('^')) { p++; return { k: 'bin', op: '^', a, b: pow() }; }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) { p++; return { k: 'neg', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return atom();
  };
  const atom = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error('The formula ends too early');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'ref') return { k: 'ref', id: t.id, part: t.part };
    if (t.t === 'fn') {
      expect('(');
      const args: Node[] = [];
      if (!isOp(')')) { args.push(cmp()); while (isOp(',')) { p++; args.push(cmp()); } }
      expect(')');
      if (t.v === 'if' && args.length !== 3) throw new Error('if needs three parts: if(condition, then, else)');
      if ((t.v === 'abs') && args.length !== 1) throw new Error(`${t.v} needs one value`);
      if (t.v === 'round' && (args.length < 1 || args.length > 2)) throw new Error('round needs a value and optionally decimals');
      if (!args.length) throw new Error(`${t.v} needs at least one value`);
      return { k: 'call', fn: t.v, args };
    }
    if (t.v === '(') { const e = cmp(); expect(')'); return e; }
    throw new Error(`Unexpected “${t.v}”`);
  };
  const tree = cmp();
  if (p < toks.length) throw new Error(`Unexpected “${(toks[p] as { v?: string }).v ?? 'value'}”`);
  return tree;
}

/** Problems with a stored formula, for the builder: syntax, unknown or later questions, unusable types. */
export function formulaProblem(formula: string | undefined, fields: Ref[], selfIndex: number): string | null {
  if (!formula?.trim()) return 'Write a formula, e.g. Q2 + Q3.';
  try { parseFormula(formula); } catch (e) { return (e as Error).message; }
  for (const id of referencedIds(formula)) {
    const j = fields.findIndex((f) => f.id === id);
    if (j < 0) return 'It refers to a question that was deleted.';
    if (j >= selfIndex) return `It refers to Q${j + 1}, which comes after it. Move the score below the questions it uses.`;
    if (['text', 'textarea', 'email', 'date', 'file', 'signature'].includes(fields[j].type)) return `Q${j + 1} is not a number, choice or scale question.`;
  }
  return null;
}

/** Evaluate a formula against one respondent's answers. Blank answers make arithmetic blank, but sum/mean/count/min/max skip them. */
export function evaluate(formula: string, fields: Ref[], answers: Record<string, AnswerValue>): number | null {
  let tree: Node;
  try { tree = parseFormula(formula); } catch { return null; }
  const byId = new Map(fields.map((f) => [f.id.toLowerCase(), f]));
  const ev = (n: Node): number | null => {
    switch (n.k) {
      case 'num': return n.v;
      case 'ref': { const f = byId.get(n.id); return f ? numericValue(f, answers[f.id], n.part) : null; }
      case 'neg': { const a = ev(n.a); return a == null ? null : -a; }
      case 'bin': {
        const a = ev(n.a), b = ev(n.b);
        if (a == null || b == null) return null;
        switch (n.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return b === 0 ? null : a / b;
          case '^': return a ** b;
          case '<': return a < b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '==': return a === b ? 1 : 0;
          case '!=': return a !== b ? 1 : 0;
        }
        return null;
      }
      case 'call': {
        if (n.fn === 'if') { const c = ev(n.args[0]); return c == null ? null : ev(c ? n.args[1] : n.args[2]); }
        if (n.fn === 'round') { const a = ev(n.args[0]); const d = n.args[1] ? ev(n.args[1]) ?? 0 : 0; return a == null ? null : Math.round(a * 10 ** d) / 10 ** d; }
        if (n.fn === 'abs') { const a = ev(n.args[0]); return a == null ? null : Math.abs(a); }
        const xs = n.args.map(ev).filter((x): x is number => x != null && Number.isFinite(x));
        if (n.fn === 'count') return xs.length;
        if (!xs.length) return null;
        if (n.fn === 'sum') return xs.reduce((a, b) => a + b, 0);
        if (n.fn === 'mean' || n.fn === 'avg') return xs.reduce((a, b) => a + b, 0) / xs.length;
        if (n.fn === 'min') return Math.min(...xs);
        if (n.fn === 'max') return Math.max(...xs);
        return null;
      }
    }
  };
  const r = ev(tree);
  return r == null || !Number.isFinite(r) ? null : r;
}

/** Answers with every calculated score filled in (scores may use earlier scores). */
export function withScores<A extends Record<string, AnswerValue>>(fields: Ref[], answers: A): A {
  const calcs = fields.filter((f) => f.type === 'calc' && f.settings?.formula);
  if (!calcs.length) return answers;
  const out: Record<string, AnswerValue> = { ...answers };
  for (const f of calcs) {
    const v = evaluate(f.settings!.formula!, fields, out);
    const d = f.settings?.decimals ?? 2;
    if (v == null) delete out[f.id]; else out[f.id] = Math.round(v * 10 ** d) / 10 ** d;
  }
  return out as A;
}

/** Responses with their scores, for statistics, CSV and charts. */
export function scoreResponses<R extends { answers: Record<string, AnswerValue> }>(fields: Ref[], responses: R[]): R[] {
  if (!fields.some((f) => f.type === 'calc')) return responses;
  return responses.map((r) => ({ ...r, answers: withScores(fields, r.answers) }));
}

/** Piping: replace {@id} in a label with that question's answer (or a blank line when unanswered). */
export function pipe(text: string, answers: Record<string, AnswerValue>, fields: Pick<RhField, 'id'>[], label: (id: string, v: AnswerValue) => string): string {
  if (!text.includes('{')) return text;
  return text
    .replace(new RegExp(`\\{@(${UUID})\\}`, 'gi'), (_, id) => { const v = answers[id] ?? answers[id.toLowerCase()]; return v == null || v === '' ? '___' : label(id, v); })
    .replace(/\{Q(\d+)\}/gi, (m, q) => { const f = fields[Number(q) - 1]; const v = f && answers[f.id]; return !f ? m : v == null || v === '' ? '___' : label(f.id, v); });
}

/** Random order of items (Fisher–Yates) using the given random source. */
export function shuffle<T>(xs: T[], rand: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Question order for one respondent when randomisation is on. A question and
 * the questions that depend on it (skip logic) move together as a block, so a
 * follow-up always comes straight after its question. Scores stay at the end.
 */
export function randomOrder<F extends Pick<RhField, 'id' | 'type' | 'settings'>>(fields: F[], rand: () => number = Math.random): F[] {
  const blocks: F[][] = [];
  const blockOf = new Map<string, F[]>();
  const calcs: F[] = [];
  for (const f of fields) {
    if (f.type === 'calc') { calcs.push(f); continue; }
    const parent = f.settings?.show_if?.field;
    const b = parent ? blockOf.get(parent) : undefined;
    if (b) { b.push(f); blockOf.set(f.id, b); } else { const nb = [f]; blocks.push(nb); blockOf.set(f.id, nb); }
  }
  return [...shuffle(blocks, rand).flat(), ...calcs];
}

/** Option order for one respondent: shuffled, optionally keeping the last option (e.g. “Other”) last. */
export function optionOrder(options: string[], keepLast: boolean, rand: () => number = Math.random): string[] {
  if (options.length < 2) return options;
  return keepLast ? [...shuffle(options.slice(0, -1), rand), options[options.length - 1]] : shuffle(options, rand);
}
