// 文件内容解析：给指纹计算和版本对比用
import path from 'node:path';
import { isPng, extractCardFromPng, readPngInfo, pngImageHash } from './png.js';
import { readZip } from './zip.js';
import { detectFile } from './detect.js';
import { sigOf, syncParts } from '../../web/js/sig.js';

/** 把文件解析成对象：PNG 角色卡、JSON、CHARX；文本返回 text；其它返回 null */
export function parseFile(buf, filename = '') {
    const ext = path.extname(filename).toLowerCase();
    if (isPng(buf)) return { obj: extractCardFromPng(buf), image: true };
    if (ext === '.charx') {
        try {
            const card = readZip(buf).find((e) => e.name.toLowerCase() === 'card.json');
            if (card) return { obj: JSON.parse(card.read().toString('utf8')) };
        } catch { /* ignore */ }
        return { obj: null };
    }
    if (ext === '.json' || buf[0] === 0x7b || buf[0] === 0x5b) {
        try { return { obj: JSON.parse(buf.toString('utf8').replace(/^﻿/, '')) }; } catch { /* 当作文本 */ }
    }
    if (/^\.(txt|md|js|mjs|ts|css|jsonl|yaml|yml|html)$/.test(ext) || ext === '.json') return { obj: null, text: buf.toString('utf8') };
    return { obj: null };
}

/** 内容指纹（见 web/js/sig.js）；不支持的类型返回空串 */
export function fileSig(buf, filename, det = null) {
    try {
        const { obj } = parseFile(buf, filename);
        if (!obj) return '';
        return sigOf((det || detectFile(buf, filename)).type, obj);
    } catch {
        return '';
    }
}

/** 角色卡、世界书的分段指纹（见 web/js/sig.js syncParts）；其它类型返回 null */
export function fileParts(buf, filename, det = null) {
    try {
        const { obj } = parseFile(buf, filename);
        if (!obj) return null;
        return syncParts((det || detectFile(buf, filename)).type, obj);
    } catch {
        return null;
    }
}

export { readPngInfo, pngImageHash };
