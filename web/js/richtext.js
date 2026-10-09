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
