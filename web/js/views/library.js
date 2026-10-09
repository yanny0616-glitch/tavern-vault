// 仓库主页：搜索、筛选、排序、多选批量操作
import { h, clear, toast, confirmDialog, promptDialog, debounce, downloadBlob, sheet } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, live, allTags, savePrefs, TYPE_META, typeMeta, reload } from '../state.js';
import { topbar, ensureView, itemCard, itemRow } from './common.js';
import { openDetail } from './detail.js';
import { openImporter } from './importer.js';
import { importItemsToTavern } from './tavern.js';

const SORTS = {
    updated: ['最近更新', (a, b) => b.updatedAt.localeCompare(a.updatedAt)],
    created: ['最近添加', (a, b) => b.createdAt.localeCompare(a.createdAt)],
    name: ['名称', (a, b) => a.name.localeCompare(b.name, 'zh')],
    rating: ['评分', (a, b) => (b.rating || 0) - (a.rating || 0) || b.updatedAt.localeCompare(a.updatedAt)],
    type: ['类型', (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'zh')],
};

export function filtered() {
    const f = state.filter;
    const q = f.q.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    let list = live().filter((it) => {
        if (f.type !== 'all' && it.type !== f.type) return false;
        if (f.fav && !it.favorite) return false;
        if (f.tag && !it.tags.includes(f.tag)) return false;
        if (f.collection && !it.collections.includes(f.collection)) return false;
        if (terms.length) {
            const hay = `${it.name}\n${it.description}\n${it.author}\n${it.tags.join(' ')}\n${it.notes}\n${it.searchText}\n${Object.values(it.fields || {}).join(' ')}`.toLowerCase();
            return terms.every((t) => (t.startsWith('#') ? it.tags.some((x) => x.toLowerCase() === t.slice(1)) : hay.includes(t)));
        }
        return true;
    });
    list = list.sort((SORTS[state.prefs.sort] || SORTS.updated)[1]);
    return list;
}

export function renderLibrary(root) {
    const refs = ensureView(root, 'library', () => {
        const search = h('input', {
            class: 'input', type: 'search', placeholder: '搜索名称、标签、作者、内容…（#标签）', value: state.filter.q,
            oninput: debounce(() => { state.filter.q = search.value; renderLibrary(root); }, 180),
        });
        const head = topbar(state.settings.title || '酒馆藏馆',
            h('div', { class: 'search desktop-only' }, search),
            h('button', { class: 'btn desktop-only', onclick: () => openImporter() }, '＋ 添加'));
        const mobileSearch = h('div', { class: 'search mobile-only', style: { marginTop: '10px', maxWidth: 'none' } });
        // 移动端搜索框与桌面共用同一个 input 实例
        const mq = matchMedia('(max-width: 899px)');
        const place = () => (mq.matches ? mobileSearch : head.querySelector('.search.desktop-only')).append(search);
        mq.addEventListener?.('change', place);
        head.append(mobileSearch);
        const chips = h('div', { class: 'chips' });
        head.append(chips);
        place();
        const toolbar = h('div', { class: 'toolbar' });
        const content = h('div');
        const selbar = h('div', { class: 'selbar', hidden: true });
        root.append(head, h('div', { class: 'page' }, toolbar, content), selbar);
        return { chips, toolbar, content, selbar, search };
    });

    const items = live();
    const counts = {};
    for (const it of items) counts[it.type] = (counts[it.type] || 0) + 1;

    // 类型筛选
    clear(refs.chips,
        h('button', { class: `chip ${state.filter.type === 'all' ? 'active' : ''}`, onclick: () => setFilter({ type: 'all' }) }, '全部', h('span', { class: 'n' }, items.length)),
        h('button', { class: `chip ${state.filter.fav ? 'active' : ''}`, onclick: () => setFilter({ fav: !state.filter.fav }) }, '⭐ 收藏'),
        Object.entries(TYPE_META).filter(([k]) => counts[k]).map(([k, v]) =>
            h('button', { class: `chip ${state.filter.type === k ? 'active' : ''}`, onclick: () => setFilter({ type: state.filter.type === k ? 'all' : k }) },
                v.icon, v.label, h('span', { class: 'n' }, counts[k]))));

    // 工具栏
    const tags = allTags();
    const tagSel = h('select', { class: 'select', style: { width: 'auto', height: '32px', fontSize: '13px' }, onchange: () => setFilter({ tag: tagSel.value }) },
        h('option', { value: '' }, '🏷️ 全部标签'), tags.map(([t, n]) => h('option', { value: t, selected: state.filter.tag === t }, `${t} (${n})`)));
    const colSel = h('select', { class: 'select', style: { width: 'auto', height: '32px', fontSize: '13px' }, onchange: () => setFilter({ collection: colSel.value }) },
        h('option', { value: '' }, '📚 全部合集'), state.collections.map((c) => h('option', { value: c.id, selected: state.filter.collection === c.id }, `${c.icon} ${c.name}`)));
    const sortSel = h('select', { class: 'select', style: { width: 'auto', height: '32px', fontSize: '13px' }, onchange: () => { state.prefs.sort = sortSel.value; savePrefs(); renderLibrary(root); } },
        Object.entries(SORTS).map(([k, [label]]) => h('option', { value: k, selected: state.prefs.sort === k }, `↕ ${label}`)));
    const list = filtered();
    clear(refs.toolbar,
        tags.length ? tagSel : null,
        state.collections.length ? colSel : null,
        sortSel,
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted small' }, `${list.length} 项`),
        h('button', { class: 'btn sm icon', title: '切换视图', onclick: () => { state.prefs.view = state.prefs.view === 'grid' ? 'list' : 'grid'; savePrefs(); renderLibrary(root); } }, state.prefs.view === 'grid' ? '☰' : '▦'),
        state.prefs.view === 'grid' ? h('button', { class: 'btn sm icon', title: '密度', onclick: () => { state.prefs.dense = !state.prefs.dense; savePrefs(); renderLibrary(root); } }, state.prefs.dense ? '◻' : '▪') : null,
        h('button', { class: `btn sm ${state.selecting ? 'primary' : ''}`, onclick: () => { state.selecting = !state.selecting; state.selection.clear(); renderLibrary(root); } }, state.selecting ? '完成' : '多选'));

    // 内容
    if (!items.length) {
        clear(refs.content, h('div', { class: 'empty' }, h('div', { class: 'big' }, '📦'),
            h('div', { style: { fontSize: '17px', fontWeight: 600, color: 'var(--text)' } }, '仓库还是空的'),
            h('p', {}, '上传角色卡 PNG / JSON、世界书、预设、正则、脚本、主题……都会自动识别。', bridge.host ? '也可以去「酒馆」页把酒馆里已有的内容一键收藏进来。' : ''),
            h('button', { class: 'btn primary', onclick: () => openImporter() }, '＋ 添加第一个资源')));
    } else if (!list.length) {
        clear(refs.content, h('div', { class: 'empty' }, h('div', { class: 'big' }, '🔍'), '没有符合条件的内容',
            h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => { refs.search.value = ''; setFilter({ q: '', type: 'all', tag: '', collection: '', fav: false }); } }, '清除筛选'))));
    } else {
        const click = (it) => () => {
            if (state.selecting) {
                state.selection.has(it.id) ? state.selection.delete(it.id) : state.selection.add(it.id);
                renderLibrary(root);
            } else openDetail(it.id);
        };
        const LIMIT = 400; // 防止一次渲染过多
        const shown = list.slice(0, refs.limit || LIMIT);
        const container = state.prefs.view === 'grid'
            ? h('div', { class: `grid ${state.prefs.dense ? 'dense' : ''}` }, shown.map((it) => itemCard(it, { onClick: click(it), selected: state.selection.has(it.id), selecting: state.selecting })))
            : h('div', { class: 'list' }, shown.map((it) => itemRow(it, { onClick: click(it), selected: state.selection.has(it.id) })));
        clear(refs.content, container,
            list.length > shown.length ? h('div', { style: { textAlign: 'center', margin: '20px' } },
                h('button', { class: 'btn', onclick: () => { refs.limit = (refs.limit || LIMIT) + LIMIT; renderLibrary(root); } }, `显示更多（剩余 ${list.length - shown.length}）`)) : null);
    }

    renderSelbar(refs.selbar, list, root);
}

function setFilter(patch) {
    Object.assign(state.filter, patch);
    const root = document.querySelector('main.main');
    root._refs.limit = 0;
    renderLibrary(root);
}

function renderSelbar(bar, list, root) {
    bar.hidden = !state.selecting;
    if (!state.selecting) return;
    const ids = [...state.selection];
    const n = ids.length;
    const run = async (action, value, msg) => {
        if (!n) return;
        await api.post('/api/batch', { ids, action, value });
        toast(msg || '已完成', 'ok');
    };
    clear(bar,
        h('span', { class: 'count' }, `已选 ${n}`),
        h('button', { class: 'btn sm', onclick: () => { if (n === list.length) state.selection.clear(); else list.forEach((i) => state.selection.add(i.id)); renderLibrary(root); } }, n === list.length ? '取消全选' : '全选'),
        h('button', { class: 'btn sm', disabled: !n, onclick: async () => {
            const v = await promptDialog('多个标签用逗号分隔', { title: '添加标签' });
            if (v) await run('addTags', v.split(/[,，]/).map((s) => s.trim()).filter(Boolean), '已添加标签');
        } }, '🏷️ 标签'),
        h('button', { class: 'btn sm', disabled: !n, onclick: () => pickCollection(async (cid) => run('addCollection', cid, '已加入合集')) }, '📚 合集'),
        h('button', { class: 'btn sm', disabled: !n, onclick: () => run('favorite', true, '已收藏') }, '⭐'),
        h('button', { class: 'btn sm', disabled: !n, onclick: async () => {
            const blob = await api.req('POST', '/api/export', { ids }, { blob: true });
            downloadBlob(blob, `TavernVault-${n}项.zip`);
        } }, '⬇️ 导出'),
        bridge.host ? h('button', { class: 'btn sm', disabled: !n, onclick: () => importItemsToTavern(ids.map((id) => state.byId.get(id))) }, '🍺 导入酒馆') : null,
        h('button', { class: 'btn sm danger', disabled: !n, onclick: async () => {
            if (await confirmDialog(`将 ${n} 项移入回收站？`, { danger: true, ok: '删除' })) { await run('delete', null, '已移入回收站'); state.selection.clear(); }
        } }, '🗑️'));
}

export function pickCollection(onPick) {
    const s = sheet({
        title: '选择合集',
        body: h('div', { class: 'list' },
            state.collections.map((c) => h('div', { class: 'list-row', onclick: () => { s.close(); onPick(c.id); } }, h('div', { class: 'thumb' }, c.icon), h('div', { class: 'title grow' }, c.name))),
            h('div', { class: 'list-row', onclick: async () => {
                const name = await promptDialog('', { title: '新建合集', placeholder: '合集名称' });
                if (!name) return;
                const c = await api.post('/api/collections', { name });
                await reload();
                s.close();
                onPick(c.id);
            } }, h('div', { class: 'thumb' }, '＋'), h('div', { class: 'title' }, '新建合集'))),
    });
}
