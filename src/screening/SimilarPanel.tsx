import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { similarReferences } from '../lib/api/references';
import type { Stage } from '../lib/types';
import { DecisionIcon } from '../components/Decision';
import { Spinner } from '../components/ui';

/** Records in the project most like this one (shared title and keyword words), with their decisions. */
export function SimilarPanel({ referenceId, stage, onOpen }: { referenceId: string; stage: Stage; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['similar', referenceId], queryFn: () => similarReferences(referenceId), enabled: open, staleTime: 60_000 });
  return (
    <div className="space-y-1 text-sm" data-testid="similar-panel">
      <button type="button" className="flex w-full items-center justify-between font-semibold text-ink-900" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-testid="similar-toggle">
        Similar records <span aria-hidden="true" className="text-slate-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (q.isLoading ? <Spinner className="h-4 w-4" label="Finding similar records…" /> : !q.data?.length ? (
        <p className="text-xs text-slate-500">No similar records in this project.</p>
      ) : (
        <ul className="space-y-1">
          {q.data.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-ink-50" data-testid="similar-item">
                <DecisionIcon decision={stage === 'title_abstract' ? r.title_abstract_decision : r.full_text_decision} />
                <span className="min-w-0 flex-1"><span className="line-clamp-2 text-slate-800">#{r.seq} {r.title ?? '[No title]'}</span>
                  <span className="text-slate-500">{[r.authors?.split(';')[0], r.year].filter(Boolean).join(' · ')}</span></span>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
