#!/usr/bin/env node
/* ------------------------------------------------------------------
   SAVAŞ ALANI — statik dosya sunucusu + WebSocket röle (sıfır bağımlılık)
   Kullanım:  node server/server.js   (veya npm start)
   Ortam:     PORT=3000 (varsayılan)
------------------------------------------------------------------ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_ROOM = 24;
const MAX_PAYLOAD = 96 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

const rooms = new Map();
let idCounter = 0;

function safePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.resolve(ROOT, '.' + p);
  if (!full.startsWith(ROOT)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: [...rooms.values()].reduce((a, s) => a + s.size, 0) }));
    return;
  }
  const file = safePath(req.url);
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 — bulunamadı'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

// --------------------------- WebSocket çerçeveleri ---------------------------
function sendFrame(socket, text) {
  if (socket.destroyed) return;
  const data = Buffer.from(text);
  const len = data.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x81; // FIN + text
  try { socket.write(Buffer.concat([head, data])); } catch {}
}
function sendControl(socket, opcode) {
  const b = Buffer.from([0x80 | opcode, 0]);
  try { socket.write(b); } catch {}
}

function parseFrames(client, chunk) {
  client.buf = Buffer.concat([client.buf, chunk]);
  if (client.buf.length > MAX_PAYLOAD * 4) { client.socket.destroy(); return; }
  let off = 0;
  while (off + 2 <= client.buf.length) {
    const b0 = client.buf[off], b1 = client.buf[off + 1];
    const fin = !!(b0 & 0x80), opcode = b0 & 0x0f, masked = !!(b1 & 0x80);
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (p + 2 > client.buf.length) break; len = client.buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > client.buf.length) break; len = Number(client.buf.readBigUInt64BE(p)); p += 8; }
    if (len > MAX_PAYLOAD) { client.socket.destroy(); return; }
    let mask = null;
    if (masked) { if (p + 4 > client.buf.length) break; mask = client.buf.subarray(p, p + 4); p += 4; }
    if (p + len > client.buf.length) break;
    const payload = Buffer.from(client.buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    off = p + len;
    switch (opcode) {
      case 0x1:
      case 0x0: {
        client.fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(client.fragments).toString('utf8');
          client.fragments = [];
          handleMessage(client, text);
        }
        break;
      }
      case 0x8: client.socket.end(); return;
      case 0x9: sendControl(client.socket, 0xA); break;
      case 0xA: break;
      default: break;
    }
  }
  client.buf = client.buf.subarray(off);
}

function roomPeers(room, except) {
  const out = [];
  for (const c of (rooms.get(room) || [])) {
    if (c === except) continue;
    out.push({ id: c.id, name: c.name, team: c.team });
  }
  return out;
}
function broadcast(room, text, except) {
  for (const c of (rooms.get(room) || [])) if (c !== except) sendFrame(c.socket, text);
}

function handleMessage(client, text) {
  let m;
  try { m = JSON.parse(text); } catch { return; }
  m.from = client.id;
  m.room = client.room;
  if (!m.info) m.info = { id: client.id, name: client.name, team: client.team };
  if (m.t === 'hello' && m.info) { client.name = String(m.info.name || client.name).slice(0, 16); client.team = m.info.team || client.team; }
  broadcast(client.room, JSON.stringify(m), client);
}

server.on('upgrade', (req, socket, head) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
  if (u.pathname !== '/ws' && u.pathname !== '/ws/') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);

  const room = (u.searchParams.get('room') || 'GENEL').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
  let set = rooms.get(room);
  if (!set) { set = new Set(); rooms.set(room, set); }
  if (set.size >= MAX_ROOM) { sendFrame(socket, JSON.stringify({ t: 'full', room })); socket.end(); return; }
  let id = (u.searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  if (!id) id = 'srv_' + (++idCounter) + '_' + crypto.randomBytes(3).toString('hex');
  while ([...set].some((c) => c.id === id)) id += 'x';

  const client = {
    id,
    name: (u.searchParams.get('name') || 'ASKER').slice(0, 16),
    team: u.searchParams.get('team') || 'blue',
    room, socket, buf: Buffer.alloc(0), fragments: [],
  };
  set.add(client);
  sendFrame(socket, JSON.stringify({ t: 'welcome', id, room, peers: roomPeers(room, client) }));
  broadcast(room, JSON.stringify({ t: 'join', p: { id, name: client.name, team: client.team }, room }), client);
  console.log(`[+] ${id} (${client.name}) -> ${room}  [${set.size} oyuncu]`);

  if (head && head.length) parseFrames(client, head);
  socket.on('data', (chunk) => parseFrames(client, chunk));
  socket.on('close', () => {
    set.delete(client);
    broadcast(room, JSON.stringify({ t: 'left', id, room }), client);
    if (set.size === 0) rooms.delete(room);
    console.log(`[-] ${id} <- ${room}  [${set.size} oyuncu]`);
  });
  socket.on('error', () => {});
  // bağlantıyı canlı tut
  const ka = setInterval(() => { if (socket.destroyed) { clearInterval(ka); return; } try { socket.write(Buffer.from([0x89, 0])); } catch {} }, 25000);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  SAVAŞ ALANI hazır:  http://localhost:${PORT}`);
  console.log(`  WebSocket röle:     ws://localhost:${PORT}/ws?room=ODAADI\n`);
});
