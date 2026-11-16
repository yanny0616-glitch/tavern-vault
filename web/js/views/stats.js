// 统计
import { h, clear, fmtBytes, timeAgo, icon } from '../ui.js';
import { state, live, TYPE_META, allTags } from '../state.js';
import { topbar, ensureView, itemRow } from './common.js';
import { openDetail } from './detail.js';

export function renderStats(root, { go }) {
    const refs = ensureView(root, 'stats', () => {
        const content = h('div', { class: 'stack stats-flow' });
        root.append(topbar('统计', { kicker: 'Overview', sub: '藏品概况' }), h('div', { class: 'page' }, content));
        return { content };
    });
    const items = live();
    const st = state.stats;
    const byType = Object.entries(st.byType || {}).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...byType.map(([, n]) => n));
    const recent = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
    const everyTag = allTags();
    const tags = everyTag.slice(0, 60);
    const topTags = everyTag.slice(0, 10);
    const onceTags = everyTag.filter(([, n]) => n === 1).length;
    // 最近 30 天新增，分成 4 段
    const DAY = 86400000;
    const now = Date.now();
    const age = (iso) => (now - Date.parse(iso)) / DAY;
    const added30 = items.filter((i) => age(i.createdAt) <= 30);
    const weeks = [[21, 30, '21～30 天前'], [14, 21, '14～21 天前'], [7, 14, '7～14 天前'], [-1, 7, '最近 7 天']].map(([lo, hi, label]) => [label, added30.filter((i) => { const d = age(i.createdAt); return d > lo && d <= hi; }).length]);
    const maxWeek = Math.max(1, ...weeks.map(([, n]) => n));
    // 清库存：没打开过的、放了很久没看的
    const unopened = items.filter((i) => !i.openedAt);
    const stale = unopened.filter((i) => age(i.createdAt) > 90);
    const untagged = items.filter((i) => !i.tags.length);
    const dusty = [...unopened].filter((i) => i.type === 'character').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 8);
    const toLib = (patch) => { Object.assign(state.filter, { tagsIn: [], tagsOut: [], quick: [], collection: '', fav: false, ai: '', q: '' }, patch); go('library'); };
    const maxTag = Math.max(1, ...tags.map(([, n]) => n));
    const rated = items.filter((i) => i.rating);
    const avg = rated.length ? (rated.reduce((s, i) => s + i.rating, 0) / rated.length).toFixed(1) : '—';
    const chars = items.filter((i) => i.type === 'character');
    const tokens = chars.reduce((s, i) => s + (i.meta?.card?.estTokens || 0), 0);

    const kpis = [
        ['藏品总数', st.total ?? 0, 'archive'],
        ['角色卡', chars.length, 'user'],
        ['已收藏', items.filter((i) => i.favorite).length, 'star'],
        ['平均评分', avg, 'sparkles'],
        ['占用空间', fmtBytes(st.bytes), 'database'],
        ['来自酒馆', items.filter((i) => i.origin === 'tavern').length, 'beer'],
        ['合集', state.collections.length, 'layers'],
        ['角色卡 Token', tokens.toLocaleString(), 'type'],
        ['近 30 天新增', added30.length, 'plus'],
        ['没打开过', unopened.length, 'eye'],
    ];
    clear(refs.content,
        h('div', { class: 'kpis' }, kpis.map(([k, v, ic]) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-ic' }, icon(ic, { size: 16 })), h('b', {}, String(v)), h('span', {}, k)))),
        h('section', { class: 'panel stat-types' }, h('div', { class: 'panel-head' }, icon('chart', { size: 16 }), h('h3', {}, '类型分布')),
            byType.length ? h('div', { class: 'bars' }, byType.map(([t, n]) => h('button', { class: 'bar-row', style: { '--tc': TYPE_META[t]?.color }, onclick: () => { Object.assign(state.filter, { type: t }); go('library'); } },
                h('span', { class: 'bar-label' }, icon(TYPE_META[t]?.icon || 'box', { size: 14 }), TYPE_META[t]?.label || t),
                h('span', { class: 'bar' }, h('i', { style: { width: `${(n / max) * 100}%` } })),
                h('span', { class: 'bar-n' }, n)))) : h('div', { class: 'muted' }, '暂无数据')),
        h('section', { class: 'panel stat-new' }, h('div', { class: 'panel-head' }, icon('plus', { size: 16 }), h('h3', {}, `最近 30 天新增 · ${added30.length}`)),
            added30.length ? h('div', { class: 'bars' }, weeks.map(([label, n]) => h('div', { class: 'bar-row' },
                h('span', { class: 'bar-label' }, label), h('span', { class: 'bar' }, h('i', { style: { width: `${(n / maxWeek) * 100}%` } })), h('span', { class: 'bar-n' }, n)))) : h('div', { class: 'muted' }, '这 30 天没有新增。')),
        h('section', { class: 'panel stat-clean' }, h('div', { class: 'panel-head' }, icon('eraser', { size: 16 }), h('h3', {}, '清库存')),
            h('div', { class: 'clean-acts' },
                [['没打开过', unopened.length, { quick: ['unopened'] }], ['未打标签', untagged.length, { quick: ['untagged'] }], ['没打开过又没标签', unopened.filter((i) => !i.tags.length).length, { quick: ['unopened', 'untagged'] }]]
                    .map(([label, n, patch]) => h('button', { class: 'clean-act', disabled: !n, onclick: () => toLib(patch) }, h('b', {}, n), h('span', {}, label), icon('chevronRight', { size: 14 })))),
            h('div', { class: 'muted small' }, `${stale.length ? `其中 ${stale.length} 件收进来超过 90 天还没打开过。` : ''}打开记录是从这个版本开始算的，更早看过的也会算作没打开过。`),
            dusty.length ? [h('div', { class: 'sub-label' }, '放得最久还没打开的角色卡'),
                h('div', { class: 'rows' }, dusty.map((it) => itemRow(it, { onClick: () => openDetail(it.id), right: h('span', { class: 'muted small nowrap' }, `${timeAgo(it.createdAt)}收录`) })))] : null),
        topTags.length ? h('section', { class: 'panel stat-toptags' }, h('div', { class: 'panel-head' }, icon('hash', { size: 16 }), h('h3', {}, '用得最多的标签')),
            h('div', { class: 'bars' }, topTags.map(([t, n]) => h('button', { class: 'bar-row', onclick: () => toLib({ tagsIn: [t], type: 'all' }) },
                h('span', { class: 'bar-label' }, t), h('span', { class: 'bar' }, h('i', { style: { width: `${(n / maxTag) * 100}%` } })), h('span', { class: 'bar-n' }, n)))),
            h('div', { class: 'muted small' }, `一共 ${everyTag.length} 个标签${onceTags ? `，其中 ${onceTags} 个只用过一次` : ''}。`)) : null,
        tags.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('tag', { size: 16 }), h('h3', {}, '标签')),
            h('div', { class: 'tag-wall' }, tags.map(([t, n]) => h('button', { class: 'tag', style: { fontSize: `calc(${12 + Math.round((n / maxTag) * 5)}px * var(--fs))` }, onclick: () => { Object.assign(state.filter, { tagsIn: [t], tagsOut: [], quick: [], type: 'all' }); go('library'); } }, t, h('small', {}, n))))) : null,
        recent.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('clock', { size: 16 }), h('h3', {}, '最近收录')),
            h('div', { class: 'rows' }, recent.map((it) => itemRow(it, { onClick: () => openDetail(it.id), right: h('span', { class: 'muted small nowrap' }, timeAgo(it.createdAt)) })))) : null);
}
