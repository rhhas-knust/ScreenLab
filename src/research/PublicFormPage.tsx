import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { deviceToken, getPublicForm, submitResponse } from '../lib/api/research';
import { friendlyError } from '../lib/errors';
import { Alert, Button, PageLoader } from '../components/ui';
import { FormView } from './FormView';

const doneKey = (id: string) => `rh-done-${id}`;
function readDone(id: string) {
  try { return localStorage.getItem(doneKey(id)) === '1'; } catch { return false; }
}

/** Respondent-facing questionnaire at /f/:formId — no account needed. */
export function PublicFormPage() {
  const { formId = '' } = useParams();
  const valid = /^[0-9a-f-]{36}$/i.test(formId);
  const q = useQuery({ queryKey: ['rh', 'public', formId], queryFn: () => getPublicForm(formId), enabled: valid, retry: 1 });
  const [already] = useState(() => readDone(formId));
  useEffect(() => {
    if (q.data?.title) document.title = q.data.title;
  }, [q.data?.title]);

  let body: React.ReactNode;
  if (!valid || (q.isSuccess && !q.data)) {
    body = <Alert kind="info">This questionnaire was not found. Check the link you were given.</Alert>;
  } else if (q.isLoading) {
    body = <PageLoader label="Loading questionnaire…" />;
  } else if (q.error) {
    body = (
      <>
        <Alert>{friendlyError(q.error, 'Could not load the questionnaire.')}</Alert>
        <Button className="mt-3" onClick={() => q.refetch()}>Try again</Button>
      </>
    );
  } else if (q.data) {
    const f = q.data;
    body = (
      <FormView form={f} alreadyDone={!!f.one_per_device && already} onSubmit={async (answers, meta) => {
        await submitResponse(formId, answers, { ...meta, device: f.one_per_device ? deviceToken() : null });
        if (f.one_per_device) try { localStorage.setItem(doneKey(formId), '1'); } catch { /* private mode */ }
      }} />
    );
  }

  return (
    <div className="min-h-full bg-slate-100">
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">{body}</main>
      <footer className="pb-8 text-center text-xs text-slate-500">Powered by ResearchHub · Built by Hastech Solutions</footer>
    </div>
  );
}
