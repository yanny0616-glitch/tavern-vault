// 读取用户选择 / 拖入的文件，支持文件夹（递归），并过滤系统垃圾文件

export function isJunkPath(p) {
    const parts = String(p).split('/');
    const base = parts[parts.length - 1];
    return parts.some((x) => x === '__MACOSX' || (x.startsWith('.') && x.length > 1)) || /^(thumbs\.db|desktop\.ini)$/i.test(base);
}

/** iOS 上的网页不支持选择文件夹 */
export const canPickFolder = (() => {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return !ios && 'webkitdirectory' in document.createElement('input');
})();

const entryFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
function readAll(reader) {
    return new Promise((resolve, reject) => {
        const out = [];
        const next = () => reader.readEntries((batch) => {
            if (!batch.length) resolve(out);
            else { out.push(...batch); next(); }
        }, reject);
        next();
    });
}
async function walk(entry, prefix, out) {
    const p = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
        if (!isJunkPath(p)) out.push({ file: await entryFile(entry), path: p });
    } else if (entry.isDirectory) {
        for (const child of await readAll(entry.createReader())) await walk(child, p, out);
    }
}

/** @returns {Promise<{file: File, path: string}[]>} */
export async function filesFromDrop(dt) {
    const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length && entries.some((e) => e.isDirectory)) {
        const out = [];
        for (const e of entries) await walk(e, '', out);
        return out;
    }
    return [...(dt.files || [])].filter((f) => !isJunkPath(f.name)).map((file) => ({ file, path: file.name }));
}

export function filesFromInput(input) {
    return [...input.files].map((file) => ({ file, path: file.webkitRelativePath || file.name })).filter((x) => !isJunkPath(x.path));
}

/** 「卡包/子目录/卡.png」→「卡包」；没有目录返回空串 */
export const topFolder = (p) => (String(p).includes('/') ? String(p).split('/')[0] : '');
