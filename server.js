// Server statis lokal tanpa dependency (opsional; index.html juga bisa dibuka langsung).
// Jalankan: node server.js   lalu buka http://localhost:5173
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = +process.env.PORT || 5173;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };

 /* ===== Upscale native: Real-ESRGAN ncnn-vulkan (GPU via Metal/Vulkan), tetap lokal ===== */
const RE_DIR = path.join(ROOT, 'tools', 'realesrgan');
const RE_BIN = path.join(RE_DIR, process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan');
const RE_MODELS = { x4plus: { n: 'realesrgan-x4plus', scales: [4] }, anime: { n: 'realesrgan-x4plus-anime', scales: [4] }, video: { n: 'realesr-animevideov3', scales: [2, 3, 4] } };
const MAX_BODY = 300 * 1024 * 1024;
let reQueue = Promise.resolve(); // satu proses GPU sekaligus
function nativeInfo() { return { available: fs.existsSync(RE_BIN), models: Object.fromEntries(Object.entries(RE_MODELS).map(([k, m]) => [k, m.scales])) }; }
function readBody(req) {
  return new Promise((ok, fail) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { fail(new Error('Gambar terlalu besar')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts))); req.on('error', fail);
  });
}
async function nativeUpscale(req, res, url) {
  const m = RE_MODELS[url.searchParams.get('model')] || RE_MODELS.x4plus;
  let scale = +url.searchParams.get('scale') || 4; if (!m.scales.includes(scale)) scale = Math.max(...m.scales);
  const tile = Math.max(0, Math.min(1024, +url.searchParams.get('tile') || 0)), tta = url.searchParams.get('tta') === '1';
  const body = await readBody(req);
  if (body.length < 8 || body.readUInt32BE(0) !== 0x89504e47) return send(res, 400, JSON.stringify({ error: 'Kirim PNG' }));
  const run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-up-')), inp = path.join(dir, 'in.png'), out = path.join(dir, 'out.png');
    try {
      fs.writeFileSync(inp, body);
      const args = ['-i', inp, '-o', out, '-n', m.n, '-s', String(scale), '-t', String(tile), '-m', path.join(RE_DIR, 'models'), '-f', 'png'];
      if (tta) args.push('-x');
      let log = '';
      const code = await new Promise(ok => {
        const p = spawn(RE_BIN, args, { cwd: RE_DIR });
        p.stderr.on('data', d => { log = (log + d).slice(-2000); });
        p.on('error', e => { log += e.message; ok(-1); });
        p.on('close', ok);
        req.on('close', () => { if (!res.writableEnded) p.kill(); }); // dibatalkan dari browser
      });
      if (code !== 0 || !fs.existsSync(out)) return send(res, 500, JSON.stringify({ error: 'realesrgan gagal (' + code + '): ' + log.trim().split('\n').pop() }));
      send(res, 200, fs.readFileSync(out), 'image/png');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const job = reQueue.then(run, run); reQueue = job.catch(() => {}); await job;
}

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/native') return send(res, 200, JSON.stringify(nativeInfo()));
    if (url.pathname === '/api/upscale' && req.method === 'POST') {
      if (!nativeInfo().available) return send(res, 503, JSON.stringify({ error: 'Binary realesrgan-ncnn-vulkan tidak ditemukan di tools/realesrgan' }));
      return nativeUpscale(req, res, url).catch(e => { if (!res.headersSent) send(res, 500, JSON.stringify({ error: e.message })); });
    }
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || /(^|[\\/])\.(env|git)/.test(path.relative(ROOT, file)) || path.basename(file) === 'server.js' || /^tools([\\/]|$)/.test(path.relative(ROOT, file))) return send(res, 404, 'Not found', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, 'Server error: ' + e.message, 'text/plain');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Lapis jalan di http://localhost:${PORT}`);
});
