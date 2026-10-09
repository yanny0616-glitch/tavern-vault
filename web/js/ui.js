// 轻量 DOM 工具
import { icon } from './icons.js';

export { icon };
export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null || sv === '') continue; if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'value') el.value = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false || c === true) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
}

export function clear(el, ...children) {
    el.replaceChildren();
    append(el, children);
    return el;
}

export function toast(msg, kind = '') {
    const box = document.getElementById('toasts');
    const ic = kind === 'err' ? 'alert' : kind === 'ok' ? 'checkCircle' : 'info';
    const t = h('div', { class: `toast ${kind}` }, icon(ic, { size: 16 }), h('span', {}, msg));
    box.append(t);
    setTimeout(() => t.classList.add('out'), kind === 'err' ? 4200 : 2400);
    setTimeout(() => t.remove(), kind === 'err' ? 4600 : 2800);
}

/**
 * 打开底部弹层。
 * beforeClose：点 X、点遮罩、按 Esc 时先调用，返回 false（或 Promise<false>）就不关；代码里调用 close() 不经过它
 */
// ---- 返回手势 / 安卓返回键：先关掉最上面的弹窗，而不是切走页面 ----
// 打开弹窗时往浏览历史里压一步；按返回时关弹窗。用按钮关掉的，把那一步退回去
const sheetStack = [];
let sheetSeq = 0;
let skipPops = 0;
window.addEventListener('popstate', () => {
    if (skipPops > 0) { skipPops--; return; }
    const top = sheetStack[sheetStack.length - 1];
    if (!top) return;
    top.pushed = false; // 这一步已经被退掉了
    top.tryClose().then(() => {
        // 有没保存的内容、选择不关时，把这一步补回来，下次返回还是先问
        if (top.overlay.isConnected && !top.pushed) {
            try { history.pushState({ tvSheet: top.id }, ''); top.pushed = true; } catch { /* ignore */ }
        }
    });
});
function trackSheet(entry) {
    // 当前这一步属于刚关掉的弹窗（关一个马上开另一个）：直接沿用，不再多压一步
    const cur = history.state?.tvSheet;
    const reuse = cur && !sheetStack.some((x) => x.id === cur);
    sheetStack.push(entry);
    try {
        if (reuse) history.replaceState({ tvSheet: entry.id }, ''); else history.pushState({ tvSheet: entry.id }, '');
        entry.pushed = true;
    } catch { /* ignore */ }
}
function untrackSheet(entry) {
    const i = sheetStack.indexOf(entry);
    if (i >= 0) sheetStack.splice(i, 1);
    if (!entry.pushed) return;
    entry.pushed = false;
    // 稍后再退：关弹窗后紧接着跳转页面的，历史已经变了，就不要再退（否则会把刚跳的页面退回去）
    setTimeout(() => {
        if (history.state?.tvSheet === entry.id) { skipPops++; history.back(); }
    }, 0);
}

/** 往下拖弹窗顶部（小横条和标题栏）关掉弹窗 */
function dragToClose(box, overlay, tryClose) {
    const grabs = () => [box.querySelector('.sheet-grip'), box.querySelector('.sheet-head')];
    let y0 = 0;
    let t0 = 0;
    let dy = 0;
    let on = false;
    const reset = () => { box.style.transition = ''; box.style.transform = ''; overlay.style.background = ''; };
    box.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1 || box.classList.contains('dialog')) return;
        if (!grabs().some((g) => g?.contains(e.target)) || e.target.closest('button, a, input, select, textarea')) return;
        on = true; y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0;
        box.style.transition = 'none';
    }, { passive: true });
    box.addEventListener('touchmove', (e) => {
        if (!on) return;
        dy = Math.max(0, e.touches[0].clientY - y0);
        box.style.transform = dy ? `translateY(${dy}px)` : '';
    }, { passive: true });
    const end = async () => {
        if (!on) return;
        on = false;
        const fast = dy > 30 && dy / Math.max(1, Date.now() - t0) > 0.6;
        box.style.transition = 'transform .2s ease';
        if (dy > Math.min(120, box.offsetHeight * 0.25) || fast) {
            box.style.transform = `translateY(${box.offsetHeight}px)`;
            await new Promise((r) => setTimeout(r, 160));
            await tryClose();
            if (overlay.isConnected) reset(); // 有没保存的内容、选择不关
        } else {
            box.style.transform = '';
            setTimeout(reset, 220);
        }
    };
    box.addEventListener('touchend', end);
    box.addEventListener('touchcancel', end);
}

export function sheet({ title, body, foot, full = false, onClose, headExtra, beforeClose } = {}) {
    const close = () => {
        if (!overlay.isConnected) return;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        untrackSheet(entry);
        onClose?.();
    };
    let asking = false;
    const tryClose = async () => {
        if (asking || !overlay.isConnected) return;
        if (beforeClose) {
            asking = true;
            try { if (!(await beforeClose())) return; } finally { asking = false; }
        }
        close();
    };
    const onKey = (e) => { if (e.key === 'Escape' && [...document.querySelectorAll('.overlay')].pop() === overlay) { e.stopImmediatePropagation(); tryClose(); } };
    const bodyEl = h('div', { class: 'sheet-body' }, body);
    const footEl = foot ? h('div', { class: 'sheet-foot' }, foot) : null;
    const titleEl = h('h2', {}, title);
    const box = h('div', { class: `sheet ${full ? 'full' : ''}` },
        h('div', { class: 'sheet-grip' }),
        h('div', { class: 'sheet-head' }, titleEl, headExtra, h('button', { class: 'btn icon ghost sheet-x', onclick: tryClose, 'aria-label': '关闭' }, icon('x', { size: 20 }))),
        bodyEl, footEl);
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) tryClose(); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    const entry = { id: ++sheetSeq, overlay, tryClose, pushed: false };
    trackSheet(entry);
    dragToClose(box, overlay, tryClose);
    return { close, tryClose, body: bodyEl, foot: footEl, title: titleEl, el: box };
}

export function confirmDialog(message, { ok = '确定', danger = false, title = '确认' } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
        const s = sheet({
            title,
            body: h('div', { style: { whiteSpace: 'pre-wrap' } }, message),
            foot: [
                h('button', { class: 'btn', onclick: () => finish(false) }, '取消'),
                h('button', { class: `btn ${danger ? 'danger solid' : 'primary'}`, onclick: () => finish(true) }, ok),
            ],
            onClose: () => finish(false),
        });
        s.el.classList.add('dialog');
        s.el.parentElement.classList.add('center');
    });
}

/** 多选一对话框：options = [{key, label, cls}]，取消返回 null */
export function choiceDialog(message, options, { title = '请选择' } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
        const s = sheet({
            title,
            body: h('div', { class: 'choice-body' }, message),
            foot: [h('button', { class: 'btn ghost', onclick: () => finish(null) }, '取消'), ...options.map((o) => h('button', { class: `btn ${o.cls || ''}`, onclick: () => finish(o.key) }, o.label))],
            onClose: () => finish(null),
        });
        s.el.classList.add('dialog', 'choice');
        s.el.parentElement.classList.add('center');
    });
}

export function promptDialog(message, { value = '', placeholder = '', title = '输入', ok = '确定', multiline = false } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const input = multiline
            ? h('textarea', { class: 'textarea', placeholder, value })
            : h('input', { class: 'input', placeholder, value, onkeydown: (e) => { if (e.key === 'Enter') finish(input.value); } });
        const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
        const s = sheet({
            title,
            body: h('div', {}, message ? h('div', { class: 'muted', style: { marginBottom: '10px' } }, message) : null, input),
            foot: [h('button', { class: 'btn', onclick: () => finish(null) }, '取消'), h('button', { class: 'btn primary', onclick: () => finish(input.value) }, ok)],
            onClose: () => finish(null),
        });
        s.el.classList.add('dialog');
        s.el.parentElement.classList.add('center');
        setTimeout(() => input.focus(), 50);
    });
}

export function lightbox(src) {
    const lb = h('div', { class: 'lightbox', onclick: () => lb.remove() }, h('img', { src }));
    document.body.append(lb);
}

export function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(iso, withTime = false) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (x) => String(x).padStart(2, '0');
    const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return withTime ? `${s} ${p(d.getHours())}:${p(d.getMinutes())}` : s;
}

export function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
    return fmtDate(iso);
}

export function debounce(fn, ms = 300) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function switchEl(checked, onchange) {
    const input = h('input', { type: 'checkbox', checked, onchange: () => onchange(input.checked) });
    return h('label', { class: 'switch' }, input, h('span'));
}

/** 带图标的按钮 */
export function btn(label, { icon: ic, cls = '', onclick, title, href, download, disabled } = {}) {
    const children = [ic ? icon(ic, { size: cls.includes('sm') ? 15 : 17 }) : null, label ? h('span', {}, label) : null];
    if (href) return h('a', { class: `btn ${cls} ${label ? '' : 'icon'}`, href, download, title }, children);
    return h('button', { class: `btn ${cls} ${label ? '' : 'icon'}`, onclick, title, disabled, type: 'button' }, children);
}

/** 星级 */
export function starsEl(value, onSet, { size = 18 } = {}) {
    const wrap = h('span', { class: 'stars' });
    const draw = (v) => clear(wrap, [1, 2, 3, 4, 5].map((n) => {
        const s = h('span', { class: n <= (v || 0) ? 'on' : '', onclick: onSet ? (e) => { e.stopPropagation(); const nv = v === n ? 0 : n; onSet(nv); draw(nv); } : null }, icon('star', { size, fill: n <= (v || 0) }));
        return s;
    }));
    draw(value);
    return wrap;
}

/** 空状态 */
export function emptyState(ic, title, text, action) {
    return h('div', { class: 'empty' },
        h('div', { class: 'empty-ic' }, icon(ic, { size: 30, stroke: 1.5 })),
        title ? h('div', { class: 'empty-title' }, title) : null,
        text ? h('div', { class: 'empty-text' }, text) : null,
        action ? h('div', { class: 'empty-act' }, action) : null);
}
