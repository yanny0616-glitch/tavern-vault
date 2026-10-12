// 服务器上的备份：每份是一个文件夹（db.json + files/），文件用硬链接指向同一份数据，
// 没变过的文件不管存了多少份备份都只占一份空间。下载时再打包成和以前一样的 ZIP。
// 以前的备份是 ZIP 文件，启动后会逐个转换成文件夹，转换并核对无误后才删掉 ZIP。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildZip, readZip } from './zip.js';

const NAME = /^TavernVault-(auto|manual)-\d{8}-\d{6}\.zip$/;
const BLOB = /^files\/([a-f0-9]{2})\/([a-f0-9]{64})$/;
const META = 'backup.json';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** 把 src 链接到 dest；不能链接（跨磁盘、链接数满）时复制 */
function linkOrCopy(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.linkSync(src, dest); } catch { fs.copyFileSync(src, dest); }
}

function walk(dir, base = dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, base, out);
        else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
    }
    return out;
}

/** db.json 损坏或丢失时用：从最近一份能读的备份里取出数据库（两种格式都认，不需要 store） */
export function recoverDb(dir) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => NAME.test(f.endsWith('.zip') ? f : `${f}.zip`)); } catch { return null; }
    names.sort((a, b) => b.replace(/\.zip$/, '').slice(-15).localeCompare(a.replace(/\.zip$/, '').slice(-15)));
    for (const name of names) {
        try {
            const p = path.join(dir, name);
            const buf = fs.statSync(p).isDirectory() ? fs.readFileSync(path.join(p, 'db.json'))
                : readZip(fs.readFileSync(p), { maxTotal: 4 * 1024 ** 3, maxEntries: 500000 }).find((x) => x.name === 'db.json')?.read();
            const db = buf && JSON.parse(buf.toString('utf8'));
            if (db?.items && typeof db.items === 'object') return { db, from: `备份 ${name.replace(/\.zip$/, '')}` };
        } catch { /* 这份也坏了，试下一份 */ }
    }
    return null;
}

export function createBackups({ dir, store, log = () => {} }) {
    const folder = (name) => path.join(dir, name.replace(/\.zip$/, ''));
    const zipFile = (name) => path.join(dir, name);

    /** name 对应的备份在哪：{ kind: 'dir' | 'zip', path }，不存在时返回 null */
    function locate(name) {
        if (!NAME.test(name || '')) return null;
        if (fs.existsSync(path.join(folder(name), 'db.json'))) return { kind: 'dir', path: folder(name) };
        if (fs.existsSync(zipFile(name))) return { kind: 'zip', path: zipFile(name) };
        return null;
    }

    function readMeta(p) {
        try { return JSON.parse(fs.readFileSync(path.join(p, META), 'utf8')); } catch { return null; }
    }

    function list() {
        let names = [];
        try { names = fs.readdirSync(dir); } catch { return []; }
        const out = new Map();
        for (const f of names) {
            const name = f.endsWith('.zip') ? f : `${f}.zip`;
            if (!NAME.test(name) || out.has(name)) continue;
            const loc = locate(name);
            if (!loc) continue;
            let size;
            let at;
            if (loc.kind === 'dir') {
                const m = readMeta(loc.path);
                size = m?.size ?? 0;
                at = m?.at || fs.statSync(path.join(loc.path, 'db.json')).mtime.toISOString();
            } else {
                const st = fs.statSync(loc.path);
                size = st.size;
                at = st.mtime.toISOString();
            }
            out.set(name, { name, size, at, auto: name.includes('-auto-') });
        }
        return [...out.values()].sort((a, b) => b.name.slice(-19).localeCompare(a.name.slice(-19)));
    }

    /** 备份里的全部内容：[{ name, size, read() }]，供下载和还原 */
    function entries(name) {
        const loc = locate(name);
        if (!loc) return null;
        if (loc.kind === 'zip') return readZip(fs.readFileSync(loc.path), { maxTotal: 4 * 1024 ** 3, maxEntries: 500000 });
        return walk(loc.path).filter((r) => r !== META).sort((a, b) => (a === 'db.json' ? -1 : b === 'db.json' ? 1 : 0))
            .map((r) => ({ name: r, read: () => fs.readFileSync(path.join(loc.path, r)) }));
    }

    function readDb(name) {
        const loc = locate(name);
        if (!loc) return null;
        if (loc.kind === 'dir') return JSON.parse(fs.readFileSync(path.join(loc.path, 'db.json'), 'utf8'));
        return JSON.parse(entries(name).find((e) => e.name === 'db.json').read().toString('utf8'));
    }

    /** 打包成 ZIP（下载用） */
    function zip(name) {
        const loc = locate(name);
        if (!loc) return null;
        if (loc.kind === 'zip') return fs.readFileSync(loc.path);
        return buildZip(entries(name).map((e) => ({ name: e.name, data: e.read() })));
    }

    /** 按现在的数据存一份 */
    function make(kind) {
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
        const name = `TavernVault-${kind}-${stamp.slice(0, 8)}-${stamp.slice(8)}.zip`;
        const final = folder(name);
        const tmp = path.join(dir, `.${path.basename(final)}.tmp`);
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        store.flush();
        fs.copyFileSync(store.dbPath, path.join(tmp, 'db.json'));
        let size = fs.statSync(path.join(tmp, 'db.json')).size;
        const seen = new Set();
        for (const it of Object.values(store.db.items)) {
            for (const sha of [...it.files.map((f) => f.sha), it.cover].filter(Boolean)) {
                if (seen.has(sha) || !store.hasBlob(sha)) continue;
                seen.add(sha);
                const src = store.blobPath(sha);
                linkOrCopy(src, path.join(tmp, 'files', sha.slice(0, 2), sha));
                size += fs.statSync(src).size;
            }
        }
        fs.writeFileSync(path.join(tmp, META), JSON.stringify({ at: new Date().toISOString(), size, files: seen.size }));
        fs.renameSync(tmp, final);
        return name;
    }

    function remove(name) {
        const loc = locate(name);
        if (!loc) return false;
        if (loc.kind === 'dir') fs.rmSync(loc.path, { recursive: true, force: true });
        else fs.unlinkSync(loc.path);
        return true;
    }

    /** 全部备份实际占的空间：同一个文件只算一次；和仓库共用的文件另外统计 */
    function disk() {
        const live = new Set();
        try { for (const r of walk(store.filesDir)) { const st = fs.statSync(path.join(store.filesDir, r)); live.add(`${st.dev}:${st.ino}`); } } catch { /* ignore */ }
        const seen = new Set();
        let total = 0;
        let shared = 0;
        for (const b of list()) {
            const loc = locate(b.name);
            const files = loc.kind === 'zip' ? [loc.path] : walk(loc.path).map((r) => path.join(loc.path, r));
            for (const f of files) {
                const st = fs.statSync(f);
                const key = `${st.dev}:${st.ino}`;
                if (seen.has(key)) continue;
                seen.add(key);
                total += st.size;
                if (live.has(key)) shared += st.size;
            }
        }
        return { total, extra: total - shared };
    }

    /**
     * 把以前的 ZIP 备份转换成文件夹。逐个文件核对内容，全部对上才删掉 ZIP；出任何问题都保留 ZIP。
     * 文件优先链接到仓库里或其它备份里的同一份。
     */
    function migrate() {
        let names = [];
        try { names = fs.readdirSync(dir).filter((f) => NAME.test(f) && fs.statSync(zipFile(f)).isFile()); } catch { return 0; }
        let done = 0;
        for (const name of names) {
            if (fs.existsSync(folder(name))) continue;
            const tmp = path.join(dir, `.${path.basename(folder(name))}.tmp`);
            try {
                const st = fs.statSync(zipFile(name));
                const others = fs.readdirSync(dir).filter((d) => !d.startsWith('.') && !d.endsWith('.zip')).map((d) => path.join(dir, d));
                const list = readZip(fs.readFileSync(zipFile(name)), { maxTotal: 4 * 1024 ** 3, maxEntries: 500000 });
                if (!list.some((e) => e.name === 'db.json')) throw new Error('缺少 db.json');
                fs.rmSync(tmp, { recursive: true, force: true });
                fs.mkdirSync(tmp, { recursive: true });
                let size = 0;
                let files = 0;
                for (const e of list) {
                    const rel = e.name.replace(/\\/g, '/');
                    if (!rel || rel === META || rel.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error(`无法处理的文件名：${e.name}`);
                    const dest = path.join(tmp, rel);
                    const m = rel.match(BLOB);
                    let placed = false;
                    if (m && m[2].startsWith(m[1])) {
                        const candidates = [store.hasBlob(m[2]) ? store.blobPath(m[2]) : '', ...others.map((d) => path.join(d, rel))];
                        const src = candidates.find((c) => c && fs.existsSync(c) && sha256(fs.readFileSync(c)) === m[2]);
                        if (src) { linkOrCopy(src, dest); placed = true; }
                    }
                    const data = placed ? null : e.read();
                    if (!placed) {
                        if (m && sha256(data) !== m[2]) throw new Error(`${rel} 内容和文件名对不上`);
                        fs.mkdirSync(path.dirname(dest), { recursive: true });
                        fs.writeFileSync(dest, data);
                    }
                    size += fs.statSync(dest).size;
                    if (m) files++;
                }
                // 核对：数量一致，db.json 一字不差
                if (walk(tmp).length !== list.length) throw new Error('转换后的文件数量不对');
                if (!fs.readFileSync(path.join(tmp, 'db.json')).equals(list.find((e) => e.name === 'db.json').read())) throw new Error('db.json 不一致');
                fs.writeFileSync(path.join(tmp, META), JSON.stringify({ at: st.mtime.toISOString(), size, files, from: 'zip' }));
                fs.renameSync(tmp, folder(name));
                fs.unlinkSync(zipFile(name));
                done++;
                log(`  [备份] ${name} 已转换为文件夹格式`);
            } catch (err) {
                fs.rmSync(tmp, { recursive: true, force: true });
                log(`  [备份] ${name} 转换失败，保留原 ZIP：${err.message}`);
            }
        }
        return done;
    }

    return { NAME, list, locate, entries, readDb, zip, make, remove, disk, migrate };
}
