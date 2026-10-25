import { useState } from 'react';
import Papa from 'papaparse';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  InviteError, addInvites, deleteInvite, inviteKey, inviteUrl, listInvites, parseInvitees, sendInvites, type RhInvite, type RhProject,
} from '../lib/api/research';
import { defaultMessage, defaultSubject } from '../../supabase/functions/rh-invite/email';
import { downloadText, safeFileName } from '../lib/export/formats';
import { friendlyError } from '../lib/errors';
import { fmtDate } from '../lib/hooks';
import { Alert, Button, Card, Input, Label, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

const status = (r: RhInvite) => (r.responded_on ? 'responded' : r.send_count ? 'invited' : 'new');

/**
 * Personal links for a list of people, emailed from ResearchHub, with
 * reminders for those who have not responded. Only *that* someone responded
 * is recorded — never which answers are theirs.
 */
export function InvitePanel({ project }: { project: RhProject }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: inviteKey(project.id), queryFn: () => listInvites(project.id) });
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState<string | null>(null);
  const rows = q.data ?? [];
  const fresh = rows.filter((r) => status(r) === 'new');
  const waiting = rows.filter((r) => !r.responded_on && r.send_count > 0);
  const responded = rows.filter((r) => r.responded_on).length;
  const reload = () => qc.invalidateQueries({ queryKey: inviteKey(project.id) });

  const add = async () => {
    const { people, bad } = parseInvitees(paste);
    if (!people.length) { toast(bad.length ? `No email addresses found (e.g. “${bad[0]}”).` : 'Paste some email addresses first.', { kind: 'error' }); return; }
    setBusy('add');
    try {
      const n = await addInvites(project.id, people);
      await reload();
      setPaste('');
      toast(`${n} added${people.length - n ? `, ${people.length - n} already on the list` : ''}${bad.length ? ` · ${bad.length} line${bad.length === 1 ? '' : 's'} without an email skipped` : ''}`);
    } catch (e) {
      toast(friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const send = async (kind: 'invite' | 'reminder', list: RhInvite[]) => {
    if (!list.length) return;
    if (!window.confirm(`Email ${kind === 'reminder' ? 'a reminder' : 'an invitation'} to ${list.length} ${list.length === 1 ? 'person' : 'people'}?`)) return;
    setBusy(kind);
    try {
      let sent = 0, failed = 0;
      for (let i = 0; i < list.length; i += 500) {
        const r = await sendInvites(project.id, list.slice(i, i + 500).map((x) => x.id), kind, subject || defaultSubject(kind, project.title), message || defaultMessage(kind));
        sent += r.sent; failed += r.failed.length;
      }
      await reload();
      toast(`${sent} ${kind === 'reminder' ? 'reminder' : 'invitation'}${sent === 1 ? '' : 's'} sent${failed ? ` · ${failed} failed` : ''}`, failed ? { kind: 'error' } : undefined);
    } catch (e) {
      if (e instanceof InviteError && e.code === 'not_configured') setNotSetUp(e.message);
      else toast(e instanceof Error ? e.message : friendlyError(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const remove = async (r: RhInvite) => {
    if (!window.confirm(`Remove ${r.email} from the list? Their link stops working.`)) return;
    try { await deleteInvite(r.id); await reload(); } catch (e) { toast(friendlyError(e), { kind: 'error' }); }
  };
  const copy = async (r: RhInvite) => {
    try { await navigator.clipboard.writeText(inviteUrl(project.id, r.token)); toast('Personal link copied'); } catch { toast('Could not copy the link.', { kind: 'error' }); }
  };
  const csv = () => downloadText(`${safeFileName(project.title)}_invitation_links.csv`, '﻿' + Papa.unparse([
    ['Name', 'Email', 'Personal link', 'Status', 'Last emailed', 'Responded on'],
    ...rows.map((r) => [r.name ?? '', r.email, inviteUrl(project.id, r.token), status(r), r.last_sent_at ?? '', r.responded_on ?? '']),
  ]), 'text/csv');
  const mailto = (r: RhInvite, kind: 'invite' | 'reminder') =>
    `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject || defaultSubject(kind, project.title))}&body=${encodeURIComponent(`${r.name ? `Dear ${r.name},` : 'Hello,'}\n\n${message || defaultMessage(kind)}\n\n${inviteUrl(project.id, r.token)}\n\nThis link is personal to you, so please do not forward it.`)}`;

  return (
    <div data-testid="rh-invites"><Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold text-ink-900">Invite people by email</h2>
        {rows.length > 0 && <span className="text-sm text-slate-600" data-testid="rh-invite-stats">{rows.length} on the list · {responded} responded</span>}
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="rh-invites-toggle">{open ? 'Hide' : rows.length ? 'Manage' : 'Set up'}</Button>
      </div>
      {!open ? (
        <p className="text-xs text-slate-500">Each person gets a personal link, so you can see who has responded and remind only the others. Their answers stay anonymous: ResearchHub records only that a person responded, never which response is theirs.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <Label htmlFor="rh-inv-paste" hint="(one per line — “Name, email”, “Name <email>” or just the email; you can paste from Excel)">Add people</Label>
            <Textarea id="rh-inv-paste" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Ama Mensah, ama@example.com\nkofi@example.com'} />
            <Button size="sm" className="mt-2" onClick={add} loading={busy === 'add'} data-testid="rh-inv-add">Add to the list</Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">Email wording</summary>
            <div className="mt-2 space-y-2">
              <Input aria-label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={defaultSubject('invite', project.title)} maxLength={200} />
              <Textarea aria-label="Email message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={defaultMessage('invite')} maxLength={5000} />
              <p className="text-xs text-slate-500">Each email starts “Dear [name],” and ends with a button for the person’s own link. Leave these blank to use the standard wording (reminders get reminder wording).</p>
            </div>
          </details>
          {notSetUp && (
            <Alert kind="warning">
              <p className="font-medium">Email sending is not switched on for this ScreenLab yet.</p>
              <p className="mt-1 text-sm">{notSetUp} Until then: download the links for a mail merge in Gmail or Outlook, or use the “Email app” and WhatsApp buttons next to each person.</p>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send('invite', fresh)} disabled={!fresh.length || project.status !== 'active'} loading={busy === 'invite'} data-testid="rh-inv-send">
              Email invitations{fresh.length ? ` (${fresh.length} new)` : ''}
            </Button>
            <Button variant="secondary" onClick={() => send('reminder', waiting)} disabled={!waiting.length || project.status !== 'active'} loading={busy === 'reminder'} data-testid="rh-inv-remind">
              Send reminders{waiting.length ? ` (${waiting.length} not responded)` : ''}
            </Button>
            <Button variant="ghost" onClick={csv} disabled={!rows.length}>Download links (CSV)</Button>
          </div>
          {project.status !== 'active' && <p className="text-xs text-amber-800">The questionnaire is closed, so emails are paused. Reopen it to send.</p>}
          {rows.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
                  <tr><th className="px-2 py-1.5 text-left">Person</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 align-top" data-testid="rh-invite-row">
                      <td className="px-2 py-1.5"><div className="font-medium text-slate-800">{r.name ?? r.email}</div>{r.name && <div className="text-xs text-slate-500">{r.email}</div>}</td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {r.responded_on ? <span className="font-medium text-emerald-700">Responded {fmtDate(`${r.responded_on.slice(0, 10)}T12:00:00`, false)}</span>
                          : r.send_count ? <span className="text-slate-700">Emailed {r.send_count}× · last {fmtDate(r.last_sent_at, false)}</span>
                            : <span className="text-slate-500">Not emailed yet</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <button type="button" className="text-xs text-ink-700 underline" onClick={() => copy(r)}>Copy link</button>
                        <a className="ml-2 text-xs text-ink-700 underline" href={mailto(r, r.send_count ? 'reminder' : 'invite')}>Email app</a>
                        <a className="ml-2 text-xs text-ink-700 underline" target="_blank" rel="noreferrer"
                          href={`https://wa.me/?text=${encodeURIComponent(`${message || defaultMessage(r.send_count ? 'reminder' : 'invite')}\n${inviteUrl(project.id, r.token)}`)}`}>WhatsApp</a>
                        <button type="button" className="ml-2 text-xs text-rose-700 underline" onClick={() => remove(r)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card></div>
  );
}
