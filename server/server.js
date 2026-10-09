#!/usr/bin/env node
// TavernVault 酒馆藏馆 —— 服务端（零依赖，Node >= 18）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, newId, DEFAULT_FIELDS } from './lib/store.js';
import { detectFile, mimeOf, normalizeCard, summarizeCard, TYPES } from './lib/detect.js';
import { extractCardFromPng, isPng, writeCardToPng } from './lib/png.js';
import { buildZip } from './lib/zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.0';
const PORT = Number(process.env.TV_PORT || process.env.PORT || 5180);
const HOST = process.env.TV_HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.TV_DATA || path.join(__dirname, 'data'));
const WEB_DIR = path.resolve(process.env.TV_WEB || path.join(__dirname, '..', 'web'));
const MAX_UPLOAD = Number(process.env.TV_MAX_UPLOAD_MB || 200) * 1024 * 1024;

const store = new Store(DATA_DIR);

// ---------------- 认证 ----------------
function hashPassword(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function verifyPassword(pw, stored) {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const h = crypto.scryptSync(pw, salt, 32);
    return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
const makeToken = () => crypto.createHmac('sha256', store.db.settings.secret).update('tavern-vault').digest('hex');
const authEnabled = () => Boolean(store.db.settings.passwordHash);

if (process.env.TV_PASSWORD && !store.db.settings.passwordHash) {
    store.db.settings.passwordHash = hashPassword(process.env.TV_PASSWORD);
    store.flush();
}

function isAuthed(req, url) {
    if (!authEnabled()) return true;
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token') || '';
    const good = makeToken();
    return tok.length === good.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(good));
}

// ---------------- 实时推送 (SSE) ----------------
const sseClients = new Set();
function broadcast(event, data = {}) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(msg);
}
setInterval(() => { for (const res of sseClients) res.write(': ping\n\n'); }, 25000).unref();

// ---------------- 工具 ----------------
class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
    if (Buffer.isBuffer(body) || typeof body === 'string') {
        res.writeHead(status, headers);
        res.end(body);
    } else {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
        res.end(JSON.stringify(body));
    }
}

function readBody(req, limit = MAX_UPLOAD) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(new HttpError(413, '文件过大')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
async function readJson(req) {
    const buf = await readBody(req, 50 * 1024 * 1024);
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON 格式错误'); }
}

const getItem = (id) => {
    const it = store.db.items[id];
    if (!it) throw new HttpError(404, '条目不存在');
    return it;
};

/** 列表用的精简条目 */
function slim(it) {
    const { searchText, ...rest } = it;
    return { ...rest, searchText: searchText ? searchText.slice(0, 600) : '' };
}

function safeFilename(name) {
    return String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 150) || 'file';
}

function contentDisposition(name, download) {
    return `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(name).replace(/['()]/g, escape)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** 用文件内容刷新条目的解析数据 */
function applyDetection(it, det, sha, { keepUserFields = true } = {}) {
    const patch = { meta: det.meta || {}, searchText: det.searchText || '', subtype: det.subtype || '' };
    if (det.isCover) patch.cover = sha;
    if (!keepUserFields) {
        Object.assign(patch, { type: det.type, name: det.name, description: det.description || '', author: det.author || '', version: det.version || '' });
    } else {
        if (!it.author && det.author) patch.author = det.author;
        if (det.version) patch.version = det.version;
    }
    store.updateItem(it.id, patch);
}

function ingest(buf, filename, opts = {}) {
    const sha = store.putBlob(buf);
    const det = detectFile(buf, filename);
    const dupes = store.findBySha(sha).filter((i) => !i.deletedAt);
    if (dupes.length && opts.mode !== 'new') {
        return { duplicate: true, item: slim(dupes[0]) };
    }
    const tags = [...(det.tags || []), ...(opts.tags || [])];
    const item = store.createItem({
        type: opts.type && TYPES[opts.type] ? opts.type : det.type,
        subtype: det.subtype,
        name: opts.name || det.name,
        description: det.description,
        author: det.author,
        version: det.version,
        tags,
        collections: opts.collections || [],
        meta: det.meta,
        searchText: det.searchText,
        source: opts.source || '',
        origin: opts.origin || '',
        cover: det.isCover ? sha : null,
        fields: { downloadedAt: new Date().toISOString().slice(0, 10) },
    });
    store.addFile(item.id, { sha, name: safeFilename(filename), size: buf.length, mime: mimeOf(filename), primary: true });
    return { duplicate: false, item: slim(store.db.items[item.id]) };
}

function parseOpts(url) {
    const sp = url.searchParams;
    const list = (k) => (sp.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
    return {
        filename: sp.get('filename') || 'upload.bin',
        type: sp.get('type') || '',
        name: sp.get('name') || '',
        tags: list('tags'),
        collections: list('collections'),
        mode: sp.get('mode') || 'auto',
        source: sp.get('source') || '',
        origin: sp.get('origin') || '',
    };
}

function loadContent(it) {
    const f = store.primaryFile(it);
    if (!f) return { kind: 'none' };
    const buf = store.readBlob(f.sha);
    if (isPng(buf)) {
        const card = extractCardFromPng(buf);
        return card ? { kind: 'card', data: card, file: f } : { kind: 'image', file: f };
    }
    if (/json/.test(f.mime) || f.name.endsWith('.json')) {
        try {
            const data = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
            if (it.type === 'character') return { kind: 'card', data, file: f };
            return { kind: 'json', data, file: f };
        } catch { /* fallthrough */ }
    }
    if (/^text\//.test(f.mime) || /\.(jsonl|txt|md|js|css|yaml|yml)$/i.test(f.name)) {
        return { kind: 'text', text: buf.toString('utf8').slice(0, 2 * 1024 * 1024), file: f };
    }
    return { kind: 'binary', file: f };
}

// ---------------- 路由 ----------------
const routes = [];
const route = (method, pattern, handler, { open = false } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler, open });
};

route('GET', '/api/health', () => ({ ok: true, app: 'tavern-vault', version: VERSION, auth: authEnabled(), title: store.db.settings.title, skin: store.db.settings.skin }), { open: true });

route('POST', '/api/login', async ({ req }) => {
    const { password } = await readJson(req);
    if (!authEnabled()) return { token: '' };
    if (!password || !verifyPassword(String(password), store.db.settings.passwordHash)) throw new HttpError(401, '密码错误');
    return { token: makeToken() };
}, { open: true });

route('POST', '/api/password', async ({ req }) => {
    const { password } = await readJson(req);
    if (password) {
        if (String(password).length < 4) throw new HttpError(400, '密码至少 4 位');
        store.db.settings.passwordHash = hashPassword(String(password));
    } else {
        store.db.settings.passwordHash = '';
    }
    store.db.settings.secret = crypto.randomBytes(32).toString('hex'); // 使旧 token 失效
    store.flush();
    broadcast('auth');
    return { ok: true, token: authEnabled() ? makeToken() : '' };
});

route('GET', '/api/state', () => {
    const { passwordHash, secret, ...settings } = store.db.settings;
    return {
        version: VERSION,
        types: TYPES,
        items: Object.values(store.db.items).map(slim),
        collections: Object.values(store.db.collections),
        fields: store.db.fields,
        settings: { ...settings, auth: authEnabled(), version: VERSION },
        stats: store.stats(),
    };
});

route('GET', '/api/events', ({ req, res }) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('event: hello\ndata: {}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return null;
});

// 条目
route('GET', '/api/items/:id', ({ p }) => getItem(p.id));

route('GET', '/api/items/:id/content', ({ p }) => {
    const it = getItem(p.id);
    const c = loadContent(it);
    if (c.kind === 'card') {
        const n = normalizeCard(c.data);
        return { kind: 'card', card: c.data, data: n.data, spec: n.spec };
    }
    return c;
});

route('POST', '/api/items', async ({ req, url }) => {
    const opts = parseOpts(url);
    const buf = await readBody(req);
    if (!buf.length) throw new HttpError(400, '空文件');
    const result = ingest(buf, opts.filename, opts);
    if (!result.duplicate) broadcast('change', { ids: [result.item.id] });
    return result;
});

route('POST', '/api/items/manual', async ({ req }) => {
    const body = await readJson(req);
    const item = store.createItem({ ...body, type: TYPES[body.type] ? body.type : 'other' });
    broadcast('change', { ids: [item.id] });
    return slim(item);
});

route('POST', '/api/import-url', async ({ req }) => {
    const { url: target, ...rest } = await readJson(req);
    let u;
    try { u = new URL(target); } catch { throw new HttpError(400, '链接无效'); }
    if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, '仅支持 http/https 链接');
    const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'TavernVault/1.0' } });
    if (!r.ok) throw new HttpError(502, `下载失败：HTTP ${r.status}`);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_UPLOAD) throw new HttpError(413, '文件过大');
    const buf = Buffer.from(await r.arrayBuffer());
    let filename = '';
    const cd = r.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
    if (m) { try { filename = decodeURIComponent(m[1]); } catch { filename = m[1]; } }
    if (!filename) filename = decodeURIComponent(path.basename(u.pathname)) || 'download';
    if (!path.extname(filename)) {
        const ct = r.headers.get('content-type') || '';
        filename += ct.includes('png') ? '.png' : ct.includes('json') ? '.json' : ct.includes('jpeg') ? '.jpg' : '';
    }
    const result = ingest(buf, filename, { ...rest, source: rest.source || target, origin: 'url' });
    if (!result.duplicate) broadcast('change', { ids: [result.item.id] });
    return result;
});

route('PATCH', '/api/items/:id', async ({ req, p }) => {
    getItem(p.id);
    const body = await readJson(req);
    const it = store.updateItem(p.id, body);
    broadcast('change', { ids: [p.id] });
    return slim(it);
});

route('DELETE', '/api/items/:id', ({ p, url }) => {
    const it = getItem(p.id);
    if (url.searchParams.get('hard') === '1') {
        delete store.db.items[p.id];
        store.save();
        store.gcBlobs();
    } else {
        it.deletedAt = new Date().toISOString();
        store.save();
    }
    broadcast('change', { ids: [p.id] });
    return { ok: true };
});

route('POST', '/api/items/:id/restore', ({ p }) => {
    const it = getItem(p.id);
    it.deletedAt = null;
    store.save();
    broadcast('change', { ids: [p.id] });
    return slim(it);
});

route('POST', '/api/items/:id/files', async ({ req, p, url }) => {
    const it = getItem(p.id);
    const sp = url.searchParams;
    const filename = sp.get('filename') || 'file.bin';
    const buf = await readBody(req);
    if (!buf.length) throw new HttpError(400, '空文件');
    const sha = store.putBlob(buf);
    const primary = sp.get('primary') === '1';
    const file = store.addFile(it.id, { sha, name: safeFilename(filename), size: buf.length, mime: mimeOf(filename), label: sp.get('label') || '', primary });
    if (file.primary) applyDetection(it, detectFile(buf, filename), sha);
    broadcast('change', { ids: [it.id] });
    return slim(store.db.items[it.id]);
});

route('PATCH', '/api/items/:id/files/:fid', async ({ req, p }) => {
    const it = getItem(p.id);
    const f = it.files.find((x) => x.id === p.fid);
    if (!f) throw new HttpError(404, '文件不存在');
    const body = await readJson(req);
    if (typeof body.label === 'string') f.label = body.label;
    if (typeof body.name === 'string' && body.name.trim()) f.name = safeFilename(body.name);
    if (body.primary) {
        it.files.forEach((x) => { x.primary = x.id === f.id; });
        applyDetection(it, detectFile(store.readBlob(f.sha), f.name), f.sha);
    }
    if (body.asCover) store.updateItem(it.id, { cover: f.sha });
    it.updatedAt = new Date().toISOString();
    store.save();
    broadcast('change', { ids: [it.id] });
    return slim(it);
});

route('DELETE', '/api/items/:id/files/:fid', ({ p }) => {
    const it = getItem(p.id);
    const idx = it.files.findIndex((x) => x.id === p.fid);
    if (idx < 0) throw new HttpError(404, '文件不存在');
    const [f] = it.files.splice(idx, 1);
    if (f.primary && it.files.length) {
        const last = it.files[it.files.length - 1];
        last.primary = true;
        applyDetection(it, detectFile(store.readBlob(last.sha), last.name), last.sha);
    }
    if (it.cover === f.sha && !it.files.some((x) => x.sha === f.sha)) it.cover = null;
    store.save();
    store.gcBlobs();
    broadcast('change', { ids: [it.id] });
    return slim(it);
});

// 编辑角色卡内容 → 生成新版本文件
route('PUT', '/api/items/:id/card', async ({ req, p }) => {
    const it = getItem(p.id);
    const { card } = await readJson(req);
    const n = normalizeCard(card);
    if (!n?.data?.name) throw new HttpError(400, '角色卡数据无效');
    const full = { spec: 'chara_card_v3', spec_version: '3.0', data: n.data };
    // 兼容 V1 顶层字段
    for (const k of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example']) full[k] = n.data[k] ?? '';
    const prev = store.primaryFile(it);
    let buf;
    let filename;
    const prevBuf = prev ? store.readBlob(prev.sha) : null;
    if (prevBuf && isPng(prevBuf)) {
        buf = await writeCardToPng(prevBuf, full);
        filename = prev.name;
    } else if (it.cover && store.hasBlob(it.cover) && isPng(store.readBlob(it.cover))) {
        buf = await writeCardToPng(store.readBlob(it.cover), full);
        filename = `${safeFilename(n.data.name)}.png`;
    } else {
        buf = Buffer.from(JSON.stringify(full, null, 2));
        filename = `${safeFilename(n.data.name)}.json`;
    }
    const sha = store.putBlob(buf);
    store.addFile(it.id, { sha, name: filename, size: buf.length, mime: mimeOf(filename), label: `编辑于 ${new Date().toLocaleString('zh-CN')}`, primary: true });
    applyDetection(it, detectFile(buf, filename), sha);
    store.updateItem(it.id, { name: n.data.name });
    broadcast('change', { ids: [it.id] });
    return slim(store.db.items[it.id]);
});

// 批量操作
route('POST', '/api/batch', async ({ req }) => {
    const { ids = [], action, value } = await readJson(req);
    const items = ids.map((id) => store.db.items[id]).filter(Boolean);
    const stamp = new Date().toISOString();
    for (const it of items) {
        switch (action) {
            case 'addTags': it.tags = [...new Set([...it.tags, ...value])]; break;
            case 'removeTags': it.tags = it.tags.filter((t) => !value.includes(t)); break;
            case 'addCollection': if (!it.collections.includes(value)) it.collections.push(value); break;
            case 'removeCollection': it.collections = it.collections.filter((c) => c !== value); break;
            case 'favorite': it.favorite = Boolean(value); break;
            case 'setType': if (TYPES[value]) it.type = value; break;
            case 'setField': it.fields[value.id] = value.value; break;
            case 'delete': it.deletedAt = stamp; break;
            case 'restore': it.deletedAt = null; break;
            case 'purge': delete store.db.items[it.id]; break;
            default: throw new HttpError(400, '未知操作');
        }
        if (store.db.items[it.id]) it.updatedAt = stamp;
    }
    store.save();
    if (action === 'purge') store.gcBlobs();
    broadcast('change', { ids });
    return { ok: true, count: items.length };
});

route('POST', '/api/export', async ({ req, res }) => {
    const { ids = [], withMeta = true } = await readJson(req);
    const entries = [];
    const typeDir = (t) => TYPES[t] || t;
    for (const id of ids) {
        const it = store.db.items[id];
        if (!it) continue;
        const f = store.primaryFile(it);
        if (f) entries.push({ name: `${typeDir(it.type)}/${f.name}`, data: store.readBlob(f.sha) });
        if (withMeta) entries.push({ name: `${typeDir(it.type)}/_info/${safeFilename(it.name)}.json`, data: Buffer.from(JSON.stringify({ ...it, searchText: undefined }, null, 2)) });
    }
    const zip = buildZip(entries);
    send(res, 200, zip, { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition(`TavernVault-${new Date().toISOString().slice(0, 10)}.zip`, true) });
    return null;
});

route('GET', '/api/backup', ({ res }) => {
    store.flush();
    const entries = [{ name: 'db.json', data: fs.readFileSync(store.dbPath) }];
    const seen = new Set();
    for (const it of Object.values(store.db.items)) {
        for (const sha of [...it.files.map((f) => f.sha), it.cover].filter(Boolean)) {
            if (seen.has(sha) || !store.hasBlob(sha)) continue;
            seen.add(sha);
            entries.push({ name: `files/${sha.slice(0, 2)}/${sha}`, data: store.readBlob(sha) });
        }
    }
    send(res, 200, buildZip(entries), { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition(`TavernVault-backup-${new Date().toISOString().slice(0, 10)}.zip`, true) });
    return null;
});

// 文件下载
route('GET', '/api/files/:sha', ({ req, res, p, url }) => {
    if (!store.hasBlob(p.sha)) throw new HttpError(404, '文件不存在');
    const name = url.searchParams.get('name') || p.sha;
    const etag = `"${p.sha}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return null; }
    const buf = store.readBlob(p.sha);
    send(res, 200, buf, {
        'Content-Type': mimeOf(name) === 'application/octet-stream' && isPng(buf) ? 'image/png' : mimeOf(name),
        'Content-Length': buf.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: etag,
        'Content-Disposition': contentDisposition(name, url.searchParams.get('dl') === '1'),
    });
    return null;
});

// 合集
route('POST', '/api/collections', async ({ req }) => {
    const body = await readJson(req);
    const c = { id: newId(), name: String(body.name || '新合集').slice(0, 60), icon: /^[a-zA-Z]+$/.test(body.icon || '') ? body.icon : 'folder', color: body.color || '', description: body.description || '', createdAt: new Date().toISOString() };
    store.db.collections[c.id] = c;
    store.save();
    broadcast('change', {});
    return c;
});
route('PATCH', '/api/collections/:id', async ({ req, p }) => {
    const c = store.db.collections[p.id];
    if (!c) throw new HttpError(404, '合集不存在');
    const body = await readJson(req);
    for (const k of ['name', 'icon', 'color', 'description']) if (k in body) c[k] = body[k];
    store.save();
    broadcast('change', {});
    return c;
});
route('DELETE', '/api/collections/:id', ({ p }) => {
    delete store.db.collections[p.id];
    for (const it of Object.values(store.db.items)) it.collections = it.collections.filter((c) => c !== p.id);
    store.save();
    broadcast('change', {});
    return { ok: true };
});

// 自定义字段 & 设置
route('PUT', '/api/fields', async ({ req }) => {
    const { fields } = await readJson(req);
    if (!Array.isArray(fields)) throw new HttpError(400, 'fields 必须是数组');
    store.db.fields = fields.map((f) => ({
        id: String(f.id || newId()).replace(/[^\w-]/g, '_'),
        label: String(f.label || '字段').slice(0, 40),
        kind: ['text', 'textarea', 'number', 'url', 'date', 'select', 'tags', 'checkbox', 'rating', 'color'].includes(f.kind) ? f.kind : 'text',
        options: Array.isArray(f.options) ? f.options.map(String) : [],
        types: Array.isArray(f.types) ? f.types.filter((t) => TYPES[t]) : [],
        hidden: Boolean(f.hidden),
        builtin: Boolean(f.builtin),
    }));
    store.save();
    broadcast('change', {});
    return store.db.fields;
});
route('POST', '/api/fields/reset', () => {
    store.db.fields = structuredClone(DEFAULT_FIELDS);
    store.save();
    broadcast('change', {});
    return store.db.fields;
});
route('PUT', '/api/settings', async ({ req }) => {
    const body = await readJson(req);
    for (const k of ['title', 'accent']) if (typeof body[k] === 'string') store.db.settings[k] = body[k].slice(0, 80);
    if (['atelier', 'minimal', 'tavern', 'sakura', 'ink', 'neon'].includes(body.skin)) store.db.settings.skin = body.skin;
    store.save();
    broadcast('change', {});
    return { ok: true };
});
// 打包插件目录，方便桌面版酒馆手动安装
route('GET', '/api/extension.zip', ({ res }) => {
    const dir = path.resolve(__dirname, '..', 'extension');
    const entries = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile())
        .map((f) => ({ name: `tavern-vault/${f}`, data: fs.readFileSync(path.join(dir, f)) }));
    send(res, 200, buildZip(entries), { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition('tavern-vault-extension.zip', true) });
    return null;
}, { open: true });
route('POST', '/api/maintenance/gc', () => ({ removed: store.gcBlobs() }));

// ---------------- 静态文件 ----------------
function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(WEB_DIR, rel));
    if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' });
        return;
    }
    const buf = fs.readFileSync(file);
    send(res, 200, buf, { 'Content-Type': mimeOf(file), 'Cache-Control': rel === '/index.html' || rel === '/sw.js' ? 'no-cache' : 'no-cache' });
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '86400',
};

const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
        if (!url.pathname.startsWith('/api/')) { serveStatic(req, res, url); return; }
        for (const r of routes) {
            if (r.method !== req.method) continue;
            const m = url.pathname.match(r.re);
            if (!m) continue;
            if (!r.open && !isAuthed(req, url)) throw new HttpError(401, '需要登录');
            const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
            const out = await r.handler({ req, res, url, p });
            if (out !== null && !res.headersSent) send(res, 200, out);
            return;
        }
        throw new HttpError(404, '接口不存在');
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error(err);
        if (!res.headersSent) send(res, status, { error: err.message || '服务器错误' });
        else res.end();
    }
});

server.requestTimeout = 0;
server.listen(PORT, HOST, () => {
    console.log(`\n  TavernVault 酒馆藏馆 v${VERSION}`);
    console.log(`  数据目录: ${DATA_DIR}`);
    console.log(`  本机访问: http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  局域网:   http://${a.address}:${PORT}`);
    }
    if (!authEnabled()) console.log('\n  [警告] 尚未设置访问密码！公网部署前请在网页「设置」中设置密码，或用 TV_PASSWORD 环境变量启动。');
    console.log('');
});

const shutdown = () => { store.flush(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
