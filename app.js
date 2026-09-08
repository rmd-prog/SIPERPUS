/* ============================================================
   SIPERPUS SD V10 - app.js
   Frontend logic. API_BASE hardcoded ke Cloudflare Worker.
   ============================================================ */

const API_BASE = "https://siperpus.adm-sd.workers.dev";

/* ---------------- State ---------------- */
const state = {
  token: localStorage.getItem("siperpus_token") || null,
  user: JSON.parse(localStorage.getItem("siperpus_user") || "null"),
  books: [],
  members: [],
  transactions: [],
  currentPage: "dashboard",
};

/* ---------------- Utilities ---------------- */

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return escapeHtml(dateStr);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCurrency(n) {
  const num = Number(n) || 0;
  return "Rp " + num.toLocaleString("id-ID");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isOverdue(tx) {
  if (tx.status !== "borrowed") return false;
  const due = new Date(tx.due_date);
  const now = new Date();
  due.setHours(23, 59, 59, 999);
  return now > due;
}

/* ---------------- Toast ---------------- */

const ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>',
};

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast " + type;
  toast.innerHTML = (ICONS[type] || ICONS.info) + "<span>" + escapeHtml(message) + "</span>";
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity .25s";
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

/* ---------------- API wrapper ---------------- */

async function apiFetch(path, options = {}) {
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers || {}
  );
  if (state.token) {
    headers["Authorization"] = "Bearer " + state.token;
  }

  let res;
  try {
    res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  } catch (err) {
    showToast("Tidak bisa terhubung ke server. Periksa koneksi internet.", "error");
    throw err;
  }

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || "Terjadi kesalahan pada server (" + res.status + ")";
    throw new Error(msg);
  }

  return data;
}

function handleUnauthorized() {
  clearSession();
  showLoginView();
  showToast("Sesi berakhir, silakan masuk kembali.", "error");
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("siperpus_token");
  localStorage.removeItem("siperpus_user");
}

/* ---------------- Auth / views ---------------- */

function showLoginView() {
  document.getElementById("login-view").style.display = "flex";
  document.getElementById("app-view").style.display = "none";
}

function showAppView() {
  document.getElementById("login-view").style.display = "none";
  document.getElementById("app-view").style.display = "block";
  document.getElementById("sidebar-username").textContent = state.user?.name || state.user?.username || "-";
  document.getElementById("sidebar-role").textContent = state.user?.role || "-";
  const hour = new Date().getHours();
  const greet = hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 18 ? "Selamat sore" : "Selamat malam";
  document.getElementById("dashboard-greeting").textContent = greet + ", " + (state.user?.name || state.user?.username || "");
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errorBox = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  errorBox.style.display = "none";

  if (!username || !password) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Memproses...";

  try {
    const data = await apiFetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    if (!data || !data.token) {
      throw new Error("Login gagal, respons tidak valid.");
    }

    state.token = data.token;
    state.user = data.user || { username };
    localStorage.setItem("siperpus_token", state.token);
    localStorage.setItem("siperpus_user", JSON.stringify(state.user));

    showAppView();
    navigateTo("dashboard");
    showToast("Berhasil masuk. Selamat bekerja!", "success");
  } catch (err) {
    errorBox.textContent = err.message || "Username atau password salah.";
    errorBox.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Masuk";
  }
}

function handleLogout() {
  clearSession();
  showLoginView();
  document.getElementById("login-form").reset();
  showToast("Berhasil keluar.", "info");
}

/* ---------------- Navigation ---------------- */

function navigateTo(page) {
  state.currentPage = page;
  document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  document.querySelectorAll(".nav-link").forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });
  closeSidebarMobile();

  if (page === "dashboard") loadDashboard();
  if (page === "buku") loadBooks();
  if (page === "anggota") loadMembers();
  if (page === "transaksi") loadTransactions();
}

function closeSidebarMobile() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-backdrop").classList.remove("active");
}

/* ---------------- Modal helpers ---------------- */

function openModal(id) {
  document.getElementById(id).classList.add("active");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

/* ---------------- Dashboard ---------------- */

async function loadDashboard() {
  const body = document.getElementById("dashboard-recent-body");
  body.innerHTML = '<tr><td colspan="5" class="loading-row"><span class="spinner"></span>Memuat data...</td></tr>';

  try {
    const data = await apiFetch("/api/dashboard");

    document.getElementById("stat-total-buku").textContent = data.books ?? "0";
    document.getElementById("stat-total-anggota").textContent = data.members ?? "0";
    document.getElementById("stat-dipinjam").textContent = data.borrowed ?? "0";
    document.getElementById("stat-terlambat").textContent = data.late ?? "0";
  } catch (err) {
    if (err.message !== "Unauthorized") {
      showToast("Gagal memuat ringkasan dashboard: " + err.message, "error");
    }
  }

  try {
    const txData = await apiFetch("/api/transactions");
    const list = (Array.isArray(txData) ? txData : txData.transactions || txData.data || []).slice(0, 5);
    state.transactions = Array.isArray(txData) ? txData : txData.transactions || txData.data || [];

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>Belum ada transaksi.</p></div></td></tr>';
      return;
    }

    body.innerHTML = list
      .map(
        (tx) => `
      <tr>
        <td class="cell-title">${escapeHtml(tx.transaction_code)}</td>
        <td>${escapeHtml(tx.member_name || tx.member || "-")}</td>
        <td>${escapeHtml(tx.book_title || tx.book || "-")}</td>
        <td>${formatDate(tx.borrow_date)}</td>
        <td>${statusBadge(tx)}</td>
      </tr>`
      )
      .join("");
  } catch (err) {
    if (err.message !== "Unauthorized") {
      body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>Gagal memuat transaksi terbaru: ' + escapeHtml(err.message) + "</p></div></td></tr>";
    }
  }
}

function statusBadge(tx) {
  if (tx.status === "returned") return '<span class="badge badge-success">Dikembalikan</span>';
  if (isOverdue(tx)) return '<span class="badge badge-danger">Terlambat</span>';
  if (tx.status === "borrowed") return '<span class="badge badge-warn">Dipinjam</span>';
  return '<span class="badge badge-neutral">' + escapeHtml(tx.status) + "</span>";
}

/* ---------------- Data Buku ---------------- */

async function loadBooks() {
  const body = document.getElementById("buku-table-body");
  body.innerHTML = '<tr><td colspan="8" class="loading-row"><span class="spinner"></span>Memuat data buku...</td></tr>';
  try {
    const data = await apiFetch("/api/books");
    state.books = data.books || data.data || data || [];
    renderBooks(state.books);
  } catch (err) {
    if (err.message !== "Unauthorized") {
      body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><p>Gagal memuat buku: ' + escapeHtml(err.message) + "</p></div></td></tr>";
    }
  }
}

function renderBooks(list) {
  const body = document.getElementById("buku-table-body");
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><p>Belum ada buku yang cocok.</p></div></td></tr>';
    return;
  }
  body.innerHTML = list
    .map(
      (b) => `
    <tr>
      <td>
        <div class="cell-title">${escapeHtml(b.title)}</div>
        <div class="cell-sub">${escapeHtml(b.code)}${b.author ? " &middot; " + escapeHtml(b.author) : ""}</div>
      </td>
      <td>${escapeHtml(b.category || "-")}</td>
      <td>${escapeHtml(b.class_level || "-")}</td>
      <td>${escapeHtml(b.rack || "-")}</td>
      <td>${escapeHtml(b.stock)}</td>
      <td>${escapeHtml(b.available)}</td>
      <td>${conditionBadge(b.condition)}</td>
      <td><button class="btn btn-ghost btn-sm" data-edit-buku="${b.id}">Edit</button> <button class="btn btn-sm" style="background:#dc2626" data-delete-buku="${b.id}">Hapus</button></td>
    </tr>`
    )
    .join("");
}

function conditionBadge(cond) {
  if (cond === "Rusak Berat") return '<span class="badge badge-danger">' + escapeHtml(cond) + "</span>";
  if (cond === "Rusak Ringan") return '<span class="badge badge-warn">' + escapeHtml(cond) + "</span>";
  return '<span class="badge badge-success">' + escapeHtml(cond || "Baik") + "</span>";
}

function openBukuModal(book) {
  document.getElementById("form-buku").reset();
  document.getElementById("buku-id").value = "";
  document.getElementById("modal-buku-title").textContent = book ? "Edit Buku" : "Tambah Buku";
  if (book) {
    document.getElementById("buku-id").value = book.id;
    document.getElementById("buku-code").value = book.code || "";
    document.getElementById("buku-isbn").value = book.isbn || "";
    document.getElementById("buku-title").value = book.title || "";
    document.getElementById("buku-author").value = book.author || "";
    document.getElementById("buku-publisher").value = book.publisher || "";
    document.getElementById("buku-year").value = book.year || "";
    document.getElementById("buku-category").value = book.category || "";
    document.getElementById("buku-class-level").value = book.class_level || "";
    document.getElementById("buku-rack").value = book.rack || "";
    document.getElementById("buku-stock").value = book.stock ?? 0;
    document.getElementById("buku-condition").value = book.condition || "Baik";
  }
  openModal("modal-buku");
}

async function saveBuku() {
  const id = document.getElementById("buku-id").value;
  const payload = {
    code: document.getElementById("buku-code").value.trim(),
    isbn: document.getElementById("buku-isbn").value.trim(),
    title: document.getElementById("buku-title").value.trim(),
    author: document.getElementById("buku-author").value.trim(),
    publisher: document.getElementById("buku-publisher").value.trim(),
    year: document.getElementById("buku-year").value ? Number(document.getElementById("buku-year").value) : null,
    category: document.getElementById("buku-category").value.trim(),
    class_level: document.getElementById("buku-class-level").value.trim(),
    rack: document.getElementById("buku-rack").value.trim(),
    stock: Number(document.getElementById("buku-stock").value || 0),
    condition: document.getElementById("buku-condition").value,
  };

  if (!payload.code || !payload.title) {
    showToast("Kode buku dan judul wajib diisi.", "error");
    return;
  }
  if (!id) {
    payload.available = payload.stock;
  }

  const btn = document.getElementById("save-buku-btn");
  btn.disabled = true;
  btn.textContent = "Menyimpan...";
  try {
    if (id) {
      await apiFetch("/api/books/" + id, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Buku berhasil diperbarui.", "success");
    } else {
      await apiFetch("/api/books", { method: "POST", body: JSON.stringify(payload) });
      showToast("Buku berhasil ditambahkan.", "success");
    }
    closeModal("modal-buku");
    loadBooks();
  } catch (err) {
    if (err.message !== "Unauthorized") showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan";
  }
}

/* ---------------- Anggota ---------------- */

async function loadMembers() {
  const body = document.getElementById("anggota-table-body");
  body.innerHTML = '<tr><td colspan="6" class="loading-row"><span class="spinner"></span>Memuat data anggota...</td></tr>';
  try {
    const data = await apiFetch("/api/members");
    state.members = data.members || data.data || data || [];
    renderMembers(state.members);
  } catch (err) {
    if (err.message !== "Unauthorized") {
      body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><p>Gagal memuat anggota: ' + escapeHtml(err.message) + "</p></div></td></tr>";
    }
  }
}

function renderMembers(list) {
  const body = document.getElementById("anggota-table-body");
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><p>Belum ada anggota yang cocok.</p></div></td></tr>';
    return;
  }
  body.innerHTML = list
    .map(
      (m) => `
    <tr>
      <td>
        <div class="cell-title">${escapeHtml(m.name)}</div>
        <div class="cell-sub">${escapeHtml(m.member_code)}</div>
      </td>
      <td><span class="badge badge-neutral">${escapeHtml(capitalize(m.type))}</span></td>
      <td>${escapeHtml(m.class_name || "-")}</td>
      <td>${escapeHtml(m.nis || "-")}</td>
      <td>${escapeHtml(m.phone || "-")}</td>
      <td><button class="btn btn-ghost btn-sm" data-edit-anggota="${m.id}">Edit</button> <button class="btn btn-sm" style="background:#dc2626" data-delete-anggota="${m.id}">Hapus</button></td>
    </tr>`
    )
    .join("");
}

function capitalize(s) {
  if (!s) return "-";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function openAnggotaModal(member) {
  document.getElementById("form-anggota").reset();
  document.getElementById("anggota-id").value = "";
  document.getElementById("modal-anggota-title").textContent = member ? "Edit Anggota" : "Tambah Anggota";
  if (member) {
    document.getElementById("anggota-id").value = member.id;
    document.getElementById("anggota-code").value = member.member_code || "";
    document.getElementById("anggota-type").value = member.type || "siswa";
    document.getElementById("anggota-name").value = member.name || "";
    document.getElementById("anggota-class").value = member.class_name || "";
    document.getElementById("anggota-nis").value = member.nis || "";
    document.getElementById("anggota-phone").value = member.phone || "";
  }
  openModal("modal-anggota");
}

async function saveAnggota() {
  const id = document.getElementById("anggota-id").value;
  const payload = {
    member_code: document.getElementById("anggota-code").value.trim(),
    type: document.getElementById("anggota-type").value,
    name: document.getElementById("anggota-name").value.trim(),
    class_name: document.getElementById("anggota-class").value.trim(),
    nis: document.getElementById("anggota-nis").value.trim(),
    phone: document.getElementById("anggota-phone").value.trim(),
  };

  if (!payload.member_code || !payload.name) {
    showToast("Kode anggota dan nama wajib diisi.", "error");
    return;
  }

  const btn = document.getElementById("save-anggota-btn");
  btn.disabled = true;
  btn.textContent = "Menyimpan...";
  try {
    if (id) {
      await apiFetch("/api/members/" + id, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Anggota berhasil diperbarui.", "success");
    } else {
      await apiFetch("/api/members", { method: "POST", body: JSON.stringify(payload) });
      showToast("Anggota berhasil ditambahkan.", "success");
    }
    closeModal("modal-anggota");
    loadMembers();
  } catch (err) {
    if (err.message !== "Unauthorized") showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan";
  }
}

/* ---------------- Transaksi ---------------- */

async function loadTransactions() {
  const body = document.getElementById("transaksi-table-body");
  body.innerHTML = '<tr><td colspan="8" class="loading-row"><span class="spinner"></span>Memuat transaksi...</td></tr>';
  try {
    const data = await apiFetch("/api/transactions");
    state.transactions = data.transactions || data.data || data || [];
    renderTransactions(state.transactions);
  } catch (err) {
    if (err.message !== "Unauthorized") {
      body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><p>Gagal memuat transaksi: ' + escapeHtml(err.message) + "</p></div></td></tr>";
    }
  }
}

function renderTransactions(list) {
  const body = document.getElementById("transaksi-table-body");
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><p>Belum ada transaksi yang cocok.</p></div></td></tr>';
    return;
  }
  body.innerHTML = list
    .map(
      (tx) => `
    <tr>
      <td class="cell-title">${escapeHtml(tx.transaction_code)}</td>
      <td>${escapeHtml(tx.member_name || tx.member || "-")}</td>
      <td>${escapeHtml(tx.book_title || tx.book || "-")}</td>
      <td>${formatDate(tx.borrow_date)}</td>
      <td>${formatDate(tx.due_date)}</td>
      <td>${statusBadge(tx)}</td>
      <td>${tx.fine ? formatCurrency(tx.fine) : "-"}</td>
      <td>${
        tx.status === "borrowed"
          ? `<button class="btn btn-ghost btn-sm" data-return-tx="${tx.id}">Kembalikan</button>`
          : ""
      }</td>
    </tr>`
    )
    .join("");
}

function populateSelect(selectEl, items, valueKey, labelFn, placeholder) {
  selectEl.innerHTML = `<option value="">${placeholder}</option>` + items.map((it) => `<option value="${it[valueKey]}">${escapeHtml(labelFn(it))}</option>`).join("");
}

async function openPinjamModal() {
  document.getElementById("form-pinjam").reset();
  try {
    if (!state.members.length) await loadMembers();
    if (!state.books.length) await loadBooks();
  } catch (e) {
    /* ignored, handled elsewhere */
  }
  populateSelect(
    document.getElementById("pinjam-member"),
    state.members.filter((m) => m.active !== 0),
    "id",
    (m) => `${m.name} (${m.member_code})`,
    "Pilih anggota..."
  );
  populateSelect(
    document.getElementById("pinjam-book"),
    state.books.filter((b) => b.available > 0),
    "id",
    (b) => `${b.title} — tersedia ${b.available}`,
    "Pilih buku..."
  );
  document.getElementById("pinjam-borrow-date").value = todayISO();
  document.getElementById("pinjam-due-date").value = addDaysISO(todayISO(), 7);
  openModal("modal-pinjam");
}

async function savePinjam() {
  const member_id = document.getElementById("pinjam-member").value;
  const book_id = document.getElementById("pinjam-book").value;
  const borrow_date = document.getElementById("pinjam-borrow-date").value;
  const due_date = document.getElementById("pinjam-due-date").value;

  if (!member_id || !book_id || !borrow_date || !due_date) {
    showToast("Lengkapi semua data peminjaman.", "error");
    return;
  }

  const btn = document.getElementById("save-pinjam-btn");
  btn.disabled = true;
  btn.textContent = "Menyimpan...";
  try {
    await apiFetch("/api/transactions/borrow", {
      method: "POST",
      body: JSON.stringify({ member_id: Number(member_id), book_id: Number(book_id), borrow_date, due_date }),
    });
    showToast("Peminjaman berhasil dicatat.", "success");
    closeModal("modal-pinjam");
    loadTransactions();
    loadBooks();
  } catch (err) {
    if (err.message !== "Unauthorized") showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan Peminjaman";
  }
}

let pendingReturnTx = null;

function openKembaliModal(tx) {
  pendingReturnTx = tx;
  document.getElementById("kembali-info").textContent = `${tx.book_title || tx.book || "Buku"} — dipinjam oleh ${tx.member_name || tx.member || "-"}. Jatuh tempo ${formatDate(tx.due_date)}.`;
  openModal("modal-kembali");
}

async function saveKembali() {
  if (!pendingReturnTx) return;
  const btn = document.getElementById("save-kembali-btn");
  btn.disabled = true;
  btn.textContent = "Memproses...";
  try {
    const result = await apiFetch(`/api/transactions/${pendingReturnTx.id}/return`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const fineMsg = result && result.fine ? ` Denda: ${formatCurrency(result.fine)}.` : "";
    showToast("Buku berhasil dikembalikan." + fineMsg, "success");
    closeModal("modal-kembali");
    pendingReturnTx = null;
    loadTransactions();
    loadBooks();
    if (state.currentPage === "dashboard") loadDashboard();
  } catch (err) {
    if (err.message !== "Unauthorized") showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Konfirmasi Kembali";
  }
}

/* ---------------- Search / filter (client-side) ---------------- */

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function setupSearch(inputId, dataGetter, renderFn) {
  const input = document.getElementById(inputId);
  input.addEventListener(
    "input",
    debounce(() => {
      const q = input.value.trim().toLowerCase();
      const data = dataGetter();
      if (!q) {
        renderFn(data);
        return;
      }
      const filtered = data.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
      renderFn(filtered);
    }, 200)
  );
}

/* ---------------- Event wiring ---------------- */

function wireEvents() {
  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page));
  });

  document.getElementById("hamburger-btn").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebar-backdrop").classList.add("active");
  });
  document.getElementById("sidebar-backdrop").addEventListener("click", closeSidebarMobile);

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("active");
    });
  });

  document.getElementById("btn-tambah-buku").addEventListener("click", () => openBukuModal(null));
  document.getElementById("save-buku-btn").addEventListener("click", saveBuku);
  document.getElementById("buku-table-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-edit-buku]");
    if (!btn) return;
    const book = state.books.find((b) => String(b.id) === btn.dataset.editBuku);
    if (book) openBukuModal(book);
  });

  document.getElementById("btn-tambah-anggota").addEventListener("click", () => openAnggotaModal(null));
  document.getElementById("save-anggota-btn").addEventListener("click", saveAnggota);
  document.getElementById("anggota-table-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-edit-anggota]");
    if (!btn) return;
    const member = state.members.find((m) => String(m.id) === btn.dataset.editAnggota);
    if (member) openAnggotaModal(member);
  });

  document.getElementById("btn-catat-pinjam").addEventListener("click", openPinjamModal);
  document.getElementById("save-pinjam-btn").addEventListener("click", savePinjam);
  document.getElementById("save-kembali-btn").addEventListener("click", saveKembali);
  document.getElementById("transaksi-table-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-return-tx]");
    if (!btn) return;
    const tx = state.transactions.find((t) => String(t.id) === btn.dataset.returnTx);
    if (tx) openKembaliModal(tx);
  });

  document.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.quick;
      if (action === "tambah-buku") openBukuModal(null);
      if (action === "tambah-anggota") openAnggotaModal(null);
      if (action === "pinjam") openPinjamModal();
    });
  });

  setupSearch("search-buku", () => state.books, renderBooks);
  setupSearch("search-anggota", () => state.members, renderMembers);
  setupSearch("search-transaksi", () => state.transactions, renderTransactions);
}

/* ---------------- Init ---------------- */

function init() {
  wireEvents();
  if (state.token && state.user) {
    showAppView();
    navigateTo("dashboard");
  } else {
    showLoginView();
  }
}

document.addEventListener("DOMContentLoaded", init);
