// 按酒馆的方式套用正则，并在隔离的小窗口里显示 HTML 美化效果
// 隔离：iframe 不给 allow-scripts，页面内再用 CSP 禁止脚本；内容里的 <script>、事件属性都不会运行
import { h } from './ui.js';

import { slowRegex, runRegex } from './stregex.js';
export { parseRegex, PLACEMENT, runRegex, displayScripts, applyScripts } from './stregex.js';

// 卡里带的正则可能写得很慢（灾难性回溯），直接在页面上跑会把整个页面卡死。
// 所以先放到 Worker 里对着要显示的文本试跑一遍，超时就停掉 Worker，并把这条正则记为太慢、以后跳过。
const VET_MS = 1500;
const vetted = new Set();
let vetWorker = null;
function workerReady() {
    if (vetWorker) return vetWorker.ready;
    let w;
    try { w = new Worker(new URL('./regex-worker.js', import.meta.url), { type: 'module' }); } catch { return Promise.resolve(null); }
    const ready = new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 5000);
        w.addEventListener('message', () => { clearTimeout(t); resolve(w); }, { once: true });
        w.addEventListener('error', () => { clearTimeout(t); resolve(null); }, { once: true });
    });
    vetWorker = { w, ready };
    return ready;
}
function tryInWorker(w, job) {
    return new Promise((resolve) => {
        const t = setTimeout(() => { w.terminate(); vetWorker = null; resolve(null); }, VET_MS);
        w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
        w.postMessage(job);
    });
}
/** 显示前调用：把 list 里的正则依次对 texts 试跑。之后再同步调用 runRegex / applyScripts 就不会卡住页面 */
export async function vetScripts(list, texts, names) {
    for (const text of texts) {
        let out = String(text ?? '');
        for (const r of list || []) {
            const src = String(r?.findRegex || '');
            if (!src || slowRegex.has(src)) continue;
            const key = `${src}\u0000${r.replaceString ?? ''}\u0000${out}`;
            if (vetted.has(key)) { out = runRegex(out, r, names).out; continue; }
            const w = await workerReady();
            if (!w) return; // 浏览器不支持：和以前一样直接运行
            const res = await tryInWorker(w, { text: out, r: { findRegex: r.findRegex, replaceString: r.replaceString, trimStrings: r.trimStrings }, names });
            if (!res) { slowRegex.add(src); continue; }
            if (vetted.size > 400) vetted.clear();
            vetted.add(key);
            out = res.out;
        }
    }
}

export const looksHtml = (s) => /<(div|span|p|table|details|style|img|br|font|b|i|center|section|ul|ol|li|h\d|html|body|svg|button|label)\b[^>]*>/i.test(String(s || ''));

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

// 不运行脚本时，先去掉 <script> 和 onclick 这类事件属性（沙盒和 CSP 本来也会拦，省得控制台一直报错）
const stripScripts = (s) => String(s)
    .replace(/<script\b[\s\S]*?(<\/script>|$)/gi, '')
    .replace(/<[a-z][^>]*>/gi, (tag) => tag.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''));

export const hasScript = (s) => /<script\b|\son[a-z]+\s*=/i.test(String(s || ''));

// 运行脚本时的高度上报：iframe 是匿名源，外面读不到里面的高度，由里面用 postMessage 告诉外面
let frameSeq = 0;
const frames = new Map();
window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.tvFrame !== 'number') return;
    const f = frames.get(d.tvFrame);
    if (!f || e.source !== f.contentWindow) return;
    if (!f.isConnected) { frames.delete(d.tvFrame); return; }
    f.style.height = `${Math.min(Math.max(Number(d.h) || 0, 40), f.tvMax)}px`;
});
// 匿名源里不能用 localStorage，很多美化脚本一读就报错中断；给一个只存在内存里的替身
const storageShim = "(function(){function mk(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}['localStorage','sessionStorage'].forEach(function(n){try{window[n].length}catch(e){try{Object.defineProperty(window,n,{value:mk(),configurable:true})}catch(_){}}})})();";
const reporter = (id) => `<script>${storageShim}(function(){var last=0;function s(){var b=document.body,h=Math.ceil(Math.max(document.documentElement.scrollHeight,b?b.scrollHeight:0));if(Math.abs(h-last)>1){last=h;parent.postMessage({tvFrame:${id},h:h},'*')}}addEventListener('load',s);try{new ResizeObserver(s).observe(document.documentElement)}catch(e){}setInterval(s,800);s()})()</` + 'script>';

const cspOf = (scripts) => (scripts
    // 运行脚本：允许内联脚本和 https 上的库（很多美化会从 CDN 加载字体、jQuery 等）
    ? "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; img-src * data: blob:; media-src * data: blob:; font-src * data:; connect-src https:"
    : "default-src 'none'; script-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:");

/**
 * 隔离的 HTML 预览窗口，高度跟着内容走。
 * scripts=false：sandbox 只给 allow-same-origin（外面要量高度），脚本全部不运行。
 * scripts=true：sandbox 只给 allow-scripts，不给同源——脚本在匿名源里运行，读不到卡匣的登录信息和数据，也不能跳转页面、弹窗。
 * full：内容本身是一整个网页（<html>…</html>），按原样显示，只在开头加上安全设置。
 */
export function htmlFrame(html, { markdown = true, maxHeight = 2400, scripts = false, full = false } = {}) {
    const cs = getComputedStyle(document.documentElement);
    const v = (k, d) => cs.getPropertyValue(k).trim() || d;
    const id = ++frameSeq;
    const body = scripts ? String(html) : stripScripts(html);
    const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspOf(scripts)}"><meta name="viewport" content="width=device-width,initial-scale=1">`;
    const base = `<style>html,body{margin:0;background:transparent}body{color:${v('--text', '#2b2420')};font:15px/1.75 ${v('--font-body', 'system-ui, sans-serif')};word-break:break-word;overflow-wrap:anywhere}img,video{max-width:100%}</style>`;
    let doc;
    if (full) {
        const add = head + base + (scripts ? reporter(id) : '');
        const src = body.replace(/^\s*<!doctype[^>]*>/i, '');
        // 注意别把 <header> 当成 <head>
        doc = /<head(\s[^>]*)?>/i.test(src) ? `<!doctype html>${src.replace(/<head(\s[^>]*)?>/i, (m) => m + add)}`
            : /<html(\s[^>]*)?>/i.test(src) ? `<!doctype html>${src.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${add}</head>`)}`
            : `<!doctype html><html><head>${add}</head><body>${src}</body></html>`;
    } else {
        doc = `<!doctype html><html><head>${head}${base}
<style>
body{padding:12px 14px}
em{color:${v('--text-2', '#6b5f57')}}
q,blockquote{color:${v('--accent', '#9a4a2c')}}
pre{white-space:pre-wrap}
table{border-collapse:collapse;max-width:100%}
</style>${scripts ? reporter(id) : ''}</head><body>${markdown ? mdLite(body) : body}</body></html>`;
    }
    const f = h('iframe', { class: 'st-frame', sandbox: scripts ? 'allow-scripts' : 'allow-same-origin', referrerpolicy: 'no-referrer', title: '效果预览' });
    f.tvMax = maxHeight;
    f.srcdoc = doc;
    if (scripts) { frames.set(id, f); return f; }
    let n = 0;
    const fit = () => {
        try {
            const d = f.contentDocument;
            if (!d?.body || ++n > 60) return; // 内容用 100vh 之类撑高时，避免一直变高
            const hgt = Math.ceil(Math.max(d.body.getBoundingClientRect().height, full ? d.documentElement.scrollHeight : 0));
            f.style.height = `${Math.min(Math.max(hgt, 40), maxHeight)}px`;
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

// ```html … ``` 代码块：酒馆（酒馆助手的前端渲染）会把它当成网页显示
const FENCE = /```[ \t]*([\w-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/g;
const htmlish = (lang, body) => lang === 'html' || (!lang && /^\s*<(!doctype|html|head|body|style|div|section|table)\b/i.test(body));
export const hasHtmlFence = (s) => [...String(s || '').matchAll(FENCE)].some((m) => htmlish(m[1].toLowerCase(), m[2]));

/**
 * 按酒馆的样子显示一段消息：普通文字和行内 HTML 放在一个窗口里，
 * 每个 ```html 代码块单独一个窗口、按完整网页显示，其它代码块显示成代码。
 */
export function stView(text, { scripts = false } = {}) {
    const src = String(text ?? '');
    const parts = [];
    let last = 0;
    for (const m of src.matchAll(FENCE)) {
        const lang = m[1].toLowerCase();
        if (m.index > last) parts.push({ t: 'md', v: src.slice(last, m.index) });
        parts.push(htmlish(lang, m[2]) ? { t: 'html', v: m[2] } : { t: 'code', v: m[2] });
        last = m.index + m[0].length;
    }
    if (last < src.length) parts.push({ t: 'md', v: src.slice(last) });
    if (!parts.some((p) => p.t !== 'md')) return htmlFrame(src, { scripts });
    return h('div', { class: 'st-multi' }, parts.map((p) => {
        if (p.t === 'html') return htmlFrame(p.v, { scripts, full: true });
        if (p.t === 'code') return h('pre', { class: 'code' }, p.v);
        return p.v.trim() ? htmlFrame(p.v.trim(), { scripts }) : null;
    }));
}

export const escapeHtml = esc;
