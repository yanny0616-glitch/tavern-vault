// 按酒馆的方式套用正则，并在隔离的小窗口里显示 HTML 美化效果
// 隔离：iframe 不给 allow-scripts，页面内再用 CSP 禁止脚本；内容里的 <script>、事件属性都不会运行
import { h } from './ui.js';

/** 酒馆的正则写法：「/pattern/flags」或直接写 pattern */
export function parseRegex(src) {
    const s = String(src || '');
    if (!s) return null;
    const m = s.match(/^\/([\s\S]+)\/([a-z]*)$/i);
    try {
        if (m) return new RegExp(m[1], [...new Set(m[2].replace(/[^dgimsuvy]/g, ''))].join(''));
        return new RegExp(s);
    } catch {
        return null;
    }
}

const macros = (s, names) => String(s ?? '')
    .replace(/\{\{char\}\}/gi, names.char)
    .replace(/\{\{user\}\}/gi, names.user);

// 正则的作用位置（酒馆里的 placement）
export const PLACEMENT = { 1: '用户输入', 2: 'AI 输出', 3: '快捷命令', 5: '世界书', 6: '推理' };

/** 套用一条正则；返回替换后的文本和命中次数 */
export function runRegex(text, r, names) {
    const re = parseRegex(r.findRegex);
    if (!re) return { out: text, hits: 0, error: r.findRegex ? '正则写法有误' : '' };
    let hits = 0;
    const rep = String(r.replaceString ?? '').replace(/\{\{match\}\}/gi, '$&');
    const trims = (r.trimStrings || []).filter(Boolean);
    const out = String(text).replace(re, (...args) => {
        hits++;
        const groups = typeof args[args.length - 1] === 'object' ? args[args.length - 1] : null;
        const caps = args.slice(0, groups ? -3 : -2);
        const strip = (v) => trims.reduce((acc, t) => acc.split(t).join(''), v ?? '');
        // 和 String.replace 一样展开 $&、$1、$<name>，被引用的内容先去掉 trimStrings
        return macros(rep, names).replace(/\$(&|\d{1,2}|<[^>]+>)/g, (m, k) => {
            if (k === '&') return strip(caps[0]);
            if (k[0] === '<') return strip(groups?.[k.slice(1, -1)]);
            const i = Number(k);
            return i < caps.length ? strip(caps[i]) : m;
        });
    });
    return { out, hits };
}

/** 酒馆显示消息时会生效的正则：作用于 AI 输出、没被禁用、不是「只改发送内容」 */
export function displayScripts(list) {
    return (list || []).filter((r) => r && !r.disabled && !r.promptOnly && (!r.placement?.length || r.placement.includes(2)));
}

export function applyScripts(text, list, names) {
    let out = String(text ?? '');
    let hits = 0;
    for (const r of displayScripts(list)) {
        const x = runRegex(out, r, names);
        out = x.out;
        hits += x.hits;
    }
    return { out, hits };
}

export const looksHtml = (s) => /<(div|span|p|table|details|style|img|br|font|b|i|center|section|ul|ol|li|h\d)\b[^>]*>/i.test(String(s || ''));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 酒馆会把消息当 Markdown 显示：换行、**粗体**、*斜体*。<style>、<pre> 和标签内部保持原样
function mdLite(s) {
    return String(s).split(/(<style[\s\S]*?<\/style>|<pre[\s\S]*?<\/pre>|<[^>]+>)/i).map((part, i) => {
        if (i % 2) return part;
        return part
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }).join('');
}

// 脚本本来就不会运行（沙盒 + CSP），这里再去掉一遍，省得浏览器控制台一直报「已拦截」
const stripScripts = (s) => String(s)
    .replace(/<script\b[\s\S]*?(<\/script>|$)/gi, '')
    .replace(/<[a-z][^>]*>/gi, (tag) => tag.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''));

/** 隔离的 HTML 预览窗口，高度跟着内容走 */
export function htmlFrame(html, { markdown = true, maxHeight = 0 } = {}) {
    const cs = getComputedStyle(document.documentElement);
    const v = (k, d) => cs.getPropertyValue(k).trim() || d;
    const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;padding:0;background:transparent}
body{padding:12px 14px;color:${v('--text', '#2b2420')};font:15px/1.75 ${v('--font-body', 'system-ui, sans-serif')};word-break:break-word;overflow-wrap:anywhere}
img,video{max-width:100%;height:auto}
em{color:${v('--text-2', '#6b5f57')}}
q,blockquote{color:${v('--accent', '#9a4a2c')}}
pre{white-space:pre-wrap}
table{border-collapse:collapse;max-width:100%}
</style></head><body>${markdown ? mdLite(stripScripts(html)) : stripScripts(html)}</body></html>`;
    const f = h('iframe', { class: 'st-frame', sandbox: 'allow-same-origin', referrerpolicy: 'no-referrer', loading: 'lazy', title: '效果预览' });
    f.srcdoc = doc;
    const fit = () => {
        try {
            const d = f.contentDocument;
            if (!d?.body) return;
            const hgt = Math.ceil(d.body.getBoundingClientRect().height);
            f.style.height = `${maxHeight ? Math.min(hgt, maxHeight) : hgt}px`;
        } catch { /* 读不到就保持默认高度 */ }
    };
    f.addEventListener('load', () => {
        fit();
        try {
            new ResizeObserver(fit).observe(f.contentDocument.body);
            for (const img of f.contentDocument.images) img.addEventListener('load', fit);
        } catch { /* ignore */ }
    });
    return f;
}

export const escapeHtml = esc;
