// 角色卡文本的阅读排版：*动作*、“对白”、**强调**、{{char}} / {{user}}；全部生成 DOM 节点，不解析 HTML
import { h } from './ui.js';

const INLINE = /(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|“[^”\n]{0,600}”|「[^」\n]{0,600}」|"[^"\n]{1,600}"|\{\{(?:char|user)\}\}|<(?:BOT|USER|CHAR)>)/gi;

function inline(line, names) {
    const out = [];
    let last = 0;
    for (const m of line.matchAll(INLINE)) {
        if (m.index > last) out.push(line.slice(last, m.index));
        const t = m[0];
        const low = t.toLowerCase();
        if (t.startsWith('**')) out.push(h('strong', {}, t.slice(2, -2)));
        else if (t.startsWith('*')) out.push(h('em', { class: 'rt-act' }, t.slice(1, -1)));
        else if (low === '{{char}}' || low === '<bot>' || low === '<char>') out.push(h('span', { class: 'rt-name' }, names.char));
        else if (low === '{{user}}' || low === '<user>') out.push(h('span', { class: 'rt-name user' }, names.user));
        else out.push(h('span', { class: 'rt-say' }, t));
        last = m.index + t.length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
}

const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const withNames = (names) => ({ char: names?.char || '角色', user: names?.user || '你' });

/** 段落 + 行内样式 */
export function richText(text, names, { cls = '' } = {}) {
    const n = withNames(names);
    const paras = norm(text).split(/\n{2,}/).filter(Boolean);
    return h('div', { class: `rt ${cls}` }, paras.map((p) => h('p', {}, p.split('\n').flatMap((ln, i) => (i ? [h('br'), ...inline(ln, n)] : inline(ln, n))))));
}

/** 对话示例：按 <START> 分段，按「{{user}}: / {{char}}:」分成一来一回 */
export function dialogView(text, names) {
    const n = withNames(names);
    const who = (line) => {
        const m = line.match(/^\s*(\{\{user\}\}|<user>|\{\{char\}\}|<bot>|<char>)\s*[:：]\s?/i)
            || (n.char && line.match(new RegExp(`^\\s*(${n.char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*[:：]\\s?`)));
        if (!m) return null;
        return { side: /user/i.test(m[1]) ? 'user' : 'char', rest: line.slice(m[0].length) };
    };
    const blocks = norm(text).split(/<START>/i).map((b) => b.trim()).filter(Boolean);
    let any = false;
    const views = blocks.map((b) => {
        const turns = [];
        for (const line of b.split('\n')) {
            const w = who(line);
            if (w) { turns.push({ side: w.side, text: w.rest }); any = true; } else if (turns.length) turns[turns.length - 1].text += `\n${line}`;
            else turns.push({ side: 'note', text: line });
        }
        return h('div', { class: 'dlg' }, turns.filter((t) => t.text.trim()).map((t) => h('div', { class: `dlg-turn ${t.side}` },
            t.side === 'note' ? null : h('span', { class: 'dlg-who' }, t.side === 'user' ? n.user : n.char),
            richText(t.text, n))));
    });
    if (!any) return richText(text, n);
    return h('div', { class: 'dlg-list' }, views);
}

// AI 回复：常见的 Markdown（标题、列表、引用、代码块、**加粗**、`代码`），同样只生成 DOM 节点
const MD_INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+?`)/g;
function mdInline(line) {
    const out = [];
    let last = 0;
    for (const m of line.matchAll(MD_INLINE)) {
        if (m.index > last) out.push(line.slice(last, m.index));
        out.push(m[0].startsWith('**') ? h('strong', {}, m[0].slice(2, -2)) : h('code', {}, m[0].slice(1, -1)));
        last = m.index + m[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
}

export function mdLite(text, { cls = '' } = {}) {
    const lines = norm(text).split('\n');
    const out = [];
    let para = [];
    let list = null;
    const flushPara = () => { if (para.length) out.push(h('p', {}, para.flatMap((ln, i) => (i ? [h('br'), ...mdInline(ln)] : mdInline(ln))))); para = []; };
    const flushList = () => { if (list) out.push(h(list.tag, {}, list.items.map((x) => h('li', {}, mdInline(x))))); list = null; };
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const fence = ln.match(/^\s*```/);
        if (fence) {
            flushPara(); flushList();
            const body = [];
            for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
            out.push(h('pre', { class: 'code' }, body.join('\n')));
            continue;
        }
        const head = ln.match(/^\s*#{1,6}\s+(.*)$/);
        const ul = ln.match(/^\s*[-*•]\s+(.*)$/);
        const ol = ln.match(/^\s*\d+[.)、]\s*(.*)$/);
        const quote = ln.match(/^\s*>\s?(.*)$/);
        if (!ln.trim()) { flushPara(); flushList(); }
        else if (head) { flushPara(); flushList(); out.push(h('h4', {}, mdInline(head[1]))); }
        else if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { flushPara(); flushList(); out.push(h('hr')); }
        else if (ul || ol) {
            flushPara();
            const tag = ul ? 'ul' : 'ol';
            if (list?.tag !== tag) { flushList(); list = { tag, items: [] }; }
            list.items.push((ul || ol)[1]);
        } else if (quote) { flushPara(); flushList(); out.push(h('blockquote', {}, mdInline(quote[1]))); }
        else if (list && /^\s{2,}\S/.test(ln)) list.items[list.items.length - 1] += ` ${ln.trim()}`;
        else { flushList(); para.push(ln); }
    }
    flushPara(); flushList();
    return h('div', { class: `md ${cls}` }, out);
}
