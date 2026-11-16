// 模拟 Discord：读帖子标题、命令列表、发交互，加一个最小的网关（WebSocket）把 bot 的「只有你能看到」的消息推回来。
// bot 的流程照着真实社区 bot 的样子：/获取作品 → 声明 + 确定按钮 → 选版本 → 加载中 → 文件列表
import http from 'node:http';
import crypto from 'node:crypto';
const PORT = 5196; const BASE = `http://127.0.0.1:${PORT}/discord`;
const titles = {}; const log = []; const files = {}; const socks = new Set();
const APP = '900000000000000001';
const CMD = { id: '800000000000000001', application_id: APP, version: '800000000000000002', name: '获取作品', type: 1, description: '获取本帖作品', options: [] };
const OTHER = { id: '800000000000000003', application_id: APP, version: '1', name: '按id获取作品', type: 1, description: '', options: [{ type: 4, name: 'id', required: true }] };

// ---- 最小的 WebSocket 服务端：只收发文本帧
const frame = (text) => {
    const b = Buffer.from(text); const n = b.length;
    const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const x = Buffer.alloc(8); x.writeBigUInt64BE(BigInt(n)); return x; })()]);
    return Buffer.concat([head, b]);
};
let seq = 0;
const push = (t, d) => { for (const s of socks) if (s.ready) s.write(frame(JSON.stringify({ op: 0, t, s: ++seq, d }))); };
function onUpgrade(req, sock) {
    const key = req.headers['sec-websocket-key'];
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')}\r\n\r\n`);
    socks.add(sock);
    sock.on('close', () => socks.delete(sock)); sock.on('error', () => socks.delete(sock));
    sock.write(frame(JSON.stringify({ op: 10, d: { heartbeat_interval: 41250 } })));
    let buf = Buffer.alloc(0);
    sock.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        while (buf.length >= 2) {
            const op = buf[0] & 15; let len = buf[1] & 127; let off = 2;
            if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
            if (buf.length < off + 4 + len) return;
            const mask = buf.subarray(off, off + 4); const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
            for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
            buf = buf.subarray(off + 4 + len);
            if (op === 8) { sock.end(); return; }
            if (op !== 1) continue;
            const p = JSON.parse(data.toString());
            if (p.op === 2) {
                log.push({ identify: { token: p.d.token, hasIntents: 'intents' in p.d } });
                if (p.d.token !== 'good-token') { sock.write(Buffer.from([0x88, 2, 0x0f, 0xa4])); sock.end(); return; } // 4004
                sock.ready = true; sock.session = 'sess-' + crypto.randomBytes(4).toString('hex');
                sock.write(frame(JSON.stringify({ op: 0, t: 'READY', s: ++seq, d: { session_id: sock.session, user: { id: '1' } } })));
            }
        }
    });
}

// ---- bot
const msgs = {}; let nextId = 700000000000000000n;
const base = (channel, extra) => ({ channel_id: channel, author: { id: APP, bot: true, username: '雪霁' }, application_id: APP, flags: 64, content: '', embeds: [], components: [], attachments: [], ...extra });
const edit = (m, patch) => { Object.assign(m, patch); push('MESSAGE_UPDATE', { id: m.id, channel_id: m.channel_id, flags: m.flags, content: m.content, embeds: m.embeds, components: m.components }); };
function interact(b) {
    log.push({ interaction: { type: b.type, session_id: b.session_id, channel_id: b.channel_id, guild_id: b.guild_id, nonce: b.nonce, data: b.data, message_id: b.message_id } });
    if (b.type === 2) {
        const m = base(b.channel_id, { id: String(nextId++), nonce: b.nonce, flags: 64 | 128 });
        msgs[m.id] = m;
        setTimeout(() => { push('INTERACTION_CREATE', { id: '1', nonce: b.nonce }); push('MESSAGE_CREATE', m); }, 60);
        setTimeout(() => edit(m, { flags: 64, embeds: [{ title: '⏳ 请阅读以下声明', description: '禁止商用，禁止虐崽，记得开关世界书条目\n阅读完毕后请点击下方"确定"按钮继续' }], components: [{ type: 1, components: [{ type: 2, style: 3, label: '确定', custom_id: 'confirm' }] }] }), 350);
        return;
    }
    const m = msgs[b.message_id]; if (!m) return;
    if (b.data.custom_id === 'confirm') {
        setTimeout(() => edit(m, { embeds: [], content: '📂 **本帖共有 2 个发布作品，请选择要获取的版本：**', components: [{ type: 1, components: [{ type: 3, custom_id: 'pick', placeholder: '请选择要获取的作品', options: [{ label: '初版.json', value: '19739', description: '2026年9月22日' }, { label: '最新版.json', value: '19788', description: '2026年9月23日' }] }] }] }), 120);
    } else if (b.data.custom_id === 'pick') {
        setTimeout(() => edit(m, { content: '✅ 验证通过，加载文件中...', components: [] }), 80);
        setTimeout(() => edit(m, { content: '', embeds: [{ title: '🌹 获取作品', description: `今日剩余可获取作品量：**66 / 75**\n\n作品 ID：\`${b.data.values[0]}\`\n📥 **文件列表**\n1. [最新版.json](${BASE}/files/card.json) · 707.95 KB\n2. [世界书2.0.json](${BASE}/files/wb.json) · 168.90 KB\n[作者主页](https://example.com/author)`, footer: { text: '本作品为作者原创，未经授权禁止二次传播' } }] }), 500);
    }
}

http.createServer((req, res) => {
    let body = []; req.on('data', (c) => body.push(c));
    req.on('end', () => {
        body = Buffer.concat(body);
        const u = req.url.split('?')[0].replace(/^\/discord/, '');
        const send = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
        if (u === '/__set') { Object.assign(titles, JSON.parse(body.toString() || '{}')); return send(200, { ok: true }); }
        if (u === '/__log') return send(200, log);
        if (u.startsWith('/__file/')) { files[decodeURIComponent(u.slice(8))] = body; return send(200, { ok: true }); }
        if (u.startsWith('/files/')) { const f = files[decodeURIComponent(u.slice(7))]; if (!f) return send(404, {}); res.writeHead(200, { 'content-length': f.length }); return res.end(f); }
        if (req.headers.authorization !== 'good-token') { log.push({ id: u, auth: req.headers.authorization || '', method: req.method }); return send(401, { message: '401: Unauthorized' }); }
        let m;
        if ((m = /^\/channels\/(\d+)$/.exec(u))) {
            log.push({ id: m[1], auth: req.headers.authorization, method: req.method });
            const c = titles[m[1]];
            if (c === 429) return send(429, { message: 'You are being rate limited.', retry_after: 5 });
            if (c === 403) return send(403, { message: 'Missing Access' });
            if (!c) return send(404, { message: 'Unknown Channel' });
            return send(200, { id: m[1], name: c, type: 11 });
        }
        if (/^\/guilds\/\d+\/application-command-index$/.test(u)) return send(200, { applications: [{ id: APP, name: '雪霁' }], application_commands: [OTHER, CMD], version: '1' });
        if (u === '/interactions' && req.method === 'POST') { interact(JSON.parse(body.toString())); return send(204); }
        return send(404, { message: 'Not Found' });
    });
}).on('upgrade', onUpgrade).listen(PORT, '127.0.0.1');
