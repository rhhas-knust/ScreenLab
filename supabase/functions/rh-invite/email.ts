// Email text for ResearchHub invitations and reminders. Pure functions shared
// by the Edge Function and the unit tests.
export interface Invitee { email: string; name: string | null; token: string }
export interface Form { id: string; title: string; university: string | null; department: string | null; closes_at: string | null }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function defaultSubject(kind: 'invite' | 'reminder', title: string): string {
  return kind === 'reminder' ? `Reminder: ${title}` : `Invitation: ${title}`;
}

export function defaultMessage(kind: 'invite' | 'reminder'): string {
  return kind === 'reminder'
    ? 'This is a friendly reminder about my questionnaire. If you have a few minutes, I would be grateful for your answers. If you have already responded, thank you — please ignore this email.'
    : 'I am inviting you to take part in my research questionnaire. It takes only a few minutes and your answers are confidential. Taking part is voluntary.';
}

/** One email: plain text and simple HTML with the person's own link. */
export function buildEmail(kind: 'invite' | 'reminder', form: Form, who: Invitee, link: string, message: string): { text: string; html: string } {
  const hello = who.name ? `Dear ${who.name},` : 'Hello,';
  const body = (message.trim() || defaultMessage(kind)).slice(0, 5000);
  const by = [form.department, form.university].filter(Boolean).join(', ');
  const closes = form.closes_at ? `The questionnaire closes on ${new Date(form.closes_at).toUTCString().slice(0, 16)}.` : '';
  const text = [hello, '', body, '', `${form.title}${by ? ` (${by})` : ''}`, link, ...(closes ? ['', closes] : []), '',
    'This link is personal to you, so please do not forward it.'].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;max-width:560px">
<p>${esc(hello)}</p>
${body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#16325c;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open the questionnaire</a></p>
<p style="font-size:14px;color:#475569"><strong>${esc(form.title)}</strong>${by ? `<br>${esc(by)}` : ''}${closes ? `<br>${esc(closes)}` : ''}</p>
<p style="font-size:12px;color:#64748b">If the button does not work, copy this link into your browser: ${esc(link)}<br>This link is personal to you, so please do not forward it.</p>
</body></html>`;
  return { text, html };
}
