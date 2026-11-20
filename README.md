# Lapis — editor foto berbasis layer

HTML + CSS + JavaScript murni, tanpa build.

**Coba online:** https://mastoppink.github.io/owahi/ (GitHub Pages, ter-update otomatis setiap push ke `master`).

Jalankan lokal: `node server.js` lalu buka http://localhost:5173 (server kecil tanpa dependency). `index.html` juga bisa dibuka langsung, tapi model AI yang disimpan di repo (`models/`) dan Native GPU hanya jalan lewat `http://`.

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
| **AI Upscale bertile sampai 4K**, **Perjelas** (ukuran tetap), **Hilangkan blur** (MAXIM): Real-ESRGAN/ESRGAN di browser atau native GPU, gambar tidak dikirim ke mana pun | Menu Gambar (Ctrl+Alt+U) |
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

Semua di menu **Gambar → AI Upscale** (Ctrl+Alt+U). Gambar dipotong jadi tile berukuran tetap dengan overlap, tiap tile diproses AI, lalu dirangkai lagi tanpa sambungan. Semua jalan di perangkat sendiri; gambar tidak dikirim ke mana pun.

### Target

- **Upscale:** 4K UHD, 4K DCI, QHD, 2×, 4×. Semua layer digabung lalu diperbesar.
- **Perjelas · ukuran tetap:** diproses AI lalu langsung diperkecil kembali ke ukuran asli. Noise dan artefak JPEG berkurang, lalu tepi dipertajam.
  - **Detail:** penajaman setelah AI (default 80%).
  - **Kekuatan:** campuran dengan foto asli supaya tidak terlihat "plastik".
- **Hilangkan blur · ukuran tetap:** model MAXIM (dataset GoPro, ~88 MB, berat) untuk blur gerak/goyang. Kurang efektif untuk blur karena tidak fokus.
- **Terapkan ke** (khusus Perjelas & Hilangkan blur): *Gambar gabungan* atau *Layer aktif saja*. Mode layer hanya mengganti piksel layer yang dipilih; adjustment, teks, mask, dan layer lain tetap utuh.

### Model

| Model | Jalan di | Catatan |
|---|---|---|
| **Native GPU · Real-ESRGAN** x4plus / anime / general 2–4× | `server.js` + `realesrgan-ncnn-vulkan` | Paling cepat. Hanya muncul kalau server lokal & binary tersedia (lihat di bawah). |
| **Real-ESRGAN x4plus · di browser** | ONNX Runtime Web (WebGPU, fallback CPU) | Kualitas sama dengan native, ~34 MB dari `models/`. Bisa dipakai di GitHub Pages. |
| **Real-ESR general · di browser** | ONNX Runtime Web | Versi kompak resmi (~2,4 MB, ±8× lebih cepat dari x4plus). Untuk laptop tanpa GPU kuat. |
| ESRGAN thick / GAN / medium / slim | TensorFlow.js (WebGPU → WebGL → CPU) | Diunduh dari CDN saat pertama dipakai. thick paling bagus tapi berat; slim paling cepat. |
| MAXIM deblur | TensorFlow.js | Dipakai otomatis oleh target *Hilangkan blur*. |

**Pilihan otomatis (★):** saat dialog dibuka, aplikasi membaca dukungan WebGPU, memori GPU, RAM, dan jumlah inti CPU, lalu memilih model dan ukuran tile yang paling cocok:

| Kondisi | Model | Tile |
|---|---|---|
| Server lokal + binary native tersedia | Native GPU · Real-ESRGAN x4plus | 192 |
| WebGPU, RAM ≥ 8 GB, memori GPU besar | Real-ESRGAN x4plus di browser | 192 |
| WebGPU tapi RAM/memori GPU terbatas | Real-ESR general (ringan) | 128 |
| Tanpa WebGPU (CPU) | Real-ESR general (ringan) | 96 |

Semua pilihan tetap bisa diubah manual. Kalau GPU kehabisan memori di tengah proses, tile otomatis diperkecil setengah lalu pass itu diulang. Progres menampilkan perkiraan sisa waktu, dan halaman tetap responsif (tombol Batal bisa dipakai) di perangkat lambat.

Pengaturan lain:
- **Kualitas:** Normal (default, tercepat), Tinggi (rata-rata 2 orientasi, 2× lebih lama), Maksimal (4 orientasi). Belum berlaku untuk Real-ESRGAN di browser.
- **Ukuran tile:** default mengikuti pilihan otomatis. Turunkan ke 64–128 kalau GPU kehabisan memori, naikkan ke 256 kalau GPU kuat.
- **Campur tekstur GAN** (khusus ESRGAN TensorFlow.js): memadukan hasil model utama dengan model GAN untuk tekstur lebih tajam. Coba 20–40%; untuk wajah/teks pakai angka kecil.
- **Simpan foto asli sebagai layer pembanding:** tidak dicentang secara default.

Pesan progres menunjukkan apakah yang dipakai GPU atau CPU. Kalau tertulis "CPU (lambat)", pakai Chrome/Edge terbaru supaya WebGPU aktif.

### Native GPU (opsional, paling cepat)

1. Unduh `realesrgan-ncnn-vulkan-20220424-macos.zip` (atau versi Windows/Linux) dari [Real-ESRGAN releases v0.2.5.0](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0).
2. Ekstrak ke `tools/realesrgan/` sehingga ada `tools/realesrgan/realesrgan-ncnn-vulkan` dan folder `tools/realesrgan/models/`. Folder ini di-`.gitignore`.
3. `chmod +x tools/realesrgan/realesrgan-ncnn-vulkan`, lalu jalankan `node server.js`. Kalau macOS menolak membuka binary, izinkan di System Settings → Privacy & Security.

`server.js` menyediakan `GET /api/native` (cek ketersediaan) dan `POST /api/upscale?model=x4plus|anime|video&scale=2|3|4&tta=0|1` (body PNG, balasan PNG). Hanya satu proses GPU berjalan sekaligus, dan proses dihentikan kalau dibatalkan dari browser.

### Model ONNX di repo

`models/realesr-general-x4v3-fp16.onnx` (~2,4 MB) diekspor dengan cara yang sama dari `realesr-general-x4v3.pth`.

`models/realesrgan-x4plus-fp16.onnx` adalah bobot resmi `RealESRGAN_x4plus.pth` yang diekspor ke ONNX (opset 17, bobot fp16, input/output float32 NCHW 0..1, tinggi/lebar dinamis). Hasilnya praktis sama dengan versi native (selisih ~38 dB PSNR).

## Batasan

- Upscale ke ukuran lebih besar selalu menggabungkan semua layer menjadi satu (bisa di-undo).
- Semua pemrosesan selain AI jalan di CPU lewat Canvas 2D. Adjustment layer di foto di atas ~12 MP terasa lambat saat melukis.
- Content-Aware Fill untuk area besar diproses di resolusi lebih kecil, jadi hasilnya bisa sedikit blur.
- Belum ada: grup layer, Warp mesh, file RAW kamera.
- Simpan otomatis hanya menyimpan kondisi terakhir, bukan riwayat undo. Simpanan ada di browser itu saja dan hilang kalau data situs dihapus. Untuk arsip, pakai File → Simpan proyek.
