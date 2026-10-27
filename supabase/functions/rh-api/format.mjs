// Pure helpers for the rh-api Edge Function: turning a questionnaire's
// responses into JSON / CSV for other tools, webhook payloads and signatures.
// Plain JavaScript so Deno (the function), Node (the local test stack) and
// Vitest (unit tests) all run the same code.

/** @typedef {{ id: string, label: string, type: string, options: string[], settings?: { rows?: string[] } }} Field */
/** @typedef {{ id: string, submitted_at: string, answers: Record<string, unknown> }} Response */

const isFile = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.file === 'string' && typeof v.name === 'string';
const blank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

/** Stable short keys: Q1, Q2 … in questionnaire order (the same names as Chart studio and the downloads). */
export function questionKeys(fields) {
  return fields.map((f, i) => ({ key: `Q${i + 1}`, field: f }));
}

/** One answer as it travels in JSON: files become their name, everything else stays as it is. */
function jsonValue(v) {
  if (blank(v)) return null;
  if (isFile(v)) return { file_name: v.name };
  return v;
}

/** Spreadsheet columns: grids get a column per statement, rankings a column per option (its rank). */
function columns(fields) {
  const out = [];
  questionKeys(fields).forEach(({ key, field: f }) => {
    if (f.type === 'calc') return; // scores are worked out in ResearchHub, not stored
    if (f.type === 'grid') {
      (f.settings?.rows ?? []).forEach((row, j) => out.push({ head: `${key}_${j + 1}. ${f.label} — ${row}`, get: (a) => { const v = a[f.id]; return v && typeof v === 'object' && !Array.isArray(v) ? v[row] ?? '' : ''; } }));
    } else if (f.type === 'ranking') {
      f.options.forEach((o, j) => out.push({ head: `${key}_${j + 1}. ${f.label} — rank of ${o}`, get: (a) => { const v = a[f.id]; const k = Array.isArray(v) ? v.indexOf(o) : -1; return k < 0 ? '' : String(k + 1); } }));
    } else {
      out.push({ head: `${key}. ${f.label}`, get: (a) => { const v = a[f.id]; if (blank(v)) return ''; if (isFile(v)) return v.name; if (Array.isArray(v)) return v.join('; '); if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('; '); return String(v); } });
    }
  });
  return out;
}

/** Header row plus one row per response (oldest first). */
export function tableRows(fields, responses) {
  const cols = columns(fields);
  return [
    ['Response', 'Submitted at', ...cols.map((c) => c.head)],
    ...responses.map((r, i) => [String(i + 1), new Date(r.submitted_at).toISOString(), ...cols.map((c) => c.get(r.answers ?? {}))]),
  ];
}

/** RFC 4180 CSV. Cells that start with = + - @ are prefixed with ' so spreadsheets never run them as formulas. */
export function toCsv(rows) {
  const cell = (s) => {
    let t = String(s ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** The JSON document: the questions, then the responses keyed by Q1, Q2 …. */
export function toJson(form, fields, responses) {
  const keys = questionKeys(fields).filter(({ field }) => field.type !== 'calc');
  return {
    form: { id: form.id, title: form.title },
    generated_at: new Date().toISOString(),
    questions: keys.map(({ key, field: f }) => ({ key, id: f.id, label: f.label, type: f.type, options: f.options, ...(f.type === 'grid' ? { rows: f.settings?.rows ?? [] } : {}) })),
    responses: responses.map((r, i) => ({
      number: i + 1, id: r.id, submitted_at: r.submitted_at,
      answers: Object.fromEntries(keys.map(({ key, field }) => [key, jsonValue(r.answers?.[field.id])])),
    })),
  };
}

/** The body POSTed to a webhook for one new response. */
export function webhookPayload(form, fields, response, number) {
  const doc = toJson(form, fields, [response]);
  return { event: 'response.created', form: doc.form, questions: doc.questions, response: { ...doc.responses[0], number } };
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*|\[?fe80:.*|metadata\.google\.internal)$/i;

/** Problems with a webhook address, or null. Only public https endpoints (local http only in the test stack). */
export function checkWebhookUrl(raw, allowLocal = false) {
  let u;
  try { u = new URL(raw); } catch { return 'Enter a full address starting with https://'; }
  if (allowLocal && u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null;
  if (u.protocol !== 'https:') return 'The address must start with https://';
  if (u.username || u.password) return 'Leave the user name and password out of the address.';
  if (PRIVATE_HOST.test(u.hostname)) return 'The address must be on the public internet.';
  if (raw.length > 2000) return 'The address is too long.';
  return null;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** HMAC-SHA256 of the raw body with the webhook secret, as sent in X-ResearchHub-Signature: sha256=<hex>. */
export async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}
