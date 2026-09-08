const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization, X-Setup-Key'
  }
});

const getOrigin = (request) => request.headers.get('Origin') || '*';
const body = async (request) => {
  try { return await request.json(); } catch { return {}; }
};
const today = () => new Date().toISOString().slice(0, 10);

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function auth(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const session = await env.DB.prepare(
    'SELECT u.id,u.username,u.name,u.role FROM users u WHERE u.id=? AND u.active=1'
  ).bind(Number(token)).first();
  return session || null;
}

export default {
  async fetch(request, env) {
    const origin = getOrigin(request);
    if (request.method === 'OPTIONS') return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization, X-Setup-Key'
      }
    });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/' || path === '/api/health') {
        return json({ ok: true, app: 'SIPERPUS SD', service: 'Cloudflare Worker + D1' }, 200, origin);
      }

      if (path === '/api/login' && request.method === 'POST') {
        const { username, password } = await body(request);
        if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400, origin);
        const user = await env.DB.prepare('SELECT id,username,password_hash,name,role,active FROM users WHERE username=?').bind(username.trim()).first();
        if (!user || !user.active || user.password_hash !== await sha256(password)) {
          return json({ error: 'Username atau password salah.' }, 401, origin);
        }
        return json({ ok: true, token: String(user.id), user: { id: user.id, username: user.username, name: user.name, role: user.role } }, 200, origin);
      }

      if (path ===
