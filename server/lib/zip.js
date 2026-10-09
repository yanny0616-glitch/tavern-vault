// 极简 ZIP 读写：写入用 store 模式（不压缩），用于导出/备份；读取支持 store 与 deflate
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

/** entries: [{ name, data: Buffer }] → Buffer */
export function buildZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const { time, date } = dosTime(new Date());
    const used = new Set();
    for (const e of entries) {
        let name = e.name.replace(/\\/g, '/');
        if (used.has(name)) {
            const dot = name.lastIndexOf('.');
            let i = 2;
            while (used.has(`${dot > 0 ? name.slice(0, dot) : name} (${i})${dot > 0 ? name.slice(dot) : ''}`)) i++;
            name = `${dot > 0 ? name.slice(0, dot) : name} (${i})${dot > 0 ? name.slice(dot) : ''}`;
        }
        used.add(name);
        const nameBuf = Buffer.from(name, 'utf8');
        const data = e.data;
        const crc = crc32(data);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(0x0800, 6); // UTF-8 文件名
        lh.writeUInt16LE(0, 8);
        lh.writeUInt16LE(time, 10);
        lh.writeUInt16LE(date, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(data.length, 18);
        lh.writeUInt32LE(data.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        lh.writeUInt16LE(0, 28);
        locals.push(lh, nameBuf, data);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0x0800, 8);
        ch.writeUInt16LE(0, 10);
        ch.writeUInt16LE(time, 12);
        ch.writeUInt16LE(date, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(data.length, 20);
        ch.writeUInt32LE(data.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt32LE(offset, 42);
        centrals.push(ch, nameBuf);
        offset += 30 + nameBuf.length + data.length;
    }
    const cdSize = centrals.reduce((s, b) => s + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}

// ---------------- 读取 ----------------
const utf8 = new TextDecoder('utf-8', { fatal: true });
let gbk = null;
try { gbk = new TextDecoder('gbk'); } catch { /* 没有完整 ICU 时退回 latin1 */ }

function decodeName(bytes, utf8Flag) {
    if (utf8Flag) return Buffer.from(bytes).toString('utf8');
    try { return utf8.decode(bytes); } catch { /* Windows 压缩软件常用 GBK */ }
    return gbk ? gbk.decode(bytes) : Buffer.from(bytes).toString('latin1');
}

/** 文件名是否是压缩包里的垃圾文件（系统缓存、隐藏文件） */
export function isJunkPath(name) {
    const parts = name.split('/');
    const base = parts[parts.length - 1];
    return parts.some((p) => p === '__MACOSX' || (p.startsWith('.') && p !== '.' && p !== '..'))
        || /^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(base);
}

/**
 * 读取 ZIP 目录与内容
 * @param {Buffer} buf
 * @param {{maxEntries?: number, maxTotal?: number}} limits 防止压缩炸弹
 * @returns {{name: string, size: number, read: () => Buffer}[]} 只含文件，不含目录
 */
export function readZip(buf, { maxEntries = 10000, maxTotal = 4 * 1024 * 1024 * 1024 } = {}) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
    let count = buf.readUInt16LE(eocd + 10);
    let cdOffset = buf.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) {
        // ZIP64
        const loc = eocd - 20;
        if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('ZIP64 格式不完整');
        const z64 = Number(buf.readBigUInt64LE(loc + 8));
        count = Number(buf.readBigUInt64LE(z64 + 32));
        cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
    }
    if (count > maxEntries) throw new Error(`压缩包内文件过多（${count} 个，上限 ${maxEntries}）`);
    const out = [];
    let total = 0;
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 目录损坏');
        const flags = buf.readUInt16LE(p + 8);
        const method = buf.readUInt16LE(p + 10);
        let csize = buf.readUInt32LE(p + 20);
        let usize = buf.readUInt32LE(p + 24);
        const nlen = buf.readUInt16LE(p + 28);
        const xlen = buf.readUInt16LE(p + 30);
        const clen = buf.readUInt16LE(p + 32);
        let lho = buf.readUInt32LE(p + 42);
        const name = decodeName(buf.subarray(p + 46, p + 46 + nlen), flags & 0x800).replace(/\\/g, '/');
        // ZIP64 扩展字段
        let x = p + 46 + nlen;
        const xend = x + xlen;
        while (x + 4 <= xend) {
            const id = buf.readUInt16LE(x);
            const sz = buf.readUInt16LE(x + 2);
            if (id === 0x0001) {
                let q = x + 4;
                if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
                if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
                if (lho === 0xffffffff) { lho = Number(buf.readBigUInt64LE(q)); }
            }
            x += 4 + sz;
        }
        p = xend + clen;
        if (name.endsWith('/')) continue;
        if (flags & 0x1) throw new Error(`压缩包有密码，无法解压：${name}`);
        if (method !== 0 && method !== 8) throw new Error(`不支持的压缩方式（${method}）：${name}`);
        total += usize;
        if (total > maxTotal) throw new Error('压缩包解压后过大');
        const entry = { name, size: usize, method, csize, lho };
        entry.read = () => {
            if (buf.readUInt32LE(entry.lho) !== 0x04034b50) throw new Error(`ZIP 文件头损坏：${name}`);
            const start = entry.lho + 30 + buf.readUInt16LE(entry.lho + 26) + buf.readUInt16LE(entry.lho + 28);
            const raw = buf.subarray(start, start + entry.csize);
            if (entry.method === 0) return Buffer.from(raw);
            return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) + 1024 });
        };
        out.push(entry);
    }
    return out;
}
