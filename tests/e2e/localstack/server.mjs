/**
 * LOCAL TEST STACK ONLY — a small Supabase-compatible HTTP server used to run
 * ScreenLab's browser end-to-end tests without internet access to supabase.co.
 *
 * It implements the subset of the Supabase Auth (GoTrue), REST (PostgREST) and
 * Storage APIs that ScreenLab uses, on top of a local PostgreSQL database that
 * has the real ScreenLab migration applied. Every request runs inside a
 * transaction as the `authenticated` (or `anon`) role with the caller's JWT
 * claims, so the real Row Level Security policies are enforced by Postgres.
 *
 * Never used in production.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const PORT = Number(process.env.STACK_PORT ?? 54321);
const DB = process.env.STACK_DB ?? 'postgres://postgres@localhost:54329/screenlab?host=/tmp/sl-pg';
const SECRET = 'local-test-secret-not-for-production';
const STORAGE_DIR = process.env.STACK_STORAGE ?? '/tmp/sl-storage';
// PostgREST returns bigint / numeric as JSON numbers
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
const pool = new pg.Pool({ connectionString: DB, max: 10 });
const refreshTokens = new Map();
let offline = false; // toggled by tests to simulate an outage

// ---------------------------------------------------------------- JWT ------
const b64u = (b) => Buffer.from(b).toString('base64url');
function signJwt(claims) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(claims));
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function verifyJwt(token) {
  const [h, p, s] = String(token).split('.');
  if (!s) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  if (expected !== s) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
export const ANON_KEY = signJwt({ role: 'anon', iss: 'local', iat: 1700000000, exp: 4100000000 });

// ------------------------------------------------------------ helpers ------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors(), ...headers });
  res.end(body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Profile, Range',
  };
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
const qi = (id) => `"${String(id).replace(/"/g, '""')}"`;
function claimsFrom(req) {
  const auth = req.headers.authorization ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const c = verifyJwt(token) ?? verifyJwt(req.headers.apikey);
  return c ?? { role: 'anon' };
}
function pgError(res, e) {
  const code = e.code ?? 'XX000';
  const status = { '42501': 403, '23505': 409, '23503': 409, P0002: 404, '22023': 400, '22P02': 400, '23514': 400, '42703': 400, '42P01': 404 }[code] ?? 400;
  send(res, status, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}
async function asUser(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------- auth ------
function userJson(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { sub: u.id, email: u.email } }],
    created_at: u.created_at, updated_at: u.updated_at,
  };
}
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(process.env.STACK_TOKEN_TTL ?? 3600);
  const access = signJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + ttl, session_id: crypto.randomUUID() });
  const refresh = crypto.randomBytes(16).toString('hex');
  refreshTokens.set(refresh, u.id);
  return { access_token: access, token_type: 'bearer', expires_in: ttl, expires_at: now + ttl, refresh_token: refresh, user: userJson(u) };
}
async function handleAuth(req, res, url, body) {
  const p = url.pathname.replace('/auth/v1', '');
  const json = body.length ? JSON.parse(body.toString()) : {};
  if (p === '/token' && url.searchParams.get('grant_type') === 'password') {
    const { rows } = await pool.query('select * from auth.users where lower(email) = lower($1) and encrypted_password = crypt($2, encrypted_password)', [json.email, json.password]);
    if (!rows[0]) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' });
    return send(res, 200, session(rows[0]));
  }
  if (p === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const uid = refreshTokens.get(json.refresh_token);
    if (!uid) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    const { rows } = await pool.query('select * from auth.users where id = $1', [uid]);
    return send(res, 200, session(rows[0]));
  }
  if (p === '/signup') {
    try {
      const { rows } = await pool.query(
        "insert into auth.users(id, email, encrypted_password, email_confirmed_at, aud, role) values (gen_random_uuid(), $1, crypt($2, gen_salt('bf')), now(), 'authenticated', 'authenticated') returning *",
        [json.email, json.password]);
      return send(res, 200, session(rows[0]));
    } catch (e) {
      return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    }
  }
  const claims = claimsFrom(req);
  if (p === '/user' && req.method === 'GET') {
    if (claims.role !== 'authenticated') return send(res, 401, { code: 401, msg: 'invalid JWT' });
    const { rows } = await pool.query('select * from auth.users where id = $1', [claims.sub]);
    return send(res, 200, userJson(rows[0]));
  }
  if (p === '/user' && req.method === 'PUT') {
    if (claims.role !== 'authenticated') return send(res, 401, { code: 401, msg: 'invalid JWT' });
    if (json.password) await pool.query("update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where id = $1", [claims.sub, json.password]);
    const { rows } = await pool.query('select * from auth.users where id = $1', [claims.sub]);
    return send(res, 200, userJson(rows[0]));
  }
  if (p === '/logout') return send(res, 204);
  if (p === '/recover') return send(res, 200, {});
  return send(res, 404, { msg: `auth route not implemented: ${p}` });
}

// --------------------------------------------------------------- REST ------
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === '\\') { cur += s[++i]; continue; }
      if (ch === '"') q = false;
      continue;
    }
    if (ch === '"') { q = true; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function unquote(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, '$1');
  return v;
}
function cond(col, expr, params) {
  let neg = false;
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  const c = qi(col);
  const add = (v) => { params.push(v); return `$${params.length}`; };
  let sql;
  switch (op) {
    case 'eq': sql = `${c} = ${add(unquote(raw))}`; break;
    case 'neq': sql = `${c} <> ${add(unquote(raw))}`; break;
    case 'gt': sql = `${c} > ${add(unquote(raw))}`; break;
    case 'gte': sql = `${c} >= ${add(unquote(raw))}`; break;
    case 'lt': sql = `${c} < ${add(unquote(raw))}`; break;
    case 'lte': sql = `${c} <= ${add(unquote(raw))}`; break;
    case 'like': sql = `${c}::text like ${add(unquote(raw).replace(/\*/g, '%'))}`; break;
    case 'ilike': sql = `${c}::text ilike ${add(unquote(raw).replace(/\*/g, '%'))}`; break;
    case 'is': sql = raw === 'null' ? `${c} is null` : raw === 'true' ? `${c} is true` : raw === 'false' ? `${c} is false` : `${c} is not null`; break;
    case 'in': {
      const list = splitTop(raw.replace(/^\(|\)$/g, '')).map(unquote);
      sql = `${c}::text = any(${add(list)}::text[])`;
      break;
    }
    case 'cs': {
      const list = splitTop(raw.replace(/^\{|\}$/g, '')).map(unquote);
      sql = `${c} @> ${add(list)}::text[]`;
      break;
    }
    default: throw Object.assign(new Error(`operator not supported by test stack: ${op}`), { code: 'PGRST100' });
  }
  return neg ? `not (${sql})` : sql;
}
function logic(kind, inner, params) {
  const parts = splitTop(inner).map((p) => {
    const m = p.match(/^(not\.)?(and|or)\((.*)\)$/s);
    if (m) {
      const s = logic(m[2], m[3], params);
      return m[1] ? `not ${s}` : s;
    }
    const i = p.indexOf('.');
    return cond(p.slice(0, i), p.slice(i + 1), params);
  });
  return `(${parts.join(kind === 'and' ? ' and ' : ' or ')})`;
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function whereClause(url, params) {
  const parts = [];
  for (const [k, v] of url.searchParams) {
    if (RESERVED.has(k)) continue;
    if (k === 'or' || k === 'and') parts.push(logic(k, v.replace(/^\(|\)$/g, ''), params));
    else parts.push(cond(k, v, params));
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}
function selectCols(url) {
  const s = url.searchParams.get('select');
  if (!s || s === '*') return '*';
  return s.split(',').map((c) => qi(c.trim())).join(', ');
}
function orderClause(url) {
  const o = url.searchParams.get('order');
  if (!o) return '';
  return 'order by ' + o.split(',').map((t) => {
    const [col, ...mods] = t.split('.');
    let s = qi(col);
    if (mods.includes('desc')) s += ' desc'; else s += ' asc';
    if (mods.includes('nullsfirst')) s += ' nulls first';
    if (mods.includes('nullslast')) s += ' nulls last';
    return s;
  }).join(', ');
}

async function handleRest(req, res, url, body) {
  const claims = claimsFrom(req);
  const prefer = req.headers.prefer ?? '';
  const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
  const seg = url.pathname.replace('/rest/v1/', '').split('/');
  if (seg[0] === 'rpc') return handleRpc(req, res, seg[1], body, claims, single);
  const table = `public.${qi(seg[0])}`;
  const params = [];
  try {
    const out = await asUser(claims, async (c) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const where = whereClause(url, params);
        const limit = url.searchParams.get('limit');
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const q = `select ${selectCols(url)} from ${table} ${where} ${orderClause(url)} ${limit ? `limit ${Number(limit)}` : ''} ${offset ? `offset ${offset}` : ''}`;
        const rows = req.method === 'HEAD' ? [] : (await c.query(q, params)).rows;
        let count = null;
        if (/count=exact/.test(prefer)) count = Number((await c.query(`select count(*) from ${table} ${where}`, params)).rows[0].count);
        return { status: 200, rows, count, offset };
      }
      const json = body.length ? JSON.parse(body.toString()) : null;
      const returning = /return=representation/.test(prefer);
      if (req.method === 'POST') {
        const arr = Array.isArray(json) ? json : [json];
        const cols = [...new Set(arr.flatMap((r) => Object.keys(r)))];
        params.push(JSON.stringify(arr));
        const q = `with ins as (insert into ${table} (${cols.map(qi).join(', ')}) select ${cols.map(qi).join(', ')} from json_populate_recordset(null::${table}, $1) returning *) select ${selectCols(url)} from ins`;
        const rows = (await c.query(q, params)).rows;
        return { status: 201, rows: returning ? rows : null };
      }
      if (req.method === 'PATCH') {
        const cols = Object.keys(json);
        params.push(JSON.stringify(json));
        const where = whereClause(url, params);
        const q = `with up as (update ${table} t set (${cols.map(qi).join(', ')}) = (select ${cols.map((x) => `r.${qi(x)}`).join(', ')} from json_populate_record(null::${table}, $1) r) ${where} returning t.*) select ${selectCols(url)} from up`;
        const rows = (await c.query(q.replace(/where /, 'where '), params)).rows;
        return { status: 200, rows: returning ? rows : null };
      }
      if (req.method === 'DELETE') {
        const where = whereClause(url, params);
        const rows = (await c.query(`with del as (delete from ${table} ${where} returning *) select ${selectCols(url)} from del`, params)).rows;
        return { status: 200, rows: returning ? rows : null };
      }
      throw Object.assign(new Error('method not supported'), { code: 'PGRST000' });
    });
    return respondRows(res, out, single);
  } catch (e) {
    return pgError(res, e);
  }
}

function respondRows(res, out, single) {
  const headers = {};
  if (out.count != null) {
    const n = out.rows?.length ?? 0;
    headers['Content-Range'] = n ? `${out.offset}-${out.offset + n - 1}/${out.count}` : `*/${out.count}`;
  }
  if (out.rows == null) return send(res, out.status === 201 ? 201 : 204, undefined, headers);
  if (single) {
    if (out.rows.length !== 1) {
      return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${out.rows.length} rows`, hint: null });
    }
    return send(res, out.status, out.rows[0], headers);
  }
  return send(res, out.status, out.rows, headers);
}

const procCache = new Map();
async function procInfo(name) {
  if (procCache.has(name)) return procCache.get(name);
  const { rows } = await pool.query(`
    select p.proretset, t.typtype, t.typname, p.proargnames, p.pronargs,
      (select array_agg(format_type(x, null) order by o) from unnest(p.proargtypes) with ordinality as a(x, o)) argtypes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and p.proname = $1`, [name]);
  if (!rows[0]) throw Object.assign(new Error(`function ${name} not found`), { code: 'PGRST202' });
  procCache.set(name, rows[0]);
  return rows[0];
}
async function handleRpc(req, res, fn, body, claims, single) {
  try {
    const info = await procInfo(fn);
    const args = body.length ? JSON.parse(body.toString()) : {};
    const params = [];
    const names = (info.proargnames ?? []).slice(0, info.pronargs);
    const parts = [];
    names.forEach((n, i) => {
      if (!(n in args)) return;
      let v = args[n];
      const t = info.argtypes[i];
      if (t === 'jsonb' || t === 'json') v = v == null ? null : JSON.stringify(v);
      params.push(v);
      parts.push(`${qi(n)} => $${params.length}::${t}`);
    });
    const call = `public.${qi(fn)}(${parts.join(', ')})`;
    const out = await asUser(claims, async (c) => {
      if (info.proretset || info.typtype === 'c') {
        const rows = (await c.query(`select * from ${call}`, params)).rows;
        if (!info.proretset) return { status: 200, rows: rows[0] ?? null, scalar: true };
        return { status: 200, rows };
      }
      const r = (await c.query(`select ${call} as r`, params)).rows[0].r;
      return { status: 200, rows: r, scalar: true };
    });
    if (out.scalar) return send(res, 200, out.rows === undefined ? null : out.rows);
    return respondRows(res, out, single);
  } catch (e) {
    return pgError(res, e);
  }
}

// ------------------------------------------------------------ storage ------
/** Extract the file part of a multipart/form-data body (storage-js sends Blobs this way). */
function fileFromMultipart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return null;
  const sep = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(sep);
  while (start >= 0) {
    const next = body.indexOf(sep, start + sep.length);
    if (next < 0) break;
    const part = body.subarray(start + sep.length + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    const headers = part.subarray(0, headerEnd).toString();
    if (/filename=/i.test(headers)) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? 'application/octet-stream';
      return { data: part.subarray(headerEnd + 4), type };
    }
    start = next;
  }
  return null;
}

async function handleStorage(req, res, url, rawBody) {
  let body = rawBody;
  const claims = claimsFrom(req);
  const p = decodeURIComponent(url.pathname.replace('/storage/v1/', ''));
  try {
    let m;
    if ((m = p.match(/^object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'POST') {
      const [, bucket, name] = m;
      const ok = await asUser(claims, async (c) => (await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount);
      if (!ok) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      const token = signJwt({ url: `${bucket}/${name}`, exp: Math.floor(Date.now() / 1000) + 3600 });
      return send(res, 200, { signedURL: `/object/sign/${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}?token=${token}` });
    }
    if ((m = p.match(/^object\/sign\/([^/]+)\/(.+)$/)) && req.method === 'GET') {
      const t = verifyJwt(url.searchParams.get('token'));
      if (!t || t.url !== `${m[1]}/${m[2]}`) return send(res, 400, { error: 'invalid token' });
      const file = path.join(STORAGE_DIR, m[1], m[2]);
      res.writeHead(200, { 'Content-Type': 'application/pdf', ...cors() });
      return fs.createReadStream(file).pipe(res);
    }
    if ((m = p.match(/^object\/([^/]+)\/(.+)$/)) && req.method === 'POST') {
      const [, bucket, name] = m;
      const b = (await pool.query('select * from storage.buckets where id = $1', [bucket])).rows[0];
      if (!b) return send(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      let type = req.headers['content-type'] ?? '';
      if (type.startsWith('multipart/form-data')) {
        const f = fileFromMultipart(body, type);
        if (!f) return send(res, 400, { statusCode: '400', error: 'invalid_request', message: 'No file in form data' });
        body = f.data;
        type = f.type;
      }
      if (b.allowed_mime_types && !b.allowed_mime_types.includes(type.split(';')[0])) {
        return send(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
      }
      if (b.file_size_limit && body.length > Number(b.file_size_limit)) return send(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      await asUser(claims, (c) => c.query('insert into storage.objects(bucket_id, name, owner, metadata) values ($1, $2, auth.uid(), $3)', [bucket, name, { size: body.length, mimetype: type }]));
      const file = path.join(STORAGE_DIR, bucket, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
    }
    if ((m = p.match(/^object\/([^/]+)$/)) && req.method === 'DELETE') {
      const bucket = m[1];
      const { prefixes = [] } = JSON.parse(body.toString() || '{}');
      const rows = await asUser(claims, async (c) => (await c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, prefixes])).rows);
      for (const r of rows) fs.rmSync(path.join(STORAGE_DIR, bucket, r.name), { force: true });
      return send(res, 200, rows.map((r) => ({ name: r.name, bucket_id: bucket })));
    }
    return send(res, 404, { message: `storage route not implemented: ${p}` });
  } catch (e) {
    return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: e.message });
  }
}

// ------------------------------------------------------------- server ------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/__control/offline') {
    offline = url.searchParams.get('v') === '1';
    return send(res, 200, { offline });
  }
  if (req.method === 'OPTIONS') return send(res, 204);
  if (offline) {
    req.socket.destroy(); // simulate a network failure
    return;
  }
  const body = await readBody(req);
  try {
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url, body);
    if (url.pathname.startsWith('/rest/v1')) return await handleRest(req, res, url, body);
    if (url.pathname.startsWith('/storage/v1')) return await handleStorage(req, res, url, body);
    return send(res, 404, { message: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { message: String(e.message ?? e) });
  }
});

server.listen(PORT, () => {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STORAGE_DIR, '..', 'sl-anon-key.txt'), ANON_KEY);
  console.log(`ScreenLab local test stack on http://localhost:${PORT}`);
  console.log(`ANON_KEY=${ANON_KEY}`);
});
