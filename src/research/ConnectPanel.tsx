import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiUrl, connectKey, createApiKey, deleteWebhook, getWebhook, listApiKeys, retryWebhook, revokeApiKey, saveWebhook, testWebhook, webhookLog, type RhProject,
} from '../lib/api/research';
import { checkWebhookUrl } from '../../supabase/functions/rh-api/format.mjs';
import { friendlyError } from '../lib/errors';
import { fmtDate } from '../lib/hooks';
import { Alert, Button, Card, Input, cx } from '../components/ui';
import { useToast } from '../components/Toast';

/**
 * Connect ResearchHub to other tools: a read-only data link (API key) for
 * Google Sheets, Excel, Power BI, R or Python, and a webhook that sends each
 * new response to Zapier, Make, n8n or your own server.
 */
export function ConnectPanel({ project }: { project: RhProject }) {
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useQuery({ queryKey: [...connectKey(project.id), 'keys'], queryFn: () => listApiKeys(project.id) });
  const hook = useQuery({ queryKey: [...connectKey(project.id), 'hook'], queryFn: () => getWebhook(project.id) });
  const log = useQuery({ queryKey: [...connectKey(project.id), 'log'], queryFn: () => webhookLog(project.id), enabled: !!hook.data });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  useEffect(() => { if (hook.data) setUrl(hook.data.url); }, [hook.data]);
  const reload = () => qc.invalidateQueries({ queryKey: connectKey(project.id) });
  const run = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(what);
    try { await fn(); await reload(); if (done) toast(done); } catch (e) { toast(e instanceof Error && !('code' in e) ? e.message : friendlyError(e), { kind: 'error' }); } finally { setBusy(null); }
  };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Select the text and copy it.', { kind: 'error' }); }
  };
  const urlProblem = url.trim() ? checkWebhookUrl(url.trim()) : null;
  const active = (keys.data ?? []).filter((k) => !k.revoked_at);

  return (
    <div className="space-y-5" data-testid="rh-connect">
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold text-ink-900">Data link (API)</h2>
        <p className="text-sm text-slate-600">
          A private link that always returns the latest responses — set-aside ones left out. Use it to keep a Google Sheet up to date, or to load the data into Excel, Power BI, R or Python. Anyone with the key can read the answers, so keep it like a password and revoke it when you no longer need it.
        </p>
        {newKey && (
          <Alert kind="success">
            <div className="space-y-2" data-testid="rh-new-key">
              <p className="font-medium">Your new key — copy it now. For safety it is not stored and will not be shown again.</p>
              <div className="flex gap-2"><Input readOnly value={newKey} aria-label="New API key" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" data-testid="rh-key-value" /><Button size="sm" onClick={() => copy(newKey, 'Key')}>Copy</Button></div>
              <Snippet label="Google Sheets — paste in cell A1 (refreshes about every hour)" text={`=IMPORTDATA("${apiUrl(newKey, 'csv')}")`} onCopy={copy} testid="rh-sheets-formula" />
              <Snippet label="CSV (Excel: Data → From Web; R: read.csv(url); Python: pandas.read_csv(url))" text={apiUrl(newKey, 'csv')} onCopy={copy} />
              <Snippet label="JSON (questions and answers, for code and Power BI)" text={apiUrl(newKey, 'json')} onCopy={copy} testid="rh-json-url" />
              <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>I have copied it</Button>
            </div>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Key name" className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Google Sheet for supervisor" maxLength={100} />
          <Button loading={busy === 'key'} data-testid="rh-create-key"
            onClick={() => run('key', async () => { const k = await createApiKey(project.id, name.trim() || 'API key'); setNewKey(k.key); setName(''); }, 'Key created')}>
            Create a key
          </Button>
        </div>
        {(keys.data ?? []).length > 0 && (
          <table className="w-full text-sm" data-testid="rh-keys">
            <thead><tr className="text-xs text-slate-600"><th className="py-1 text-left">Key</th><th className="py-1 text-left">Created</th><th className="py-1 text-left">Last used</th><th /></tr></thead>
            <tbody>
              {(keys.data ?? []).map((k) => (
                <tr key={k.id} className={cx('border-t border-slate-100', k.revoked_at && 'text-slate-400 line-through')}>
                  <td className="py-1.5"><span className="font-medium">{k.name}</span> <span className="font-mono text-xs text-slate-500">{k.prefix}…</span></td>
                  <td className="py-1.5 whitespace-nowrap">{fmtDate(k.created_at, false)}</td>
                  <td className="py-1.5 whitespace-nowrap">{k.last_used_at ? fmtDate(k.last_used_at) : 'never'}</td>
                  <td className="py-1.5 text-right">{!k.revoked_at && (
                    <Button size="sm" variant="ghost" className="text-rose-700" disabled={!!busy}
                      onClick={() => { if (window.confirm(`Revoke “${k.name}”? Anything using it stops working at once.`)) void run('revoke', () => revokeApiKey(k.id), 'Key revoked'); }}>Revoke</Button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {active.length > 0 && !newKey && <p className="text-xs text-slate-500">Lost a key? Create a new one and revoke the old one — keys cannot be shown again.</p>}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 font-semibold text-ink-900">Webhook</h2>
          {hook.data && <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium', hook.data.enabled ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700')} data-testid="rh-hook-state">{hook.data.enabled ? 'On' : 'Paused'}</span>}
        </div>
        <p className="text-sm text-slate-600">
          Each new response is sent straight away, as JSON, to an address you choose — for example a Zapier, Make or n8n “catch hook”, which can then add a row to a sheet, post to Slack or send you an email. Uploaded files are sent as their file names only.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input aria-label="Webhook address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" aria-invalid={!!urlProblem} data-testid="rh-hook-url" />
          <Button loading={busy === 'save'} disabled={!url.trim() || !!urlProblem} data-testid="rh-hook-save"
            onClick={() => run('save', () => saveWebhook(project.id, url.trim(), hook.data?.enabled ?? true), 'Webhook saved')}>{hook.data ? 'Save' : 'Switch on'}</Button>
        </div>
        {urlProblem && <p className="text-sm text-rose-700">{urlProblem}</p>}
        {hook.data && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" loading={busy === 'test'} data-testid="rh-hook-test"
                onClick={() => run('test', async () => { const r = await testWebhook(project.id); if (!r.ok) throw new Error(`Test failed: ${r.error}`); }, 'Test sent — the endpoint answered OK')}>Send a test</Button>
              <Button size="sm" variant="secondary" loading={busy === 'retry'} data-testid="rh-hook-retry"
                onClick={() => run('retry', async () => { const r = await retryWebhook(project.id); toast(r.sent || r.failed ? `${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}` : 'Nothing waiting — every response from the last 30 days was delivered'); })}>Send undelivered</Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run('pause', () => saveWebhook(project.id, hook.data!.url, !hook.data!.enabled), hook.data?.enabled ? 'Webhook paused' : 'Webhook switched on')}>{hook.data.enabled ? 'Pause' : 'Resume'}</Button>
              <Button size="sm" variant="ghost" className="text-rose-700" disabled={!!busy} onClick={() => { if (window.confirm('Remove the webhook?')) void run('del', () => deleteWebhook(project.id), 'Webhook removed'); }}>Remove</Button>
            </div>
            <details className="text-sm" open={showSecret} onToggle={(e) => setShowSecret((e.target as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer text-slate-700">Check that requests really come from ResearchHub (signing secret)</summary>
              <div className="mt-2 space-y-2 text-slate-600">
                <p>Every request carries <code>X-ResearchHub-Signature: sha256=&lt;HMAC-SHA256 of the raw body with this secret&gt;</code>. Compare it on your server before trusting the data.</p>
                {showSecret && <Snippet label="Secret" text={hook.data.secret} onCopy={copy} />}
              </div>
            </details>
            {(log.data ?? []).length > 0 && (
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm" data-testid="rh-hook-log">
                  <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600"><tr><th className="px-2 py-1 text-left">When</th><th className="px-2 py-1 text-left">What</th><th className="px-2 py-1 text-left">Result</th></tr></thead>
                  <tbody>
                    {(log.data ?? []).map((l) => (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="px-2 py-1 whitespace-nowrap">{fmtDate(l.created_at)}</td>
                        <td className="px-2 py-1">{l.event === 'ping' ? 'Test' : 'New response'}{l.attempts > 1 ? ` · ${l.attempts} tries` : ''}</td>
                        <td className={cx('px-2 py-1', l.delivered_at ? 'text-emerald-700' : 'text-rose-700')}>{l.delivered_at ? `Delivered (HTTP ${l.status})` : l.error ?? 'Sending…'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Snippet({ label, text, onCopy, testid }: { label: string; text: string; onCopy: (t: string, what: string) => void; testid?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-600">{label}</p>
      <div className="mt-0.5 flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded bg-white px-2 py-1.5 text-xs whitespace-nowrap ring-1 ring-slate-200" data-testid={testid}>{text}</code>
        <Button size="sm" variant="ghost" onClick={() => onCopy(text, label.split(' — ')[0].split(' (')[0])}>Copy</Button>
      </div>
    </div>
  );
}
