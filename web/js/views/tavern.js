// 酒馆联通页：浏览酒馆本地内容、收藏进仓库；以及把仓库条目导入酒馆
import { h, clear, toast, sheet, icon, btn, emptyState } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, findByName, typeMeta, reload } from '../state.js';
import { topbar, ensureView } from './common.js';
import { openDetail } from './detail.js';

const KINDS = [
    ['character', '角色卡'],
    ['worldbook', '世界书'],
    ['preset', '预设'],
    ['regex', '正则'],
    ['quickreply', '快速回复'],
    ['theme', '主题'],
    ['background', '背景'],
];
export const TAVERN_IMPORTABLE = new Set(KINDS.map(([k]) => k));

const ui = { kind: 'character', lists: {}, loading: false, selected: new Set(), q: '', onlyNew: false };
const thumbCache = new Map();

// 酒馆数据变化时，下次进入酒馆页重新读取
bridge.on((event) => {
    if (event !== 'tavern-changed') return;
    ui.lists = {};
    const root = document.querySelector('main.main');
    if (root?.dataset.view === 'tavern' && !ui.loading) renderTavern(root);
});

export function renderTavern(root) {
    const refs = ensureView(root, 'tavern', () => {
        const seg = h('div', { class: 'seg' });
        const actions = h('div', { class: 'tb-actions-inner' });
        const head = topbar('酒馆', { kicker: bridge.host ? `Connected · ${bridge.host.host}` : 'Tavern', sub: '浏览酒馆里的内容，收藏进仓库', actions: [actions] });
        const searchInput = h('input', { class: 'input search-input', type: 'search', placeholder: '筛选', oninput: (e) => { ui.q = e.target.value; renderTavern(root); } });
        head.append(h('label', { class: 'search' }, icon('search', { size: 16 }), searchInput), seg);
        const toolbar = h('div', { class: 'toolbar-row' });
        const content = h('div');
        const selbar = h('div', { class: 'selbar', hidden: true });
        root.append(head, h('div', { class: 'page' }, toolbar, content), selbar);
        clear(actions, btn('', { icon: 'refresh', cls: 'ghost', title: '重新读取', onclick: () => refresh(true) }));
        return { seg, toolbar, content, selbar };
    });
    if (!bridge.host) {
        clear(refs.content, emptyState('beer', '未连接酒馆', '这个页面需要在酒馆插件里打开'));
        return;
    }
    clear(refs.seg, KINDS.map(([k, label]) => h('button', { class: `seg-item ${ui.kind === k ? 'active' : ''}`, onclick: () => { ui.kind = k; ui.selected.clear(); refresh(); } },
        icon(typeMeta(k).icon, { size: 14 }), h('span', { class: 'seg-label' }, label), ui.lists[k] ? h('span', { class: 'seg-n' }, ui.lists[k].length) : null)));

    const list = ui.lists[ui.kind];
    if (!list) {
        if (!ui.loading) refresh();
        clear(refs.content, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, '正在读取酒馆数据')));
        clear(refs.toolbar);
        refs.selbar.hidden = true;
        return;
    }

    const q = ui.q.toLowerCase();
    const rows = list.filter((x) => (!q || `${x.name} ${x.sub || ''}`.toLowerCase().includes(q)) && (!ui.onlyNew || !findByName(ui.kind, x.name)));
    const newCount = list.filter((x) => !findByName(ui.kind, x.name)).length;
    clear(refs.toolbar,
        h('button', { class: `pill ${ui.onlyNew ? 'active' : ''}`, onclick: () => { ui.onlyNew = !ui.onlyNew; renderTavern(root); } }, h('span', {}, `只看未收藏 · ${newCount}`)),
        h('span', { class: 'grow' }),
        btn('全选', { cls: 'sm ghost', onclick: () => { const all = rows.every((r) => ui.selected.has(r.id)); rows.forEach((r) => (all ? ui.selected.delete(r.id) : ui.selected.add(r.id))); renderTavern(root); } }));

    if (!rows.length) {
        clear(refs.content, emptyState(typeMeta(ui.kind).icon, list.length ? '没有符合条件的内容' : '酒馆里还没有这类内容'));
    } else {
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); loadThumb(e.target); }
        }, { rootMargin: '200px' });
        const toggle = (r) => { ui.selected.has(r.id) ? ui.selected.delete(r.id) : ui.selected.add(r.id); renderTavern(root); };
        clear(refs.content, h('div', { class: 'rows' }, rows.map((r) => {
            const inVault = findByName(ui.kind, r.name);
            const sel = ui.selected.has(r.id);
            const thumb = h('div', { class: 'row-thumb', dataset: { kind: ui.kind, id: r.id } }, icon(typeMeta(ui.kind).icon, { size: 20 }));
            if (r.thumb) io.observe(thumb);
            return h('div', { class: `row-item ${sel ? 'selected' : ''}`, style: { '--tc': typeMeta(ui.kind).color }, onclick: () => toggle(r) },
                h('span', { class: `row-check ${sel ? 'on' : ''}` }, icon('check', { size: 13, stroke: 3 })),
                thumb,
                h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('span', {}, r.name)), r.sub ? h('div', { class: 'row-sub' }, h('span', {}, r.sub)) : null),
                inVault
                    ? h('button', { class: 'chip-s ok as-btn', title: '在仓库中查看', onclick: (e) => { e.stopPropagation(); openDetail(inVault.id); } }, icon('check', { size: 11, stroke: 3 }), '已收藏')
                    : btn('收藏', { icon: 'download', cls: 'sm', onclick: (e) => { e.stopPropagation(); collect([r]); } }));
        })));
    }

    const n = ui.selected.size;
    refs.selbar.hidden = !n;
    if (n) {
        clear(refs.selbar, h('div', { class: 'sel-top' }, h('span', { class: 'sel-count' }, `已选 ${n} 项`),
            h('span', { class: 'grow' }),
            btn('取消', { cls: 'sm ghost', onclick: () => { ui.selected.clear(); renderTavern(root); } }),
            btn('收藏到仓库', { icon: 'download', cls: 'sm primary', onclick: () => collect(list.filter((r) => ui.selected.has(r.id))) })));
    }
}

async function refresh(force = false) {
    const kind = ui.kind;
    if (force) { ui.lists = {}; thumbCache.clear(); }
    ui.loading = true;
    try {
        ui.lists[kind] = await bridge.call('list', { kind });
    } catch (e) {
        ui.lists[kind] = [];
        toast(`读取失败：${e.message}`, 'err');
    }
    ui.loading = false;
    rerender();
}

function rerender() {
    const root = document.querySelector('main.main');
    if (root?.dataset.view === 'tavern') renderTavern(root);
}

async function loadThumb(el) {
    const key = `${el.dataset.kind}:${el.dataset.id}`;
    try {
        let url = thumbCache.get(key);
        if (!url) {
            const r = await bridge.call('thumb', { kind: el.dataset.kind, id: el.dataset.id }, [], 30000);
            if (!r?.data) return;
            url = URL.createObjectURL(new Blob([r.data], { type: r.mime || 'image/png' }));
            thumbCache.set(key, url);
        }
        clear(el, h('img', { src: url, alt: '' }));
    } catch { /* 忽略缩略图失败 */ }
}

/** 从酒馆导出并上传到仓库 */
async function collect(rows) {
    const kind = ui.kind;
    const prog = progressSheet(`收藏到仓库（${rows.length}）`);
    let ok = 0;
    let dup = 0;
    let fail = 0;
    for (const [i, r] of rows.entries()) {
        prog.update(i, rows.length, r.name);
        try {
            const exp = await bridge.call('export', { kind, id: r.id });
            const res = await api.upload(new Blob([exp.data]), { filename: exp.filename, origin: 'tavern', type: kind === 'background' ? 'background' : '' });
            if (res.duplicate) dup++; else ok++;
        } catch (e) {
            fail++;
            prog.log(`${r.name}：${e.message}`, 'err');
        }
    }
    prog.done(`完成：新增 ${ok}，已存在 ${dup}${fail ? `，失败 ${fail}` : ''}`);
    ui.selected.clear();
    await reload();
}

/** 把仓库条目导入酒馆 */
export async function importItemsToTavern(items) {
    if (!bridge.host) { toast('未连接酒馆', 'err'); return; }
    const supported = items.filter((it) => TAVERN_IMPORTABLE.has(it.type) && it.files.length);
    const skipped = items.length - supported.length;
    if (!supported.length) { toast('所选内容不支持直接导入酒馆（支持：角色卡、世界书、预设、正则、快速回复、主题、背景）', 'err'); return; }
    const prog = progressSheet(`导入到酒馆（${supported.length}）`);
    let ok = 0;
    for (const [i, it] of supported.entries()) {
        prog.update(i, supported.length, it.name);
        try {
            const f = it.files.find((x) => x.primary) || it.files[0];
            const blob = await api.fetchFile(f.sha);
            const data = await blob.arrayBuffer();
            const res = await bridge.call('import', { kind: it.type, filename: f.name, name: it.name, apiId: it.meta?.apiId || '', data }, [data]);
            ok++;
            if (res?.message) prog.log(`${it.name}：${res.message}`, 'ok');
        } catch (e) {
            prog.log(`${it.name}：${e.message}`, 'err');
        }
    }
    prog.done(`已导入 ${ok}/${supported.length}${skipped ? `，${skipped} 项不支持已跳过` : ''}`);
    ui.lists = {};
}

function progressSheet(title) {
    const bar = h('i', { style: { width: '0%' } });
    const label = h('div', { class: 'progress-label' }, '准备中');
    const log = h('div', { class: 'progress-log' });
    const s = sheet({ title, body: h('div', { class: 'stack-s' }, h('div', { class: 'progress' }, bar), label, log) });
    return {
        update(i, n, name) { bar.style.width = `${(i / n) * 100}%`; label.textContent = `${i + 1} / ${n} · ${name}`; },
        log(msg, kind = '') { log.append(h('div', { class: `log-line ${kind}` }, icon(kind === 'err' ? 'xCircle' : 'checkCircle', { size: 14 }), h('span', {}, msg))); },
        done(msg) {
            bar.style.width = '100%';
            label.textContent = msg;
            toast(msg, 'ok');
            if (!log.childElementCount) setTimeout(() => s.close(), 900);
        },
    };
}
