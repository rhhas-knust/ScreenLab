import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getPublicForm, submitResponse } from '../lib/api/research';
import { friendlyError } from '../lib/errors';
import { Alert, Button, PageLoader } from '../components/ui';
import { FormView } from './FormView';

/** Respondent-facing questionnaire at /f/:formId — no account needed. */
export function PublicFormPage() {
  const { formId = '' } = useParams();
  const valid = /^[0-9a-f-]{36}$/i.test(formId);
  const q = useQuery({ queryKey: ['rh', 'public', formId], queryFn: () => getPublicForm(formId), enabled: valid, retry: 1 });
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
      <>
        <header className="mb-5 rounded-xl border-t-8 border-t-ink-800 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold text-ink-900">{f.title}</h1>
          {(f.university || f.department) && <p className="mt-1 text-sm text-slate-500">{[f.department, f.university].filter(Boolean).join(' · ')}</p>}
          {f.description && <p className="mt-3 whitespace-pre-wrap text-slate-700">{f.description}</p>}
          {f.status === 'active' && f.fields.some((x) => x.required) && <p className="mt-3 text-xs text-rose-700">* Required</p>}
        </header>
        {f.status === 'closed'
          ? <Alert kind="info">This questionnaire is closed and no longer accepts responses. Thank you for your interest.</Alert>
          : <FormView form={f} onSubmit={async (answers) => { await submitResponse(formId, answers); }} />}
      </>
    );
  }

  return (
    <div className="min-h-full bg-slate-100">
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">{body}</main>
      <footer className="pb-8 text-center text-xs text-slate-500">Powered by ResearchHub · Built by Hastech Solutions</footer>
    </div>
  );
}
