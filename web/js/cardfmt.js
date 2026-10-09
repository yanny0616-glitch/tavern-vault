// 各种来源的卡片 / 预设写法不统一，这里集中处理，服务端和网页共用

const arr = (v) => (Array.isArray(v) ? v : []);

/** 世界书条目：entries 可能是数组，也可能是 { "0": {...}, "1": {...} } 这样的对象 */
export function entriesOf(book) {
    if (!book || typeof book !== 'object') return [];
    const e = book.entries;
    if (Array.isArray(e)) return e.filter((x) => x && typeof x === 'object');
    if (e && typeof e === 'object') return Object.values(e).filter((x) => x && typeof x === 'object');
    return [];
}

/** 关键词：数组，或写成一个用中英文逗号分隔的字符串 */
export function splitKeys(v) {
    const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    return list.flatMap((k) => String(k ?? '').split(/[,，]/)).map((k) => k.trim()).filter(Boolean);
}
export const entryKeys = (e) => splitKeys(e?.key ?? e?.keys);
export const entryKeys2 = (e) => splitKeys(e?.keysecondary ?? e?.secondary_keys);

/**
 * 预设里提示词真正的启用状态和顺序在 prompt_order 里（酒馆默认用 character_id 100001 那组），
 * prompts[].enabled 往往不准。返回 [{ p, enabled, used }]，按生效顺序；没放进顺序里的排在后面，used=false
 */
export function promptOrderOf(preset) {
    const groups = arr(preset?.prompt_order).filter((g) => g && Array.isArray(g.order));
    return (groups.find((g) => Number(g.character_id) === 100001) || groups.find((g) => g.order.length) || null)?.order || null;
}
export function effectivePrompts(preset) {
    const prompts = arr(preset?.prompts).filter((p) => p && typeof p === 'object');
    const order = promptOrderOf(preset);
    if (!order) return prompts.map((p) => ({ p, enabled: p.enabled !== false, used: true }));
    const byId = new Map(prompts.map((p) => [p.identifier, p]));
    const seen = new Set();
    const out = [];
    for (const o of order) {
        const p = byId.get(o?.identifier);
        if (!p || seen.has(o.identifier)) continue;
        seen.add(o.identifier);
        out.push({ p, enabled: o.enabled !== false, used: true });
    }
    for (const p of prompts) if (!seen.has(p.identifier)) out.push({ p, enabled: false, used: false });
    return out;
}

/** 预设里附带的正则（新版酒馆导出预设时会带上） */
export const presetRegex = (preset) => arr(preset?.extensions?.regex_scripts).filter((r) => r && typeof r === 'object');

/**
 * 估算 token：中日韩文字每字约 0.7，其它字符（英文、数字、标点、空格）每个约 0.3。
 * 不同模型的分词不一样，只用来大致比较卡的体量。
 */
export function estTokens(text) {
    const s = String(text ?? '');
    if (!s) return 0;
    const cjk = (s.match(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g) || []).length;
    return Math.ceil(cjk * 0.7 + (s.length - cjk) * 0.3);
}

const entryOff = (e) => Boolean(e?.disable) || e?.enabled === false;

/**
 * 角色卡的 token 分项：
 * perm 常驻（描述、性格、场景、对话示例、系统提示词、后置指令、深度提示词）
 * first 主开场白，greet 全部开场白合计
 * bookConst 世界书常驻（蓝灯）条目，bookTrig 关键词触发（绿灯）条目，禁用的条目不算
 * total = 常驻 + 全部开场白 + 启用的世界书条目
 */
export function cardTokens(d) {
    if (!d || typeof d !== 'object') return null;
    const t = (v) => estTokens(String(v ?? '').trim());
    const perm = ['description', 'personality', 'scenario', 'mes_example', 'system_prompt', 'post_history_instructions'].reduce((s, k) => s + t(d[k]), 0)
        + t(d.extensions?.depth_prompt?.prompt);
    const first = t(d.first_mes);
    const greet = first + arr(d.alternate_greetings).reduce((s, g) => s + t(g), 0);
    let bookConst = 0;
    let bookTrig = 0;
    for (const e of entriesOf(d.character_book)) {
        if (entryOff(e)) continue;
        if (e.constant) bookConst += t(e.content); else bookTrig += t(e.content);
    }
    return { total: perm + greet + bookConst + bookTrig, perm, first, greet, bookConst, bookTrig };
}
