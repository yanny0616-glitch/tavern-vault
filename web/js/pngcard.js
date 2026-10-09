// 把角色卡数据写进任意一张图片，生成酒馆能直接导入的 PNG
// 酒馆读取 PNG 里的 tEXt 块：ccv3（V3 卡）优先，其次 chara（V2）

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function b64utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

function textChunk(keyword, text) {
    const data = new TextEncoder().encode(`${keyword}\0${text}`);
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set([0x74, 0x45, 0x58, 0x74], 4); // tEXt
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

/** 在 PNG 里去掉已有的 chara / ccv3，再在 IEND 前写入新的 */
export function embedCard(png, card) {
    const u8 = new Uint8Array(png);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const parts = [u8.subarray(0, 8)];
    let iend = null;
    for (let p = 8; p + 12 <= u8.length;) {
        const len = dv.getUint32(p);
        const type = String.fromCharCode(...u8.subarray(p + 4, p + 8));
        const chunk = u8.subarray(p, p + 12 + len);
        p += 12 + len;
        if (type === 'IEND') { iend = chunk; break; }
        if (type === 'tEXt' || type === 'iTXt') {
            const kw = String.fromCharCode(...chunk.subarray(8, 8 + Math.min(len, 8))).split('\0')[0].toLowerCase();
            if (kw === 'chara' || kw === 'ccv3') continue;
        }
        parts.push(chunk);
    }
    if (!iend) throw new Error('图片不是有效的 PNG');
    const v3 = card?.spec === 'chara_card_v3';
    const v2 = v3 ? { ...card, spec: 'chara_card_v2', spec_version: '2.0' } : card;
    parts.push(textChunk('chara', b64utf8(JSON.stringify(v2))));
    if (v3) parts.push(textChunk('ccv3', b64utf8(JSON.stringify(card))));
    parts.push(iend);
    return new Blob(parts, { type: 'image/png' });
}

/** 任意格式的图片地址 → 带角色卡数据的 PNG */
export async function cardPng(imageUrl, card) {
    const blob = await (await fetch(imageUrl)).blob();
    let png;
    if (blob.type === 'image/png') {
        png = await blob.arrayBuffer();
    } else {
        // JPEG / WebP 等先在浏览器里转成 PNG
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        const out = await new Promise((r) => c.toBlob(r, 'image/png'));
        if (!out) throw new Error('图片转换失败');
        png = await out.arrayBuffer();
    }
    return embedCard(png, card);
}
