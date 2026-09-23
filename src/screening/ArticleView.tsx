import type { ReactNode } from 'react';
import { Highlight } from '../components/Highlight';
import type { CriteriaTerms } from '../lib/criteria';
import type { Reference, Stage } from '../lib/types';
import { doiUrl, isValidDoi, pubmedUrl } from '../lib/normalize';
import { DecisionBadge, TagChip } from '../components/Decision';

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <dt className="w-32 shrink-0 font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">{children}</dd>
    </div>
  );
}

const DUP_TEXT: Record<string, string> = {
  possible: '⚠ Possible duplicate — review on the Duplicates page',
  duplicate: '⧉ Marked as duplicate (removed from screening)',
  merged: '⧉ Merged into another record (removed from screening)',
};

export function ArticleView({ reference: r, stage, terms, criteria }: { reference: Reference; stage: Stage; terms: string[]; criteria?: CriteriaTerms }) {
  const doiLink = isValidDoi(r.doi) ? doiUrl(r.doi) : null;
  const pmLink = pubmedUrl(r.pmid);
  const citation = [r.journal, r.year, r.volume && `${r.volume}${r.issue ? `(${r.issue})` : ''}`, r.pages].filter(Boolean).join(' · ');
  return (
    <article className="mx-auto max-w-3xl px-4 py-5 sm:px-6" aria-labelledby="article-title">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">#{r.seq}</span>
        {stage === 'full_text' && (
          <span className="text-xs text-slate-600">Title/abstract: <DecisionBadge decision={r.title_abstract_decision} compact /></span>
        )}
        {r.database_source && <span className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-xs font-medium text-ink-800">{r.database_source}</span>}
        {r.publication_type && <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700">{r.publication_type}</span>}
        {r.language && <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700">{r.language}</span>}
        {r.tag_names?.map((t) => <TagChip key={t} name={t} />)}
      </div>
      {DUP_TEXT[r.duplicate_status] && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-950">{DUP_TEXT[r.duplicate_status]}</p>
      )}
      <h1 id="article-title" className="font-serif text-xl leading-snug font-semibold text-ink-950 sm:text-2xl">
        {r.title ? <Highlight text={r.title} search={terms} terms={criteria} /> : <em className="text-rose-700">[No title]</em>}
      </h1>
      {r.authors && <p className="mt-2 text-sm text-slate-700"><Highlight text={r.authors} search={terms} /></p>}
      {citation && <p className="mt-1 text-sm text-slate-600 italic">{citation}</p>}

      <section className="mt-5" aria-labelledby="abstract-h">
        <h2 id="abstract-h" className="mb-1 text-xs font-bold tracking-wide text-slate-500 uppercase">Abstract</h2>
        {r.abstract ? (
          <div className="abstract-text max-w-[75ch] text-[15px] leading-relaxed text-slate-900">
            {r.abstract.split(/\n{2,}/).map((p, i) => <p key={i}><Highlight text={p} search={terms} terms={criteria} /></p>)}
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">No abstract available for this record.</p>
        )}
      </section>

      <dl className="mt-6 border-t border-slate-200 pt-3">
        {r.keywords && <Meta label="Keywords"><Highlight text={r.keywords} search={terms} terms={criteria} /></Meta>}
        {r.journal && <Meta label="Journal">{r.journal}</Meta>}
        {r.year && <Meta label="Year">{r.year}</Meta>}
        <Meta label="DOI">
          {r.doi ? (doiLink ? <a className="text-ink-700 underline" href={doiLink} target="_blank" rel="noopener noreferrer">{r.doi}</a> : <span>{r.doi} <span className="text-xs text-amber-800">(not a valid DOI)</span></span>) : '—'}
        </Meta>
        <Meta label="PMID">{r.pmid ? (pmLink ? <a className="text-ink-700 underline" href={pmLink} target="_blank" rel="noopener noreferrer">{r.pmid}</a> : r.pmid) : '—'}</Meta>
        <Meta label="Database source">{r.database_source ?? '—'}</Meta>
        <Meta label="Publication type">{r.publication_type ?? '—'}</Meta>
        {r.url && <Meta label="URL"><a className="break-all text-ink-700 underline" href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a></Meta>}
        {r.full_text_url && <Meta label="Full-text URL"><a className="break-all text-ink-700 underline" href={r.full_text_url} target="_blank" rel="noopener noreferrer">{r.full_text_url}</a></Meta>}
      </dl>
    </article>
  );
}
