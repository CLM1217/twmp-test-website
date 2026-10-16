import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { ContactError, submitInquiry } from './contact-submit.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.vtt': 'text/vtt' };
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/contact') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { ok: false, message: '請透過聯絡表單送出。' }); }
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return json(res, 403, { ok: false, message: '請從同一網站的聯絡表單送出。' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { ok: false, message: '提交格式不正確。' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new ContactError('TOO_LARGE', '填寫內容過長。', 413); chunks.push(chunk); }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { ok: false, message: '提交格式不正確。' }); }
      return json(res, 200, await submitInquiry(payload));
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { ok: false });
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index_gpt_1.html' : url.pathname);
    const file = path.resolve(root, '.' + pathname);
    if (!file.toLowerCase().startsWith((root + path.sep).toLowerCase()) || !mime[path.extname(file).toLowerCase()]) return json(res, 404, { ok: false });
    let info;
    try { info = await stat(file); } catch { return json(res, 404, { ok: false }); }
    if (!info.isFile()) return json(res, 404, { ok: false });
    const headers = { 'Content-Type': mime[path.extname(file).toLowerCase()], 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end); }
      else start = Math.max(0, info.size - Number(range[2]));
      if (start > end || start >= info.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const known = error instanceof ContactError;
    json(res, known ? error.status : 502, { ok: false, code: known ? error.code : 'DELIVERY_UNCONFIRMED', message: known ? error.message : '目前無法確認送出結果，內容已保留。請稍後以聯絡信箱確認，避免重複送出。' });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, '127.0.0.1', () => console.log(`網站預覽：http://127.0.0.1:${port}/`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `連接埠 ${port} 已使用，請關閉先前的預覽或設定 PORT。` : error.message); process.exitCode = 1; });
}
