// 内容指纹：只看「内容」不看文件字节。
// 同一张卡被酒馆重新导出成 PNG 后字节会变，但指纹不变；正文改了一个字，指纹就会变。
// 服务端（server/lib）和网页端（酒馆比对）共用这一份代码，保证两边算出来一致。

export const SIG_VERSION = 1;

/** cyrb53：小而快的 53 位字符串哈希，浏览器和 Node 结果一致 */
export function hash53(s) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const text = (v) => (v == null ? '' : String(v)).replace(/\r\n?/g, '\n').trim();
const list = (v) => (Array.isArray(v) ? v : []);
const keys = (v) => list(Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(text).filter(Boolean).sort();

/** 键排序后的 JSON，避免字段顺序不同导致指纹不同 */
function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    return JSON.stringify(v ?? null);
}
const omit = (obj, ...ks) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !ks.includes(k)));

function bookEntries(book) {
    if (!book || typeof book !== 'object') return [];
    const entries = Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {});
    return entries.map((e) => [
        keys(e.key ?? e.keys).join('|'),
        keys(e.keysecondary ?? e.secondary_keys).join('|'),
        text(e.content),
        text(e.comment ?? e.name),
        e.constant ? 1 : 0,
        e.disable || e.enabled === false ? 1 : 0,
    ].join('\u0001')).sort();
}

const CARD_TEXT = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes', 'creator', 'character_version'];

/** 各类型参与指纹的内容；返回 null 表示该类型不做内容比对 */
export function sigSource(type, obj) {
    if (!obj || typeof obj !== 'object') return null;
    switch (type) {
        case 'character': {
            const d = obj.data && typeof obj.data === 'object' ? obj.data : obj;
            const pick = (k) => text(d[k] ?? obj[k] ?? (k === 'creator_notes' ? obj.creatorcomment : ''));
            return [
                ...CARD_TEXT.map(pick),
                list(d.alternate_greetings).map(text).join('\u0002'),
                keys(d.tags ?? obj.tags).join('|'),
                text(d.extensions?.depth_prompt?.prompt),
                bookEntries(d.character_book).join('\u0002'),
            ].join('\u0003');
        }
        case 'worldbook':
            return bookEntries(obj).join('\u0002');
        case 'regex': {
            const one = (r) => [text(r.scriptName), text(r.findRegex), text(r.replaceString), stable(list(r.trimStrings)), stable(list(r.placement)), r.markdownOnly ? 1 : 0, r.promptOnly ? 1 : 0, r.minDepth ?? '', r.maxDepth ?? ''].join('\u0001');
            return Array.isArray(obj) ? obj.map(one).join('\u0002') : one(obj);
        }
        case 'quickreply':
            return list(obj.qrList).map((q) => `${text(q.label)}\u0001${text(q.message)}`).join('\u0002');
        case 'preset':
        case 'theme':
            return stable(omit(obj, 'name'));
        default:
            return null;
    }
}

/**
 * 从酒馆同步时排除的世界书条目。
 * 酒馆保存角色卡时会把主绑定世界书整本写进卡里，总结类脚本（如「数据库」）写进这本世界书的条目也会跟着进来；
 * 条目标题（备注）包含任一规则文字的，同步和比对时都去掉。
 */
export const DEFAULT_SYNC_EXCLUDE = ['TavernDB-ACU'];

export function stripSyncEntries(type, obj, rules) {
    const rs = (rules || []).map((r) => String(r).trim()).filter(Boolean);
    if (!rs.length || !obj || typeof obj !== 'object') return { obj, removed: 0 };
    const hit = (e) => { const t = String(e?.comment ?? e?.name ?? ''); return rs.some((r) => t.includes(r)); };
    let removed = 0;
    const strip = (book) => {
        if (!book || typeof book !== 'object' || !book.entries) return book;
        if (Array.isArray(book.entries)) {
            const keep = book.entries.filter((e) => !hit(e));
            removed += book.entries.length - keep.length;
            return { ...book, entries: keep };
        }
        const keep = Object.fromEntries(Object.entries(book.entries).filter(([, e]) => !hit(e)));
        removed += Object.keys(book.entries).length - Object.keys(keep).length;
        return { ...book, entries: keep };
    };
    let out = obj;
    if (type === 'character') {
        if (obj.data?.character_book) out = { ...obj, data: { ...obj.data, character_book: strip(obj.data.character_book) } };
        else if (obj.character_book) out = { ...obj, character_book: strip(obj.character_book) };
    } else if (type === 'worldbook') out = strip(obj);
    return { obj: removed ? out : obj, removed };
}

/** 返回 "类型:哈希"，不支持的类型返回空串 */
export function sigOf(type, obj) {
    const src = sigSource(type, obj);
    return src == null ? '' : `${type}:${hash53(src)}`;
}
