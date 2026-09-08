/* SIPERPUS SD V2 — Cloudflare Worker + D1 frontend */
let API_BASE=(window.SIPERPUS_API_URL||localStorage.getItem('siperpus_api_url')||'').replace(/\/$/,'');
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const dateNow=()=>new Date().toISOString().slice(0,10);
let currentUser=JSON.parse(sessionStorage.getItem('siperpus_user')||'null');
let books=[],members=[],transactions=[];

function ensureApiBase(){
  if(API_BASE) return true;
  const value=prompt('Masukkan URL Cloudflare Worker SIPERPUS:');
  if(!value) return false;
  API_BASE=value.trim().replace(/\/$/,'');
  if(!/^https:\/\//i.test(API_BASE)){
    alert('URL Worker harus diawali https://');
    API_BASE='';
    return false;
  }
  localStorage.setItem('siperpus_api_url',API_BASE);
  return true;
}

async function api(path,options={}){
  if(!ensureApiBase()) throw new Error('URL Worker belum diatur.');
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(currentUser?.token) headers.Authorization=`Bearer ${currentUser.token}`;
  const res=await fetch(API_BASE+path,{...options,headers});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}
function setError(msg){$('#loginError').textContent=msg||''}
function showPage(p){document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));$('#page-'+p).classList.remove('hidden');document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===p));$('#pageTitle').textContent={dashboard:'Dashboard',books:'Data Buku',members:'Data Anggota',transactions:'Transaksi'}[p];loadPage(p)}
async function loadPage(p){try{if(p==='dashboard')await renderDashboard();if(p==='books')await renderBooks();if(p==='members')await renderMembers();if(p==='transactions')await renderTransactions()}catch(e){alert(e.message)}}
async function renderDashboard(){const s=await api('/api/dashboard');$('#statBooks').textContent=s.books;$('#statMembers').textContent=s.members;$('#statBorrowed').textContent=s.borrowed;$('#statLate').textContent=s.late;const tx=await api('/api/transactions');$('#recentTransactions').innerHTML=tx.slice(0,5).map(t=>`<p><b>${esc(t.transaction_code)}</b> — ${esc(t.member_name)} meminjam ${esc(t.book_title)}</p>`).join('')||'<div class="empty">Belum ada transaksi.</div>'}
async function renderBooks(){const q=($('#bookSearch').value||'').trim();books=await api('/api/books'+(q?'?q='+encodeURIComponent(q):''));$('#booksTable').innerHTML=books.map(b=>`<tr><td>${esc(b.code)}</td><td>${esc(b.title)}</td><td>${esc(b.author)}</td><td>${esc(b.category)}</td><td>${esc(b.class_level)}</td><td>${b.available}/${b.stock}</td><td><button onclick="editBook(${b.id})">Edit</button></td></tr>`).join('')||'<tr><td colspan="7">Belum ada buku.</td></tr>'}
async function renderMembers(){const q=($('#memberSearch').value||'').trim();members=await api('/api/members'+(q?'?q='+encodeURIComponent(q):''));$('#membersTable').innerHTML=members.map(m=>`<tr><td>${esc(m.member_code)}</td><td>${esc(m.name)}</td><td>${esc(m.type)}</td><td>${esc(m.class_name)}</td><td>${esc(m.nis)}</td><td><span class="badge available">${m.active?'Aktif':'Nonaktif'}</span></td><td><button onclick="editMember(${m.id})">Edit</button></td></tr>`).join('')||'<tr><td colspan="7">Belum ada anggota.</td></tr>'}
async function renderTransactions(){transactions=await api('/api/transactions');$('#transactionsTable').innerHTML=transactions.map(t=>{const late=t.status==='borrowed'&&t.due_date<dateNow();return `<tr><td>${esc(t.transaction_code)}</td><td>${esc(t.member_name)}</td><td>${esc(t.book_title)}</td><td>${t.borrow_date}</td><td>${t.due_date}</td><td>${t.return_date||'-'}</td><td><span class="badge ${late?'late':t.status==='returned'?'available':'borrowed'}">${late?'Terlambat':t.status==='returned'?'Dikembalikan':'Dipinjam'}</span></td></tr>`}).join('')||'<tr><td colspan="7">Belum ada transaksi.</td></tr>'}
function modal(title,html,handler){$('#modalTitle').textContent=title;$('#modalForm').innerHTML=html;$('#modalForm').onsubmit=async e=>{e.preventDefault();try{await handler(new FormData(e.target));$('#modal').classList.add('hidden')}catch(err){alert(err.message)}};$('#modal').classList.remove('hidden')}
function addBook(existing){modal(existing?'Edit Buku':'Tambah Buku',`<label>Kode Buku</label><input name="code" required value="${esc(existing?.code)}"><label>ISBN</label><input name="isbn" value="${esc(existing?.isbn)}"><label>Judul</label><input name="title" required value="${esc(existing?.title)}"><label>Pengarang</label><input name="author" value="${esc(existing?.author)}"><label>Penerbit</label><input name="publisher" value="${esc(existing?.publisher)}"><label>Tahun</label><input name="year" type="number" value="${esc(existing?.year)}"><label>Kategori</label><input name="category" value="${esc(existing?.category)}"><label>Kelas</label><input name="class_level" value="${esc(existing?.class_level)}"><label>Rak</label><input name="rack" value="${esc(existing?.rack)}"><label>Jumlah Stok</label><input name="stock" type="number" min="0" required value="${existing?.stock??1}"><button>Simpan</button>`,async f=>{const x=Object.fromEntries(f);if(existing)await api('/api/books/'+existing.id,{method:'PUT',body:JSON.stringify(x)});else await api('/api/books',{method:'POST',body:JSON.stringify(x)});await renderBooks();await renderDashboard()})}
window.editBook=x=>addBook(books.find(b=>b.id===Number(x)));
function addMember(existing){modal(existing?'Edit Anggota':'Tambah Anggota',`<label>No. Anggota</label><input name="member_code" required value="${esc(existing?.member_code)}"><label>Nama</label><input name="name" required value="${esc(existing?.name)}"><label>Tipe</label><select name="type"><option value="siswa" ${existing?.type==='siswa'?'selected':''}>siswa</option><option value="guru" ${existing?.type==='guru'?'selected':''}>guru</option></select><label>Kelas</label><input name="class_name" value="${esc(existing?.class_name)}"><label>NIS</label><input name="nis" value="${esc(existing?.nis)}"><label>Telepon</label><input name="phone" value="${esc(existing?.phone)}"><label>Status</label><select name="active"><option value="true" ${existing?.active!==0?'selected':''}>Aktif</option><option value="false" ${existing?.active===0?'selected':''}>Nonaktif</option></select><button>Simpan</button>`,async f=>{const x=Object.fromEntries(f);x.active=x.active!=='false';if(existing)await api('/api/members/'+existing.id,{method:'PUT',body:JSON.stringify(x)});else await api('/api/members',{method:'POST',body:JSON.stringify(x)});await renderMembers();await renderDashboard()})}
window.editMember=x=>addMember(members.find(m=>m.id===Number(x)));
async function borrow(){members=await api('/api/members');books=await api('/api/books');const available=books.filter(b=>Number(b.available)>0);if(!members.length||!available.length)return alert('Tambahkan anggota dan buku yang tersedia terlebih dahulu.');modal('Peminjaman',`<label>Anggota</label><select name="member_id" required>${members.filter(m=>m.active).map(m=>`<option value="${m.id}">${esc(m.member_code)} — ${esc(m.name)}</option>`).join('')}</select><label>Buku</label><select name="book_id" required>${available.map(b=>`<option value="${b.id}">${esc(b.code)} — ${esc(b.title)} (tersedia ${b.available})</option>`).join('')}</select><label>Jatuh Tempo</label><input name="due_date" type="date" required value="${new Date(Date.now()+7*864e5).toISOString().slice(0,10)}"><button>Proses Peminjaman</button>`,async f=>{const x=Object.fromEntries(f);await api('/api/transactions/borrow',{method:'POST',body:JSON.stringify(x)});await renderTransactions();await renderDashboard()})}
async function ret(){transactions=await api('/api/transactions');const active=transactions.filter(t=>t.status==='borrowed');if(!active.length)return alert('Tidak ada buku yang sedang dipinjam.');modal('Pengembalian',`<label>Transaksi</label><select name="trx_id" required>${active.map(t=>`<option value="${t.id}">${esc(t.transaction_code)} — ${esc(t.member_name)} — ${esc(t.book_title)}</option>`).join('')}</select><button>Proses Pengembalian</button>`,async f=>{const x=Object.fromEntries(f);const r=await api('/api/transactions/'+x.trx_id+'/return',{method:'POST'});if(r.fine)alert('Pengembalian berhasil. Denda: Rp '+Number(r.fine).toLocaleString('id-ID'));await renderTransactions();await renderDashboard()})}
$('#loginForm').onsubmit=async e=>{e.preventDefault();setError('');try{const r=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});currentUser={token:r.token,...r.user};sessionStorage.setItem('siperpus_user',JSON.stringify(currentUser));$('#loginPage').classList.add('hidden');$('#app').classList.remove('hidden');$('#userName').textContent=currentUser.name;showPage('dashboard')}catch(err){setError(err.message)}};
$('#logoutBtn').onclick=()=>{sessionStorage.removeItem('siperpus_user');location.reload()};
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$('#addBookBtn').onclick=()=>addBook();$('#addMemberBtn').onclick=()=>addMember();$('#borrowBtn').onclick=borrow;$('#returnBtn').onclick=ret;$('#closeModal').onclick=()=>$('#modal').classList.add('hidden');$('#bookSearch').oninput=()=>renderBooks();$('#memberSearch').oninput=()=>renderMembers();$('#today').textContent=new Date().toLocaleDateString('id-ID',{dateStyle:'full'});
if(currentUser){$('#loginPage').classList.add('hidden');$('#app').classList.remove('hidden');$('#userName').textContent=currentUser.name;showPage('dashboard')}
