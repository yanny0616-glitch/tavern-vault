// 仓库主页：搜索、类型分段、筛选面板、多选批量操作
import { h, clear, toast, confirmDialog, promptDialog, debounce, downloadBlob, sheet, icon, btn, emptyState, switchEl } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, live, allTags, savePrefs, TYPE_META, reload } from '../state.js';
import { topbar, ensureView, itemCard, itemRow, collectionName, applyHit } from './common.js';
import { openDetail } from './detail.js';
import { openImporter } from './importer.js';
import { importItemsToTavern } from './tavern.js';
import { startOrganize, aiReady } from './ai.js';
import { findDuplicates, openDuplicates } from './dupes.js';
import { openDiff } from './diff.js';

export const SORTS = {
    updated: ['最近更新', (a, b) => b.updatedAt.localeCompare(a.updatedAt)],
    created: ['最近添加', (a, b) => b.createdAt.localeCompare(a.createdAt)],
    name: ['名称', (a, b) => a.name.localeCompare(b.name, 'zh')],
    rating: ['评分', (a, b) => (b.rating || 0) - (a.rating || 0) || b.updatedAt.localeCompare(a.updatedAt)],
    type: ['类型', (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'zh')],
};

/** 搜索词：空格分隔都要满足；#标签、-#标签（不要这个标签）、-词（不能出现） */
export function parseQuery(q) {
    const words = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = { tags: [], notTags: [], pos: [], neg: [], text: '' };
    for (const w of words) {
        if (w.startsWith('-#') && w.length > 2) out.notTags.push(w.slice(2));
        else if (w.startsWith('#') && w.length > 1) out.tags.push(w.slice(1));
        else if (w.startsWith('-') && w.length > 1) out.neg.push(w.slice(1));
        else if (w !== '-') out.pos.push(w);
    }
    out.text = [...out.pos, ...out.neg.map((w) => `-${w}`)].join(' ');
    return out;
}

// 全文搜索的结果（服务端按文件内容搜）；列表变了或搜索词变了就作废
export const deep = { text: '', items: null, hits: null, pending: '' };
const deepReady = (text) => deep.hits && deep.text === text && deep.items === state.items;

// 快捷筛选
const versionCount = (it) => it.files.filter((x) => x.primary || x.sig).length;
export const QUICK = {
    untagged: ['未打标签', (it) => !it.tags.length],
    unsorted: ['未整理', (it) => !it.tags.length && !it.notes && !it.rating && !it.favorite && !it.collections.length],
    multi: ['多个版本', (it) => versionCount(it) > 1],
};

export function filtered() {
    const f = state.filter;
    const pq = parseQuery(f.q);
    const useDeep = pq.text && deepReady(pq.text);
    return live().filter((it) => {
        if (f.type !== 'all' && it.type !== f.type) return false;
        if (f.fav && !it.favorite) return false;
        if (f.tagsIn.length && !f.tagsIn.every((t) => it.tags.includes(t))) return false;
        if (f.tagsOut.length && f.tagsOut.some((t) => it.tags.includes(t))) return false;
        if (f.quick.length && !f.quick.every((k) => QUICK[k]?.[1](it))) return false;
        if (f.collection && !it.collections.includes(f.collection)) return false;
        if (f.ai && (f.ai === 'no') === Boolean(it.ai?.at)) return false;
        const tags = it.tags.map((x) => x.toLowerCase());
        if (!pq.tags.every((t) => tags.includes(t)) || pq.notTags.some((t) => tags.includes(t))) return false;
        if (!pq.text) return true;
        if (useDeep) return Boolean(deep.hits[it.id]);
        // 全文结果回来之前先按列表里已有的资料搜
        const hay = `${it.name}\n${it.description}\n${it.author}\n${it.tags.join(' ')}\n${it.notes}\n${it.searchText}\n${Object.values(it.fields || {}).join(' ')}`.toLowerCase();
        return pq.pos.every((t) => hay.includes(t)) && !pq.neg.some((t) => hay.includes(t));
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

const activeFilterCount = () => state.filter.tagsIn.length + state.filter.tagsOut.length + state.filter.quick.length + [state.filter.collection, state.filter.fav, state.filter.ai].filter(Boolean).length;
const CLEAR_FILTERS = () => ({ tagsIn: [], tagsOut: [], quick: [], collection: '', fav: false, ai: '' });

export function renderLibrary(root) {
    const refs = ensureView(root, 'library', () => {
        const search = h('input', {
            class: 'input search-input', type: 'search', placeholder: '搜索名称、开场白、世界书等全部内容', value: state.filter.q,
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
        const health = h('div', { class: 'lib-notice warn', hidden: true });
        const selbar = h('div', { class: 'selbar', hidden: true });
        root.append(head, h('div', { class: 'page' }, health, notice, content), selbar);
        const r = { seg, content, selbar, search, actions, sub, activeRow, notice, health };
        bindSelectGestures(r, root);
        return r;
    });

    const items = live();
    const pq = parseQuery(state.filter.q);
    if (pq.text && !deepReady(pq.text) && deep.pending !== `${pq.text}|${state.items.length}`) {
        const key = `${pq.text}|${state.items.length}`;
        const items0 = state.items;
        deep.pending = key;
        api.get(`/api/search?q=${encodeURIComponent(pq.text)}`).then((r) => {
            if (deep.pending !== key) return;
            Object.assign(deep, { text: pq.text, items: items0, hits: r.hits || {}, pending: '' });
            if (parseQuery(state.filter.q).text === pq.text && state.items === items0) renderLibrary(root);
        }).catch(() => { if (deep.pending === key) deep.pending = ''; });
    }
    const hitOf = (it) => (pq.pos.length ? { terms: pq.pos, ...(deepReady(pq.text) ? deep.hits[it.id] : null) } : null);
    const counts = {};
    for (const it of items) counts[it.type] = (counts[it.type] || 0) + 1;
    const list = filtered();
    refs.list = list;
    refs.content.classList.toggle('is-selecting', state.selecting);
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
    for (const k of state.filter.quick) pills.push([QUICK[k]?.[0] || k, () => setFilter(root, { quick: state.filter.quick.filter((x) => x !== k) })]);
    for (const t of state.filter.tagsIn) pills.push([`#${t}`, () => setFilter(root, { tagsIn: state.filter.tagsIn.filter((x) => x !== t) })]);
    for (const t of state.filter.tagsOut) pills.push([`不含 #${t}`, () => setFilter(root, { tagsOut: state.filter.tagsOut.filter((x) => x !== t) }), 'out']);
    if (state.filter.ai) pills.push([state.filter.ai === 'no' ? 'AI 未整理' : 'AI 已整理', () => setFilter(root, { ai: '' })]);
    if (state.filter.collection) pills.push([`合集：${collectionName(state.filter.collection)}`, () => setFilter(root, { collection: '' })]);
    clear(refs.activeRow, pills.map(([label, off, cls]) => h('button', { class: `pill ${cls || ''}`, onclick: off }, h('span', {}, label), icon('x', { size: 12 }))));
    refs.activeRow.hidden = !pills.length;

    renderHealth(refs.health);
    renderDupNotice(refs.notice, fc || state.filter.q || state.filter.type !== 'all' || state.selecting);

    if (!items.length) {
        clear(refs.content, emptyState('archive', '仓库还是空的', '上传角色卡、世界书、预设、正则、脚本、主题等文件，类型会自动识别。', btn('添加第一件藏品', { icon: 'plus', cls: 'primary', onclick: () => openImporter() })));
    } else if (!list.length) {
        clear(refs.content, emptyState('search', '没有符合条件的内容', '换个关键词，或清除筛选条件', btn('清除筛选', { icon: 'x', onclick: () => { refs.search.value = ''; setFilter(root, { q: '', type: 'all', ...CLEAR_FILTERS() }); } })));
    } else {
        const click = (it) => (e) => {
            if (state.selecting) {
                // 电脑上按住 Shift：从上次点的那项到这一项全部选上
                const from = refs.lastPick ? list.findIndex((x) => x.id === refs.lastPick) : -1;
                if (e?.shiftKey && from >= 0) {
                    const to = list.findIndex((x) => x.id === it.id);
                    for (const x of list.slice(Math.min(from, to), Math.max(from, to) + 1)) state.selection.add(x.id);
                    refs.lastPick = it.id;
                    renderLibrary(root);
                    return;
                }
                refs.lastPick = it.id;
                state.selection.has(it.id) ? state.selection.delete(it.id) : state.selection.add(it.id);
                // 多选时只改这一张的选中样式和底部操作栏，不重画整页
                const el = e?.currentTarget;
                const on = state.selection.has(it.id);
                if (!el) { renderLibrary(root); return; }
                el.classList.toggle('selected', on);
                el.querySelector('.row-check')?.classList.toggle('on', on);
                renderSelbar(refs.selbar, list, root);
            } else openDetail(it.id, { seq: list.map((x) => x.id), onLeave: (last) => reveal(refs, root, list, last) });
        };
        const LIMIT = 300;
        const shown = list.slice(0, refs.limit || LIMIT);
        const container = state.prefs.view === 'grid'
            ? h('div', { class: `grid ${state.prefs.dense ? 'dense' : ''} ${state.prefs.cols ? `fixed-cols c${state.prefs.cols}` : ''}`, style: { '--cols': state.prefs.cols || null } }, withTimeGroups(shown, (it, i) => applyHit(itemCard(it, { onClick: click(it), selected: state.selection.has(it.id), selecting: state.selecting, index: i }), it, hitOf(it)), 'in-grid'))
            : h('div', { class: 'rows' }, withTimeGroups(shown, (it, i) => applyHit(itemRow(it, { cache: true, onClick: click(it), selected: state.selection.has(it.id), index: i,
                right: state.selecting ? h('span', { class: `row-check ${state.selection.has(it.id) ? 'on' : ''}` }, icon('check', { size: 13, stroke: 3 })) : null }), it, hitOf(it)), 'in-rows'));
        clear(refs.content, container,
            list.length > shown.length ? h('div', { class: 'more' }, btn(`显示更多（剩余 ${list.length - shown.length}）`, { onclick: () => { refs.limit = (refs.limit || LIMIT) + LIMIT; renderLibrary(root); } })) : null);
    }
    renderSelbar(refs.selbar, list, root);
}

// 有可能重复的条目时，在列表上方提示一次；关掉后，直到出现新的重复组才再提示
let dupMemo = { items: null, ignore: '', groups: [] };
// 数据安全提醒：数据库损坏后自动恢复过、或条目数突然少了一大半（自动备份已暂停）
export function renderHealth(el) {
    const { guard, recovered } = state.health || {};
    el.hidden = !guard && !recovered;
    if (el.hidden) return;
    const toBackups = btn('去备份页', { cls: 'sm', onclick: () => { location.hash = '#/settings/data'; } });
    if (guard) {
        clear(el, icon('alert', { size: 15 }),
            h('span', { class: 'grow' }, `现在连回收站一共只有 ${guard.items} 个条目，最近一份备份里有 ${guard.ref} 个。为了不让好的备份被挤掉，自动备份已暂停。如果不是你自己删的，到备份页还原。`),
            h('div', { class: 'lib-notice-acts' }, toBackups,
                btn('是我删的，继续备份', { cls: 'sm ghost', onclick: async () => {
                    if (!(await confirmDialog(`确认条目是你自己删掉的？会按现在的 ${guard.items} 个条目存一份新备份，之后照常每天备份。旧的备份不会马上删，超出保留份数后才会轮换掉。`, { ok: '继续备份' }))) return;
                    try { await api.post('/api/backups/ack'); toast('已备份，自动备份恢复', 'ok'); await reload(); } catch (e) { toast(e.message, 'err'); }
                } })));
        return;
    }
    clear(el, icon('alert', { size: 15 }),
        h('span', { class: 'grow' }, recovered.missing
            ? `数据库文件不见了，已自动从${recovered.from}恢复。请检查条目是否齐全，缺的话可以到备份页还原。`
            : `数据库文件损坏，已自动从${recovered.from}恢复（损坏的文件另存为 ${recovered.bad}）。请检查条目是否齐全，缺的话可以到备份页还原。`),
        h('div', { class: 'lib-notice-acts' }, toBackups,
            btn('知道了', { cls: 'sm ghost', onclick: async () => { try { await api.post('/api/health/ack'); await reload(); } catch (e) { toast(e.message, 'err'); } } })));
}

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

// 从详情页切了好几项再关掉：把列表滚到最后看的那一项
function reveal(refs, root, list, id) {
    const find = () => refs.content.querySelector(`[data-id="${CSS.escape(id)}"]`);
    let el = find();
    const idx = list.findIndex((x) => x.id === id);
    if (!el && idx >= 0 && idx >= (refs.limit || 300)) { refs.limit = Math.ceil((idx + 1) / 300) * 300; renderLibrary(root); el = find(); }
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 90) el.scrollIntoView({ block: 'center' });
    el.classList.add('just-viewed');
    setTimeout(() => el.classList.remove('just-viewed'), 1200);
}

function setFilter(root, patch) {
    Object.assign(state.filter, patch);
    if (root._refs) root._refs.limit = 0;
    renderLibrary(root);
}

function openFilters(root) {
    const s = sheet({ title: '筛选与排序', body: h('div') });
    let tagQ = '';
    // 标签：点一下「要有」，再点「不要」，再点取消；可以同时选多个
    const tagSection = (tags) => {
        const list = h('div', { class: 'opts tag-opts' });
        const drawTags = () => {
            const q = tagQ.trim().toLowerCase();
            const f = state.filter;
            const shown = tags.filter(([t]) => !q || t.toLowerCase().includes(q) || f.tagsIn.includes(t) || f.tagsOut.includes(t));
            const limit = q ? 300 : 80;
            clear(list, shown.slice(0, limit).map(([t, n]) => {
                const st = f.tagsIn.includes(t) ? 'in' : f.tagsOut.includes(t) ? 'out' : '';
                return h('button', { class: `opt tag-opt ${st ? `active ${st}` : ''}`, title: st === 'in' ? '再点一下改成「不要这个标签」' : st === 'out' ? '再点一下取消' : '点一下只看带这个标签的', onclick: () => {
                    f.tagsIn = f.tagsIn.filter((x) => x !== t);
                    f.tagsOut = f.tagsOut.filter((x) => x !== t);
                    if (!st) f.tagsIn.push(t); else if (st === 'in') f.tagsOut.push(t);
                    drawTags();
                    renderLibrary(root);
                } }, st === 'in' ? icon('check', { size: 13, stroke: 3 }) : st === 'out' ? icon('minus', { size: 13, stroke: 3 }) : null, h('span', {}, t), h('span', { class: 'opt-n' }, n));
            }), shown.length > limit ? h('span', { class: 'muted small' }, `还有 ${shown.length - limit} 个，输入文字筛选`) : null,
            !shown.length ? h('span', { class: 'muted small' }, '没有匹配的标签') : null);
        };
        drawTags();
        return h('div', { class: 'form-group' },
            h('div', { class: 'row-between' }, h('div', { class: 'form-label' }, `标签 · ${tags.length}`),
                state.filter.tagsIn.length || state.filter.tagsOut.length ? btn('清除', { cls: 'sm ghost', onclick: () => { state.filter.tagsIn = []; state.filter.tagsOut = []; drawTags(); renderLibrary(root); } }) : null),
            tags.length > 12 ? h('label', { class: 'search inline' }, icon('search', { size: 15 }), h('input', { class: 'input search-input', placeholder: '找标签', value: tagQ, oninput: (e) => { tagQ = e.target.value; drawTags(); } })) : null,
            list,
            h('div', { class: 'muted small' }, '点一次：只看带这个标签的；再点一次：排除这个标签；再点取消。选多个时要同时满足。'));
    };
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
            h('div', { class: 'form-group' }, h('div', { class: 'form-label' }, '快捷筛选'),
                h('div', { class: 'opts' }, Object.entries(QUICK).map(([k, [label]]) => opt(state.filter.quick.includes(k), label, () => {
                    const q = state.filter.quick;
                    state.filter.quick = q.includes(k) ? q.filter((x) => x !== k) : [...q, k];
                })))),
            tags.length ? tagSection(tags) : null,
            h('div', { class: 'muted small' }, '搜索会查到开场白、对话示例、世界书条目、预设提示词等全部文字。多个词用空格分开表示都要包含；「-词」表示不能出现；「#标签」只看带这个标签的，「-#标签」排除这个标签。'));
    };
    draw();
    s.foot = h('div', { class: 'sheet-foot' },
        btn('重置', { onclick: () => { Object.assign(state.filter, CLEAR_FILTERS()); state.prefs.sort = 'updated'; state.prefs.groupTime = false; savePrefs(); draw(); renderLibrary(root); } }),
        btn('完成', { cls: 'primary', onclick: () => s.close() }));
    s.el.append(s.foot);
}

/**
 * 手机：长按一张卡进入多选并选中它；多选时手指横向滑过的卡依次选上（起点是选中的就依次取消），竖着滑照常滚动
 */
function bindSelectGestures(refs, root) {
    const box = refs.content;
    const itemEl = (t) => t?.closest?.('.card[data-id], .row-item[data-id]');
    let timer = 0;
    let start = null;
    let drag = null;
    let suppress = false;
    const mark = (el) => {
        const id = el.dataset.id;
        if (!id || drag.seen.has(id)) return;
        drag.seen.add(id);
        if (drag.on) state.selection.add(id); else state.selection.delete(id);
        el.classList.toggle('selected', drag.on);
        el.querySelector('.row-check')?.classList.toggle('on', drag.on);
        renderSelbar(refs.selbar, refs.list || [], root);
    };
    const stop = () => { clearTimeout(timer); timer = 0; start = null; drag = null; };
    box.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.pointerType === 'mouse') return;
        const el = itemEl(e.target);
        if (!el) return;
        start = { x: e.clientX, y: e.clientY, el, pid: e.pointerId };
        if (!state.selecting) {
            timer = setTimeout(() => {
                timer = 0;
                suppress = true;
                state.selecting = true;
                state.selection.clear();
                state.selection.add(el.dataset.id);
                refs.lastPick = el.dataset.id;
                navigator.vibrate?.(12);
                renderLibrary(root);
            }, 450);
        }
    });
    box.addEventListener('pointermove', (e) => {
        if (!start || e.pointerId !== start.pid) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (timer && Math.hypot(dx, dy) > 8) { clearTimeout(timer); timer = 0; }
        if (!state.selecting) return;
        if (!drag && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            drag = { on: !state.selection.has(start.el.dataset.id), seen: new Set() };
            suppress = true;
            mark(start.el);
        }
        if (drag) {
            const el = itemEl(document.elementFromPoint(e.clientX, e.clientY));
            if (el && box.contains(el)) mark(el);
        }
    });
    box.addEventListener('pointerup', stop);
    box.addEventListener('pointercancel', stop);
    // 长按或滑动选择之后松手，不要再当成一次点击
    box.addEventListener('click', (e) => { if (suppress) { suppress = false; e.stopPropagation(); e.preventDefault(); } }, true);
    box.addEventListener('pointerdown', () => { suppress = false; }, true);
    box.addEventListener('contextmenu', (e) => { if (itemEl(e.target) && (timer || state.selecting)) e.preventDefault(); });
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
    const items = ids.map((id) => state.byId.get(id)).filter(Boolean);
    const allFav = n > 0 && items.every((it) => it.favorite);
    clear(bar,
        h('div', { class: 'sel-top' },
            h('span', { class: 'sel-count' }, `已选 ${n} 项`),
            matchMedia('(pointer: coarse)').matches ? h('span', { class: 'sel-hint' }, '横向滑过可以连选') : h('span', { class: 'sel-hint' }, '按住 Shift 点击可以选一段'),
            h('button', { class: 'btn sm ghost', onclick: () => { if (n === list.length) state.selection.clear(); else list.forEach((i) => state.selection.add(i.id)); renderLibrary(root); } }, n === list.length ? '取消全选' : '全选')),
        h('div', { class: 'sel-acts' },
            act('tag', '标签', () => batchPick(items, 'tags')),
            act('layers', '合集', () => batchPick(items, 'collections')),
            act('star', allFav ? '取消收藏' : '收藏', () => run('favorite', !allFav, allFav ? '已取消收藏' : '已收藏')),
            aiReady() ? act('sparkles', 'AI 整理', () => startOrganize(ids)) : null,
            bridge.host ? act('beer', '入酒馆', () => importItemsToTavern(items)) : null,
            act('trash', '删除', async () => {
                if (await confirmDialog(`将 ${n} 项移入回收站？`, { danger: true, ok: '删除' })) { await run('delete', null, '已移入回收站'); state.selection.clear(); }
            }, 'danger'),
            act('more', '更多', () => batchMore(items, run))));
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

// 多选的「更多」：对比两项、导出、改类型
function batchMore(items, run) {
    const n = items.length;
    const item = (ic, label, fn, disabled = false, note = '') => h('button', { class: 'menu-item', disabled, onclick: async () => { m.close(); await fn(); } },
        icon(ic, { size: 17 }), h('span', { class: 'grow' }, label), note ? h('span', { class: 'muted small' }, note) : null);
    const pf = (it) => it.files.find((f) => f.primary) || it.files[0];
    const canDiff = n === 2 && items.every((it) => pf(it));
    const m = sheet({
        title: `已选 ${n} 项`,
        body: h('div', { class: 'menu' },
            item('layers', '对比这两项', () => {
                const [a, b] = [...items].sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
                openDiff({ sha: pf(a).sha, name: pf(a).name, label: a.name }, { sha: pf(b).sha, name: pf(b).name, label: b.name }, { title: '对比两个条目' });
            }, !canDiff, n === 2 ? '' : '选中 2 项时可用'),
            item('download', '导出为 ZIP', async () => {
                toast(`正在打包 ${n} 项…`);
                try { downloadBlob(await api.req('POST', '/api/export', { ids: items.map((i) => i.id) }, { blob: true }), `TavernVault-${n}项.zip`); } catch (e) { toast(e.message, 'err'); }
            }),
            item('blocks', '改类型', () => {
                const s = sheet({
                    title: '改成哪种类型',
                    body: h('div', { class: 'menu' }, Object.entries(TYPE_META).map(([k, v]) => h('button', { class: 'menu-item', onclick: async () => {
                        s.close();
                        if (await confirmDialog(`把 ${n} 项都改成「${v.label}」？只改藏馆里的分类，不改文件。`, { ok: '修改' })) await run('setType', k, '已修改类型');
                    } }, icon(v.icon, { size: 17 }), h('span', {}, v.label)))),
                });
            })),
    });
}

/**
 * 批量改标签 / 合集：每项显示「全部有 / 部分有 / 都没有」，点一下切换，确定时一次算出要加的和要去掉的
 * kind: 'tags' | 'collections'
 */
function batchPick(items, kind) {
    const n = items.length;
    const isTag = kind === 'tags';
    const label = (k) => (isTag ? k : collectionName(k));
    const has = (k) => items.filter((it) => it[kind].includes(k)).length;
    const keys = isTag
        ? [...new Set([...items.flatMap((it) => it.tags), ...allTags().slice(0, 40).map(([t]) => t)])]
        : state.collections.map((c) => c.id);
    const orig = new Map(keys.map((k) => [k, has(k) === n ? 'all' : has(k) ? 'some' : 'none']));
    const cur = new Map(orig);
    let q = '';
    const list = h('div', { class: 'opts tri-opts' });
    const input = h('input', { class: 'input', placeholder: isTag ? '找标签，或输入新标签后回车' : '找合集', oninput: (e) => { q = e.target.value; draw(); },
        onkeydown: (e) => {
            if (e.key !== 'Enter' || !isTag) return;
            const v = input.value.trim().replace(/^#/, '');
            if (!v) return;
            if (!cur.has(v)) { keys.unshift(v); orig.set(v, 'none'); }
            cur.set(v, 'all');
            input.value = ''; q = ''; draw();
        } });
    const next = (k) => {
        const c = cur.get(k);
        // 部分有的：→ 全部有 → 都没有 → 回到部分有；其它：全部有 ↔ 都没有
        if (orig.get(k) === 'some') return c === 'some' ? 'all' : c === 'all' ? 'none' : 'some';
        return c === 'all' ? 'none' : 'all';
    };
    const draw = () => {
        const ql = q.trim().toLowerCase();
        const shown = keys.filter((k) => !ql || label(k).toLowerCase().includes(ql) || cur.get(k) !== orig.get(k));
        clear(list, shown.map((k) => {
            const c = cur.get(k);
            const changed = c !== orig.get(k);
            return h('button', { class: `opt tri ${c} ${changed ? 'changed' : ''}`, onclick: () => { cur.set(k, next(k)); draw(); } },
                c === 'all' ? icon('check', { size: 13, stroke: 3 }) : c === 'some' ? icon('minus', { size: 13, stroke: 3 }) : null,
                h('span', {}, label(k)), c === 'some' ? h('span', { class: 'opt-n' }, `${has(k)}/${n}`) : null);
        }), !shown.length ? h('span', { class: 'muted small' }, isTag ? '按回车添加为新标签' : '没有匹配的合集') : null);
    };
    draw();
    const s = sheet({
        title: isTag ? `${n} 项的标签` : `${n} 项的合集`,
        body: h('div', { class: 'stack-s' },
            h('div', { class: 'muted small' }, '打勾 = 全部都有，横线 = 只有一部分有。点一下切换，改过的会高亮，点「确定」后才生效。'),
            input, list,
            !isTag ? btn('新建合集', { icon: 'plus', cls: 'sm', onclick: async () => {
                const name = await promptDialog('', { title: '新建合集', placeholder: '合集名称' });
                if (!name) return;
                const c = await api.post('/api/collections', { name });
                await reload();
                keys.push(c.id); orig.set(c.id, 'none'); cur.set(c.id, 'all'); draw();
            } }) : null),
        foot: [
            btn('取消', { onclick: () => s.close() }),
            btn('确定', { cls: 'primary', icon: 'check', onclick: async () => {
                // 输入框里还有没按回车的新标签，也算上
                const typed = isTag ? input.value.trim().replace(/^#/, '') : '';
                if (typed && !keys.includes(typed)) { keys.unshift(typed); orig.set(typed, 'none'); cur.set(typed, 'all'); }
                const add = keys.filter((k) => cur.get(k) === 'all' && orig.get(k) !== 'all');
                const remove = keys.filter((k) => cur.get(k) === 'none' && orig.get(k) !== 'none');
                s.close();
                if (!add.length && !remove.length) return;
                const ids = items.map((it) => it.id);
                try {
                    if (isTag) {
                        if (add.length) await api.post('/api/batch', { ids, action: 'addTags', value: add });
                        if (remove.length) await api.post('/api/batch', { ids, action: 'removeTags', value: remove });
                    } else {
                        for (const c of add) await api.post('/api/batch', { ids, action: 'addCollection', value: c });
                        for (const c of remove) await api.post('/api/batch', { ids, action: 'removeCollection', value: c });
                    }
                    toast([add.length ? `加上 ${add.map(label).join('、')}` : '', remove.length ? `去掉 ${remove.map(label).join('、')}` : ''].filter(Boolean).join('，'), 'ok');
                } catch (e) { toast(e.message, 'err'); }
            } }),
        ],
    });
    if (isTag && matchMedia('(pointer: fine)').matches) setTimeout(() => input.focus(), 150);
}

