import { normDoi, normTitle } from '../normalize';

export interface DedupeKeyRecord {
  doi: string | null;
  pmid: string | null;
  title: string | null;
  year: number | null;
}

/** Simple union-find used to group duplicate pairs into connected components. */
export class UnionFind<T> {
  private parent = new Map<T, T>();
  find(x: T): T {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (this.parent.get(x) !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a: T, b: T) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  groups(): T[][] {
    const out = new Map<T, T[]>();
    for (const k of this.parent.keys()) {
      const r = this.find(k);
      if (!out.has(r)) out.set(r, []);
      out.get(r)!.push(k);
    }
    return [...out.values()].filter((g) => g.length > 1);
  }
}

/**
 * Find duplicates *within* a list of records using exact keys
 * (DOI, PMID, normalised title + year). Returns index groups.
 */
export function findWithinFileDuplicates(records: DedupeKeyRecord[]): number[][] {
  const uf = new UnionFind<number>();
  const byDoi = new Map<string, number>();
  const byPmid = new Map<string, number>();
  const byTitle = new Map<string, number>();
  records.forEach((r, i) => {
    const d = normDoi(r.doi);
    if (d) {
      if (byDoi.has(d)) uf.union(byDoi.get(d)!, i);
      else byDoi.set(d, i);
    }
    const p = r.pmid?.trim();
    if (p) {
      if (byPmid.has(p)) uf.union(byPmid.get(p)!, i);
      else byPmid.set(p, i);
    }
    const t = normTitle(r.title);
    if (t && t.length >= 10) {
      const key = `${t}|${r.year ?? ''}`;
      if (byTitle.has(key)) uf.union(byTitle.get(key)!, i);
      else byTitle.set(key, i);
    }
  });
  return uf.groups();
}
