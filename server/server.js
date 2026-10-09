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
import { buildZip, readZip, isJunkPath } from './lib/zip.js';
import { fileSig, fileParts, parseFile } from './lib/content.js';
import { entriesOf, entryKeys, effectivePrompts } from '../web/js/cardfmt.js';
import { stripSyncEntries, DEFAULT_SYNC_EXCLUDE, SYNC_OPTIONS, PARTS_VERSION, sameParts, mergeParts } from '../web/js/sig.js';
import { diffFiles, diffSummary } from './lib/diff.js';
import { AiConfig, listModels, chat, AiError } from './lib/ai.js';
import { createAiTasks } from './lib/ai-tasks.js';
const str = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '1.2.0';
const PORT = Number(process.env.TV_PORT || process.env.PORT || 5180);
const HOST = process.env.TV_HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.TV_DATA || path.join(__dirname, 'data'));
const WEB_DIR = path.resolve(process.env.TV_WEB || path.join(__dirname, '..', 'web'));
const MAX_UPLOAD = Number(process.env.TV_MAX_UPLOAD_MB || 200) * 1024 * 1024;
const MAX_RESTORE = Number(process.env.TV_MAX_RESTORE_MB || 2048) * 1024 * 1024;

// db.json 损坏或丢失时，从最近一份备份（自动或手动）里取回索引
const store = new Store(DATA_DIR, {
    recover() {
        const dir = path.join(DATA_DIR, 'backups');
        let names = [];
        try { names = fs.readdirSync(dir).filter((f) => /^TavernVault-(auto|manual)-\d{8}-\d{6}\.zip$/.test(f)).sort((a, b) => b.slice(-19).localeCompare(a.slice(-19))); } catch { return null; }
        for (const name of names) {
            try {
                const e = readZip(fs.readFileSync(path.join(dir, name)), { maxTotal: 4 * 1024 ** 3, maxEntries: 500000 }).find((x) => x.name === 'db.json');
                const db = e && JSON.parse(e.read().toString('utf8'));
                if (db?.items && typeof db.items === 'object') return { db, from: `备份 ${name}` };
            } catch { /* 这份也坏了，试下一份 */ }
        }
        return null;
    },
});
const aiConfig = new AiConfig(DATA_DIR);

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
    const files = it.files.map((f) => (/^image\//.test(f.mime) && f.sha !== it.cover && store.hasThumb(f.sha) ? { ...f, thumb: true } : f));
    return { ...rest, files, searchText: searchText ? searchText.slice(0, 600) : '', thumb: !!it.cover && store.hasThumb(it.cover) };
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

/** 用于判断「是不是同一个东西」的名字：去掉扩展名、版本号、副本标记 */
function normName(s) {
    return String(s || '').toLowerCase()
        .replace(/\.(png|json|charx|jsonl|txt|md|js|css|webp|jpe?g|gif|zip|ya?ml)$/i, '')
        .replace(/[\s_\-]*[(（[【]\s*(?:v(?:er(?:sion)?)?\.?\s*\d+(?:\.\d+)*[a-z]?|\d+|副本|copy)\s*[)）\]】]\s*$/i, '')
        .replace(/[\s_\-]+v(?:er(?:sion)?)?\.?\s*\d+(?:\.\d+)*[a-z]?$/i, '')
        .replace(/[\s_\-]*(?:副本|copy)$/i, '')
        .replace(/[\s_\-·・]+/g, ' ')
        .trim();
}

/** 同类型、同名（作者不冲突）的已有条目，最近更新的在前 */
function findSimilar(det) {
    const name = normName(det.name);
    if (!name) return [];
    const author = normName(det.author);
    return Object.values(store.db.items)
        .filter((it) => !it.deletedAt && it.type === det.type && it.files.length && normName(it.name) === name)
        .filter((it) => det.type !== 'preset' || !det.meta?.apiId || !it.meta?.apiId || det.meta.apiId === it.meta.apiId)
        .filter((it) => !author || !it.author || normName(it.author) === author)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function withCollections(opts) {
    const cols = [...(opts.collections || [])];
    if (opts.collectionName) {
        const c = store.ensureCollection(opts.collectionName);
        if (c && !cols.includes(c.id)) cols.push(c.id);
    }
    return cols.filter((id) => store.db.collections[id]);
}

// ---- 版本号：卡里的 character_version，没有就看文件名里的 v1.2 / ver2 ----
const fileVer = (name) => (String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').match(/(?:^|[\s_\-(（[【])v(?:er(?:sion)?)?\.?\s*(\d+(?:\.\d+)*)/i) || [])[1] || '';
const versionOf = (det, filename) => String(det?.version || '').trim() || fileVer(filename);
const verKey = (v) => { const m = String(v || '').match(/\d+(?:\.\d+)*/); return m ? m[0].split('.').map(Number) : null; };
function cmpVer(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
    return 0;
}
/** 当前版本文件的版本号（旧文件没记过就现读一次） */
function fileVersion(f) {
    if (typeof f.ver === 'string') return f.ver;
    try { f.ver = versionOf(detectFile(store.readBlob(f.sha), f.name), f.name); } catch { f.ver = ''; }
    return f.ver;
}
/** 新文件的版本号比当前版本低（比如后导入了旧版）：返回当前版本号，否则返回空 */
function olderThanCurrent(it, det, filename) {
    const nv = verKey(versionOf(det, filename));
    const cur = store.primaryFile(it);
    if (!nv || !cur) return '';
    const cv = fileVersion(cur);
    const ck = verKey(cv);
    return ck && cmpVer(nv, ck) < 0 ? cv : '';
}

/** 给已有条目加一个新版本；默认设为当前版本，opts.primary === false 时只存为历史版本 */
function addVersion(it, { buf, filename, sha, sig, parts, det }, opts = {}) {
    const ver = versionOf(det, filename);
    const primary = opts.primary !== false;
    store.addFile(it.id, { sha, name: filename, size: buf.length, mime: mimeOf(filename), label: opts.label || (ver ? `v${ver.replace(/^v/i, '')}` : ''), primary, sig, parts, ver });
    if (primary) applyDetection(it, det, sha);
    const cols = withCollections(opts);
    store.updateItem(it.id, {
        tags: [...new Set([...it.tags, ...(opts.tags || [])])],
        collections: [...new Set([...it.collections, ...cols])],
        ...(opts.source && !it.source ? { source: opts.source } : {}),
    });
    return store.db.items[it.id];
}

/**
 * 收录一个文件
 * opts.mode: 'auto'（默认）| 'new'（无论如何都新建）
 * opts.match: 遇到同名条目时 'ask'（返回冲突，等用户决定）| 'version'（存为新版本）| 'new'（另存）| 'skip'
 * opts.target: 指定要挂到哪个条目下作为新版本
 * 返回 status: created | version | duplicate | conflict | skipped
 */
function ingest(buf, filename, opts = {}) {
    const sha = store.putBlob(buf);
    const fname = safeFilename(filename);
    const det = detectFile(buf, fname);
    const sig = fileSig(buf, fname, det);
    const parts = fileParts(buf, fname, det);
    const file = { buf, filename: fname, sha, sig, parts, det };
    const base = { sha, filename: fname, size: buf.length, detected: { type: det.type, name: det.name, author: det.author || '', version: det.version || '' } };
    const target = opts.target ? store.db.items[opts.target] : null;
    if (opts.target && (!target || target.deletedAt)) throw new HttpError(404, '目标条目不存在');

    if (opts.mode !== 'new') {
        const pool = target ? [target] : Object.values(store.db.items).filter((i) => !i.deletedAt);
        let hit = null;
        let hitFile = null;
        for (const it of pool) {
            hitFile = it.files.find((f) => f.sha === sha) || (sig ? it.files.find((f) => f.sig === sig) : null);
            if (hitFile) { hit = it; break; }
        }
        // 从酒馆收录：设置里忽略的那几段（自己在酒馆里改过的）不同，也算同一个版本
        const ignore = opts.origin === 'tavern' ? syncIgnore() : [];
        if (!hit && ignore.length && parts) {
            for (const it of pool) {
                hitFile = it.files.find((f) => f.primary && sameParts(f.parts, parts, ignore)) || it.files.find((f) => sameParts(f.parts, parts, ignore));
                if (hitFile) { hit = it; base.ignoredOnly = true; break; }
            }
        }
        if (hit) {
            // 和已有条目完全相同：导入时指定了合集（例如按压缩包名建合集）的，也把它加进去
            if (opts.collectionName || opts.collections?.length) {
                const cols = withCollections(opts);
                if (cols.some((c) => !hit.collections.includes(c))) store.updateItem(hit.id, { collections: [...new Set([...hit.collections, ...cols])] });
            }
            return { ...base, status: 'duplicate', duplicate: true, exact: hitFile.sha === sha, current: Boolean(hitFile.primary), item: slim(hit) };
        }
        const candidates = target ? [target] : findSimilar(det);
        if (candidates.length) {
            // 指定了目标：默认直接存为新版本；match=ask 时只返回对比结果（酒馆页「对比」用）
            const action = target ? (opts.match === 'ask' ? 'ask' : opts.match === 'skip' ? 'skip' : 'version') : opts.match || 'ask';
            const cand = candidates[0];
            if (action === 'version') {
                // 版本号比当前低：存为历史版本，不顶替当前版本（从酒馆收录、手动指定的除外）
                const curVer = opts.origin === 'tavern' || opts.primary === true ? '' : olderThanCurrent(cand, det, fname);
                const item = addVersion(cand, file, { ...opts, primary: !curVer });
                return { ...base, status: 'version', duplicate: false, older: Boolean(curVer), currentVersion: curVer, newVersion: versionOf(det, fname), item: slim(item) };
            }
            if (action === 'skip') return { ...base, status: 'skipped', duplicate: false, item: slim(cand) };
            if (action === 'ask') {
                const prev = store.primaryFile(cand);
                let summary = '';
                let changes = 0;
                try {
                    const d = diffFiles({ buf: store.readBlob(prev.sha), name: prev.name }, { buf, name: fname });
                    summary = diffSummary(d);
                    changes = d.changes;
                } catch { /* 对比失败不影响导入 */ }
                return { ...base, status: 'conflict', conflict: true, duplicate: false, summary, changes, candidates: candidates.slice(0, 5).map(slim) };
            }
        }
    }

    const item = store.createItem({
        type: opts.type && TYPES[opts.type] ? opts.type : det.type,
        subtype: det.subtype,
        name: opts.name || det.name,
        description: det.description,
        author: det.author,
        version: det.version,
        tags: [...(det.tags || []), ...(opts.tags || [])],
        collections: withCollections(opts),
        meta: det.meta,
        searchText: det.searchText,
        source: opts.source || '',
        origin: opts.origin || '',
        cover: det.isCover ? sha : null,
        fields: { downloadedAt: new Date().toISOString().slice(0, 10) },
    });
    store.addFile(item.id, { sha, name: fname, size: buf.length, mime: mimeOf(fname), primary: true, sig, parts, label: opts.label || '', ver: versionOf(det, fname) });
    return { ...base, status: 'created', duplicate: false, item: slim(store.db.items[item.id]) };
}

/** 压缩包是不是一个酒馆扩展（根目录或唯一子目录里有 manifest.json） */
function isExtensionZip(entries) {
    const m = entries.find((e) => /^([^/]+\/)?manifest\.json$/i.test(e.name));
    if (!m || m.size > 100000) return false;
    try {
        const j = JSON.parse(m.read().toString('utf8'));
        return Boolean(j.display_name && (j.js || j.loading_order !== undefined));
    } catch { return false; }
}
const isBackupZip = (entries) => entries.some((e) => e.name === 'db.json') && entries.some((e) => e.name.startsWith('files/'));

/** 解压并逐个收录，返回每个文件的结果 */
function ingestZip(buf, archiveName, opts, depth = 0) {
    const entries = readZip(buf, { maxTotal: MAX_UPLOAD * 10 });
    if (isBackupZip(entries)) throw new HttpError(400, '这是藏馆的完整备份，请到「设置 → 数据」里用「从备份还原」导入');
    const base = path.basename(archiveName, path.extname(archiveName));
    const o = { ...opts, collectionName: opts.zipCollection ? base : opts.collectionName };
    const results = [];
    for (const e of entries) {
        if (isJunkPath(e.name) || !e.size) continue;
        const entryName = path.posix.basename(e.name);
        try {
            const data = e.read();
            if (/\.zip$/i.test(entryName) && depth < 1) {
                const inner = readZip(data);
                if (!isExtensionZip(inner) && !isBackupZip(inner)) {
                    for (const r of ingestZip(data, entryName, { ...o, zipCollection: false }, depth + 1).results) results.push({ ...r, entry: `${e.name}/${r.entry}` });
                    continue;
                }
            }
            results.push({ entry: e.name, ...ingest(data, entryName, { ...o, origin: o.origin || 'zip' }) });
        } catch (err) {
            results.push({ entry: e.name, filename: entryName, status: 'error', error: err.message });
        }
    }
    const col = o.collectionName ? Object.values(store.db.collections).find((c) => c.name === String(o.collectionName).trim().slice(0, 60)) : null;
    return { batch: true, archive: archiveName, results, collection: col || null, collectionName: o.collectionName || '' };
}

/** 通用入口：ZIP 自动解压（扩展包、CHARX 除外），其它直接收录 */
function ingestAny(buf, filename, opts) {
    if (/\.zip$/i.test(filename) && opts.unzip !== false) {
        let entries;
        try { entries = readZip(buf); } catch { entries = null; }
        if (entries && isBackupZip(entries)) throw new HttpError(400, '这是藏馆的完整备份，请到「设置 → 数据」里用「从备份还原」导入');
        if (entries && !isExtensionZip(entries)) return ingestZip(buf, filename, opts);
    }
    return ingest(buf, filename, opts);
}

function changedIds(result) {
    const list = result.batch ? result.results : [result];
    return list.filter((r) => r.status === 'created' || r.status === 'version').map((r) => r.item.id);
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
        match: ['ask', 'version', 'new', 'skip'].includes(sp.get('match')) ? sp.get('match') : '',
        target: sp.get('target') || '',
        collectionName: sp.get('collectionName') || '',
        zipCollection: sp.get('zipCollection') === '1',
        unzip: sp.get('unzip') !== '0',
        label: sp.get('label') || '',
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

route('GET', '/api/health', () => ({ ok: true, app: 'tavern-vault', version: VERSION, features: ['versions', 'zip', 'restore', 'sig', 'ai'], auth: authEnabled(), title: store.db.settings.title, skin: store.db.settings.skin }), { open: true });

// ---------------- 登录保护 ----------------
// 同一来源连续输错 5 次后暂停，之后每多错一次暂停时间翻倍（最长 30 分钟）；
// 所有来源 15 分钟内合计错 50 次时，暂停全部新登录 10 分钟（已登录的设备不受影响）。
const LOGIN_WINDOW = 15 * 60e3;
const loginFails = new Map();
const loginGlobal = { fails: [], until: 0 };
const loginLogPath = path.join(DATA_DIR, 'login-log.json');
let loginLog = [];
try { loginLog = JSON.parse(fs.readFileSync(loginLogPath, 'utf8')).slice(-100); } catch { /* 没有记录 */ }
const saveLoginLog = () => { try { fs.writeFileSync(loginLogPath, JSON.stringify(loginLog.slice(-100))); } catch { /* ignore */ } };

function clientIp(req) {
    return String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim().replace(/^::ffff:/, '').slice(0, 64);
}
function deviceOf(ua = '') {
    const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    const app = /TauriTavern|Tauri/i.test(ua) ? 'TauriTavern' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return [os, app].filter(Boolean).join(' · ') || '未知设备';
}
const waitText = (ms) => (ms >= 60e3 ? `${Math.ceil(ms / 60e3)} 分钟` : `${Math.ceil(ms / 1000)} 秒`);

route('POST', '/api/login', async ({ req }) => {
    const { password } = await readJson(req);
    if (!authEnabled()) return { token: '' };
    const ip = clientIp(req);
    const now = Date.now();
    const rec = loginFails.get(ip);
    if (rec?.until > now) throw new HttpError(429, `尝试次数太多，请 ${waitText(rec.until - now)}后再试`);
    if (loginGlobal.until > now) throw new HttpError(429, `登录尝试过于频繁，已暂停新登录，请 ${waitText(loginGlobal.until - now)}后再试`);
    const ok = Boolean(password) && verifyPassword(String(password), store.db.settings.passwordHash);
    loginLog.push({ at: new Date().toISOString(), ip, ok, device: deviceOf(req.headers['user-agent']) });
    saveLoginLog();
    if (ok) {
        loginFails.delete(ip);
        return { token: makeToken() };
    }
    const r = rec && now - rec.first < LOGIN_WINDOW ? rec : { count: 0, first: now, until: 0 };
    r.count++;
    if (r.count >= 5) r.until = now + Math.min(30 * 60e3, 60e3 * 2 ** (r.count - 5));
    loginFails.set(ip, r);
    loginGlobal.fails = loginGlobal.fails.filter((t) => now - t < LOGIN_WINDOW);
    loginGlobal.fails.push(now);
    if (loginGlobal.fails.length >= 50) { loginGlobal.until = now + 10 * 60e3; loginGlobal.fails = []; console.log('  [登录保护] 15 分钟内失败次数过多，暂停新登录 10 分钟'); }
    console.log(`  [登录保护] 密码错误 ip=${ip} 第 ${r.count} 次${r.until > now ? `，暂停 ${waitText(r.until - now)}` : ''}`);
    await new Promise((res) => setTimeout(res, 400));
    throw new HttpError(r.until > now ? 429 : 401, r.until > now ? `密码错误次数太多，请 ${waitText(r.until - now)}后再试` : `密码错误${r.count >= 3 ? `，再错 ${5 - r.count} 次会暂停登录` : ''}`);
}, { open: true });
setInterval(() => { const now = Date.now(); for (const [k, r] of loginFails) if (now - r.first > LOGIN_WINDOW && r.until < now) loginFails.delete(k); }, 10 * 60e3).unref();

route('GET', '/api/security/log', () => ({ log: loginLog.slice(-30).reverse(), locked: [...loginFails].filter(([, r]) => r.until > Date.now()).map(([ip, r]) => ({ ip, until: new Date(r.until).toISOString() })) }));

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
        health: { guard: backupGuard(), recovered: settings.recoveredNote || null },
        settings: { ...settings, syncExclude: syncExclude(), syncIgnore: syncIgnore(), syncKeep: syncKeep(), auth: authEnabled(), version: VERSION, ai: { ready: aiConfig.ready, ...aiTasks.summary() } },
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
    let buf = await readBody(req);
    if (!buf.length) throw new HttpError(400, '空文件');
    let merged = false;
    if (opts.origin === 'tavern') {
        buf = await stripFromTavern(buf, opts.filename);
        if (opts.target) ({ buf, merged } = await keepVaultParts(buf, opts.filename, opts.target));
    }
    const result = ingestAny(buf, opts.filename, opts);
    if (merged && result.status === 'duplicate') result.ignoredOnly = true;
    const ids = changedIds(result);
    if (ids.length || result.batch) broadcast('change', { ids });
    return result;
});

const syncExclude = () => store.db.settings.syncExclude ?? DEFAULT_SYNC_EXCLUDE;
// 从酒馆同步时忽略的角色卡分段；syncKeep：收新版本时，这几段沿用藏馆原来的内容
const syncIgnore = () => (store.db.settings.syncIgnore || []).filter((k) => k in SYNC_OPTIONS);
const syncKeep = () => store.db.settings.syncKeep !== false;

/** 酒馆里的卡收成新版本前：把忽略的那几段换回藏馆当前版本的内容 */
async function keepVaultParts(buf, filename, targetId) {
    const ignore = syncIgnore();
    const it = store.db.items[targetId];
    const prev = it && store.primaryFile(it);
    if (!ignore.length || !syncKeep() || !prev || !['character', 'worldbook'].includes(it.type) || !store.hasBlob(prev.sha)) return { buf, merged: false };
    try {
        const cur = parseFile(buf, filename);
        const old = parseFile(store.readBlob(prev.sha), prev.name).obj;
        if (!cur?.obj || !old || (!cur.image && path.extname(filename).toLowerCase() === '.charx')) return { buf, merged: false };
        const out = mergeParts(it.type, cur.obj, old, ignore);
        if (JSON.stringify(out) === JSON.stringify(cur.obj)) return { buf, merged: false };
        return { buf: cur.image ? await writeCardToPng(buf, out) : Buffer.from(JSON.stringify(out, null, 4)), merged: true };
    } catch {
        return { buf, merged: false };
    }
}

/** 从酒馆来的角色卡 / 世界书：去掉总结脚本写进去的条目（规则见 设置 → 导入） */
async function stripFromTavern(buf, filename) {
    let parsed;
    try { parsed = parseFile(buf, filename); } catch { return buf; }
    const obj = parsed?.obj;
    if (!obj || typeof obj !== 'object' || (!parsed.image && path.extname(filename).toLowerCase() === '.charx')) return buf;
    const type = parsed.image || obj.data || obj.spec || obj.first_mes != null ? 'character' : obj.entries ? 'worldbook' : '';
    if (!type) return buf;
    const { obj: out, removed } = stripSyncEntries(type, obj, syncExclude());
    if (!removed) return buf;
    console.log(`  从酒馆同步：去掉 ${removed} 个排除规则内的世界书条目（${filename}）`);
    if (parsed.image) return writeCardToPng(buf, out);
    return Buffer.from(JSON.stringify(out, null, 4));
}

// 处理导入冲突：用户选择「存为新版本 / 另存为新条目 / 跳过」
route('POST', '/api/ingest/resolve', async ({ req }) => {
    const { sha, filename, action, target, ...opts } = await readJson(req);
    if (action === 'skip') return { status: 'skipped' };
    if (!/^[a-f0-9]{64}$/.test(sha || '') || !store.hasBlob(sha)) throw new HttpError(410, '临时文件已失效，请重新上传');
    const buf = store.readBlob(sha);
    let result;
    if (action === 'new') result = ingest(buf, filename, { ...opts, mode: 'new' });
    else if (action === 'version') result = ingest(buf, filename, { ...opts, target, match: 'version' });
    else throw new HttpError(400, '未知操作');
    broadcast('change', { ids: changedIds(result) });
    return result;
});

// 对比两个文件（两个版本）
route('POST', '/api/diff', async ({ req }) => {
    const { a, b } = await readJson(req);
    for (const x of [a, b]) if (!x || !/^[a-f0-9]{64}$/.test(x.sha || '') || !store.hasBlob(x.sha)) throw new HttpError(404, '文件不存在');
    return diffFiles({ buf: store.readBlob(a.sha), name: a.name || 'a' }, { buf: store.readBlob(b.sha), name: b.name || 'b' });
});

// ---------------- AI ----------------
const aiTasks = createAiTasks({ dataDir: DATA_DIR, store, config: aiConfig, loadContent, broadcast });
const aiFail = (e) => { throw new HttpError(e instanceof AiError ? 400 : 500, e.message); };
const idList = (v) => (Array.isArray(v) ? v.map(String).filter((id) => store.db.items[id]).slice(0, 2000) : []);

route('GET', '/api/ai/config', () => aiConfig.public());
route('PUT', '/api/ai/config', async ({ req }) => {
    aiConfig.update(await readJson(req));
    broadcast('change', {});
    return aiConfig.public();
});
route('POST', '/api/ai/test', async ({ req }) => {
    const { profile } = await readJson(req);
    const p = aiConfig.resolve(profile);
    const t0 = Date.now();
    try {
        const r = await chat(p, { system: '你是连接测试。', user: '只回复两个字：成功', maxTokens: 300, timeout: 45000 });
        return { ok: true, ms: Date.now() - t0, model: r.model, text: r.text.slice(0, 200), truncated: r.truncated };
    } catch (e) { return aiFail(e); }
});
route('POST', '/api/ai/models', async ({ req }) => {
    const { profile } = await readJson(req);
    try { return { models: await listModels(aiConfig.resolve(profile)) }; } catch (e) { return aiFail(e); }
});
route('POST', '/api/ai/organize/estimate', async ({ req }) => {
    const { ids, scope } = await readJson(req);
    return aiTasks.estimate(idList(ids), scope);
});
route('POST', '/api/ai/organize/preview', async ({ req }) => {
    const { id, extra } = await readJson(req);
    try { return aiTasks.preview(String(id), extra); } catch (e) { return aiFail(e); }
});
route('POST', '/api/ai/organize', async ({ req }) => {
    const { ids, extra } = await readJson(req);
    try { return { queued: aiTasks.enqueue(idList(ids), { extra }), ...aiTasks.summary() }; } catch (e) { return aiFail(e); }
});
route('GET', '/api/ai/drafts', () => ({ drafts: Object.values(aiTasks.drafts), summary: aiTasks.summary() }));
route('POST', '/api/ai/drafts/apply', async ({ req }) => {
    const { items } = await readJson(req);
    const ids = aiTasks.apply(items);
    broadcast('change', { ids });
    return { ok: true, applied: ids.length };
});
route('POST', '/api/ai/drafts/discard', async ({ req }) => {
    const { ids } = await readJson(req);
    aiTasks.discard(Array.isArray(ids) ? ids.map(String) : []);
    return { ok: true };
});
route('POST', '/api/ai/cancel', () => { aiTasks.cancel(); return { ok: true }; });
route('POST', '/api/ai/explain', async ({ req }) => {
    const { a, b, aLabel, bLabel, force } = await readJson(req);
    for (const x of [a, b]) if (!x || !/^[a-f0-9]{64}$/.test(x.sha || '') || !store.hasBlob(x.sha)) throw new HttpError(404, '文件不存在');
    const d = diffFiles({ buf: store.readBlob(a.sha), name: a.name || 'a' }, { buf: store.readBlob(b.sha), name: b.name || 'b' });
    try { return await aiTasks.explain(d, { aLabel: String(aLabel || 'A').slice(0, 80), bLabel: String(bLabel || 'B').slice(0, 80), key: `${a.sha}:${b.sha}`, force: Boolean(force) }); } catch (e) { return aiFail(e); }
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
    const result = ingestAny(buf, filename, { ...rest, source: rest.source || target, origin: 'url' });
    broadcast('change', { ids: changedIds(result) });
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
    delete it.mergedInto;
    store.save();
    broadcast('change', { ids: [p.id] });
    return slim(it);
});

// 合并重复条目：其它条目的文件并入目标作为旧版本，标签、合集、备注等合在一起，其它条目移到回收站
route('POST', '/api/items/merge', async ({ req }) => {
    const body = await readJson(req);
    const target = getItem(String(body.target || ''));
    if (target.deletedAt) throw new HttpError(400, '目标条目在回收站里');
    const sources = [...new Set((Array.isArray(body.sources) ? body.sources : []).map(String))]
        .filter((id) => id !== target.id).map((id) => store.db.items[id]).filter((it) => it && !it.deletedAt);
    if (!sources.length) throw new HttpError(400, '没有要合并的条目');
    if (sources.length > 20) throw new HttpError(400, '一次最多合并 20 个条目');
    const now = new Date().toISOString();
    const shas = new Set(target.files.map((f) => f.sha));
    const uniq = (a) => [...new Set(a.filter(Boolean))];
    let moved = 0;
    for (const src of sources) {
        for (const f of src.files) {
            if (shas.has(f.sha)) continue;
            shas.add(f.sha);
            target.files.push({ ...f, id: crypto.randomBytes(6).toString('hex'), primary: false, label: f.label || `来自「${src.name}」` });
            moved++;
        }
        target.tags = uniq([...target.tags, ...src.tags]);
        target.collections = uniq([...(target.collections || []), ...(src.collections || [])]);
        target.favorite = target.favorite || src.favorite;
        target.rating = Math.max(target.rating || 0, src.rating || 0) || target.rating;
        const note = String(src.notes || '').trim();
        if (note && !String(target.notes || '').includes(note)) target.notes = target.notes ? `${target.notes}\n\n${note}` : note;
        for (const k of ['description', 'author', 'source', 'version', 'cover']) if (!target[k] && src[k]) target[k] = src[k];
        for (const [k, v] of Object.entries(src.fields || {})) {
            const cur = target.fields?.[k];
            if ((cur == null || cur === '' || (Array.isArray(cur) && !cur.length)) && v != null && v !== '') target.fields = { ...target.fields, [k]: v };
        }
        if (src.createdAt && (!target.createdAt || src.createdAt < target.createdAt)) target.createdAt = src.createdAt;
        src.deletedAt = now;
        src.mergedInto = target.id;
    }
    // 可选：当前版本换成最新导入的同类文件（角色卡换角色卡，不会换成插图）
    const cur = target.files.find((f) => f.primary);
    if (body.newest && cur) {
        const family = (f) => ((/^image\/png/.test(f.mime) && (f.sig || f.primary)) || /\.(json|charx)$/i.test(f.name) ? 'card' : /^image\//.test(f.mime) ? 'image' : f.mime);
        const latest = target.files.filter((f) => family(f) === family(cur)).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))[0];
        if (latest && latest !== cur) {
            target.files.forEach((f) => { f.primary = f === latest; });
            applyDetection(target, detectFile(store.readBlob(latest.sha), latest.name), latest.sha);
        }
    }
    target.updatedAt = now;
    store.save();
    broadcast('change', { ids: [target.id, ...sources.map((x) => x.id)] });
    return { item: slim(target), merged: sources.length, files: moved };
});

route('POST', '/api/items/:id/files', async ({ req, p, url }) => {
    const it = getItem(p.id);
    const sp = url.searchParams;
    const filename = sp.get('filename') || 'file.bin';
    const buf = await readBody(req);
    if (!buf.length) throw new HttpError(400, '空文件');
    const sha = store.putBlob(buf);
    const primary = sp.get('primary') === '1';
    const det = detectFile(buf, filename);
    const file = store.addFile(it.id, { sha, name: safeFilename(filename), size: buf.length, mime: mimeOf(filename), label: sp.get('label') || '', primary, sig: fileSig(buf, filename, det), parts: fileParts(buf, filename, det) });
    if (file.primary) applyDetection(it, det, sha);
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
    const det = detectFile(buf, filename);
    store.addFile(it.id, { sha, name: filename, size: buf.length, mime: mimeOf(filename), label: `网页编辑 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, primary: true, sig: fileSig(buf, filename, det), parts: fileParts(buf, filename, det) });
    applyDetection(it, det, sha);
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

/** 完整备份 ZIP：db.json + 所有被引用的文件（不含缩略图、AI 密钥） */
function buildBackup() {
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
    return buildZip(entries);
}

route('GET', '/api/backup', ({ res }) => {
    send(res, 200, buildBackup(), { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition(`TavernVault-backup-${new Date().toISOString().slice(0, 10)}.zip`, true) });
    return null;
});

// 从备份还原
route('POST', '/api/restore', async ({ req, url }) => restoreFrom(await readBody(req, MAX_RESTORE), url.searchParams.get('mode') === 'replace' ? 'replace' : 'merge'));

async function restoreFrom(buf, mode) {
    let entries;
    try { entries = readZip(buf, { maxTotal: MAX_RESTORE * 4, maxEntries: 500000 }); } catch (e) { throw new HttpError(400, `无法读取备份：${e.message}`); }
    const dbEntry = entries.find((e) => e.name === 'db.json');
    if (!dbEntry) throw new HttpError(400, '这不是藏馆备份（缺少 db.json）');
    let backup;
    try { backup = JSON.parse(dbEntry.read().toString('utf8')); } catch { throw new HttpError(400, '备份里的 db.json 已损坏'); }
    if (!backup || typeof backup.items !== 'object') throw new HttpError(400, '备份格式不正确');
    // 还原前先留一份当前数据库
    store.flush();
    const safeDir = path.join(DATA_DIR, 'restore-points');
    fs.mkdirSync(safeDir, { recursive: true });
    const safeName = `db-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.copyFileSync(store.dbPath, path.join(safeDir, safeName));
    for (const old of fs.readdirSync(safeDir).filter((f) => f.startsWith('db-before-restore-')).sort().slice(0, -10)) fs.unlinkSync(path.join(safeDir, old));
    let files = 0;
    let bad = 0;
    for (const e of entries) {
        const m = e.name.match(/^files\/[a-f0-9]{2}\/([a-f0-9]{64})$/);
        if (!m) continue;
        if (store.hasBlob(m[1])) { files++; continue; }
        const sha = store.putBlob(e.read());
        if (sha === m[1]) files++; else bad++;
    }
    const stat = store.restoreDb(backup, mode);
    await fillSigs();
    broadcast('change', {});
    return { ok: true, mode, ...stat, files, bad, restorePoint: safeName };
}

// ---------------- 自动备份 ----------------
// 每天在数据目录的 backups 文件夹里存一份完整备份，保留最近几份；内容没变就不重复备份
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_NAME = /^TavernVault-(auto|manual)-\d{8}-\d{6}\.zip$/;
const autoBackupCfg = () => ({ on: true, keep: 7, ...(store.db.settings.autoBackup || {}) });

function listBackups() {
    try {
        return fs.readdirSync(BACKUP_DIR).filter((f) => BACKUP_NAME.test(f))
            .map((name) => { const st = fs.statSync(path.join(BACKUP_DIR, name)); return { name, size: st.size, at: st.mtime.toISOString(), auto: name.includes('-auto-') }; })
            .sort((a, b) => b.name.slice(-19).localeCompare(a.name.slice(-19)));
    } catch { return []; }
}
// 每份备份里有多少条目（含回收站），用来发现「库突然变空 / 少了一大半」
const COUNTS_FILE = () => path.join(BACKUP_DIR, '.counts.json');
const itemCount = () => Object.keys(store.db.items).length;
function backupCounts() {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(COUNTS_FILE(), 'utf8')) || {}; } catch { /* 第一次 */ }
    let changed = false;
    const list = listBackups();
    for (const b of list) {
        if (typeof c[b.name] === 'number') continue;
        // 旧备份没记过数量，读一次它的 db.json
        try {
            const e = readZip(fs.readFileSync(path.join(BACKUP_DIR, b.name)), { maxTotal: 4 * 1024 ** 3, maxEntries: 500000 }).find((x) => x.name === 'db.json');
            c[b.name] = Object.keys(JSON.parse(e.read().toString('utf8')).items || {}).length;
        } catch { c[b.name] = -1; }
        changed = true;
    }
    for (const k of Object.keys(c)) if (!list.some((b) => b.name === k)) { delete c[k]; changed = true; }
    if (changed) try { fs.writeFileSync(COUNTS_FILE(), JSON.stringify(c)); } catch { /* ignore */ }
    return c;
}
/** 条目数比最近一份备份少了一半以上（或变成 0）时返回提示信息，这时自动备份暂停，免得把好的备份挤掉 */
function backupGuard() {
    const last = listBackups()[0];
    if (!last) return null;
    const ref = backupCounts()[last.name];
    const now = itemCount();
    if (!(ref > 0)) return null;
    if (now === 0 || (now < ref / 2 && ref - now >= 5)) return { items: now, ref, refName: last.name };
    return null;
}

function makeBackup(kind = 'manual') {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const name = `TavernVault-${kind}-${stamp.slice(0, 8)}-${stamp.slice(8)}.zip`;
    const file = path.join(BACKUP_DIR, name);
    fs.writeFileSync(`${file}.tmp`, buildBackup());
    fs.renameSync(`${file}.tmp`, file);
    fs.writeFileSync(path.join(BACKUP_DIR, '.last-db'), dbFingerprint());
    try { fs.writeFileSync(COUNTS_FILE(), JSON.stringify({ ...backupCounts(), [name]: itemCount() })); } catch { /* ignore */ }
    pruneBackups();
    console.log(`  [自动备份] 已保存 ${name}`);
    return listBackups().find((b) => b.name === name);
}
function pruneBackups() {
    const { keep } = autoBackupCfg();
    for (const b of listBackups().filter((x) => x.auto).slice(keep)) fs.unlinkSync(path.join(BACKUP_DIR, b.name));
}
function dbFingerprint() {
    store.flush();
    return crypto.createHash('sha1').update(fs.readFileSync(store.dbPath)).digest('hex');
}
function autoBackupTick() {
    try {
        if (!autoBackupCfg().on) return;
        const last = listBackups().find((b) => b.auto);
        if (last && Date.now() - Date.parse(last.at) < 23 * 3600e3) return;
        let lastDb = '';
        try { lastDb = fs.readFileSync(path.join(BACKUP_DIR, '.last-db'), 'utf8'); } catch { /* 第一次 */ }
        if (last && lastDb === dbFingerprint()) return;
        const g = backupGuard();
        if (g) { console.log(`  [自动备份] 暂停：现在 ${g.items} 个条目，最近一份备份里有 ${g.ref} 个`); return; }
        makeBackup('auto');
    } catch (e) { console.log(`  [自动备份] 失败：${e.message}`); }
}
setTimeout(autoBackupTick, 60e3).unref();
setInterval(autoBackupTick, 3600e3).unref();

const backupFile = (name) => {
    if (!BACKUP_NAME.test(name || '') || !fs.existsSync(path.join(BACKUP_DIR, name))) throw new HttpError(404, '备份不存在');
    return path.join(BACKUP_DIR, name);
};
route('GET', '/api/backups', () => ({ ...autoBackupCfg(), list: listBackups(), counts: backupCounts(), guard: backupGuard() }));
// 「条目确实是我自己删的」：立刻按现在的数据存一份自动备份，之后照常
route('POST', '/api/backups/ack', () => { const b = makeBackup('auto'); broadcast('change', {}); return b; });
route('POST', '/api/health/ack', () => { delete store.db.settings.recoveredNote; store.save(); broadcast('change', {}); return { ok: true }; });
route('POST', '/api/backups', () => makeBackup('manual'));
route('GET', '/api/backups/:name', ({ res, p }) => {
    const file = backupFile(p.name);
    send(res, 200, fs.readFileSync(file), { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition(p.name, true) });
    return null;
});
route('DELETE', '/api/backups/:name', ({ p }) => { fs.unlinkSync(backupFile(p.name)); return { ok: true }; });
route('POST', '/api/backups/:name/restore', async ({ p, url }) => restoreFrom(fs.readFileSync(backupFile(p.name)), url.searchParams.get('mode') === 'replace' ? 'replace' : 'merge'));

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

// 回收站自动清空：设置了天数后，删除超过这个天数的条目会被彻底清除
function purgeTrash() {
    const days = store.db.settings.trashDays;
    if (!days) return 0;
    const before = Date.now() - days * 86400e3;
    const old = Object.values(store.db.items).filter((it) => it.deletedAt && Date.parse(it.deletedAt) < before);
    if (!old.length) return 0;
    for (const it of old) delete store.db.items[it.id];
    store.save();
    store.gcBlobs();
    broadcast('change', {});
    console.log(`  回收站：自动清除 ${old.length} 个超过 ${days} 天的条目`);
    return old.length;
}
setTimeout(purgeTrash, 5000).unref();
setInterval(purgeTrash, 6 * 3600e3).unref();

// 封面缩略图：浏览器第一次显示封面时生成（宽 480），之后列表只加载缩略图
const thumbType = (b) => (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp'
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : '');
route('GET', '/api/thumbs/:sha', ({ req, res, p }) => {
    if (!/^[a-f0-9]{64}$/.test(p.sha) || !store.hasThumb(p.sha)) throw new HttpError(404, '缩略图不存在');
    const etag = `"t-${p.sha}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return null; }
    const buf = store.readThumb(p.sha);
    send(res, 200, buf, { 'Content-Type': thumbType(buf) || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=31536000, immutable', ETag: etag });
    return null;
});
route('DELETE', '/api/thumbs', () => ({ removed: store.clearThumbs() }));
route('PUT', '/api/thumbs/:sha', async ({ req, p }) => {
    if (!/^[a-f0-9]{64}$/.test(p.sha) || !Object.values(store.db.items).some((it) => it.cover === p.sha || it.files.some((f) => f.sha === p.sha && /^image\//.test(f.mime)))) throw new HttpError(404, '不是图片');
    const buf = await readBody(req, 600 * 1024);
    if (!thumbType(buf)) throw new HttpError(400, '缩略图格式不对');
    store.writeThumb(p.sha, buf);
    return { ok: true };
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
    if ([0, 7, 14, 30, 90].includes(body.trashDays)) store.db.settings.trashDays = body.trashDays;
    if (body.autoBackup && typeof body.autoBackup === 'object') {
        const cur = autoBackupCfg();
        store.db.settings.autoBackup = { on: typeof body.autoBackup.on === 'boolean' ? body.autoBackup.on : cur.on, keep: [3, 7, 14, 30].includes(body.autoBackup.keep) ? body.autoBackup.keep : cur.keep };
    }
    // 标记为「不是重复」的条目组（排序后的 id 用逗号连接）
    if (Array.isArray(body.dupIgnore)) store.db.settings.dupIgnore = [...new Set(body.dupIgnore.map((x) => String(x).replace(/[^\w,-]/g, '').slice(0, 400)).filter(Boolean))].slice(-300);
    if (Array.isArray(body.syncIgnore)) store.db.settings.syncIgnore = [...new Set(body.syncIgnore.map(String))].filter((k) => k in SYNC_OPTIONS);
    if (typeof body.syncKeep === 'boolean') store.db.settings.syncKeep = body.syncKeep;
    if (Array.isArray(body.syncExclude)) store.db.settings.syncExclude = [...new Set(body.syncExclude.map((x) => String(x).trim().slice(0, 60)).filter(Boolean))].slice(0, 30);
    store.save();
    if (body.trashDays) purgeTrash();
    if (body.autoBackup) { pruneBackups(); autoBackupTick(); }
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
route('GET', '/api/storage', () => {
    const size = (dir) => { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size; return n; };
    let blobs = 0;
    try { blobs = size(store.filesDir); } catch { /* ignore */ }
    return { blobs, thumbs: (() => { try { return size(store.thumbsDir); } catch { return 0; } })(), thumbCount: store.thumbs.size, db: fs.statSync(store.dbPath).size };
});

// ---------------- 静态文件 ----------------
// 页面引用的脚本和样式都带上版本目录 /v/<版本>/…：代码一改版本就变，浏览器可以放心长期缓存，更新后也不会用到旧文件。
// private：Cloudflare 不缓存、也不改写缓存时间。
const ASSET_CACHE = 'private, max-age=31536000, immutable';
const PAGE_CACHE = 'private, no-cache';

function assetFiles(dir = WEB_DIR) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? assetFiles(path.join(dir, e.name)) : /\.(js|css)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}
function assetVersion() {
    const h = crypto.createHash('sha1');
    for (const f of assetFiles().sort()) { const st = fs.statSync(f); h.update(`${f}:${st.size}:${st.mtimeMs}\n`); }
    return h.digest('hex').slice(0, 10);
}
function indexHtml(v) {
    const pre = (p) => `/v/${v}/${p}`;
    const preloads = assetFiles(path.join(WEB_DIR, 'js')).map((f) => `<link rel="modulepreload" href="${pre(path.relative(WEB_DIR, f).split(path.sep).join('/'))}">`).join('\n');
    return fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
        .replace(/(href|src)="\/(css|js)\//g, (m, attr, d) => `${attr}="/v/${v}/${d}/`)
        .replace('</head>', `${preloads}\n</head>`);
}

function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    const versioned = rel.match(/^\/v\/[0-9a-f]{1,40}(\/.*)$/);
    if (versioned) rel = versioned[1];
    if (rel === '/' || rel === '/index.html' || !path.extname(rel)) {
        const v = assetVersion();
        const etag = `W/"i-${v}-${Math.floor(fs.statSync(path.join(WEB_DIR, 'index.html')).mtimeMs).toString(36)}"`;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': PAGE_CACHE }); res.end(); return; }
        send(res, 200, Buffer.from(indexHtml(v)), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': PAGE_CACHE, ETag: etag });
        return;
    }
    const file = path.normalize(path.join(WEB_DIR, rel));
    if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' });
        return;
    }
    const st = fs.statSync(file);
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const cache = versioned ? ASSET_CACHE : PAGE_CACHE;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache }); res.end(); return; }
    send(res, 200, fs.readFileSync(file), { 'Content-Type': mimeOf(file), 'Cache-Control': cache, ETag: etag });
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

/** 给旧数据补算内容指纹（后台分批进行，不阻塞启动） */
// ---------------- 全文搜索 ----------------
// 列表里只带了一小段 searchText；这里按文件内容搜：开场白、对话示例、世界书条目、预设提示词……
const searchCache = new Map();
const SEG_MAX = 2 * 1024 * 1024;
function contentSegs(type, parsed) {
    const out = [];
    const add = (label, v) => { const s = str(v).trim(); if (s) out.push([label, s.slice(0, SEG_MAX)]); };
    const bookText = (book) => entriesOf(book).map((e) => `${str(e.comment || e.name)} ${entryKeys(e).join(' ')}\n${str(e.content)}`).join('\n\n');
    const obj = parsed.obj;
    if (type === 'character' && obj) {
        const d = normalizeCard(obj)?.data || {};
        add('描述', d.description); add('性格', d.personality); add('场景', d.scenario);
        add('开场白', [d.first_mes, ...(Array.isArray(d.alternate_greetings) ? d.alternate_greetings : []), ...(Array.isArray(d.group_only_greetings) ? d.group_only_greetings : [])].map(str).join('\n\n'));
        add('对话示例', d.mes_example); add('系统提示词', d.system_prompt); add('后置指令', d.post_history_instructions);
        add('作者注释', d.creator_notes); add('深度提示词', d.extensions?.depth_prompt?.prompt);
        add('内嵌世界书', bookText(d.character_book));
        add('内嵌正则', (Array.isArray(d.extensions?.regex_scripts) ? d.extensions.regex_scripts : []).map((r) => str(r?.scriptName)).join('\n'));
    } else if (type === 'worldbook' && obj) {
        add('世界书', bookText(obj));
    } else if (type === 'preset' && obj) {
        add('提示词', effectivePrompts(obj).map(({ p }) => `${str(p.name)}\n${str(p.content)}`).join('\n\n'));
    } else if (type === 'regex' && obj) {
        add('正则', (Array.isArray(obj) ? obj : [obj]).map((r) => `${str(r?.scriptName)}\n${str(r?.findRegex)}`).join('\n'));
    } else if (parsed.text) {
        add('内容', parsed.text);
    } else if (obj && type !== 'character') {
        add('内容', JSON.stringify(obj));
    }
    return out;
}
function searchSegs(it) {
    const f = store.primaryFile(it);
    const key = `${f?.sha || ''}|${it.updatedAt}`;
    const c = searchCache.get(it.id);
    if (c && c.key === key) return c.segs;
    const segs = [['名称', it.name], ['作者', it.author], ['标签', it.tags.join(' ')], ['简介', it.description], ['笔记', it.notes], ['资料', Object.values(it.fields || {}).join(' ')]]
        .map(([l, v]) => [l, str(v)]).filter(([, v]) => v);
    if (f && f.size < 64 * 1024 * 1024 && store.hasBlob(f.sha)) {
        try { segs.push(...contentSegs(it.type, parseFile(store.readBlob(f.sha), f.name))); } catch { /* 读不了就只搜资料 */ }
    }
    const out = segs.map(([l, v]) => [l, v, v.toLowerCase()]);
    searchCache.set(it.id, { key, segs: out });
    return out;
}
function snippet(text, lower, term) {
    const i = lower.indexOf(term);
    if (i < 0) return '';
    // 命中的词放在片段靠前的位置，卡片只显示两行也能看到
    const a = Math.max(0, i - 8);
    const b = Math.min(text.length, i + term.length + 60);
    return `${a > 0 ? '…' : ''}${text.slice(a, b).replace(/\s+/g, ' ').trim()}${b < text.length ? '…' : ''}`;
}
/** 空格分隔的词都要出现，-词 表示不能出现；#标签 / -#标签 由网页自己按标签筛 */
route('GET', '/api/search', ({ url }) => {
    const raw = String(url.searchParams.get('q') || '').slice(0, 500);
    const words = raw.toLowerCase().split(/\s+/).filter(Boolean).filter((w) => !/^-?#/.test(w));
    const pos = words.filter((w) => !w.startsWith('-'));
    const neg = words.filter((w) => w.startsWith('-') && w.length > 1).map((w) => w.slice(1));
    const hits = {};
    if (!pos.length && !neg.length) return { q: raw, hits };
    for (const it of Object.values(store.db.items)) {
        if (it.deletedAt) continue;
        const segs = searchSegs(it);
        if (neg.some((t) => segs.some((s) => s[2].includes(t)))) continue;
        let first = null;
        let ok = true;
        for (const t of pos) {
            const s = segs.find((x) => x[2].includes(t));
            if (!s) { ok = false; break; }
            first ||= [s, t];
        }
        if (!ok) continue;
        // 名称、标签里就有的不用显示片段
        const [s, t] = first || [];
        hits[it.id] = s && !['名称', '标签'].includes(s[0]) ? { where: s[0], snip: snippet(s[1], s[2], t) } : {};
    }
    return { q: raw, hits };
});

// 识别规则更新过（比如预设的启用数、对象形式的世界书条目）：启动时按文件重新算一遍统计信息
const DETECT_VERSION = 2;
async function redetect() {
    if ((store.db.detectVersion || 1) >= DETECT_VERSION) return 0;
    let n = 0;
    for (const it of Object.values(store.db.items)) {
        const f = store.primaryFile(it);
        if (!f || !store.hasBlob(f.sha)) continue;
        try {
            const det = detectFile(store.readBlob(f.sha), f.name);
            if (det.type === it.type) { it.meta = det.meta || {}; it.searchText = det.searchText || ''; n++; }
        } catch { /* 跳过 */ }
        if (n % 25 === 0) await new Promise((r) => setImmediate(r));
    }
    store.db.detectVersion = DETECT_VERSION;
    store.save();
    return n;
}

async function fillSigs() {
    let n = 0;
    for (const it of Object.values(store.db.items)) {
        for (const f of it.files) {
            const partsType = it.type === 'character' || it.type === 'worldbook';
            const needParts = partsType && f.sig && f.parts?.v !== PARTS_VERSION;
            if (f.sig !== undefined && !needParts) continue;
            try {
                const buf = store.hasBlob(f.sha) ? store.readBlob(f.sha) : null;
                if (f.sig === undefined) f.sig = buf ? fileSig(buf, f.name) : '';
                if (partsType && f.sig) f.parts = (buf && fileParts(buf, f.name)) || null;
            } catch { if (f.sig === undefined) f.sig = ''; }
            if (++n % 25 === 0) await new Promise((r) => setImmediate(r));
        }
    }
    if (n) store.save();
    return n;
}
fillSigs().then((n) => { if (n) console.log(`  已为 ${n} 个旧文件补算内容指纹`); })
    .then(redetect).then((n) => { if (n) { console.log(`  已按新规则重新识别 ${n} 个条目`); broadcast('change', {}); } });

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
