# Rebin — prototipe web app

Foto benda → Gemini mengenali bahan → ide guna ulang → **reroll** sampai cocok.

## 1. Menjalankan Rebin

1. Install Node.js versi 18 atau lebih baru.
2. Ekstrak ZIP ini.
3. Buka terminal di folder `rebin` (folder yang berisi `server.js`).
4. Jalankan `node server.js`.
5. Buka `http://localhost:3000` di browser.

**Jangan membuka `public/index.html` langsung dengan klik dua kali.** Halaman perlu dijalankan melalui `server.js` agar tombol foto bisa mengirim gambar ke endpoint API.

Tanpa API key, halaman tetap bisa dibuka dalam mode demo. Dalam mode ini foto diterima oleh server, tetapi belum dianalisis oleh AI.

## 2. Mengaktifkan AI Gemini

Kode Rebin sudah terhubung ke Gemini API. Agar AI benar-benar mengenali foto, kamu perlu memasukkan API key milikmu sendiri:

1. Buka Google AI Studio dan buat API key Gemini.
2. Di folder yang sama dengan `server.js`, salin `.env.example` lalu ubah nama salinannya menjadi `.env`.
3. Buka `.env`, lalu isi baris `GEMINI_API_KEY=` dengan API key milikmu.
4. Simpan file, hentikan server dengan `Ctrl+C`, lalu jalankan lagi `node server.js`.
5. Status di kanan atas halaman akan berubah menjadi **AI aktif** jika key terbaca.

Model utama yang digunakan adalah `gemini-3.8-flash`, dengan `gemini-3.5-flash-lite` sebagai cadangan. Nama model dapat disesuaikan melalui `GEMINI_MODELS` di `.env`.

**Penting:** API key tidak disertakan di ZIP dan tidak boleh ditaruh di `index.html`, karena pengunjung bisa melihatnya. Simpan hanya di `.env` pada server.

## 3. Upload foto

Klik **Foto atau pilih gambar**, lalu pilih satu file JPG, PNG, atau WebP. Foto akan dikecilkan di browser sebelum dikirim agar lebih cepat. Batas ukuran file asli adalah 15 MB.

Jika tombol upload tidak membuka pemilih file, pastikan halaman dibuka dari `http://localhost:3000`, bukan dari `file:///.../index.html`.

## 4. Mengambil foto dengan kamera HP

Buka website dari HP pada jaringan Wi-Fi yang sama, misalnya `http://IP-LAPTOP:3000`. Tekan **Ambil foto atau pilih gambar**; browser HP akan membuka kamera belakang. Ambil foto, lalu Rebin mengirimkannya ke server untuk dianalisis. Jika kamera tidak terbuka, gunakan pilihan gambar pada pemilih file.

ESP32-CAM tidak diperlukan untuk alur ini.

## 5. Sambungkan ESP32-CAM (opsional)

Laptop dan ESP32-CAM harus berada di Wi-Fi yang sama. Cari IP laptop (Windows: `ipconfig`). ESP32-CAM dapat mengirim foto JPEG lewat HTTP POST ke:

    http://IP-LAPTOP:3000/api/esp

Dengan header `Content-Type: image/jpeg` dan body berupa data JPEG.

Di website, nyalakan toggle **Ambil dari tong Rebin**. Foto baru dari ESP32-CAM akan dianalisis otomatis. HP dapat membuka website melalui `http://IP-LAPTOP:3000` pada Wi-Fi yang sama.

Pada versi ini, alur ESP32-CAM tidak ditampilkan di halaman; foto diambil langsung dengan HP.

## 6. Gambar hasil akhir

Setiap ide AI otomatis diberi ilustrasi hasil jadinya. Gambar ini berupa SVG yang digambar oleh model teks Gemini (gratis, memakai kuota teks), lalu disaring server sebelum ditampilkan. Gambarnya sederhana dan datar, bukan foto. Jika gambar gagal dibuat, ide tetap tampil tanpa gambar.

Opsional: jika billing Google AI aktif, isi `GEMINI_IMAGE_MODEL` di `.env` (mis. `gemini-3.1-flash-lite-image`) untuk gambar AI asli yang berbayar. Jika model itu gagal, server otomatis kembali ke ilustrasi SVG.

## 5. Struktur folder

    server.js          server + panggilan Gemini + endpoint ESP32-CAM
    public/index.html  tampilan dan JavaScript browser
    .env               API key milikmu (buat sendiri dari .env.example)

## Catatan

- Jangan bagikan API key atau mengunggah `.env` ke GitHub.
- Kuota dan biaya penggunaan mengikuti ketentuan akun Google AI Studio yang dipakai.
- Hasil identifikasi dan ide guna ulang AI bisa keliru. Periksa bahan dan keamanan sebelum mengikuti saran.
