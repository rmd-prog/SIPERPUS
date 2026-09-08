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

      if (path === '/api/setup-admin' && request.method === 'POST') {
        const key = request.headers.get('X-Setup-Key');
        if (!env.SETUP_KEY || key !== env.SETUP_KEY) return json({ error: 'Setup key tidak valid.' }, 403, origin);
        const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        if (Number(count?.n || 0) > 0) return json({ error: 'Akun sudah ada. Setup ditolak.' }, 409, origin);
        const { username = 'admin', password, name = 'Administrator' } = await body(request);
        if (!password || password.length < 8) return json({ error: 'Password minimal 8 karakter.' }, 400, origin);
        await env.DB.prepare('INSERT INTO users (username,password_hash,name,role,active) VALUES (?,?,?,?,1)')
          .bind(username.trim(), await sha256(password), name.trim(), 'admin').run();
        return json({ ok: true, message: 'Admin berhasil dibuat.' }, 201, origin);
      }

      const user = await auth(request, env);
      if (!user) return json({ error: 'Unauthorized' }, 401, origin);

      if (path === '/api/dashboard' && request.method === 'GET') {
        const [books, members, borrowed, late] = await Promise.all([
          env.DB.prepare('SELECT COALESCE(SUM(stock),0) AS n FROM books').first(),
          env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE active=1').first(),
          env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status='borrowed'").first(),
          env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status='borrowed' AND due_date<?").bind(today()).first()
        ]);
        return json({ books: Number(books?.n || 0), members: Number(members?.n || 0), borrowed: Number(borrowed?.n || 0), late: Number(late?.n || 0) }, 200, origin);
      }

      if (path === '/api/books') {
        if (request.method === 'GET') {
          const q = (url.searchParams.get('q') || '').trim();
          const result = q
            ? await env.DB.prepare("SELECT * FROM books WHERE code LIKE ? OR title LIKE ? OR author LIKE ? OR category LIKE ? OR class_level LIKE ? ORDER BY id DESC").bind(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`).all()
            : await env.DB.prepare('SELECT * FROM books ORDER BY id DESC').all();
          return json(result.results || [], 200, origin);
        }
        if (request.method === 'POST') {
          const x = await body(request);
          if (!x.code || !x.title) return json({ error: 'Kode dan judul buku wajib diisi.' }, 400, origin);
          const stock = Math.max(0, Number(x.stock || 0));
          await env.DB.prepare(`INSERT INTO books (code,isbn,title,author,publisher,year,category,class_level,rack,stock,available,cover,condition) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(x.code,x.isbn||null,x.title,x.author||null,x.publisher||null,x.year?Number(x.year):null,x.category||null,x.class_level||null,x.rack||null,stock,stock,x.cover||null,x.condition||'Baik').run();
          return json({ ok: true }, 201, origin);
        }
      }

      const bookMatch = path.match(/^\/api\/books\/(\d+)$/);
      if (bookMatch && request.method === 'PUT') {
        const x = await body(request);
        const old = await env.DB.prepare('SELECT stock,available FROM books WHERE id=?').bind(Number(bookMatch[1])).first();
        if (!old) return json({ error: 'Buku tidak ditemukan.' }, 404, origin);
        const stock = Math.max(0, Number(x.stock ?? old.stock));
        const borrowed = Math.max(0, Number(old.stock || 0) - Number(old.available || 0));
        if (stock < borrowed) return json({ error: `Stok tidak boleh kurang dari jumlah buku yang sedang dipinjam (${borrowed}).` }, 400, origin);
        const available = stock - borrowed;
        await env.DB.prepare(`UPDATE books SET code=?,isbn=?,title=?,author=?,publisher=?,year=?,category=?,class_level=?,rack=?,stock=?,available=?,cover=?,condition=? WHERE id=?`)
          .bind(x.code,x.isbn||null,x.title,x.author||null,x.publisher||null,x.year?Number(x.year):null,x.category||null,x.class_level||null,x.rack||null,stock,available,x.cover||null,x.condition||'Baik',Number(bookMatch[1])).run();
        return json({ ok: true }, 200, origin);
      }

      if (path === '/api/members') {
        if (request.method === 'GET') {
          const q = (url.searchParams.get('q') || '').trim();
          const result = q
            ? await env.DB.prepare("SELECT * FROM members WHERE member_code LIKE ? OR name LIKE ? OR nis LIKE ? OR class_name LIKE ? ORDER BY id DESC").bind(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`).all()
            : await env.DB.prepare('SELECT * FROM members ORDER BY id DESC').all();
          return json(result.results || [], 200, origin);
        }
        if (request.method === 'POST') {
          const x = await body(request);
          if (!x.member_code || !x.name) return json({ error: 'No. anggota dan nama wajib diisi.' }, 400, origin);
          await env.DB.prepare('INSERT INTO members (member_code,name,type,class_name,nis,phone,active) VALUES (?,?,?,?,?,?,1)')
            .bind(x.member_code,x.name,x.type||'siswa',x.class_name||null,x.nis||null,x.phone||null).run();
          return json({ ok: true }, 201, origin);
        }
      }

      const memberMatch = path.match(/^\/api\/members\/(\d+)$/);
      if (memberMatch && request.method === 'PUT') {
        const x = await body(request);
        await env.DB.prepare('UPDATE members SET member_code=?,name=?,type=?,class_name=?,nis=?,phone=?,active=? WHERE id=?')
          .bind(x.member_code,x.name,x.type||'siswa',x.class_name||null,x.nis||null,x.phone||null,x.active === false ? 0 : 1,Number(memberMatch[1])).run();
        return json({ ok: true }, 200, origin);
      }

      if (path === '/api/transactions' && request.method === 'GET') {
        const result = await env.DB.prepare(`SELECT t.*,m.member_code,m.name AS member_name,b.code AS book_code,b.title AS book_title FROM transactions t JOIN members m ON m.id=t.member_id JOIN books b ON b.id=t.book_id ORDER BY t.id DESC`).all();
        return json(result.results || [], 200, origin);
      }

      if (path === '/api/transactions/borrow' && request.method === 'POST') {
        const x = await body(request);
        if (!x.member_id || !x.book_id || !x.due_date) return json({ error: 'Anggota, buku, dan tanggal jatuh tempo wajib diisi.' }, 400, origin);
        const member = await env.DB.prepare('SELECT id,name FROM members WHERE id=? AND active=1').bind(Number(x.member_id)).first();
        const book = await env.DB.prepare('SELECT id,title,available FROM books WHERE id=?').bind(Number(x.book_id)).first();
        if (!member || !book) return json({ error: 'Anggota atau buku tidak ditemukan.' }, 404, origin);
        if (Number(book.available) < 1) return json({ error: 'Stok buku tidak tersedia.' }, 400, origin);
        const code = 'TRX-' + Date.now();
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO transactions (transaction_code,member_id,book_id,borrow_date,due_date,status,fine,user_id) VALUES (?,?,?,?,?,'borrowed',0,?)`).bind(code,member.id,book.id,today(),x.due_date,user.id),
          env.DB.prepare('UPDATE books SET available=available-1 WHERE id=?').bind(book.id)
        ]);
        return json({ ok: true, transaction_code: code }, 201, origin);
      }

      const returnMatch = path.match(/^\/api\/transactions\/(\d+)\/return$/);
      if (returnMatch && request.method === 'POST') {
        const trx = await env.DB.prepare('SELECT id,book_id,status,due_date FROM transactions WHERE id=?').bind(Number(returnMatch[1])).first();
        if (!trx) return json({ error: 'Transaksi tidak ditemukan.' }, 404, origin);
        if (trx.status === 'returned') return json({ error: 'Transaksi sudah dikembalikan.' }, 400, origin);
        const fine = trx.due_date < today() ? Math.max(0, Math.round((Date.parse(today()) - Date.parse(trx.due_date)) / 86400000)) * 1000 : 0;
        await env.DB.batch([
          env.DB.prepare("UPDATE transactions SET status='returned',return_date=?,fine=? WHERE id=?").bind(today(),fine,trx.id),
          env.DB.prepare('UPDATE books SET available=available+1 WHERE id=?').bind(trx.book_id)
        ]);
        return json({ ok: true, fine }, 200, origin);
      }

      return json({ error: 'Endpoint tidak ditemukan.' }, 404, origin);
    } catch (error) {
      console.error(error);
      return json({ error: 'Server error', detail: error?.message || String(error) }, 500, origin);
    }
  }
};
