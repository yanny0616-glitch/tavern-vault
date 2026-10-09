// 读取 PNG 中的文本块（tEXt / zTXt / iTXt），用于解析角色卡 chara / ccv3
import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buf) {
    return buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG);
}

export function readPngInfo(buf) {
    const texts = {};
    let width = 0;
    let height = 0;
    if (!isPng(buf)) return { texts, width, height };
    let pos = 8;
    while (pos + 8 <= buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        const start = pos + 8;
        const end = start + len;
        if (end > buf.length) break;
        const data = buf.subarray(start, end);
        try {
            if (type === 'IHDR') {
                width = data.readUInt32BE(0);
                height = data.readUInt32BE(4);
            } else if (type === 'tEXt') {
                const nul = data.indexOf(0);
                if (nul > 0) texts[data.toString('latin1', 0, nul)] = data.toString('latin1', nul + 1);
            } else if (type === 'zTXt') {
                const nul = data.indexOf(0);
                if (nul > 0) texts[data.toString('latin1', 0, nul)] = zlib.inflateSync(data.subarray(nul + 2)).toString('latin1');
            } else if (type === 'iTXt') {
                const nul = data.indexOf(0);
                if (nul > 0) {
                    const key = data.toString('latin1', 0, nul);
                    const compressed = data[nul + 1] === 1;
                    let p = nul + 3;
                    const langEnd = data.indexOf(0, p);
                    p = langEnd + 1;
                    const transEnd = data.indexOf(0, p);
                    p = transEnd + 1;
                    const raw = data.subarray(p);
                    texts[key] = (compressed ? zlib.inflateSync(raw) : raw).toString('utf8');
                }
            } else if (type === 'IEND') {
                break;
            }
        } catch {
            // 忽略损坏的块
        }
        pos = end + 4; // 跳过 CRC
    }
    return { texts, width, height };
}

/** 从 PNG 中提取角色卡 JSON（优先 ccv3） */
export function extractCardFromPng(buf) {
    const { texts } = readPngInfo(buf);
    for (const key of ['ccv3', 'chara']) {
        const v = texts[key];
        if (!v) continue;
        try {
            return JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
        } catch {
            try { return JSON.parse(v); } catch { /* next */ }
        }
    }
    return null;
}

/** 将角色卡写入 PNG（替换已有的 chara / ccv3 文本块） */
export async function writeCardToPng(buf, card) {
    const { crc32 } = await import('./zip.js');
    if (!isPng(buf)) throw new Error('not a png');
    const chunks = [];
    let pos = 8;
    while (pos + 8 <= buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        const end = pos + 12 + len;
        const raw = buf.subarray(pos, end);
        let skip = false;
        if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
            const data = buf.subarray(pos + 8, pos + 8 + len);
            const key = data.toString('latin1', 0, Math.max(0, data.indexOf(0)));
            if (key === 'chara' || key === 'ccv3') skip = true;
        }
        if (type === 'IEND') break;
        if (!skip) chunks.push(raw);
        pos = end;
    }
    const makeText = (key, text) => {
        const data = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write('tEXt', 4, 'latin1');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
        return Buffer.concat([head, data, crc]);
    };
    const v2 = structuredClone(card);
    v2.spec = 'chara_card_v2';
    v2.spec_version = '2.0';
    const v3 = structuredClone(card);
    v3.spec = 'chara_card_v3';
    v3.spec_version = '3.0';
    const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
    const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    return Buffer.concat([buf.subarray(0, 8), ...chunks, makeText('chara', b64(v2)), makeText('ccv3', b64(v3)), iend]);
}
