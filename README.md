# SIPERPUS SD V2

Sistem Perpustakaan SD — GitHub Pages → Cloudflare Worker API → Cloudflare D1.

## Backend deployment check
- Worker name: `siperpus`
- Entry point: `src/index.js`
- D1 binding: `DB`

## Fitur
- Login backend
- Dashboard
- Data buku
- Data anggota
- Peminjaman
- Pengembalian
- Statistik dasar

## Database
`schema.sql` berisi rancangan Cloudflare D1.

## Arsitektur
GitHub Pages → Cloudflare Worker API → Cloudflare D1

## Setup akun admin pertama
Akun admin **tidak disimpan di source code**. Buat secret di Cloudflare Worker terlebih dahulu:

- `SESSION_SECRET` — secret untuk menandatangani sesi login.
- `SETUP_KEY` — kunci sementara untuk membuat akun admin pertama.

Setelah Worker aktif dan database sudah memakai `schema.sql`, panggil endpoint setup satu kali:

```bash
curl -X POST https://siperpus.adm-sd.workers.dev/api/setup-admin \
  -H "Content-Type: application/json" \
  -H "X-Setup-Key: GANTI_DENGAN_SETUP_KEY" \
  -d '{"username":"admin","password":"GANTI_PASSWORD_MIN_8_KARAKTER","name":"Administrator"}'
```

Jika berhasil, login dari aplikasi menggunakan **username dan password yang dipilih saat setup**.

Endpoint setup otomatis menolak pembuatan akun baru jika tabel `users` sudah berisi akun, sehingga tidak dapat dipakai untuk menimpa akun yang sudah ada.

> Jangan memasukkan `SETUP_KEY`, `SESSION_SECRET`, atau password ke GitHub. Simpan sebagai Cloudflare Worker Secret.

## Health check
Buka:

`https://siperpus.adm-sd.workers.dev/api/health`

Respons normal memiliki `ok: true`.

## Roadmap
- Import CSV siswa/buku
- Barcode/QR
- Kartu anggota
- Laporan PDF
- Kunjungan perpustakaan
- Pengaturan denda
- Backup/restore

<!-- Cloudflare Workers Builds trigger check 2026-09-08 -->
