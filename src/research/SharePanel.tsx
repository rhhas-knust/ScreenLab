import { publicFormUrl, type RhProject } from '../lib/api/research';
import { Button, Card, Input } from '../components/ui';
import { useToast } from '../components/Toast';

export function SharePanel({ project }: { project: RhProject }) {
  const toast = useToast();
  const url = publicFormUrl(project.id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast('Could not copy automatically — select the link and copy it.', { kind: 'error' });
    }
  };
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Please fill in my questionnaire: ${project.title}\n${url}`)}`;
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-semibold text-ink-900">Share with respondents</h2>
      {project.status === 'closed' && <p className="text-sm text-amber-900">Closed — the link shows a “no longer accepting responses” message until you reopen it.</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={url} aria-label="Public link" onFocus={(e) => e.currentTarget.select()} data-testid="rh-share-url" />
        <div className="flex gap-2">
          <Button onClick={copy}>Copy link</Button>
          <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">WhatsApp</a>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">Open</a>
        </div>
      </div>
      <p className="text-xs text-slate-500">Anyone with the link can respond — no account needed. Only you can see the answers.</p>
    </Card>
  );
}
