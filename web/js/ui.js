// 轻量 DOM 工具
export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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
    const t = h('div', { class: `toast ${kind}` }, msg);
    box.append(t);
    setTimeout(() => { t.style.transition = '.3s'; t.style.opacity = '0'; }, kind === 'err' ? 4200 : 2400);
    setTimeout(() => t.remove(), kind === 'err' ? 4600 : 2800);
}

/** 打开底部弹层 */
export function sheet({ title, body, foot, full = false, onClose, headExtra } = {}) {
    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const bodyEl = h('div', { class: 'sheet-body' }, body);
    const footEl = foot ? h('div', { class: 'sheet-foot' }, foot) : null;
    const titleEl = h('h2', {}, title);
    const box = h('div', { class: `sheet ${full ? 'full' : ''}` },
        h('div', { class: 'sheet-head' }, titleEl, headExtra, h('button', { class: 'btn icon ghost', onclick: close, 'aria-label': '关闭' }, '✕')),
        bodyEl, footEl);
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    return { close, body: bodyEl, foot: footEl, title: titleEl, el: box };
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
