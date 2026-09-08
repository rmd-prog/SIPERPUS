# SIPERPUS SD V1

Sistem Perpustakaan SD — fondasi V1.

## Isi V1
- Login demo
- Dashboard
- Data buku
- Data anggota
- Peminjaman
- Pengembalian
- Statistik dasar

## Demo lokal
Buka `index.html` di browser.

Akun demo:
- Username: `admin`
- Password: `admin123`

> Mode demo menyimpan data di localStorage. Jangan gunakan akun/password ini untuk produksi.

## Database
`schema.sql` berisi rancangan Cloudflare D1 untuk tahap backend.

## Arsitektur target
GitHub Pages → Cloudflare Worker API → Cloudflare D1

## Roadmap V2
- Login backend aman + session/token
- Import CSV siswa/buku
- Barcode/QR
- Kartu anggota
- Laporan PDF
- Kunjungan perpustakaan
- Pengaturan denda
- Backup/restore
