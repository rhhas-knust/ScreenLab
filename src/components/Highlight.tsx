import { Fragment, useMemo } from 'react';
import { termPattern, type CriteriaTerms } from '../lib/criteria';
import { EXC_MARK, INC_MARK } from './CriteriaKeywords';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Highlights search terms (yellow) and criteria keywords (green = inclusion,
 * red wavy = exclusion; each also carries a title so it is not colour-only).
 */
export function Highlight({ text, search = [], terms }: { text: string; search?: string[]; terms?: CriteriaTerms }) {
  const matchers = useMemo(() => {
    const m: { re: RegExp; cls: string; title: string }[] = [];
    for (const t of terms?.exclude ?? []) m.push({ re: new RegExp(`^(?:${termPattern(t)})$`, 'i'), cls: EXC_MARK, title: `Exclusion keyword: ${t}` });
    for (const t of terms?.include ?? []) m.push({ re: new RegExp(`^(?:${termPattern(t)})$`, 'i'), cls: INC_MARK, title: `Inclusion keyword: ${t}` });
    for (const t of search) m.push({ re: new RegExp(`^${escapeRe(t)}$`, 'i'), cls: 'rounded bg-yellow-200 px-0.5 text-inherit', title: 'Search match' });
    const all = [
      ...(terms?.exclude ?? []).map(termPattern),
      ...(terms?.include ?? []).map(termPattern),
      ...search.map(escapeRe),
    ];
    return { m, re: all.length ? new RegExp(`(${all.join('|')})`, 'gi') : null };
  }, [terms, search]);
  if (!matchers.re) return <>{text}</>;
  const parts = text.split(matchers.re);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        const hit = matchers.m.find((x) => x.re.test(p));
        return <mark key={i} className={hit?.cls ?? 'bg-yellow-200'} title={hit?.title}>{p}</mark>;
      })}
    </>
  );
}
