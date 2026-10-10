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
    '用户明确要你直接修改某张角色卡时（例如“帮我把开场白改得更有悬念”“描述精简到 300 字”），先用一两句话说明改了什么，再在回复最后附上修改块，用户点一下就能存成新版本。只是讨论、提建议时不要给修改块。只有 type 为角色卡的条目能这样改。格式：',
    '```tv-edit',
    '{"item": 条目的 id 编号, "changes": [{"field": "first_mes", "value": "改好后的完整内容"}]}',
    '```',
    `field 可以是：${Object.entries(EDIT_FIELDS).map(([k, v]) => `${k}（${v}）`).join('、')}。`,
    '改第 N 条备选开场白：{"field": "alternate_greetings", "index": N, "value": "…"}；新增一条备选开场白：{"field": "alternate_greetings", "add": true, "value": "…"}；改内嵌世界书第 N 条的内容：{"field": "book", "index": N, "value": "…"}（N 是资料里条目前的编号）。',
    'value 必须是这一项改好后的完整内容，不能只写改动的片段，也不能用“……”“（同上）”省略没改的部分。资料里被截断（标有“后略”）的内容不要整段改写。修改块必须是合法 JSON，换行写成 \\n。',
].join('\n');

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
const entryTitle = (e, i) => String(e.comment || e.name || (Array.isArray(e.keys ?? e.key) ? (e.keys ?? e.key).slice(0, 3).join('、') : '') || `第 ${i} 条`);

/** 一条改动的说明，用于列表（不需要卡片内容） */
export function changeLabel(c) {
    if (c.field === 'alternate_greetings') return c.add ? '新增备选开场白' : `备选开场白 ${c.index}`;
    if (c.field === 'book') return `世界书第 ${c.index} 条`;
    return EDIT_FIELDS[c.field] || String(c.field || '?');
}

/**
 * 把改动用到角色卡上（不改原对象）
 * @returns {{ card, diffs: [{ label, before, after, changed }], errors: string[] }}
 */
export function applyEdits(card, changes) {
    const n = normalizeCard(structuredClone(card));
    if (!n?.data) return { card: null, diffs: [], errors: ['不是有效的角色卡'] };
    const d = n.data;
    const diffs = [];
    const errors = [];
    for (const c of changes) {
        if (typeof c.value !== 'string') { errors.push(`「${changeLabel(c)}」没有给出新内容`); continue; }
        const value = c.value.replace(/\r\n?/g, '\n');
        if (value.length > MAX_VALUE) { errors.push(`「${changeLabel(c)}」内容太长`); continue; }
        if (EDIT_FIELDS[c.field]) {
            diffs.push({ label: EDIT_FIELDS[c.field], before: String(d[c.field] ?? ''), after: value });
            d[c.field] = value;
        } else if (c.field === 'alternate_greetings') {
            const list = Array.isArray(d.alternate_greetings) ? d.alternate_greetings : (d.alternate_greetings = []);
            if (c.add) { diffs.push({ label: `新增备选开场白（第 ${list.length + 1} 条）`, before: '', after: value }); list.push(value); continue; }
            const i = Number(c.index);
            if (!Number.isInteger(i) || i < 1 || i > list.length) { errors.push(`没有第 ${c.index} 条备选开场白（一共 ${list.length} 条）`); continue; }
            diffs.push({ label: `备选开场白 ${i}`, before: String(list[i - 1] ?? ''), after: value });
            list[i - 1] = value;
        } else if (c.field === 'book') {
            const entries = bookEntries(d.character_book);
            const i = Number(c.index);
            if (!Number.isInteger(i) || i < 1 || i > entries.length) { errors.push(`内嵌世界书没有第 ${c.index} 条（一共 ${entries.length} 条）`); continue; }
            const e = entries[i - 1];
            diffs.push({ label: `世界书「${entryTitle(e, i)}」`, before: String(e.content ?? ''), after: value });
            e.content = value;
        } else {
            errors.push(`不支持修改「${c.field}」`);
        }
    }
    for (const x of diffs) x.changed = x.before !== x.after;
    if (diffs.length && !diffs.some((x) => x.changed)) errors.push('改动后的内容和现在完全一样');
    return { card: { ...n, data: d }, diffs, errors };
}
