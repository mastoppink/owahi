# Lapis — editor foto berbasis layer

HTML + CSS + JavaScript murni, tanpa build. Buka `index.html` langsung di browser, atau jalankan `node server.js` lalu buka http://localhost:5173 (server statis kecil tanpa dependency).

## Fitur

| Fitur | Di mana |
|---|---|
| Layer, urutan (drag), opacity, 16 blend mode | Panel Layer & Properti |
| Layer mask (lukis hitam/putih, gradient, dari seleksi, invert, terapkan) | Klik thumbnail mask, menu Layer |
| Adjustment layer: Curves, Levels, Hue/Saturation (per rentang warna), Color Balance, Camera Raw | Menu Layer, tombol "◐ Adjustment" |
| Pipeline float + dither (tanpa banding), Exposure/WB di cahaya linear, histogram RGB live, peringatan clipping, Auto, pipet white balance | Panel Properti adjustment |
| Unsharp Mask (amount, radius, threshold; luminans saja), resize & export Lanczos | Menu Filter, Gambar → Ukuran gambar |
| Seleksi: Marquee, Lasso, Magic Wand, Quick Selection | Toolbar |
| **Path (Pen)**: kurva Bézier yang bisa diedit, banyak path per dokumen, Path → Seleksi (baru/tambah/kurangi/irisan, feather), Seleksi → Path, isi & stroke path | Tool Pen (P), panel Path, menu Seleksi |
| Select Subject (AI), Select and Mask (tepi rambut, feather, geser tepi) | Menu Seleksi |
| Crop dengan rasio, luruskan, putar 90°, flip, ubah ukuran | Tool Crop, menu Gambar |
| Free Transform: skala, putar, regang, distort/perspektif | Tool Transform (tombol **F**) |
| Clone Stamp, Healing Brush, Spot Healing/Remove, Content-Aware Fill | Toolbar, Shift+Del |
| Generative Fill (AI, butuh endpoint sendiri) | Menu Edit |
| Smart Object + Smart Filter yang bisa diedit | Menu Layer, panel Properti |
| Brush (dukung tekanan pena), Eraser, Gradient, Teks, Layer Style | Toolbar, panel Properti |
| **AI Upscale bertile sampai 4K**: ESRGAN lokal, offline, gambar tidak dikirim ke mana pun | Menu Gambar (Ctrl+Alt+U) |
| Undo/redo 40 langkah, simpan/buka proyek `.lapis`, export JPG/PNG/WebP | Menu File |
| **Simpan otomatis**: dokumen tetap ada setelah refresh atau browser ditutup (IndexedDB) | Otomatis; status di kanan atas; File → Tutup dokumen untuk menghapus |

## Shortcut

V move · M marquee · L lasso · W quick/wand · C crop · **F transform** · B brush · E eraser · G gradient · S clone · J heal/spot · T teks · P pen (Enter = jadikan seleksi, Del = hapus titik, Esc = selesai) · I pipet · H/Spasi hand · Z zoom
`[` `]` ukuran brush · X tukar warna · D warna default · Del hapus seleksi · Alt+Del isi · Shift+Del content-aware
Ctrl+Z/Shift+Z undo/redo · Ctrl+A/D/Shift+I seleksi · Ctrl+J duplikat · Ctrl+E gabung · Ctrl+M/L/U/B adjustment · Ctrl+Shift+A Camera Raw · Ctrl+Alt+R Select and Mask · Ctrl+S simpan · Ctrl+Shift+E export

Ctrl+T dan Ctrl+N tidak dipakai karena dikunci browser (tab/jendela baru).

## Fitur yang butuh internet

- **Select Subject** memuat model `@imgly/background-removal` dari CDN saat pertama dipakai (puluhan MB, lalu di-cache). Lisensi library ini AGPL.
- **Generative Fill** mengirim data ke endpoint yang Anda atur di *Edit → Pengaturan AI*:

```
POST <endpoint>
Authorization: Bearer <api key>        (jika diisi)
Content-Type: application/json
{ "prompt": "...", "image": "data:image/png;base64,...", "mask": "data:image/png;base64,...", "width": 1920, "height": 1080 }
```
Mask: putih = area yang diisi. Balasan boleh berupa gambar langsung (`image/*`), atau JSON `{ "image": "<dataURL atau URL>" }`. Endpoint ini harus Anda sediakan sendiri, misalnya proxy kecil ke layanan inpainting pilihan Anda.

## AI Upscale

Gambar dipotong jadi tile dengan overlap, tiap tile diperbesar AI, lalu dirangkai lagi dengan sambungan yang dibaurkan.

- **ESRGAN lokal:** jalan di GPU browser lewat TensorFlow.js. Gratis, offline setelah model ter-cache, dan gambar tidak dikirim ke mana pun.
  - Model: **thick** (kualitas terbaik, ~28 MB, default), **GAN** (tekstur paling tajam), medium, slim.
  - Selalu memakai model 4×, lalu tiap tile langsung diperkecil ke ukuran target (supersampling), jadi hasilnya lebih tajam daripada model 2×/3×.
  - **Kualitas Tinggi** (default) merata-ratakan hasil dari 2 orientasi gambar untuk mengurangi artefak. Maksimal = 4 orientasi.
  - **Campur tekstur GAN** memadukan hasil thick dengan model GAN untuk tekstur lebih renyah.
  - Pemakaian pertama mengunduh model (thick ~28 MB). Setelah itu jauh lebih cepat.


## Batasan

- Semua pemrosesan jalan di CPU lewat Canvas 2D. Adjustment layer di foto di atas ~12 MP terasa lambat saat melukis.
- Content-Aware Fill untuk area besar diproses di resolusi lebih kecil, jadi hasilnya bisa sedikit blur.
- Belum ada: grup layer, Warp mesh, file RAW kamera.
- Simpan otomatis hanya menyimpan kondisi terakhir, bukan riwayat undo. Simpanan ada di browser itu saja dan hilang kalau data situs dihapus. Untuk arsip, pakai File → Simpan proyek.
