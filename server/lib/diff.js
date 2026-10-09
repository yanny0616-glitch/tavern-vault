// 两个文件版本的差异：数值/字段对比、长文本、条目增删改
import { parseFile, fileSig, readPngInfo, pngImageHash } from './content.js';
import { detectFile, summarizeCard, normalizeCard } from './detect.js';

const MAX_TEXT = 60000;
const str = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2)).replace(/\r\n?/g, '\n');
const arr = (v) => (Array.isArray(v) ? v : []);
const clip = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n…（已截断）` : s);

function fact(label, a, b) {
    const fa = a == null || a === '' ? '—' : String(a);
    const fb = b == null || b === '' ? '—' : String(b);
    return { label, a: fa, b: fb, changed: fa !== fb };
}

function textField(key, label, a, b) {
    const sa = str(a).trim();
    const sb = str(b).trim();
    return { key, label, a: clip(sa), b: clip(sb), changed: sa !== sb, aLen: sa.length, bLen: sb.length };
}

/** 按标题对齐两组条目，得出新增/删除/修改 */
function listDiff(label, aItems, bItems) {
    const index = (items) => {
        const m = new Map();
        for (const it of items) {
            let k = it.title || '(未命名)';
            let i = 2;
            while (m.has(k)) k = `${it.title || '(未命名)'} #${i++}`;
            m.set(k, it.body);
        }
        return m;
    };
    const A = index(aItems);
    const B = index(bItems);
    const added = [...B.keys()].filter((k) => !A.has(k)).map((k) => ({ title: k, b: clip(B.get(k)) }));
    const removed = [...A.keys()].filter((k) => !B.has(k)).map((k) => ({ title: k, a: clip(A.get(k)) }));
    const changed = [...A.keys()].filter((k) => B.has(k) && A.get(k) !== B.get(k)).map((k) => ({ title: k, a: clip(A.get(k)), b: clip(B.get(k)) }));
    return { label, added, removed, changed, same: A.size - removed.length - changed.length };
}

function bookItems(book) {
    if (!book || typeof book !== 'object') return [];
    const entries = Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {});
    return entries.map((e) => {
        const ks = arr(e.key ?? e.keys).join(', ');
        return { title: str(e.comment || e.name).trim() || ks || '(无标题)', body: `关键词：${ks}\n${e.constant ? '[常驻] ' : ''}${e.disable || e.enabled === false ? '[禁用] ' : ''}\n${str(e.content).trim()}` };
    });
}

function cardDiff(ca, cb, out) {
    const A = normalizeCard(ca)?.data || {};
    const B = normalizeCard(cb)?.data || {};
    const sa = summarizeCard(ca) || {};
    const sb = summarizeCard(cb) || {};
    out.facts.push(
        fact('角色名', sa.name, sb.name),
        fact('版本号', sa.characterVersion, sb.characterVersion),
        fact('作者', sa.creator, sb.creator),
        fact('卡片规范', sa.spec, sb.spec),
        fact('开场白', sa.greetings, sb.greetings),
        fact('世界书条目', sa.bookEntries, sb.bookEntries),
        fact('内嵌正则', sa.regexCount, sb.regexCount),
        fact('内嵌脚本', sa.scriptCount, sb.scriptCount),
        fact('估算 Token', sa.estTokens, sb.estTokens),
        fact('标签', arr(sa.tags).join('、'), arr(sb.tags).join('、')),
    );
    const T = [['description', '描述'], ['personality', '性格'], ['scenario', '场景'], ['first_mes', '开场白'], ['mes_example', '对话示例'],
        ['system_prompt', '系统提示词'], ['post_history_instructions', '后置指令'], ['creator_notes', '作者注释']];
    for (const [k, l] of T) out.texts.push(textField(k, l, A[k], B[k]));
    out.texts.push(textField('depth_prompt', '深度提示词', A.extensions?.depth_prompt?.prompt, B.extensions?.depth_prompt?.prompt));
    out.lists.push(listDiff('备选开场白', arr(A.alternate_greetings).map((g, i) => ({ title: `开场白 ${i + 2}`, body: str(g).trim() })),
        arr(B.alternate_greetings).map((g, i) => ({ title: `开场白 ${i + 2}`, body: str(g).trim() }))));
    out.lists.push(listDiff('内嵌世界书', bookItems(A.character_book), bookItems(B.character_book)));
    const rx = (d) => arr(d.extensions?.regex_scripts).map((r) => ({ title: str(r.scriptName) || '(未命名)', body: `${str(r.findRegex)}\n→ ${str(r.replaceString)}` }));
    out.lists.push(listDiff('内嵌正则', rx(A), rx(B)));
}

function presetDiff(a, b, out) {
    for (const [k, l] of [['temperature', '温度'], ['top_p', 'Top P'], ['top_k', 'Top K'], ['openai_max_context', '上下文长度'], ['openai_max_tokens', '最大回复'],
        ['frequency_penalty', '频率惩罚'], ['presence_penalty', '存在惩罚'], ['temp', '温度'], ['rep_pen', '重复惩罚']]) {
        if (k in a || k in b) out.facts.push(fact(l, a[k], b[k]));
    }
    const prompts = (o) => arr(o.prompts).map((p) => ({ title: str(p.name || p.identifier) || '(未命名)', body: `${p.enabled === false ? '[关闭] ' : ''}${p.role ? `[${p.role}] ` : ''}\n${str(p.content).trim()}` }));
    if (a.prompts || b.prompts) {
        out.facts.push(fact('提示词条目', arr(a.prompts).length, arr(b.prompts).length));
        out.lists.push(listDiff('提示词', prompts(a), prompts(b)));
    }
    for (const k of ['input_sequence', 'output_sequence', 'system_sequence', 'story_string', 'content']) {
        if (k in a || k in b) out.texts.push(textField(k, k, a[k], b[k]));
    }
    const rest = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !['prompts', 'prompt_order', 'name'].includes(k)));
    out.texts.push(textField('other', '其它设置（JSON）', JSON.stringify(rest(a), null, 2), JSON.stringify(rest(b), null, 2)));
}

/**
 * @param {{buf: Buffer, name: string}} a 旧版本
 * @param {{buf: Buffer, name: string}} b 新版本
 */
export function diffFiles(a, b) {
    const da = detectFile(a.buf, a.name);
    const db = detectFile(b.buf, b.name);
    const pa = parseFile(a.buf, a.name);
    const pb = parseFile(b.buf, b.name);
    const sigA = fileSig(a.buf, a.name, da);
    const sigB = fileSig(b.buf, b.name, db);
    const out = {
        type: db.type,
        typeA: da.type,
        sameBytes: a.buf.equals(b.buf),
        sameContent: Boolean(sigA && sigA === sigB) || a.buf.equals(b.buf),
        facts: [fact('文件名', a.name, b.name), fact('大小', `${(a.buf.length / 1024).toFixed(1)} KB`, `${(b.buf.length / 1024).toFixed(1)} KB`)],
        texts: [],
        lists: [],
        image: null,
    };
    if (pa.image || pb.image) {
        const ia = pa.image ? readPngInfo(a.buf) : null;
        const ib = pb.image ? readPngInfo(b.buf) : null;
        out.image = { changed: pngImageHash(a.buf) !== pngImageHash(b.buf), a: ia && `${ia.width}×${ia.height}`, b: ib && `${ib.width}×${ib.height}` };
    }
    const oa = pa.obj;
    const ob = pb.obj;
    if (da.type !== db.type || !oa || !ob) {
        if (pa.text != null || pb.text != null) out.texts.push(textField('content', '内容', pa.text ?? '', pb.text ?? ''));
        return finish(out);
    }
    switch (db.type) {
        case 'character': cardDiff(oa, ob, out); break;
        case 'worldbook': {
            const ea = bookItems(oa);
            const eb = bookItems(ob);
            out.facts.push(fact('条目数', ea.length, eb.length));
            out.lists.push(listDiff('条目', ea, eb));
            break;
        }
        case 'preset': presetDiff(oa, ob, out); break;
        case 'regex': {
            const items = (o) => (Array.isArray(o) ? o : [o]).map((r) => ({ title: str(r.scriptName) || '(未命名)', body: `查找：${str(r.findRegex)}\n替换：${str(r.replaceString)}\n位置：${arr(r.placement).join(',')}` }));
            if (Array.isArray(oa) || Array.isArray(ob)) out.lists.push(listDiff('正则', items(oa), items(ob)));
            else {
                out.texts.push(textField('findRegex', '查找', oa.findRegex, ob.findRegex), textField('replaceString', '替换为', oa.replaceString, ob.replaceString));
                out.facts.push(fact('作用位置', arr(oa.placement).join(','), arr(ob.placement).join(',')), fact('禁用', oa.disabled ? '是' : '否', ob.disabled ? '是' : '否'));
            }
            break;
        }
        case 'quickreply': {
            const items = (o) => arr(o.qrList).map((q) => ({ title: str(q.label) || '(未命名)', body: str(q.message) }));
            out.facts.push(fact('按钮数', arr(oa.qrList).length, arr(ob.qrList).length));
            out.lists.push(listDiff('按钮', items(oa), items(ob)));
            break;
        }
        case 'theme':
            for (const k of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
                if (k === 'name' || k === 'custom_css') continue;
                const f = fact(k, typeof oa[k] === 'object' ? JSON.stringify(oa[k]) : oa[k], typeof ob[k] === 'object' ? JSON.stringify(ob[k]) : ob[k]);
                if (f.changed) out.facts.push(f);
            }
            out.texts.push(textField('custom_css', '自定义 CSS', oa.custom_css, ob.custom_css));
            break;
        default:
            out.texts.push(textField('json', '内容（JSON）', JSON.stringify(oa, null, 2), JSON.stringify(ob, null, 2)));
    }
    return finish(out);
}

function finish(out) {
    out.lists = out.lists.filter((l) => l.added.length || l.removed.length || l.changed.length);
    out.unchangedTexts = out.texts.filter((t) => !t.changed).map((t) => t.label);
    out.texts = out.texts.filter((t) => t.changed);
    out.changes = out.facts.filter((f) => f.changed && f.label !== '文件名').length + out.texts.length
        + out.lists.reduce((s, l) => s + l.added.length + l.removed.length + l.changed.length, 0) + (out.image?.changed ? 1 : 0);
    return out;
}

/** 给导入冲突用的简短摘要：「描述、开场白有改动；世界书 +2」 */
export function diffSummary(d) {
    if (d.sameContent) return '内容相同';
    const parts = [];
    const facts = d.facts.filter((f) => f.changed && !['文件名', '大小'].includes(f.label));
    const ver = facts.find((f) => f.label === '版本号');
    if (ver) parts.push(`版本 ${ver.a} → ${ver.b}`);
    if (d.texts.length) parts.push(`${d.texts.slice(0, 3).map((t) => t.label).join('、')}${d.texts.length > 3 ? ` 等 ${d.texts.length} 处` : ''}有改动`);
    for (const l of d.lists) {
        const seg = [l.added.length && `+${l.added.length}`, l.removed.length && `-${l.removed.length}`, l.changed.length && `改${l.changed.length}`].filter(Boolean).join(' ');
        parts.push(`${l.label} ${seg}`);
    }
    if (d.image?.changed) parts.push('图片有变化');
    const others = facts.filter((f) => f !== ver && !['估算 Token', '开场白', '世界书条目', '内嵌正则', '内嵌脚本', '条目数', '提示词条目', '按钮数'].includes(f.label));
    if (!parts.length && others.length) parts.push(`${others.slice(0, 3).map((f) => f.label).join('、')}有变化`);
    return parts.join('；') || '内容有差异';
}
