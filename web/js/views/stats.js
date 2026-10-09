// 统计
import { h, clear, fmtBytes, timeAgo } from '../ui.js';
import { state, live, TYPE_META, allTags } from '../state.js';
import { topbar, ensureView, itemRow } from './common.js';
import { openDetail } from './detail.js';

export function renderStats(root, { go }) {
    const refs = ensureView(root, 'stats', () => {
        const content = h('div');
        root.append(topbar('统计'), h('div', { class: 'page' }, content));
        return { content };
    });
    const items = live();
    const st = state.stats;
    const byType = Object.entries(st.byType || {}).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...byType.map(([, n]) => n));
    const recent = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
    const tags = allTags().slice(0, 60);
    const fav = items.filter((i) => i.favorite).length;
    const rated = items.filter((i) => i.rating);
    const avg = rated.length ? (rated.reduce((s, i) => s + i.rating, 0) / rated.length).toFixed(1) : '-';
    const chars = items.filter((i) => i.type === 'character');
    const tokens = chars.reduce((s, i) => s + (i.meta?.card?.estTokens || 0), 0);
    const fromTavern = items.filter((i) => i.origin === 'tavern').length;

    clear(refs.content,
        h('div', { class: 'section' }, h('div', { class: 'stat-grid' },
            [['资源总数', st.total], ['角色卡', chars.length], ['已收藏⭐', fav], ['平均评分', avg], ['占用空间', fmtBytes(st.bytes)], ['文件数', st.files], ['来自酒馆', fromTavern], ['角色卡总 Token', tokens.toLocaleString()]]
                .map(([k, v]) => h('div', { class: 'stat' }, h('b', {}, String(v ?? 0)), h('span', {}, k))))),
        h('div', { class: 'section' }, h('h3', {}, '📦 类型分布'),
            byType.length ? byType.map(([t, n]) => h('div', { class: 'bar-row', style: { cursor: 'pointer' }, onclick: () => { Object.assign(state.filter, { type: t }); go('library'); } },
                h('span', {}, `${TYPE_META[t]?.icon || ''} ${TYPE_META[t]?.label || t}`),
                h('div', { class: 'bar' }, h('i', { style: { width: `${(n / max) * 100}%` } })),
                h('span', { class: 'muted', style: { textAlign: 'right' } }, n))) : h('div', { class: 'muted' }, '暂无数据')),
        tags.length ? h('div', { class: 'section' }, h('h3', {}, '🏷️ 标签云'), h('div', { class: 'tag-cloud' },
            tags.map(([t, n]) => h('span', { class: 'tag', style: { cursor: 'pointer', fontSize: `${Math.min(17, 11 + n)}px` }, onclick: () => { Object.assign(state.filter, { tag: t, type: 'all' }); go('library'); } }, `${t} ${n}`)))) : null,
        recent.length ? h('div', { class: 'section' }, h('h3', {}, '🕒 最近添加'), h('div', { class: 'list' },
            recent.map((it) => itemRow(it, { onClick: () => openDetail(it.id), right: h('span', { class: 'muted small' }, timeAgo(it.createdAt)) })))) : null);
}
