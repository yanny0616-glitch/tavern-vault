// AI 对话里的「修改块」：AI 在回复末尾用 ```tv-edit 给出结构化的修改，用户预览后一键存成新版本
import { normalizeCard } from './detect.js';

export const EDIT_FIELDS = {
    description: '描述',
    personality: '性格',
    scenario: '场景',
    first_mes: '开场白',
    mes_example: '对话示例',
    creator_notes: '作者注释',
    system_prompt: '系统提示词',
    post_history_instructions: '后置指令',
};
const MAX_VALUE = 60000;
const BLOCK = /```[ \t]*tv-edit[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/g;

/** 给 AI 的说明：什么时候、用什么格式给修改块 */
export const EDIT_GUIDE = [
    '用户明确要你直接修改某个条目时（例如“帮我把开场白改得更有悬念”“这条世界书写得更具体”“精简这段预设提示词”），先用一两句话说明改了什么，再在回复最后附上修改块，用户点一下就能存成新版本。只是讨论、提建议时不要给修改块。角色卡、世界书、预设可以这样改，其它类型不行。格式：',
    '```tv-edit',
    '{"item": 条目的 id 编号, "changes": [改动, …]}',
    '```',
    `角色卡的改动：{"field": "first_mes", "value": "改好后的完整内容"}，field 可以是 ${Object.entries(EDIT_FIELDS).map(([k, v]) => `${k}（${v}）`).join('、')}；改第 N 条备选开场白 {"field": "alternate_greetings", "index": N, "value": "…"}，新增一条 {"field": "alternate_greetings", "add": true, "value": "…"}；内嵌世界书第 N 条 {"field": "book", "index": N, …}，新增一条 {"field": "book", "add": true, …}。`,
    '世界书的改动：第 N 条 {"field": "entry", "index": N, …}，新增一条 {"field": "entry", "add": true, …}。',
    '世界书条目（包括角色卡的内嵌世界书）的 … 部分可以有："value": "条目的完整内容"、"keys": ["关键词", …]、"title": "条目标题"，只写要改的；新增时 value 和 keys 必须有。',
    '预设的改动：第 N 段提示词 {"field": "prompt", "index": N, "value": "改好后的完整内容"}。',
    'N 是资料里条目、提示词前面的编号。value 必须是这一项改好后的完整内容，不能只写改动的片段，也不能用“……”“（同上）”省略没改的部分。资料里被截断（标有“后略”）的内容不要整段改写。修改块必须是合法 JSON，换行写成 \\n。',
].join('\n');

/** 能一键修改的条目类型 */
export const EDIT_TYPES = { character: '角色卡', worldbook: '世界书', preset: '预设' };

/** 宽松解析：模型常在字符串里直接换行、或多写尾逗号 */
function looseJson(s) {
    try { return JSON.parse(s); } catch { /* 再试 */ }
    let out = '';
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; }
            if (c === '"') inStr = false;
            out += c === '\n' ? '\\n' : c === '\r' ? '' : c === '\t' ? '\\t' : c;
        } else {
            if (c === '"') inStr = true;
            out += c;
        }
    }
    return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'));
}

/** 从回复里找出修改块：[{ item, changes, error }] */
export function parseEdits(text) {
    const out = [];
    for (const m of String(text || '').matchAll(BLOCK)) {
        try {
            const o = looseJson(m[1].trim());
            const changes = Array.isArray(o?.changes) ? o.changes.filter((c) => c && typeof c === 'object') : [];
            out.push({ item: Number(o?.item) || 1, changes, error: changes.length ? '' : '修改块里没有改动' });
        } catch {
            out.push({ item: 0, changes: [], error: '修改块格式不对，没法读取。可以让 AI 重新给一次' });
        }
    }
    return out;
}

const bookEntries = (book) => (Array.isArray(book?.entries) ? book.entries : book?.entries && typeof book.entries === 'object' ? Object.values(book.entries) : []);
const keyList = (e) => (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : []);
const entryTitle = (e, i) => String(e.comment || e.name || keyList(e).slice(0, 3).join('、') || `第 ${i} 条`);

/** 一条改动的说明，用于列表（不需要条目内容） */
export function changeLabel(c) {
    if (c.field === 'alternate_greetings') return c.add ? '新增备选开场白' : `备选开场白 ${c.index}`;
    if (c.field === 'book') return c.add ? '新增世界书条目' : `世界书第 ${c.index} 条`;
    if (c.field === 'entry') return c.add ? '新增条目' : `条目 ${c.index}`;
    if (c.field === 'prompt') return `提示词第 ${c.index} 段`;
    return EDIT_FIELDS[c.field] || String(c.field || '?');
}

const cleanKeys = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 50).map((x) => x.slice(0, 200)) : null);

/**
 * 改世界书条目（独立世界书或角色卡内嵌的）：改内容、关键词、标题，或新增一条
 * book：{ entries: 数组或以 uid 为键的对象 }；style：'world'（独立世界书，key/uid）或 'card'（内嵌，keys/id）
 */
function editEntry(book, c, style, prefix, diffs, errors) {
    const entries = bookEntries(book);
    const value = typeof c.value === 'string' ? c.value.replace(/\r\n?/g, '\n') : null;
    const keys = 'keys' in c ? cleanKeys(c.keys) : undefined;
    const title = typeof c.title === 'string' ? c.title.trim().slice(0, 200) : undefined;
    if (value != null && value.length > MAX_VALUE) { errors.push(`「${changeLabel(c)}」内容太长`); return; }
    if (keys === null) { errors.push(`「${changeLabel(c)}」的关键词要写成数组`); return; }
    if (c.add) {
        if (value == null || !keys?.length) { errors.push(`新增${prefix}条目需要内容和关键词`); return; }
        // 照着已有的最后一条复制一份，保留各种开关的默认值
        const base = entries.length ? structuredClone(entries[entries.length - 1]) : {};
        const e = Object.assign(base, { content: value, comment: title || keys[0] });
        if (style === 'world') {
            const uid = entries.reduce((m, x) => Math.max(m, Number(x.uid) || 0), -1) + 1;
            Object.assign(e, { uid, key: keys, disable: false });
            if (!('keysecondary' in e)) e.keysecondary = [];
            if (!book.entries || typeof book.entries !== 'object') book.entries = {};
            if (Array.isArray(book.entries)) book.entries.push(e); else book.entries[String(uid)] = e;
        } else {
            const id = entries.reduce((m, x) => Math.max(m, Number(x.id) || 0), -1) + 1;
            Object.assign(e, { id, keys, enabled: true });
            e.extensions ||= {};
            if (!('insertion_order' in e)) e.insertion_order = 100;
            if (!Array.isArray(book.entries)) book.entries = [...bookEntries(book)];
            book.entries.push(e);
        }
        diffs.push({ label: `新增${prefix}条目「${e.comment}」（关键词：${keys.join('、')}）`, before: '', after: value });
        return;
    }
    const i = Number(c.index);
    if (!Number.isInteger(i) || i < 1 || i > entries.length) { errors.push(`${prefix || '世界书'}没有第 ${c.index} 条（一共 ${entries.length} 条）`); return; }
    const e = entries[i - 1];
    const name = `${prefix}「${entryTitle(e, i)}」`;
    if (value == null && keys === undefined && title === undefined) { errors.push(`「${changeLabel(c)}」没有给出要改的内容`); return; }
    if (title !== undefined) {
        const prop = 'comment' in e || !('name' in e) ? 'comment' : 'name';
        diffs.push({ label: `${name}的标题`, before: String(e[prop] ?? ''), after: title });
        e[prop] = title;
    }
    if (keys !== undefined) {
        const prop = Array.isArray(e.keys) ? 'keys' : Array.isArray(e.key) ? 'key' : style === 'world' ? 'key' : 'keys';
        diffs.push({ label: `${name}的关键词`, before: keyList(e).join('、'), after: keys.join('、') });
        e[prop] = keys;
    }
    if (value != null) {
        diffs.push({ label: name, before: String(e.content ?? ''), after: value });
        e.content = value;
    }
}

/**
 * 把改动用到条目内容上（不改原对象）
 * type：character | worldbook | preset；data：角色卡 / 世界书 / 预设的 JSON
 * @returns {{ data, diffs: [{ label, before, after, changed }], errors: string[] }}
 */
export function applyEdits(type, data, changes) {
    const diffs = [];
    const errors = [];
    let out;
    let d;
    if (type === 'character') {
        const n = normalizeCard(structuredClone(data));
        if (!n?.data) return { data: null, diffs, errors: ['不是有效的角色卡'] };
        out = n;
        d = n.data;
    } else if (type === 'worldbook' || type === 'preset') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return { data: null, diffs, errors: [`不是有效的${EDIT_TYPES[type]}`] };
        out = structuredClone(data);
        d = out;
    } else {
        return { data: null, diffs, errors: ['这类条目不能一键修改'] };
    }
    // 先改已有的，再新增：编号始终对应 AI 看到的原始顺序
    for (const c of [...changes.filter((x) => !x.add), ...changes.filter((x) => x.add)]) {
        const isEntry = (type === 'character' && c.field === 'book') || (type === 'worldbook' && c.field === 'entry');
        if (!isEntry && typeof c.value !== 'string') { errors.push(`「${changeLabel(c)}」没有给出新内容`); continue; }
        const value = typeof c.value === 'string' ? c.value.replace(/\r\n?/g, '\n') : '';
        if (value.length > MAX_VALUE) { errors.push(`「${changeLabel(c)}」内容太长`); continue; }
        if (type === 'character' && EDIT_FIELDS[c.field]) {
            diffs.push({ label: EDIT_FIELDS[c.field], before: String(d[c.field] ?? ''), after: value });
            d[c.field] = value;
        } else if (type === 'character' && c.field === 'alternate_greetings') {
            const list = Array.isArray(d.alternate_greetings) ? d.alternate_greetings : (d.alternate_greetings = []);
            if (c.add) { diffs.push({ label: `新增备选开场白（第 ${list.length + 1} 条）`, before: '', after: value }); list.push(value); continue; }
            const i = Number(c.index);
            if (!Number.isInteger(i) || i < 1 || i > list.length) { errors.push(`没有第 ${c.index} 条备选开场白（一共 ${list.length} 条）`); continue; }
            diffs.push({ label: `备选开场白 ${i}`, before: String(list[i - 1] ?? ''), after: value });
            list[i - 1] = value;
        } else if (type === 'character' && c.field === 'book') {
            if (c.add && !d.character_book) d.character_book = { entries: [], extensions: {} };
            editEntry(d.character_book || {}, c, 'card', '内嵌世界书', diffs, errors);
        } else if (type === 'worldbook' && c.field === 'entry') {
            editEntry(d, c, 'world', '', diffs, errors);
        } else if (type === 'preset' && c.field === 'prompt') {
            const list = Array.isArray(d.prompts) ? d.prompts : [];
            const i = Number(c.index);
            if (!Number.isInteger(i) || i < 1 || i > list.length || !list[i - 1] || typeof list[i - 1] !== 'object') { errors.push(`预设没有第 ${c.index} 段提示词（一共 ${list.length} 段）`); continue; }
            const p = list[i - 1];
            diffs.push({ label: `提示词「${String(p.name || p.identifier || i)}」`, before: String(p.content ?? ''), after: value });
            p.content = value;
        } else {
            errors.push(`${EDIT_TYPES[type]}不能改「${c.field}」`);
        }
    }
    for (const x of diffs) x.changed = x.before !== x.after;
    if (diffs.length && !diffs.some((x) => x.changed)) errors.push('改动后的内容和现在完全一样');
    return { data: out, diffs, errors };
}
