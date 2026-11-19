// Rebin server: tanpa dependency. Butuh Node.js 18+.
// Jalankan: node server.js
const http = require('http'), fs = require('fs'), path = require('path');

// ---- baca .env ----
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}

const PORT = +process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY || '';
const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.8-flash,gemini-3.5-flash-lite')
  .split(',').map(s => s.trim()).filter(Boolean);
// Gambar hasil akhir. Bawaan: ilustrasi SVG yang digambar model TEKS (gratis).
// Isi GEMINI_IMAGE_MODEL hanya kalau billing aktif dan mau gambar AI asli (berbayar); kalau gagal otomatis kembali ke SVG.
const IMAGE_MODEL = (process.env.GEMINI_IMAGE_MODEL ?? '').trim();
const DEMO = !KEY || process.env.DEMO_MODE === '1';
let goodModel = null;

const THEMES = {
  rumah: 'Berguna di rumah',
  dekor: 'Dekorasi',
  mainan: 'Mainan & belajar',
  tanaman: 'Tanaman & taman',
  organizer: 'Penyimpan & organizer',
};
const RARITY = {
  Biasa: 'mudah, maksimal 15 menit, tanpa alat tajam, bahan tambahan paling banyak 1',
  Langka: 'lebih kreatif, 15-45 menit, boleh pakai gunting/lem/kertas/cat',
  Epik: 'tidak biasa dan mengejutkan tapi tetap realistis & aman, boleh sampai 90 menit',
};
const pick = a => a[Math.floor(Math.random() * a.length)];
function rollRarity() { const r = Math.random(); return r < 0.6 ? 'Biasa' : r < 0.88 ? 'Langka' : 'Epik'; }

// ---- schema jawaban AI ----
const ideaSchema = {
  type: 'OBJECT',
  properties: {
    judul: { type: 'STRING' },
    ringkas: { type: 'STRING' },
    bahan_tambahan: { type: 'ARRAY', items: { type: 'STRING' } },
    langkah: { type: 'ARRAY', items: { type: 'STRING' } },
    menit: { type: 'INTEGER' },
    tingkat: { type: 'STRING', enum: ['Mudah', 'Sedang', 'Sulit'] },
    keselamatan: { type: 'STRING' },
  },
  required: ['judul', 'ringkas', 'bahan_tambahan', 'langkah', 'menit', 'tingkat', 'keselamatan'],
};
const bendaSchema = {
  type: 'OBJECT',
  properties: {
    terdeteksi: { type: 'BOOLEAN' },
    nama: { type: 'STRING' },
    bahan: { type: 'STRING' },
    pilah: { type: 'STRING' },
    yakin: { type: 'INTEGER' },
  },
  required: ['terdeteksi', 'nama', 'bahan', 'pilah', 'yakin'],
};
const analyzeSchema = { type: 'OBJECT', properties: { benda: bendaSchema, ide: ideaSchema }, required: ['benda', 'ide'] };
const rerollSchema = { type: 'OBJECT', properties: { ide: ideaSchema }, required: ['ide'] };

const RULES = `Aturan ide:
- Tulis dalam Bahasa Indonesia yang santai, jelas, tanpa basa-basi dan tanpa kata hiperbola.
- Ide harus realistis untuk pelajar SMK dengan barang rumah biasa. Jangan sarankan api terbuka, bahan kimia, atau listrik tegangan tinggi.
- "langkah": 3 sampai 6 langkah, tiap langkah maksimal 15 kata.
- "bahan_tambahan": hanya yang benar-benar perlu, boleh kosong.
- "keselamatan": satu kalimat (misal cuci bersih dulu, hati-hati tepi tajam).
- Kalau benda berbahaya (baterai, kaca pecah, bekas bahan kimia, jarum suntik, makanan basi), jangan buat kerajinan. Judul ide = cara membuang/menyerahkan dengan aman, dan jelaskan di langkah.
- Jangan ulangi ide dalam daftar "sudah muncul". Hindari ide klise kecuali sesuai tingkat kelangkaan.`;

function ideaPrompt(namaBenda, bahan, exclude, tema, rarity) {
  return `Benda: ${namaBenda} (bahan: ${bahan}).
Buat SATU ide pemanfaatan ulang.
Tema: ${THEMES[tema]}.
Tingkat kelangkaan "${rarity}": ${RARITY[rarity]}.
Sudah muncul (jangan diulang): ${exclude.length ? exclude.join('; ') : '-'}.
${RULES}`;
}

let useThinking = true; // Gemini 3 default-nya "berpikir lama"; kita turunkan supaya cepat
async function gemini(parts, schema) {
  const order = goodModel ? [goodModel, ...MODELS.filter(m => m !== goodModel)] : [...MODELS];
  let last;
  for (const m of order) {
    let r, txt;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 1.0, ...(useThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
        }),
      });
      txt = await r.text();
    } catch (e) {
      if (e.name === 'AbortError') { console.log(`[gemini] ${m} timeout 30 detik`); last = new Error('AI terlalu lama merespons. Coba lagi.'); continue; }
      throw new Error('Tidak bisa menghubungi Gemini. Periksa koneksi internet.');
    } finally {
      clearTimeout(timeout);
    }
    if (r.ok) {
      try {
        const j = JSON.parse(txt);
        const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        const out = JSON.parse(t);
        goodModel = m;
        return out;
      } catch { last = new Error('Jawaban AI tidak terbaca, coba lagi.'); continue; }
    }
    console.log(`[gemini] ${m} -> ${r.status} ${txt.slice(0, 200)}`);
    if (r.status === 400 && useThinking && /thinking/i.test(txt)) { useThinking = false; order.splice(order.indexOf(m) + 1, 0, m); continue; }
    if (r.status === 403 || (r.status === 400 && /API key/i.test(txt))) throw new Error('API key salah atau belum aktif. Cek file .env');
    last = new Error(r.status === 429 ? 'Kuota gratis sedang penuh. Tunggu 1 menit lalu coba lagi.' : `AI belum bisa dipakai (kode ${r.status}). Cek nama model di .env`);
  }
  throw last || new Error('Semua model gagal');
}

// ---- gambar hasil akhir ----
const imageCache = new Map();
let photoBlockedUntil = 0;

// Gambar AI asli (berbayar). Hanya dipakai jika GEMINI_IMAGE_MODEL diisi.
async function makePhoto(judul, ringkas, nama) {
  const prompt = `Foto produk bergaya katalog: "${judul}", kerajinan guna ulang dari ${nama}. ${ringkas} Satu objek utama di tengah, latar polos terang, cahaya lembut. Tanpa teks, tanpa orang.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      signal: controller.signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    });
    const txt = await r.text();
    if (!r.ok) {
      console.log(`[image] ${IMAGE_MODEL} -> ${r.status}, pakai ilustrasi SVG`);
      if (r.status === 429 || r.status === 403) photoBlockedUntil = Date.now() + 10 * 60 * 1000;
      return null;
    }
    const parts = JSON.parse(txt).candidates?.[0]?.content?.parts || [];
    const d = parts.map(p => p.inlineData || p.inline_data).find(x => x && x.data);
    return d ? `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}` : null;
  } catch { return null; } finally { clearTimeout(timeout); }
}

// Penyaring SVG: hanya bentuk dasar. Tag lain (script, image, text, dll) ditolak.
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop']);
function cleanSvg(raw) {
  let s = String(raw || '').trim().replace(/^```(?:svg|xml)?\s*/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('<svg'), b = s.lastIndexOf('</svg>');
  if (a < 0 || b < 0) return null;
  s = s.slice(a, b + 6).replace(/<!--[\s\S]*?-->/g, '');
  if (s.length > 12000) return null;
  let ok = true;
  s = s.replace(/<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g, (m, close, name, attrs) => {
    if (!SVG_TAGS.has(name.toLowerCase())) { ok = false; return ''; }
    attrs = attrs
      .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, '')
      .replace(/\s+[\w:-]+\s*=\s*("[^"]*url\((?!\s*#)[^"]*"|'[^']*url\((?!\s*#)[^']*')/gi, '');
    return `<${close}${name}${attrs}>`;
  });
  if (!ok || !/^<svg[\s>]/i.test(s)) return null;
  const stack = [];
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2].toLowerCase());
    else if (stack.pop() !== m[2].toLowerCase()) return null;
  }
  if (stack.length) return null;
  if (!/<svg[^>]*xmlns=/i.test(s)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/<svg[^>]*viewBox=/i.test(s)) s = s.replace(/^<svg/i, '<svg viewBox="0 0 240 180"');
  return s;
}

const svgSchema = { type: 'OBJECT', properties: { svg: { type: 'STRING' } }, required: ['svg'] };
async function makeSvg(judul, ringkas, nama) {
  const prompt = `Gambar ilustrasi vektor datar (flat) dari HASIL JADI kerajinan ini: "${judul}" (dibuat dari ${nama}). ${ringkas}
Aturan SVG:
- Satu elemen <svg viewBox="0 0 240 180"> dengan xmlns. Objek jadi di tengah, mudah dikenali.
- Hanya tag: svg, g, path, circle, ellipse, rect, line, polyline, polygon, defs, linearGradient, radialGradient, stop.
- DILARANG: teks, script, image, style, link/href, filter, animasi.
- Gaya sederhana, maksimal 30 elemen, bentuk tebal dan jelas.
- Warna: latar rect penuh #0f2250, aksen biru muda #8fd9f2, boleh tambah warna hangat #f5b971, #e07a5f, #81c995, #ffffff untuk detail.
Isi JSON "svg" dengan kode SVG saja.`;
  const out = await gemini([{ text: prompt }], svgSchema);
  const svg = cleanSvg(out.svg);
  return svg ? 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64') : null;
}

// Urutan: gambar AI berbayar (hanya jika GEMINI_IMAGE_MODEL diisi) > ilustrasi SVG (bawaan, gratis).
async function makeImage(judul, ringkas, nama) {
  const k = `${judul}|${nama}`;
  if (imageCache.has(k)) return imageCache.get(k);
  let out = null;
  if (IMAGE_MODEL && Date.now() > photoBlockedUntil) {
    const u = await makePhoto(judul, ringkas, nama);
    if (u) out = { image: u, kind: 'ai' };
  }
  if (!out) {
    const u = await makeSvg(judul, ringkas, nama);
    if (u) out = { image: u, kind: 'svg' };
  }
  if (out) { imageCache.set(k, out); if (imageCache.size > 30) imageCache.delete(imageCache.keys().next().value); }
  else console.log('[image] gagal, ide tampil tanpa gambar');
  return out;
}

// ---- mode demo (tanpa API key / tanpa internet) ----
const DEMO_IDEAS = [
  { r: 'Biasa', t: 'rumah', judul: 'Tempat pensil meja', ringkas: 'Potong bagian atas, rapikan tepinya, langsung jadi wadah alat tulis.', bahan_tambahan: [], langkah: ['Cuci dan keringkan benda.', 'Potong bagian atas sampai tinggi yang pas.', 'Haluskan tepi dengan amplas atau lakban.', 'Isi dengan pulpen dan penggaris.'], menit: 10, tingkat: 'Mudah', keselamatan: 'Tepi potongan bisa tajam, tutup dengan lakban.' },
  { r: 'Langka', t: 'tanaman', judul: 'Pot gantung mini', ringkas: 'Gantung di jendela untuk tanaman kecil seperti lidah mertua atau sirih gading.', bahan_tambahan: ['Tali rafia', 'Tanah'], langkah: ['Lubangi bagian bawah untuk air keluar.', 'Buat dua lubang di sisi atas.', 'Ikat tali rafia lewat lubang.', 'Isi tanah dan tanam bibit.'], menit: 25, tingkat: 'Sedang', keselamatan: 'Minta bantuan orang dewasa saat melubangi.' },
  { r: 'Biasa', t: 'organizer', judul: 'Kotak kabel charger', ringkas: 'Simpan kabel dan charger supaya tidak kusut di tas.', bahan_tambahan: [], langkah: ['Bersihkan bagian dalam.', 'Buat satu celah kecil untuk kabel.', 'Masukkan kabel yang sudah digulung.'], menit: 8, tingkat: 'Mudah', keselamatan: 'Pastikan benda kering sebelum dipakai.' },
  { r: 'Langka', t: 'mainan', judul: 'Alat tangkap bola', ringkas: 'Permainan lempar-tangkap sederhana untuk latihan fokus dan koordinasi.', bahan_tambahan: ['Tali', 'Bola kertas'], langkah: ['Potong benda jadi bentuk cangkir.', 'Ikat tali di dasar cangkir.', 'Ikat bola kertas di ujung tali lain.', 'Ayunkan dan coba tangkap bolanya.'], menit: 20, tingkat: 'Mudah', keselamatan: 'Pastikan tepi tidak tajam sebelum dimainkan.' },
  { r: 'Epik', t: 'dekor', judul: 'Lampion bayangan', ringkas: 'Lubangi dengan pola, taruh lampu LED kecil di dalam, dinding jadi penuh bayangan.', bahan_tambahan: ['Lampu LED baterai', 'Paku kecil'], langkah: ['Gambar pola bintang atau daun di sisi benda.', 'Lubangi pola dengan paku kecil, dibantu orang dewasa.', 'Letakkan lampu LED baterai di dalam.', 'Matikan lampu ruangan, lihat bayangannya.'], menit: 60, tingkat: 'Sedang', keselamatan: 'Pakai LED baterai, bukan lilin.' },
  { r: 'Epik', t: 'mainan', judul: 'Papan pelacak kebiasaan', ringkas: 'Bagian-bagian benda jadi kantong penghitung kebiasaan harian yang bisa dipindah-pindah.', bahan_tambahan: ['Karton', 'Spidol'], langkah: ['Potong benda menjadi 7 bagian sama besar.', 'Tempel di karton, beri label hari.', 'Isi dengan kerikil kecil tiap kebiasaan selesai.'], menit: 50, tingkat: 'Sedang', keselamatan: 'Rapikan tepi potongan sebelum ditempel.' },
];
function demoRoll(exclude, tema, rarity) {
  let pool = DEMO_IDEAS.filter(i => !exclude.includes(i.judul));
  if (!pool.length) pool = DEMO_IDEAS;
  const a = pool.filter(i => i.r === rarity && (tema === 'acak' || i.t === tema));
  const b = pool.filter(i => tema === 'acak' || i.t === tema);
  const i = pick(a.length ? a : b.length ? b : pool);
  const { r, t, ...ide } = i;
  return { ide, rarity: i.r, tema: i.t };
}

// ---- handler API ----
let latest = { id: 0, ts: 0, buf: null };
let armed = false; // true = toggle "Ambil dari tong Rebin" menyala di website

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('Terlalu besar')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
function cleanIdea(x) {
  const arr = v => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    judul: String(x.judul || 'Ide tanpa judul'), ringkas: String(x.ringkas || ''),
    bahan_tambahan: arr(x.bahan_tambahan), langkah: arr(x.langkah),
    menit: Math.max(1, Math.min(240, parseInt(x.menit) || 15)),
    tingkat: ['Mudah', 'Sedang', 'Sulit'].includes(x.tingkat) ? x.tingkat : 'Sedang',
    keselamatan: String(x.keselamatan || ''),
  };
}
const cleanTema = t => (t === 'acak' || THEMES[t] ? t : 'acak');
const cleanList = a => (Array.isArray(a) ? a.slice(-20).map(s => String(s).slice(0, 120)) : []);

async function api(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/status')
      return send(res, 200, { demo: DEMO, model: DEMO ? null : (goodModel || MODELS[0]), apiKeyConfigured: !!KEY, image: !DEMO });

    // Website memberi tahu server saat toggle dinyalakan/dimatikan
    if (req.method === 'POST' && url.pathname === '/api/arm') {
      const b = JSON.parse((await readBody(req, 1e3)).toString() || '{}');
      armed = !!b.on;
      if (armed) latest.buf = null; // buang foto lama supaya tidak ikut dianalisis
      console.log(`[arm] tong ${armed ? 'AKTIF' : 'NONAKTIF'}`);
      return send(res, 200, { armed });
    }
    // ESP32-CAM bertanya: boleh memotret atau tidak?
    if (req.method === 'GET' && url.pathname === '/api/armed')
      return send(res, 200, { armed });

    if (req.method === 'POST' && url.pathname === '/api/esp') {
      if (!armed) { await readBody(req, 3e6); return send(res, 409, { error: 'tong belum diaktifkan di website' }); }
      const buf = await readBody(req, 3e6);
      if (buf.length < 100) return send(res, 400, { error: 'gambar kosong' });
      latest = { id: latest.id + 1, ts: Date.now(), buf };
      console.log(`[esp] gambar #${latest.id} (${(buf.length / 1024).toFixed(0)} KB)`);
      return send(res, 200, { ok: true, id: latest.id });
    }
    if (req.method === 'GET' && url.pathname === '/api/latest') {
      const after = +url.searchParams.get('after') || 0;
      if (!latest.buf || latest.id <= after) return send(res, 200, { id: latest.id });
      return send(res, 200, { id: latest.id, image: 'data:image/jpeg;base64,' + latest.buf.toString('base64') });
    }

    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const body = JSON.parse((await readBody(req, 8e6)).toString() || '{}');
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(body.image || '');
      if (!m) return send(res, 400, { error: 'Foto tidak valid. Gunakan JPG, PNG, atau WebP.' });
      const imageBytes = Buffer.from(m[2], 'base64');
      if (!imageBytes.length || imageBytes.length > 6 * 1024 * 1024)
        return send(res, 413, { error: 'Ukuran foto terlalu besar. Coba foto yang lebih kecil.' });
      const tema = cleanTema(body.tema);
      const rarity = rollRarity();
      const temaDipakai = tema === 'acak' ? pick(Object.keys(THEMES)) : tema;
      if (DEMO) {
        const d = demoRoll([], tema, rarity);
        return send(res, 200, { benda: { terdeteksi: true, nama: 'Foto diterima (mode demo)', bahan: 'Belum dianalisis', pilah: 'Aktifkan Gemini untuk mengenali bahan', yakin: 0 }, ide: cleanIdea(d.ide), rarity: d.rarity, tema: d.tema, demo: true });
      }
      const prompt = `Kamu asisten daur ulang untuk edukasi. Lihat foto. Tentukan benda UTAMA yang akan dibuang.
- "terdeteksi": false jika tidak ada benda jelas atau foto terlalu gelap/buram.
- "nama": nama benda singkat (mis. "Botol plastik air mineral").
- "bahan": bahan utama (plastik, kardus, kaleng, kaca, kain, dll).
- "pilah": jenis pilah singkat, mis. "Anorganik: plastik", "Organik", "Berbahaya (B3)".
- "yakin": 0-100, seberapa yakin kamu pada nama benda. Jujur, jangan selalu tinggi.
Lalu buat SATU ide pemanfaatan ulang.
Tema: ${THEMES[temaDipakai]}.
Tingkat kelangkaan "${rarity}": ${RARITY[rarity]}.
${RULES}
Jika "terdeteksi" false, tetap isi "ide" dengan ide umum dan "yakin" rendah.`;
      const out = await gemini([{ text: prompt }, { inlineData: { mimeType: m[1], data: m[2] } }], analyzeSchema);
      const b = out.benda || {};
      return send(res, 200, {
        benda: { terdeteksi: !!b.terdeteksi, nama: String(b.nama || 'Benda tidak dikenal'), bahan: String(b.bahan || '-'), pilah: String(b.pilah || '-'), yakin: Math.max(0, Math.min(100, parseInt(b.yakin) || 0)) },
        ide: cleanIdea(out.ide || {}), rarity, tema: temaDipakai,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/image') {
      if (DEMO) return send(res, 200, { image: null });
      const b = JSON.parse((await readBody(req, 1e5)).toString() || '{}');
      const judul = String(b.judul || '').slice(0, 100), nama = String(b.nama || 'benda bekas').slice(0, 100), ringkas = String(b.ringkas || '').slice(0, 200);
      if (!judul) return send(res, 400, { error: 'judul kosong' });
      try { return send(res, 200, (await makeImage(judul, ringkas, nama)) || { image: null }); }
      catch (e) { console.log('[image] gagal:', e.message); return send(res, 200, { image: null }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/reroll') {
      const body = JSON.parse((await readBody(req, 1e5)).toString() || '{}');
      const tema = cleanTema(body.tema), exclude = cleanList(body.exclude);
      const rarity = rollRarity();
      const temaDipakai = tema === 'acak' ? pick(Object.keys(THEMES)) : tema;
      if (DEMO) { const d = demoRoll(exclude, tema, rarity); return send(res, 200, { ide: cleanIdea(d.ide), rarity: d.rarity, tema: d.tema, demo: true }); }
      const nama = String(body.nama || 'benda bekas').slice(0, 100), bahan = String(body.bahan || '-').slice(0, 50);
      const out = await gemini([{ text: ideaPrompt(nama, bahan, exclude, temaDipakai, rarity) }], rerollSchema);
      return send(res, 200, { ide: cleanIdea(out.ide || {}), rarity, tema: temaDipakai });
    }
    send(res, 404, { error: 'tidak ditemukan' });
  } catch (e) {
    console.log('[error]', e.message);
    const clientError = e instanceof SyntaxError || e.message === 'Terlalu besar';
    send(res, clientError ? 400 : 500, { error: e.message || 'Terjadi kesalahan' });
  }
}

// ---- file statis ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  let p = path.normalize(path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname));
  if (!p.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\nRebin jalan di http://localhost:${PORT}`);
  console.log(DEMO ? 'MODE DEMO (tidak ada GEMINI_API_KEY). Ide diambil dari contoh bawaan.' : `AI aktif, model: ${MODELS.join(' > ')}`);
  console.log(`ESP32-CAM kirim foto ke: http://<IP-laptop>:${PORT}/api/esp\n`);
});
