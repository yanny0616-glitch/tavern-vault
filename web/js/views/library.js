// 仓库主页：搜索、类型分段、筛选面板、多选批量操作
import { h, clear, toast, confirmDialog, promptDialog, debounce, downloadBlob, sheet, icon, btn, emptyState, switchEl } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, live, allTags, savePrefs, TYPE_META, reload } from '../state.js';
import { topbar, ensureView, itemCard, itemRow, collectionName } from './common.js';
import { openDetail } from './detail.js';
import { openImporter } from './importer.js';
import { importItemsToTavern } from './tavern.js';
import { startOrganize, aiReady } from './ai.js';
import { findDuplicates, openDuplicates } from './dupes.js';

export const SORTS = {
    updated: ['最近更新', (a, b) => b.updatedAt.localeCompare(a.updatedAt)],
    created: ['最近添加', (a, b) => b.createdAt.localeCompare(a.createdAt)],
    name: ['名称', (a, b) => a.name.localeCompare(b.name, 'zh')],
    rating: ['评分', (a, b) => (b.rating || 0) - (a.rating || 0) || b.updatedAt.localeCompare(a.updatedAt)],
    type: ['类型', (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'zh')],
};

export function filtered() {
    const f = state.filter;
    const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return live().filter((it) => {
        if (f.type !== 'all' && it.type !== f.type) return false;
        if (f.fav && !it.favorite) return false;
        if (f.tag && !it.tags.includes(f.tag)) return false;
        if (f.collection && !it.collections.includes(f.collection)) return false;
        if (f.ai && (f.ai === 'no') === Boolean(it.ai?.at)) return false;
        if (terms.length) {
            const hay = `${it.name}\n${it.description}\n${it.author}\n${it.tags.join(' ')}\n${it.notes}\n${it.searchText}\n${Object.values(it.fields || {}).join(' ')}`.toLowerCase();
            return terms.every((t) => (t.startsWith('#') ? it.tags.some((x) => x.toLowerCase() === t.slice(1)) : hay.includes(t)));
        }
        return true;
    }).sort((state.prefs.groupTime ? SORTS.created : SORTS[state.prefs.sort] || SORTS.updated)[1]);
}

// 按添加时间分组：今天、昨天、7 天内、30 天内，再往前按月
function timeBucket(iso) {
    const d = new Date(iso);
    const now = new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t = d.getTime();
    if (t >= day0) return '今天';
    if (t >= day0 - 864e5) return '昨天';
    if (t >= day0 - 6 * 864e5) return '7 天内';
    if (t >= day0 - 29 * 864e5) return '30 天内';
    return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1} 月` : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

function withTimeGroups(list, make, cls) {
    if (!state.prefs.groupTime) return list.map(make);
    const out = [];
    const counts = new Map();
    for (const it of list) { const b = timeBucket(it.createdAt); counts.set(b, (counts.get(b) || 0) + 1); }
    let last = null;
    list.forEach((it, i) => {
        const b = timeBucket(it.createdAt);
        if (b !== last) { out.push(h('div', { class: `time-group ${cls}` }, h('span', {}, b), h('span', { class: 'time-group-n' }, `${counts.get(b)} 件`))); last = b; }
        out.push(make(it, i));
    });
    return out;
}

const activeFilterCount = () => [state.filter.tag, state.filter.collection, state.filter.fav, state.filter.ai].filter(Boolean).length;

export function renderLibrary(root) {
    const refs = ensureView(root, 'library', () => {
        const search = h('input', {
            class: 'input search-input', type: 'search', placeholder: '搜索名称、标签、作者、内容', value: state.filter.q,
            oninput: debounce(() => { state.filter.q = search.value; renderLibrary(root); }, 160),
        });
        const actions = h('div', { class: 'tb-actions-inner' });
        const head = topbar(state.settings.title || '酒馆藏馆', { kicker: 'Collection', actions: [actions] });
        const sub = h('div', { class: 'tb-sub' });
        head.querySelector('.tb-titles').append(sub);
        const searchWrap = h('label', { class: 'search' }, icon('search', { size: 16 }), search);
        const seg = h('div', { class: 'seg' });
        const activeRow = h('div', { class: 'active-filters' });
        head.append(searchWrap, seg, activeRow);
        const content = h('div', { class: 'lib-content' });
        const notice = h('div', { class: 'lib-notice', hidden: true });
        const selbar = h('div', { class: 'selbar', hidden: true });
        root.append(head, h('div', { class: 'page' }, notice, content), selbar);
        return { seg, content, selbar, search, actions, sub, activeRow, notice };
    });

    const items = live();
    const counts = {};
    for (const it of items) counts[it.type] = (counts[it.type] || 0) + 1;
    const list = filtered();
    const fc = activeFilterCount();

    refs.sub.textContent = `共 ${items.length} 件藏品${list.length !== items.length ? ` · 显示 ${list.length}` : ''}`;

    clear(refs.actions,
        btn('', { icon: state.prefs.view === 'grid' ? 'list' : 'grid', cls: 'ghost', title: '切换视图', onclick: () => { state.prefs.view = state.prefs.view === 'grid' ? 'list' : 'grid'; savePrefs(); renderLibrary(root); } }),
        h('button', { class: `btn ghost icon ${fc ? 'has-dot' : ''}`, title: '筛选与排序', onclick: () => openFilters(root) }, icon('filter', { size: 17 })),
        btn(state.selecting ? '完成' : '', { icon: state.selecting ? null : 'checkSquare', cls: state.selecting ? 'primary sm' : 'ghost', title: '多选', onclick: () => { state.selecting = !state.selecting; state.selection.clear(); renderLibrary(root); } }),
        btn('添加', { icon: 'plus', cls: 'primary desktop-only', onclick: () => openImporter() }));

    // 类型分段
    const segItem = (key, label, n, ic) => h('button', { class: `seg-item ${state.filter.type === key ? 'active' : ''}`, onclick: () => setFilter(root, { type: state.filter.type === key && key !== 'all' ? 'all' : key }) },
        ic ? icon(ic, { size: 14 }) : null, h('span', { class: 'seg-label' }, label), n != null ? h('span', { class: 'seg-n' }, n) : null);
    clear(refs.seg,
        segItem('all', '全部', items.length),
        Object.entries(TYPE_META).filter(([k]) => counts[k]).map(([k, v]) => segItem(k, v.label, counts[k], v.icon)));

    // 已生效的筛选
    const pills = [];
    if (state.filter.fav) pills.push(['收藏', () => setFilter(root, { fav: false })]);
    if (state.filter.tag) pills.push([`标签：${state.filter.tag}`, () => setFilter(root, { tag: '' })]);
    if (state.filter.ai) pills.push([state.filter.ai === 'no' ? 'AI 未整理' : 'AI 已整理', () => setFilter(root, { ai: '' })]);
    if (state.filter.collection) pills.push([`合集：${collectionName(state.filter.collection)}`, () => setFilter(root, { collection: '' })]);
    clear(refs.activeRow, pills.map(([label, off]) => h('button', { class: 'pill', onclick: off }, h('span', {}, label), icon('x', { size: 12 }))));
    refs.activeRow.hidden = !pills.length;

    renderDupNotice(refs.notice, fc || state.filter.q || state.filter.type !== 'all' || state.selecting);

    if (!items.length) {
        clear(refs.content, emptyState('archive', '仓库还是空的', '上传角色卡、世界书、预设、正则、脚本、主题等文件，类型会自动识别。', btn('添加第一件藏品', { icon: 'plus', cls: 'primary', onclick: () => openImporter() })));
    } else if (!list.length) {
        clear(refs.content, emptyState('search', '没有符合条件的内容', '换个关键词，或清除筛选条件', btn('清除筛选', { icon: 'x', onclick: () => { refs.search.value = ''; setFilter(root, { q: '', type: 'all', tag: '', collection: '', fav: false, ai: '' }); } })));
    } else {
        const click = (it) => (e) => {
            if (state.selecting) {
                state.selection.has(it.id) ? state.selection.delete(it.id) : state.selection.add(it.id);
                // 多选时只改这一张的选中样式和底部操作栏，不重画整页
                const el = e?.currentTarget;
                const on = state.selection.has(it.id);
                if (!el) { renderLibrary(root); return; }
                el.classList.toggle('selected', on);
                el.querySelector('.row-check')?.classList.toggle('on', on);
                renderSelbar(refs.selbar, list, root);
            } else openDetail(it.id);
        };
        const LIMIT = 300;
        const shown = list.slice(0, refs.limit || LIMIT);
        const container = state.prefs.view === 'grid'
            ? h('div', { class: `grid ${state.prefs.dense ? 'dense' : ''} ${state.prefs.cols ? `fixed-cols c${state.prefs.cols}` : ''}`, style: { '--cols': state.prefs.cols || null } }, withTimeGroups(shown, (it, i) => itemCard(it, { onClick: click(it), selected: state.selection.has(it.id), selecting: state.selecting, index: i }), 'in-grid'))
            : h('div', { class: 'rows' }, withTimeGroups(shown, (it, i) => itemRow(it, { cache: true, onClick: click(it), selected: state.selection.has(it.id), index: i,
                right: state.selecting ? h('span', { class: `row-check ${state.selection.has(it.id) ? 'on' : ''}` }, icon('check', { size: 13, stroke: 3 })) : null }), 'in-rows'));
        clear(refs.content, container,
            list.length > shown.length ? h('div', { class: 'more' }, btn(`显示更多（剩余 ${list.length - shown.length}）`, { onclick: () => { refs.limit = (refs.limit || LIMIT) + LIMIT; renderLibrary(root); } })) : null);
    }
    renderSelbar(refs.selbar, list, root);
}

// 有可能重复的条目时，在列表上方提示一次；关掉后，直到出现新的重复组才再提示
let dupMemo = { items: null, ignore: '', groups: [] };
function renderDupNotice(el, busy) {
    const ignore = (state.settings.dupIgnore || []).join('|');
    if (dupMemo.items !== state.items || dupMemo.ignore !== ignore) dupMemo = { items: state.items, ignore, groups: findDuplicates() };
    const sig = dupMemo.groups.map((g) => g.key).join('|');
    el.hidden = busy || !dupMemo.groups.length || state.prefs.dupSeen === sig;
    if (el.hidden) return;
    clear(el, icon('layers', { size: 15 }),
        h('span', { class: 'grow' }, `发现 ${dupMemo.groups.length} 组可能重复的条目`),
        btn('查看', { cls: 'sm', onclick: () => openDuplicates() }),
        btn('', { icon: 'x', cls: 'sm ghost', title: '不再提示这些', onclick: () => { state.prefs.dupSeen = sig; savePrefs(); el.hidden = true; } }));
}

function setFilter(root, patch) {
    Object.assign(state.filter, patch);
    if (root._refs) root._refs.limit = 0;
    renderLibrary(root);
}

function openFilters(root) {
    const s = sheet({ title: '筛选与排序', body: h('div') });
    const draw = () => {
        const opt = (active, label, onclick, ic) => h('button', { class: `opt ${active ? 'active' : ''}`, onclick: () => { onclick(); draw(); renderLibrary(root); } }, ic ? icon(ic, { size: 14 }) : null, label);
        const tags = allTags();
        clear(s.body,
            h('div', { class: 'form-group' }, h('div', { class: 'form-label' }, '排序'),
                h('div', { class: 'opts' }, Object.entries(SORTS).map(([k, [label]]) => opt(!state.prefs.groupTime && state.prefs.sort === k, label, () => { state.prefs.sort = k; state.prefs.groupTime = false; savePrefs(); })),
                    opt(state.prefs.groupTime, '按添加时间分组', () => { state.prefs.groupTime = !state.prefs.groupTime; savePrefs(); }, 'clock')),
                state.prefs.groupTime ? h('div', { class: 'muted small' }, '最近添加的在前，分成今天、昨天、7 天内、30 天内，更早的按月份。') : null),
            h('div', { class: 'form-group' }, h('div', { class: 'form-label' }, '显示'),
                h('div', { class: 'opts' },
                    opt(state.prefs.view === 'grid' && !state.prefs.dense, '卡片', () => { state.prefs.view = 'grid'; state.prefs.dense = false; savePrefs(); }, 'grid'),
                    opt(state.prefs.view === 'grid' && state.prefs.dense, '紧凑', () => { state.prefs.view = 'grid'; state.prefs.dense = true; savePrefs(); }, 'grid3'),
                    opt(state.prefs.view === 'list', '列表', () => { state.prefs.view = 'list'; savePrefs(); }, 'list'))),
            state.prefs.view === 'grid' ? h('div', { class: 'form-group' }, h('div', { class: 'form-label' }, '每行显示'),
                h('div', { class: 'opts' }, [0, 1, 2, 3, 4, 5, 6].map((n) => opt((state.prefs.cols || 0) === n, n ? `${n} 个` : '自动', () => { state.prefs.cols = n; savePrefs(); }))),
                h('div', { class: 'muted small' }, '只对这台设备生效。手机和电脑可以分别设置。')) : null,
            aiReady() || live().some((i) => i.ai?.at) ? h('div', { class: 'form-group' }, h('div', { class: 'form-label' }, 'AI 整理'),
                h('div', { class: 'opts' }, [['', '全部'], ['no', '未整理'], ['yes', '已整理']].map(([v, l]) => opt((state.filter.ai || '') === v, l, () => { state.filter.ai = v; })))) : null,
            h('div', { class: 'form-group row-between' }, h('div', { class: 'form-label' }, '只看收藏'), switchEl(state.filter.fav, (v) => { state.filter.fav = v; renderLibrary(root); })),
            state.collections.length ? h('div', { class: 'form-group' }, h('div', { class: 'form-label' }, '合集'),
                h('div', { class: 'opts' }, opt(!state.filter.collection, '全部', () => { state.filter.collection = ''; }),
                    state.collections.map((c) => opt(state.filter.collection === c.id, c.name, () => { state.filter.collection = c.id; }, c.icon)))) : null,
            tags.length ? h('div', { class: 'form-group' }, h('div', { class: 'form-label' }, '标签'),
                h('div', { class: 'opts' }, opt(!state.filter.tag, '全部', () => { state.filter.tag = ''; }),
                    tags.slice(0, 80).map(([t, n]) => opt(state.filter.tag === t, `${t}  ${n}`, () => { state.filter.tag = t; })))) : null);
    };
    draw();
    s.foot = h('div', { class: 'sheet-foot' },
        btn('重置', { onclick: () => { Object.assign(state.filter, { tag: '', collection: '', fav: false, ai: '' }); state.prefs.sort = 'updated'; state.prefs.groupTime = false; savePrefs(); draw(); renderLibrary(root); } }),
        btn('完成', { cls: 'primary', onclick: () => s.close() }));
    s.el.append(s.foot);
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
    const act = (ic, label, onclick, cls = '') => h('button', { class: `sel-act ${cls}`, disabled: !n, onclick }, icon(ic, { size: 18 }), h('span', {}, label));
    clear(bar,
        h('div', { class: 'sel-top' },
            h('span', { class: 'sel-count' }, `已选 ${n} 项`),
            h('button', { class: 'btn sm ghost', onclick: () => { if (n === list.length) state.selection.clear(); else list.forEach((i) => state.selection.add(i.id)); renderLibrary(root); } }, n === list.length ? '取消全选' : '全选')),
        h('div', { class: 'sel-acts' },
            act('tag', '标签', async () => {
                const v = await promptDialog('多个标签用逗号分隔', { title: '添加标签' });
                if (v) await run('addTags', v.split(/[,，]/).map((s) => s.trim()).filter(Boolean), '已添加标签');
            }),
            act('layers', '合集', () => pickCollection(async (cid) => run('addCollection', cid, '已加入合集'))),
            act('star', '收藏', () => run('favorite', true, '已收藏')),
            aiReady() ? act('sparkles', 'AI 整理', () => startOrganize(ids)) : null,
            act('download', '导出', async () => downloadBlob(await api.req('POST', '/api/export', { ids }, { blob: true }), `TavernVault-${n}项.zip`)),
            bridge.host ? act('beer', '入酒馆', () => importItemsToTavern(ids.map((id) => state.byId.get(id)))) : null,
            act('trash', '删除', async () => {
                if (await confirmDialog(`将 ${n} 项移入回收站？`, { danger: true, ok: '删除' })) { await run('delete', null, '已移入回收站'); state.selection.clear(); }
            }, 'danger')));
}

export function pickCollection(onPick) {
    const s = sheet({
        title: '选择合集',
        body: h('div', { class: 'rows' },
            state.collections.map((c) => h('div', { class: 'row-item', onclick: () => { s.close(); onPick(c.id); } },
                h('div', { class: 'row-thumb', style: { color: c.color || '' } }, icon(c.icon, { size: 20 })), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.name)))),
            h('div', { class: 'row-item', onclick: async () => {
                const name = await promptDialog('', { title: '新建合集', placeholder: '合集名称' });
                if (!name) return;
                const c = await api.post('/api/collections', { name });
                await reload();
                s.close();
                onPick(c.id);
            } }, h('div', { class: 'row-thumb' }, icon('plus', { size: 20 })), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, '新建合集')))),
    });
}
