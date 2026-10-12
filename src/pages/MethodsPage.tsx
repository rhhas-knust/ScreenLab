import { useParams, useSearchParams } from 'react-router';
import { useProject } from '../lib/hooks';
import { cx, PageLoader } from '../components/ui';
import { PrismaTab } from '../methods/PrismaTab';
import { SearchLog } from '../methods/SearchLog';
import { DecisionLog } from '../methods/DecisionLog';
import { AiUse } from '../methods/AiUse';

const TABS = [
  { key: 'prisma', label: 'PRISMA diagram' },
  { key: 'search', label: 'Search log' },
  { key: 'decisions', label: 'Decision log' },
  { key: 'ai', label: 'AI use' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Everything the methods section needs, from the project's own data. */
export function MethodsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'prisma') as Tab;
  if (!project.data) return <PageLoader />;
  const title = project.data.title;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold text-ink-900">Methods</h1>
        <p className="text-sm text-slate-600">Flow diagram, search strategy, protocol decisions and AI use for your methods section.</p>
      </div>
      <div role="tablist" aria-label="Methods sections" className="flex flex-wrap gap-1 border-b border-slate-200 print:hidden">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setParams(t.key === 'prisma' ? {} : { tab: t.key }, { replace: true })}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t.key ? 'border-ink-700 text-ink-900' : 'border-transparent text-slate-600 hover:text-ink-900')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'prisma' && <PrismaTab projectId={projectId} title={title} />}
      {tab === 'search' && <SearchLog projectId={projectId} title={title} />}
      {tab === 'decisions' && <DecisionLog projectId={projectId} title={title} />}
      {tab === 'ai' && <AiUse projectId={projectId} />}
    </div>
  );
}
