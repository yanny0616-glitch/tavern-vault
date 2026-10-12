// 入口：外壳、登录、路由
import { h, clear, toast, icon, emptyState, btn } from './ui.js';
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
import { filesFromDrop } from './files.js';

// 手机浏览器的 100vh 按「工具栏收起」时算，比实际能看到的高，弹窗底部会被截掉。
// 这里量出真实的可见高度给 CSS 用（地址栏伸缩、旋转屏幕时更新）
const setAppHeight = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
setAppHeight();
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 300));
window.visualViewport?.addEventListener('resize', setAppHeight);

// 往下滚时：带搜索框的顶栏把标题那一行推出屏幕（只留搜索和分类），右下角「+」藏起来；往上滑就恢复。
// 用位移而不是改高度，下面的内容不会跟着跳
let lastY = 0;
let collapsed = false;
function setCollapsed(on) {
    const bar = document.querySelector('.main > .topbar');
    const row = bar?.querySelector('.tb-row');
    on = on && Boolean(bar?.querySelector('.search'));
    document.documentElement.classList.toggle('scrolling-down', on);
    if (bar) bar.style.transform = on && row ? `translateY(-${row.offsetHeight + parseFloat(getComputedStyle(bar).rowGap || 0)}px)` : '';
    collapsed = on;
}
window.addEventListener('scroll', () => {
    const y = Math.max(0, window.scrollY);
    const bar = document.querySelector('.main > .topbar');
    if (y < (bar?.offsetHeight || 120)) { if (collapsed) setCollapsed(false); lastY = y; return; }
    if (y > lastY + 12) { if (!collapsed) setCollapsed(true); lastY = y; } else if (y < lastY - 12) { if (collapsed) setCollapsed(false); lastY = y; }
}, { passive: true });
import { openDetail } from './views/detail.js';
import { handleAiEvent, renderChip } from './views/ai.js';
import { handleAiChatEvent } from './views/aichat.js';

const app = document.getElementById('app');

// 在酒馆插件里打开时：底部安全区由藏馆自己留（底部栏铺到屏幕最下面），插件面板顶部跟着藏馆的风格配色
async function fitHost() {
    const root = document.documentElement;
    if (bridge.has('insets')) {
        try {
            // 插件不再留边距、也不显示自己的标题栏，藏馆铺满全屏，自己给灵动岛 / 状态栏和底部 Home 条留位置
            const r = await bridge.call('insets', {}, [], 5000);
            const px = (v) => `${Math.max(0, Math.min(Number(v) || 0, 120))}px`;
            for (const k of ['top', 'bottom', 'left', 'right']) root.style.setProperty(`--safe-${k}`, px(r?.[k]));
            root.classList.add('embed-edge');
        } catch { /* 旧版插件 */ }
    }
    if (!bridge.has('theme')) return;
    let last = '';
    const send = () => {
        const cs = getComputedStyle(root);
        const colors = { bg: getComputedStyle(document.body).backgroundColor, fg: cs.getPropertyValue('--text').trim(), line: cs.getPropertyValue('--line').trim() };
        const key = JSON.stringify(colors);
        if (key === last) return;
        last = key;
        bridge.call('theme', colors, [], 5000).catch(() => {});
    };
    send();
    let t = 0;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(send, 60); }).observe(root, { attributes: true, attributeFilter: ['data-skin', 'data-mode', 'style'] });
}
if (bridge.embedded) document.documentElement.classList.add('embed');

const ROUTES = {
    library: { label: '仓库', icon: 'archive', render: renderLibrary },
    collections: { label: '合集', icon: 'layers', render: renderCollections },
    tavern: { label: '酒馆', icon: 'beer', render: renderTavern, tavernOnly: true },
    stats: { label: '统计', icon: 'chart', render: renderStats },
    settings: { label: '设置', icon: 'settings', render: renderSettings },
    trash: { label: '回收站', icon: 'trash', render: renderTrash, hiddenInTabbar: true },
};

let current = '';
let pageEl;
let navEl;
let tabEl;

function routeName() {
    const r = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0] || state.prefs.start;
    return ROUTES[r] && (!ROUTES[r].tavernOnly || bridge.host) ? r : 'library';
}

export function go(name) {
    const keep = location.hash.includes('?') ? `?${location.hash.split('?')[1]}` : '';
    location.hash = `#/${name}${keep}`;
}

function buildShell() {
    navEl = h('nav', { class: 'sidebar' });
    tabEl = h('nav', { class: 'tabbar' });
    pageEl = h('main', { class: 'main' });
    const fab = h('button', { class: 'fab', onclick: () => openImporter(), 'aria-label': '添加' }, icon('plus', { size: 24, stroke: 2.2 }));
    clear(app, h('div', { class: 'shell' }, navEl, pageEl), tabEl, fab);
    renderNav();
}

function renderNav() {
    const r = routeName();
    const visible = Object.entries(ROUTES).filter(([, v]) => !v.tavernOnly || bridge.host);
    const counts = { library: live().length, collections: state.collections.length, trash: state.stats.trash || 0 };
    const navItem = ([k, v]) => h('button', { class: `nav-item ${r === k ? 'active' : ''}`, onclick: () => go(k) },
        icon(v.icon, { size: 18 }), h('span', { class: 'nav-label' }, v.label), counts[k] ? h('span', { class: 'nav-count' }, counts[k]) : null);
    clear(navEl,
        h('div', { class: 'brand' },
            h('div', { class: 'brand-mark' }, icon('archive', { size: 20 })),
            h('div', { class: 'brand-text' }, h('b', {}, state.settings.title || '酒馆藏馆'), h('small', {}, 'Tavern Vault'))),
        btn('添加资源', { icon: 'plus', cls: 'primary brand-add', onclick: () => openImporter() }),
        h('div', { class: 'nav-group' }, visible.filter(([k]) => k !== 'trash').map(navItem)),
        h('div', { class: 'nav-sep' }),
        h('div', { class: 'nav-group' }, navItem(['trash', ROUTES.trash])),
        h('div', { class: 'nav-foot' },
            h('span', { class: `dot ${state.online ? 'on' : ''}` }),
            h('span', {}, state.online ? '实时同步中' : '连接中…'),
            bridge.host ? h('span', { class: 'nav-host' }, icon('link', { size: 12 }), bridge.host.host) : null));
    clear(tabEl, visible.filter(([, v]) => !v.hiddenInTabbar).map(([k, v]) => h('button', { class: r === k ? 'active' : '', onclick: () => go(k) },
        h('span', { class: 'tab-ic' }, icon(v.icon, { size: 21 })), h('span', { class: 'tab-label' }, v.label))));
}

function setStatus(online) {
    if (state.online === online) return;
    state.online = online;
    if (navEl) renderNav();
}

function render() {
    const r = routeName();
    if (r !== current) {
        current = r;
        setCollapsed(false);
        lastY = 0;
        state.selecting = false;
        state.selection.clear();
        window.scrollTo(0, 0);
    }
    document.documentElement.dataset.route = r;
    renderNav();
    ROUTES[r].render(pageEl, { go });
}

function showLogin(title) {
    const pw = h('input', { class: 'input', type: 'password', placeholder: '访问密码', autocomplete: 'current-password', onkeydown: (e) => { if (e.key === 'Enter') submit(); } });
    const go2 = btn('进入', { icon: 'chevronRight', cls: 'primary login-btn', onclick: () => submit() });
    async function submit() {
        go2.disabled = true;
        try {
            const { token } = await api.post('/api/login', { password: pw.value });
            api.setToken(token);
            start();
        } catch (e) {
            toast(e.message, 'err');
            go2.disabled = false;
        }
    }
    clear(app, h('div', { class: 'login' }, embedClose(), h('div', { class: 'login-box' },
        h('div', { class: 'login-mark' }, icon('lock', { size: 26, stroke: 1.6 })),
        h('div', { class: 'login-kicker' }, 'Tavern Vault'),
        h('h2', { class: 'login-title' }, title || '酒馆藏馆'),
        h('p', { class: 'login-hint' }, '请输入访问密码'),
        h('div', { class: 'login-field' }, pw, go2))));
    setTimeout(() => pw.focus(), 50);
}

// 在酒馆里打开时：登录页、连不上的页面也要能关掉（全屏时没有插件的标题栏）
const embedClose = () => (bridge.embedded ? h('button', { class: 'btn ghost icon login-close', title: '关闭，回到酒馆', 'aria-label': '关闭', onclick: () => bridge.close() }, icon('x', { size: 19 })) : null);

let started = false;
let hostReady = null;
async function start() {
    // 先和酒馆插件接上、拿到安全区，不用等数据加载完才变成全屏
    if (bridge.embedded && !hostReady) hostReady = bridge.connect().then(fitHost).catch(() => {});
    let health;
    try {
        health = await api.get('/api/health');
    } catch (e) {
        await hostReady;
        clear(app, h('div', { class: 'login' }, embedClose(), emptyState('wifiOff', '无法连接到藏馆服务', e.message, btn('重试', { icon: 'refresh', onclick: start }))));
        return;
    }
    document.title = health.title || '酒馆藏馆';
    if (health.skin) { state.settings.skin = health.skin; applyAccent(); }
    try {
        await reload();
    } catch {
        await hostReady;
        if (health.auth) { showLogin(health.title); return; }
        throw new Error('加载失败');
    }
    await hostReady;
    buildShell();
    if (!started) {
        started = true;
        window.addEventListener('hashchange', render);
        subscribe(render);
        subscribe(renderChip);
        let timer;
        const reloadSoon = () => { clearTimeout(timer); timer = setTimeout(() => reload().catch(() => {}), 150); };
        api.events((ev, data) => {
            if (ev === 'auth') { location.reload(); return; }
            if (ev === 'ai') { handleAiEvent(data); return; }
            if (ev === 'aichat') { handleAiChatEvent(data); return; }
            reloadSoon();
        }, setStatus);
        window.addEventListener('tv:mutated', reloadSoon);
        window.addEventListener('tv:unauthorized', () => showLogin(health.title));
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reload().catch(() => {}); });
        document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
        document.addEventListener('drop', async (e) => {
            if (!e.dataTransfer?.types?.includes('Files') || e.target.closest?.('.drop')) return;
            e.preventDefault();
            const files = await filesFromDrop(e.dataTransfer);
            if (files.length) openImporter(files);
        });
        const m = location.hash.match(/[?&]item=([a-f0-9]+)/);
        if (m && state.byId.has(m[1])) setTimeout(() => openDetail(m[1]), 100);
    }
    render();
    renderChip();
    if (!health.auth && !bridge.embedded) {
        setTimeout(() => toast('尚未设置访问密码，公网部署请到「设置」中设置', 'err'), 600);
    }
}

applyAccent();
start();
