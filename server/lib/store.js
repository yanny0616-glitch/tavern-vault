// 数据存储：db.json 索引 + 按 sha256 去重的文件仓库
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_FIELDS = [
    { id: 'source', label: '来源链接', kind: 'url', types: [], builtin: true },
    { id: 'author', label: '作者', kind: 'text', types: [], builtin: true },
    { id: 'version', label: '版本', kind: 'text', types: [], builtin: true },
    { id: 'rating', label: '评分', kind: 'rating', types: [], builtin: true },
    { id: 'status', label: '使用状态', kind: 'select', options: ['未使用', '在用', '已玩过', '吃灰', '待修改'], types: [] },
    { id: 'nsfw', label: 'NSFW', kind: 'checkbox', types: ['character', 'worldbook', 'preset'] },
    { id: 'model', label: '推荐模型', kind: 'text', types: ['character', 'preset'] },
    { id: 'pairing', label: '搭配预设/世界书', kind: 'text', types: ['character'] },
    { id: 'language', label: '语言', kind: 'select', options: ['中文', 'English', '日本語', '其他'], types: ['character', 'worldbook', 'preset'] },
    { id: 'downloadedAt', label: '获取日期', kind: 'date', types: [] },
];

const now = () => new Date().toISOString();
export const newId = () => crypto.randomBytes(8).toString('hex');

export class Store {
    constructor(dir) {
        this.dir = dir;
        this.filesDir = path.join(dir, 'files');
        this.dbPath = path.join(dir, 'db.json');
        fs.mkdirSync(this.filesDir, { recursive: true });
        this.db = this.#load();
        this.saveTimer = null;
    }

    #load() {
        let db = {};
        if (fs.existsSync(this.dbPath)) {
            db = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
        }
        db.version ??= 1;
        db.items ??= {};
        db.collections ??= {};
        db.fields ??= structuredClone(DEFAULT_FIELDS);
        db.settings ??= { title: '酒馆藏馆', skin: 'atelier', accent: '', passwordHash: '', secret: crypto.randomBytes(32).toString('hex') };
        db.settings.secret ||= crypto.randomBytes(32).toString('hex');
        db.settings.skin ||= 'atelier';
        if (db.settings.accent === '#c084fc') db.settings.accent = ''; // 旧版默认值 → 跟随风格
        this.#normalize(db);
        return db;
    }

    #normalize(db) {
        for (const c of Object.values(db.collections)) if (!/^[a-zA-Z]+$/.test(c.icon || '')) c.icon = 'folder';
        for (const it of Object.values(db.items)) {
            it.files ??= [];
            it.tags ??= [];
            it.collections ??= [];
            it.fields ??= {};
            it.meta ??= {};
            if (it.files.length && !it.files.some((f) => f.primary)) it.files[it.files.length - 1].primary = true;
        }
    }

    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), 300);
    }

    flush() {
        clearTimeout(this.saveTimer);
        const tmp = `${this.dbPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.db));
        fs.renameSync(tmp, this.dbPath);
    }

    // ---------- 文件 ----------
    blobPath(sha) {
        if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('invalid sha');
        return path.join(this.filesDir, sha.slice(0, 2), sha);
    }

    putBlob(buf) {
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        const p = this.blobPath(sha);
        if (!fs.existsSync(p)) {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, buf);
        }
        return sha;
    }

    hasBlob(sha) {
        try { return fs.existsSync(this.blobPath(sha)); } catch { return false; }
    }

    readBlob(sha) {
        return fs.readFileSync(this.blobPath(sha));
    }

    /** 删除不再被引用的文件 */
    gcBlobs() {
        const used = new Set();
        for (const it of Object.values(this.db.items)) {
            for (const f of it.files) used.add(f.sha);
            if (it.cover) used.add(it.cover);
        }
        let removed = 0;
        for (const sub of fs.readdirSync(this.filesDir)) {
            const d = path.join(this.filesDir, sub);
            if (!fs.statSync(d).isDirectory()) continue;
            for (const f of fs.readdirSync(d)) {
                if (!used.has(f)) { fs.unlinkSync(path.join(d, f)); removed++; }
            }
        }
        return removed;
    }

    findBySha(sha) {
        return Object.values(this.db.items).filter((it) => it.files.some((f) => f.sha === sha));
    }

    /** 内容指纹相同（字节可能不同）的条目 */
    findBySig(sig) {
        if (!sig) return [];
        return Object.values(this.db.items).filter((it) => it.files.some((f) => f.sig === sig));
    }

    /** 找到名字或指纹对应的合集，没有就新建 */
    ensureCollection(name) {
        const n = String(name || '').trim().slice(0, 60);
        if (!n) return null;
        const found = Object.values(this.db.collections).find((c) => c.name === n);
        if (found) return found;
        const c = { id: newId(), name: n, icon: 'folder', color: '', description: '', createdAt: now() };
        this.db.collections[c.id] = c;
        this.save();
        return c;
    }

    /**
     * 合并备份里的数据库
     * merge：本地没有的条目加入；两边都有时保留更新时间较新的那份，并补上对方独有的历史版本文件
     * replace：用备份替换条目、合集、字段（保留本机的密码和风格设置）
     */
    restoreDb(backup, mode = 'merge') {
        const stat = { added: 0, updated: 0, kept: 0, collections: 0 };
        const items = backup.items || {};
        if (mode === 'replace') {
            this.db.items = {};
            this.db.collections = {};
            if (Array.isArray(backup.fields) && backup.fields.length) this.db.fields = backup.fields;
        }
        for (const [id, c] of Object.entries(backup.collections || {})) {
            if (!this.db.collections[id]) { this.db.collections[id] = c; stat.collections++; }
        }
        for (const [id, it] of Object.entries(items)) {
            const cur = this.db.items[id];
            if (!cur) {
                this.db.items[id] = it;
                stat.added++;
                continue;
            }
            const newer = String(it.updatedAt || '') > String(cur.updatedAt || '') ? it : cur;
            const older = newer === it ? cur : it;
            const shas = new Set(newer.files.map((f) => f.sha));
            for (const f of older.files) if (!shas.has(f.sha)) newer.files.push({ ...f, primary: false });
            this.db.items[id] = newer;
            if (newer === it) stat.updated++; else stat.kept++;
        }
        if (mode === 'merge') {
            const have = new Set(this.db.fields.map((f) => f.id));
            for (const f of backup.fields || []) if (!have.has(f.id)) this.db.fields.push(f);
        }
        this.#normalize(this.db);
        this.flush();
        return stat;
    }

    // ---------- 条目 ----------
    createItem(data) {
        const id = newId();
        const item = {
            id,
            type: data.type || 'other',
            subtype: data.subtype || '',
            name: data.name || '未命名',
            description: data.description || '',
            tags: [...new Set((data.tags || []).map((t) => String(t).trim()).filter(Boolean))],
            collections: data.collections || [],
            favorite: false,
            rating: 0,
            source: data.source || '',
            author: data.author || '',
            version: data.version || '',
            notes: data.notes || '',
            fields: data.fields || {},
            files: data.files || [],
            cover: data.cover || null,
            meta: data.meta || {},
            searchText: data.searchText || '',
            origin: data.origin || '',
            createdAt: now(),
            updatedAt: now(),
            deletedAt: null,
        };
        this.db.items[id] = item;
        this.save();
        return item;
    }

    updateItem(id, patch) {
        const it = this.db.items[id];
        if (!it) return null;
        const allowed = ['type', 'subtype', 'name', 'description', 'tags', 'collections', 'favorite', 'rating', 'source', 'author', 'version', 'notes', 'fields', 'cover', 'meta', 'searchText', 'ai'];
        for (const k of allowed) {
            if (k in patch) it[k] = patch[k];
        }
        if (patch.tags) it.tags = [...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))];
        it.updatedAt = now();
        this.save();
        return it;
    }

    addFile(id, { sha, name, size, mime, label = '', primary = false, sig = '' }) {
        const it = this.db.items[id];
        if (!it) return null;
        const file = { id: newId(), sha, name, size, mime, label, primary: false, addedAt: now(), sig };
        if (primary || !it.files.length) {
            it.files.forEach((f) => { f.primary = false; });
            file.primary = true;
        }
        it.files.push(file);
        it.updatedAt = now();
        this.save();
        return file;
    }

    primaryFile(it) {
        return it.files.find((f) => f.primary) || it.files[0] || null;
    }

    stats() {
        const items = Object.values(this.db.items).filter((i) => !i.deletedAt);
        const byType = {};
        const tags = {};
        let bytes = 0;
        const shas = new Set();
        for (const it of items) {
            byType[it.type] = (byType[it.type] || 0) + 1;
            for (const t of it.tags) tags[t] = (tags[t] || 0) + 1;
            for (const f of it.files) if (!shas.has(f.sha)) { shas.add(f.sha); bytes += f.size || 0; }
        }
        return { total: items.length, trash: Object.keys(this.db.items).length - items.length, byType, tags, bytes, files: shas.size };
    }
}
