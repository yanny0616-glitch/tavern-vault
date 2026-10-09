// 入口：外壳、登录、路由
import { h, clear, toast } from './ui.js';
import { api } from './api.js';
import { bridge } from './bridge.js';
import { state, reload, subscribe, applyAccent, live } from './state.js';
import { renderLibrary } from './views/library.js';
import { renderCollections } from './views/collections.js';
import { renderTavern } from './views/tavern.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';
import { renderTrash } from './views/trash.js';
import { openImporter } from './views/importer.js';
import { openDetail } from './views/detail.js';

const app = document.getElementById('app');
if (bridge.embedded) document.documentElement.classList.add('embed');

const ROUTES = {
    library: { label: '仓库', icon: '🗃️', render: renderLibrary },
    collections: { label: '合集', icon: '📚', render: renderCollections },
    tavern: { label: '酒馆', icon: '🍺', render: renderTavern, tavernOnly: true },
    stats: { label: '统计', icon: '📊', render: renderStats },
    settings: { label: '设置', icon: '⚙️', render: renderSettings },
    trash: { label: '回收站', icon: '🗑️', render: renderTrash, hiddenInTabbar: true },
};

let current = '';
let pageEl;
let navEl;
let tabEl;
let statusDot;

function routeName() {
    const r = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0];
    return ROUTES[r] && (!ROUTES[r].tavernOnly || bridge.host) ? r : 'library';
}

export function go(name) {
    const keep = location.hash.includes('?') ? `?${location.hash.split('?')[1]}` : '';
    location.hash = `#/${name}${keep}`;
}

function buildShell() {
    statusDot = h('span', { class: 'dot' });
    navEl = h('nav', { class: 'sidebar' },
        h('div', { class: 'brand' }, h('img', { src: '/icon.svg', alt: '' }), h('span', {}, '酒馆藏馆')),
        h('div', { id: 'nav-links' }),
        h('div', { class: 'nav-foot' }, statusDot, h('span', { id: 'status-text' }, '连接中…')));
    tabEl = h('nav', { class: 'tabbar' });
    pageEl = h('main', { class: 'main' });
    const fab = h('button', { class: 'fab', onclick: () => openImporter(), 'aria-label': '添加' }, '+');
    clear(app, h('div', { class: 'shell' }, navEl, pageEl), tabEl, fab);
    renderNav();
}

function renderNav() {
    const r = routeName();
    const links = navEl.querySelector('#nav-links');
    const visible = Object.entries(ROUTES).filter(([, v]) => !v.tavernOnly || bridge.host);
    const counts = { library: live().length, collections: state.collections.length, trash: state.stats.trash || 0 };
    clear(links,
        h('button', { class: 'btn primary', style: { width: '100%', marginBottom: '12px' }, onclick: () => openImporter() }, '＋ 添加资源'),
        visible.filter(([k]) => k !== 'trash').map(([k, v]) => h('button', { class: `nav-item ${r === k ? 'active' : ''}`, onclick: () => go(k) },
            h('span', { class: 'ico' }, v.icon), v.label, counts[k] != null ? h('span', { class: 'count' }, counts[k]) : null)),
        h('div', { class: 'nav-sep' }),
        h('button', { class: `nav-item ${r === 'trash' ? 'active' : ''}`, onclick: () => go('trash') },
            h('span', { class: 'ico' }, ROUTES.trash.icon), '回收站', counts.trash ? h('span', { class: 'count' }, counts.trash) : null),
        bridge.host ? h('div', { class: 'nav-item', style: { cursor: 'default' } }, h('span', { class: 'ico' }, '🔗'), h('span', { class: 'small' }, `已连接 ${bridge.host.host}`)) : null,
    );
    clear(tabEl, visible.filter(([, v]) => !v.hiddenInTabbar).map(([k, v]) => h('button', { class: r === k ? 'active' : '', onclick: () => go(k) },
        h('span', { class: 'ico' }, v.icon), v.label)));
}

function setStatus(online) {
    state.online = online;
    statusDot?.classList.toggle('on', online);
    const t = document.getElementById('status-text');
    if (t) t.textContent = online ? '实时同步中' : '连接断开，重连中…';
}

function render() {
    const r = routeName();
    if (r !== current) {
        current = r;
        state.selecting = false;
        state.selection.clear();
        window.scrollTo(0, 0);
    }
    renderNav();
    ROUTES[r].render(pageEl, { go });
}

function showLogin(title) {
    const pw = h('input', { class: 'input', type: 'password', placeholder: '访问密码', autocomplete: 'current-password', onkeydown: (e) => { if (e.key === 'Enter') submit(); } });
    const btn = h('button', { class: 'btn primary', style: { width: '100%', marginTop: '12px', height: '42px' }, onclick: () => submit() }, '进入藏馆');
    async function submit() {
        btn.disabled = true;
        try {
            const { token } = await api.post('/api/login', { password: pw.value });
            api.setToken(token);
            start();
        } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
        }
    }
    clear(app, h('div', { class: 'login' }, h('div', { class: 'login-box' },
        h('img', { src: '/icon.svg', alt: '' }),
        h('h2', { style: { margin: '0 0 4px' } }, title || '酒馆藏馆'),
        h('p', { class: 'muted', style: { margin: '0 0 18px' } }, '请输入访问密码'),
        pw, btn)));
    setTimeout(() => pw.focus(), 50);
}

let started = false;
async function start() {
    applyAccent();
    let health;
    try {
        health = await api.get('/api/health');
    } catch (e) {
        clear(app, h('div', { class: 'empty' }, h('div', { class: 'big' }, '📡'), '无法连接到藏馆服务：', e.message,
            h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: start }, '重试'))));
        return;
    }
    document.title = health.title || '酒馆藏馆';
    if (health.auth) {
        try {
            await reload();
        } catch {
            showLogin(health.title);
            return;
        }
    } else {
        await reload();
    }
    if (bridge.embedded) await bridge.connect();
    buildShell();
    if (!started) {
        started = true;
        window.addEventListener('hashchange', render);
        subscribe(render);
        let timer;
        api.events((ev) => {
            if (ev === 'auth') { location.reload(); return; }
            clearTimeout(timer);
            timer = setTimeout(() => reload().catch(() => {}), 150);
        }, setStatus);
        window.addEventListener('tv:unauthorized', () => showLogin(health.title));
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reload().catch(() => {}); });
        // 支持拖拽到页面任意位置上传
        document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
        document.addEventListener('drop', (e) => {
            if (!e.dataTransfer?.files?.length || e.target.closest?.('.drop')) return;
            e.preventDefault();
            openImporter([...e.dataTransfer.files]);
        });
        // 通过 #/library?item=xxx 直接打开条目
        const m = location.hash.match(/[?&]item=([a-f0-9]+)/);
        if (m && state.byId.has(m[1])) setTimeout(() => openDetail(m[1]), 100);
    }
    render();
    if (!health.auth && !bridge.embedded) {
        setTimeout(() => toast('⚠️ 尚未设置访问密码，公网部署请到「设置」中设置', 'err'), 600);
    }
}

start();
