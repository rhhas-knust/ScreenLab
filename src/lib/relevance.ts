// Predicted relevance, as in Rayyan's 5-star ratings: a logistic-regression
// model learns from the team's include/exclude decisions at a stage and
// scores every record. Pure functions, run in the browser; nothing leaves the
// project. Advisory only: the ratings order the list, they never decide.

export interface Doc { id: string; title: string | null; abstract: string | null; keywords: string | null; label: 0 | 1 | null }

const STOP = new Set(('a an and are as at be been but by for from had has have in into is it its of on or that the their this to was were which with ' +
  'we our not no than these those such can may also using use used based between both all any each other more most study studies results ' +
  'method methods conclusion conclusions background objective objectives aim aims however there they them were will within').split(' '));
const DIM = 1 << 18;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % DIM;
}
export function tokens(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Sparse, L2-normalised TF-IDF vector of words and word pairs; the title counts twice. */
type Vec = { idx: Int32Array; val: Float32Array };
function featurise(docs: Doc[]): Vec[] {
  const raw = docs.map((d) => {
    const t = tokens(d.title ?? ''), a = tokens(d.abstract ?? ''), k = tokens(d.keywords ?? '');
    const terms: string[] = [];
    for (const list of [t, t, a, k]) for (let i = 0; i < list.length; i++) { terms.push(list[i]); if (i + 1 < list.length) terms.push(`${list[i]}_${list[i + 1]}`); }
    const tf = new Map<number, number>();
    for (const term of terms) { const h = hash(term); tf.set(h, (tf.get(h) ?? 0) + 1); }
    return tf;
  });
  const df = new Map<number, number>();
  for (const tf of raw) for (const h of tf.keys()) df.set(h, (df.get(h) ?? 0) + 1);
  const n = docs.length;
  return raw.map((tf) => {
    const idx = new Int32Array(tf.size), val = new Float32Array(tf.size);
    let i = 0, norm = 0;
    for (const [h, c] of tf) { const w = (1 + Math.log(c)) * Math.log((1 + n) / (1 + (df.get(h) ?? 0))); idx[i] = h; val[i] = w; norm += w * w; i++; }
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < val.length; j++) val[j] /= norm;
    return { idx, val };
  });
}

interface Model { w: Float32Array; b: number }
const dot = (m: Model, x: Vec) => { let s = m.b; for (let i = 0; i < x.idx.length; i++) s += m.w[x.idx[i]] * x.val[i]; return s; };
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Logistic regression by SGD, positives weighted up to balance the classes. */
function train(xs: Vec[], ys: (0 | 1)[], epochs = 12, lr = 0.5, l2 = 1e-5): Model {
  const m: Model = { w: new Float32Array(DIM), b: 0 };
  const pos = ys.filter((y) => y === 1).length, neg = ys.length - pos;
  const wPos = pos ? Math.min(20, neg / pos) : 1;
  const order = ys.map((_, i) => i);
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let e = 0; e < epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const rate = lr / (1 + e * 0.5);
    for (const i of order) {
      const x = xs[i], y = ys[i];
      const g = (sigmoid(dot(m, x)) - y) * (y === 1 ? wPos : 1);
      for (let k = 0; k < x.idx.length; k++) { const h = x.idx[k]; m.w[h] -= rate * (g * x.val[k] + l2 * m.w[h]); }
      m.b -= rate * g;
    }
  }
  return m;
}

/** Area under the ROC curve: how often an include scores above an exclude. */
export function auc(scores: number[], labels: (0 | 1)[]): number | null {
  const pos = scores.filter((_, i) => labels[i] === 1), neg = scores.filter((_, i) => labels[i] === 0);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export const MIN_EACH = 5;
export interface RelevanceResult {
  scores: Map<string, number>;
  includes: number;
  excludes: number;
  /** Held-out check (one fifth of the decisions left out of training), when there are enough decisions. */
  auc: number | null;
}

/** Score every record from the decided ones. Throws when there are too few decisions to learn from. */
export function predictRelevance(docs: Doc[]): RelevanceResult {
  const labelled = docs.map((d, i) => ({ d, i })).filter((x) => x.d.label != null);
  const includes = labelled.filter((x) => x.d.label === 1).length, excludes = labelled.length - includes;
  if (includes < MIN_EACH || excludes < MIN_EACH) {
    throw new Error(`Ratings need at least ${MIN_EACH} included and ${MIN_EACH} excluded records at this stage (so far ${includes} included, ${excludes} excluded).`);
  }
  const xs = featurise(docs);
  let heldOut: number | null = null;
  if (includes >= 10 && excludes >= 10) {
    const test = labelled.filter((_, k) => k % 5 === 0), fit = labelled.filter((_, k) => k % 5 !== 0);
    const m = train(fit.map((x) => xs[x.i]), fit.map((x) => x.d.label!));
    heldOut = auc(test.map((x) => dot(m, xs[x.i])), test.map((x) => x.d.label!));
  }
  const m = train(labelled.map((x) => xs[x.i]), labelled.map((x) => x.d.label!));
  const scores = new Map(docs.map((d, i) => [d.id, sigmoid(dot(m, xs[i]))]));
  return { scores, includes, excludes, auc: heldOut };
}

/** 1–5 stars from a predicted probability of inclusion. */
export function stars(p: number | null | undefined): number | null {
  if (p == null) return null;
  return p >= 0.8 ? 5 : p >= 0.6 ? 4 : p >= 0.4 ? 3 : p >= 0.2 ? 2 : 1;
}
