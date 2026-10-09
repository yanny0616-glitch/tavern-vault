// 与酒馆（SillyTavern / TauriTavern）插件通信的桥。只有页面被插件以 iframe 内嵌时可用。
const params = new URLSearchParams(location.hash.includes('?') ? location.hash.split('?')[1] : location.search.slice(1));
const embedded = window.parent !== window && params.get('embed') === 'tavern';
const parentOrigin = params.get('po') || '*';

let seq = 0;
const pending = new Map();
let hostInfo = null;
const listeners = new Set();

if (embedded) {
    window.addEventListener('message', (e) => {
        if (e.source !== window.parent) return;
        if (parentOrigin !== '*' && e.origin !== parentOrigin) return;
        const m = e.data;
        if (!m || m.tv !== 1) return;
        if (m.kind === 'res' && pending.has(m.id)) {
            const { resolve, reject, timer } = pending.get(m.id);
            clearTimeout(timer);
            pending.delete(m.id);
            m.ok ? resolve(m.result) : reject(new Error(m.error || '酒馆端出错'));
        } else if (m.kind === 'event') {
            for (const fn of listeners) fn(m.event, m.data);
        }
    });
}

function call(method, params = {}, transfer = [], timeout = 120000) {
    if (!embedded) return Promise.reject(new Error('未连接酒馆'));
    return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('酒馆响应超时')); }, timeout);
        pending.set(id, { resolve, reject, timer });
        window.parent.postMessage({ tv: 1, kind: 'req', id, method, params }, parentOrigin, transfer);
    });
}

export const bridge = {
    embedded,
    get host() { return hostInfo; },
    async connect() {
        if (!embedded) return null;
        try {
            hostInfo = await call('hello', {}, [], 8000);
        } catch {
            hostInfo = null;
        }
        return hostInfo;
    },
    call,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { if (embedded) window.parent.postMessage({ tv: 1, kind: 'close' }, parentOrigin); },
};
