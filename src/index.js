const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization, X-Setup-Key'
  }
});

const getOrigin = (request) => request.headers.get('Origin') || '*';
const body = async (request) => { try { return await request.json(); } catch { return {}; } };
const today = () => new Date().toISOString().slice(0, 10);
const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function makeToken(userId, env) {
  const secret = env.SESSION_SECRET || env.SETUP_KEY;
  if (!secret) throw new Error('SESSION_SECRET belum dikonfigurasi.');
  const payload = `${userId}.${Date.now() + 1000 * 60 * 60 * 12}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

async function auth(request, env) {
  const raw = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  if (!/^\d+$/.test(userId) || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return null;
  const secret = env.SESSION_SECRET || env.SETUP_KEY;
  if (!secret) return null;
  const expected = await hmac(secret, `${userId}.${expires}`);
  if (expected.toLowerCase() !== signature.toLowerCase()) return null;
  return await env.DB.prepare('SELECT id,username,name,role FROM users WHERE id=? AND active=1').bind(Number(userId)).first();
}

const isAdmin = (user) => user?.role === 'admin';
const uniqueError = (error, fallback) => String(error?.message || '').includes('UNIQUE constraint failed') ? 'Data dengan kode tersebut sudah ada.' : fallback;

export default {
  async fetch(request, env) {
    const origin = getOrigin(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Setup-Key'
    }});

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/' || path === '/api/health') return json({ ok: true, app: 'SIPERPUS SD', service: 'Cloudflare Worker + D1', date: today() }, 200, origin);

      if (path === '/api/login' && request.method === 'POST') {
        const x = await body(request);
        const username = clean(x.username, 100);
        const password = String(x.password || '');
        if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400, origin);
        const user = await env.DB.prepare('SELECT id,username,password_hash,name,role,active FROM users WHERE username=?').bind(username).first();
        if (!user || !user.active || user.password_hash !== await sha256(password)) return json({ error: 'Username atau password salah.' }, 401, origin);
        return json({ ok: true, token: await makeToken(user.id, env), user: { id: user.id, username: user.username, name: user.name, role: user.role } }, 200, origin);
      }

      if (path === '/api/setup-admin' && request.method === 'POST') {
        const key = request.headers.get('X-Setup-Key');
        if (!env.SETUP_KEY || key !== env.SETUP_KEY) return json({ error: 'Setup key tidak valid.' }, 403, origin);
        const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        if (Number(count?.n || 0) > 0) return json({ error: 'Akun sudah ada. Setup ditolak.' }, 409, origin);
        const x = await body(request);
        const username = clean(x.username || 'admin', 100), password = String(x.password || ''), name = clean(x.name || 'Administrator', 150);
        if (!username || !password || password.length < 8 || !name) return json({ error: 'Username, nama, dan password minimal 8 karakter wajib diisi.' }, 400, origin);
        await env.DB.prepare('INSERT INTO users (username,password_hash,name,role,active) VALUES (?,?,?,?,1)').bind(username, await sha256(password), name, 'admin').run();
        return json({ ok: true, message: 'Admin berhasil dibuat.' }, 201, origin);
      }

      const user = await auth(request, env);
      if (!user) return json({ error: 'Unauthorized' }, 401, origin);

      if (path === '/api/me' && request.method === 'GET') return json({ ok: true, user }, 200, origin);

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
          const q = clean(url.searchParams.get('q'), 100);
          const result = q ? await env.DB.prepare("SELECT * FROM books WHERE code LIKE ? OR title LIKE ? OR author LIKE ? OR category LIKE ? OR class_level LIKE ? ORDER BY id DESC").bind(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`).all() : await env.DB.prepare('SELECT * FROM books ORDER BY id DESC').all();
          return json(result.results || [], 200, origin);
        }
        if (request.method === 'POST') {
          const x = await body(request), code = clean(x.code, 100), title = clean(x.title, 300);
          if (!code || !title) return json({ error: 'Kode dan judul buku wajib diisi.' }, 400, origin);
          const stock = Math.max(0, Math.floor(Number(x.stock ?? 0)) || 0);
          if (stock > 100000) return json({ error: 'Stok terlalu besar.' }, 400, origin);
          try {
            await env.DB.prepare('INSERT INTO books (code,isbn,title,author,publisher,year,category,class_level,rack,stock,available,cover,condition) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(code,clean(x.isbn,100)||null,title,clean(x.author,200)||null,clean(x.publisher,200)||null,x.year ? Number(x.year) : null,clean(x.category,100)||null,clean(x.class_level,100)||null,clean(x.rack,100)||null,stock,stock,clean(x.cover,1000)||null,clean(x.condition,50)||'Baik').run();
          } catch (e) { return json({ error: uniqueError(e, 'Gagal menambahkan buku.') }, 400, origin); }
          return json({ ok: true }, 201, origin);
        }
      }

      const bookMatch = path.match(/^\/api\/books\/(\d+)$/);
      if (bookMatch && request.method === 'DELETE') { const id=Number(bookMatch[1]); const h=await env.DB.prepare('SELECT COUNT(*) AS n FROM transactions WHERE book_id=?').bind(id).first(); if(Number(h?.n||0)>0)return json({error:'Buku memiliki riwayat transaksi.'},409,origin); await env.DB.prepare('DELETE FROM books WHERE id=?').bind(id).run(); return json({ok:true},200,origin); }
      if (bookMatch && request.method === 'PUT') {
        const id = Number(bookMatch[1]), x = await body(request);
        const old = await env.DB.prepare('SELECT stock,available FROM books WHERE id=?').bind(id).first();
        if (!old) return json({ error: 'Buku tidak ditemukan.' }, 404, origin);
        const code = clean(x.code,100), title = clean(x.title,300);
        if (!code || !title) return json({ error: 'Kode dan judul buku wajib diisi.' }, 400, origin);
        const stock = Math.max(0, Math.floor(Number(x.stock ?? old.stock)) || 0), borrowed = Math.max(0, Number(old.stock || 0) - Number(old.available || 0));
        if (stock < borrowed) return json({ error: `Stok tidak boleh kurang dari jumlah buku yang sedang dipinjam (${borrowed}).` }, 400, origin);
        try {
          await env.DB.prepare('UPDATE books SET code=?,isbn=?,title=?,author=?,publisher=?,year=?,category=?,class_level=?,rack=?,stock=?,available=?,cover=?,condition=? WHERE id=?').bind(code,clean(x.isbn,100)||null,title,clean(x.author,200)||null,clean(x.publisher,200)||null,x.year ? Number(x.year) : null,clean(x.category,100)||null,clean(x.class_level,100)||null,clean(x.rack,100)||null,stock,stock-borrowed,clean(x.cover,1000)||null,clean(x.condition,50)||'Baik',id).run();
        } catch (e) { return json({ error: uniqueError(e, 'Gagal memperbarui buku.') }, 400, origin); }
        return json({ ok: true }, 200, origin);
      }

      if (path === '/api/members') {
        if (request.method === 'GET') {
          const q = clean(url.searchParams.get('q'), 100);
          const result = q ? await env.DB.prepare("SELECT * FROM members WHERE member_code LIKE ? OR name LIKE ? OR nis LIKE ? OR class_name LIKE ? ORDER BY id DESC").bind(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`).all() : await env.DB.prepare('SELECT * FROM members ORDER BY id DESC').all();
          return json(result.results || [], 200, origin);
        }
        if (request.method === 'POST') {
          const x = await body(request), code = clean(x.member_code,100), name = clean(x.name,200);
          if (!code || !name) return json({ error: 'No. anggota dan nama wajib diisi.' }, 400, origin);
          try { await env.DB.prepare('INSERT INTO members (member_code,name,type,class_name,nis,phone,active) VALUES (?,?,?,?,?,?,1)').bind(code,name,clean(x.type,30)||'siswa',clean(x.class_name,100)||null,clean(x.nis,100)||null,clean(x.phone,50)||null).run(); }
          catch (e) { return json({ error: uniqueError(e, 'Gagal menambahkan anggota.') }, 400, origin); }
          return json({ ok: true }, 201, origin);
        }
      }

      const memberMatch = path.match(/^\/api\/members\/(\d+)$/);
      if (memberMatch && request.method === 'DELETE') { const id=Number(memberMatch[1]); const h=await env.DB.prepare('SELECT COUNT(*) AS n FROM transactions WHERE member_id=?').bind(id).first(); if(Number(h?.n||0)>0)return json({error:'Anggota memiliki riwayat transaksi.'},409,origin); await env.DB.prepare('DELETE FROM members WHERE id=?').bind(id).run(); return json({ok:true},200,origin); }
      if (memberMatch && request.method === 'PUT') {
        const id = Number(memberMatch[1]), x = await body(request);
        if (!await env.DB.prepare('SELECT id FROM members WHERE id=?').bind(id).first()) return json({ error: 'Anggota tidak ditemukan.' }, 404, origin);
        const code = clean(x.member_code,100), name = clean(x.name,200);
        if (!code || !name) return json({ error: 'No. anggota dan nama wajib diisi.' }, 400, origin);
        try { await env.DB.prepare('UPDATE members SET member_code=?,name=?,type=?,class_name=?,nis=?,phone=?,active=? WHERE id=?').bind(code,name,clean(x.type,30)||'siswa',clean(x.class_name,100)||null,clean(x.nis,100)||null,clean(x.phone,50)||null,x.active === false ? 0 : 1,id).run(); }
        catch (e) { return json({ error: uniqueError(e, 'Gagal memperbarui anggota.') }, 400, origin); }
        return json({ ok: true }, 200, origin);
      }

      if (path === '/api/transactions' && request.method === 'GET') {
        const result = await env.DB.prepare('SELECT t.*,m.member_code,m.name AS member_name,b.code AS book_code,b.title AS book_title FROM transactions t JOIN members m ON m.id=t.member_id JOIN books b ON b.id=t.book_id ORDER BY t.id DESC').all();
        return json(result.results || [], 200, origin);
      }

      if (path === '/api/transactions/borrow' && request.method === 'POST') {
        const x = await body(request), memberId = Number(x.member_id), bookId = Number(x.book_id), borrowDate = validDate(x.borrow_date) ? x.borrow_date : today(), dueDate = x.due_date;
        if (!Number.isInteger(memberId) || memberId < 1 || !Number.isInteger(bookId) || bookId < 1 || !validDate(dueDate)) return json({ error: 'Anggota, buku, dan tanggal yang valid wajib diisi.' }, 400, origin);
        if (dueDate < borrowDate) return json({ error: 'Tanggal jatuh tempo tidak boleh sebelum tanggal pinjam.' }, 400, origin);
        const member = await env.DB.prepare('SELECT id,name FROM members WHERE id=? AND active=1').bind(memberId).first();
        const book = await env.DB.prepare('SELECT id,title,available FROM books WHERE id=?').bind(bookId).first();
        if (!member || !book) return json({ error: 'Anggota atau buku tidak ditemukan.' }, 404, origin);
        if (Number(book.available) < 1) return json({ error: 'Stok buku tidak tersedia.' }, 400, origin);
        const code = 'TRX-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        await env.DB.batch([
          env.DB.prepare("INSERT INTO transactions (transaction_code,member_id,book_id,borrow_date,due_date,status,fine,user_id) VALUES (?,?,?,?,?,'borrowed',0,?)").bind(code,member.id,book.id,borrowDate,dueDate,user.id),
          env.DB.prepare('UPDATE books SET available=available-1 WHERE id=? AND available>0').bind(book.id)
        ]);
        return json({ ok: true, transaction_code: code }, 201, origin);
      }

      const transactionMatch = path.match(/^\/api\/transactions\/(\d+)$/);
      if (transactionMatch && request.method === 'DELETE') { const id=Number(transactionMatch[1]); const t=await env.DB.prepare('SELECT book_id,status FROM transactions WHERE id=?').bind(id).first(); if(!t)return json({error:'Transaksi tidak ditemukan.'},404,origin); if(t.status==='borrowed'){ await env.DB.batch([env.DB.prepare('DELETE FROM transactions WHERE id=?').bind(id),env.DB.prepare('UPDATE books SET available=MIN(stock,available+1) WHERE id=?').bind(t.book_id)]); } else { await env.DB.prepare('DELETE FROM transactions WHERE id=?').bind(id).run(); } return json({ok:true},200,origin); }

      const returnMatch = path.match(/^\/api\/transactions\/(\d+)\/return$/);
      if (returnMatch && request.method === 'POST') {
        const id = Number(returnMatch[1]), trx = await env.DB.prepare('SELECT id,book_id,status,due_date FROM transactions WHERE id=?').bind(id).first();
        if (!trx) return json({ error: 'Transaksi tidak ditemukan.' }, 404, origin);
        if (trx.status === 'returned') return json({ error: 'Transaksi sudah dikembalikan.' }, 400, origin);
        const overdueDays = trx.due_date < today() ? Math.max(0, Math.floor((Date.parse(today()) - Date.parse(trx.due_date)) / 86400000)) : 0;
        const fine = overdueDays * 1000;
        await env.DB.batch([
          env.DB.prepare("UPDATE transactions SET status='returned',return_date=?,fine=? WHERE id=? AND status='borrowed'").bind(today(),fine,id),
          env.DB.prepare('UPDATE books SET available=MIN(stock,available+1) WHERE id=?').bind(trx.book_id)
        ]);
        return json({ ok: true, fine, overdue_days: overdueDays }, 200, origin);
      }

      if (path === '/api/users' && request.method === 'GET') {
        if (!isAdmin(user)) return json({ error: 'Akses admin diperlukan.' }, 403, origin);
        const result = await env.DB.prepare('SELECT id,username,name,role,active,created_at FROM users ORDER BY id DESC').all();
        return json(result.results || [], 200, origin);
      }

      return json({ error: 'Endpoint tidak ditemukan.' }, 404, origin);
    } catch (error) {
      console.error(error);
      return json({ error: 'Server error', detail: error?.message || String(error) }, 500, origin);
    }
  }
};
