// 统计
import { h, clear, fmtBytes, timeAgo, icon } from '../ui.js';
import { state, live, TYPE_META, allTags } from '../state.js';
import { topbar, ensureView, itemRow } from './common.js';
import { openDetail } from './detail.js';

export function renderStats(root, { go }) {
    const refs = ensureView(root, 'stats', () => {
        const content = h('div', { class: 'stack' });
        root.append(topbar('统计', { kicker: 'Overview', sub: '藏品概况' }), h('div', { class: 'page' }, content));
        return { content };
    });
    const items = live();
    const st = state.stats;
    const byType = Object.entries(st.byType || {}).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...byType.map(([, n]) => n));
    const recent = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
    const tags = allTags().slice(0, 60);
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
    ];
    clear(refs.content,
        h('div', { class: 'kpis' }, kpis.map(([k, v, ic]) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-ic' }, icon(ic, { size: 16 })), h('b', {}, String(v)), h('span', {}, k)))),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('chart', { size: 16 }), h('h3', {}, '类型分布')),
            byType.length ? h('div', { class: 'bars' }, byType.map(([t, n]) => h('button', { class: 'bar-row', style: { '--tc': TYPE_META[t]?.color }, onclick: () => { Object.assign(state.filter, { type: t }); go('library'); } },
                h('span', { class: 'bar-label' }, icon(TYPE_META[t]?.icon || 'box', { size: 14 }), TYPE_META[t]?.label || t),
                h('span', { class: 'bar' }, h('i', { style: { width: `${(n / max) * 100}%` } })),
                h('span', { class: 'bar-n' }, n)))) : h('div', { class: 'muted' }, '暂无数据')),
        tags.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('tag', { size: 16 }), h('h3', {}, '标签')),
            h('div', { class: 'tag-cloud' }, tags.map(([t, n]) => h('button', { class: 'tag', style: { fontSize: `calc(${12 + Math.round((n / maxTag) * 5)}px * var(--fs))` }, onclick: () => { Object.assign(state.filter, { tagsIn: [t], tagsOut: [], quick: [], type: 'all' }); go('library'); } }, t, h('small', {}, n))))) : null,
        recent.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('clock', { size: 16 }), h('h3', {}, '最近收录')),
            h('div', { class: 'rows' }, recent.map((it) => itemRow(it, { onClick: () => openDetail(it.id), right: h('span', { class: 'muted small nowrap' }, timeAgo(it.createdAt)) })))) : null);
}
