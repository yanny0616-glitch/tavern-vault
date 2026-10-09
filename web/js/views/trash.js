// 回收站
import { h, clear, toast, confirmDialog, timeAgo } from '../ui.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { topbar, ensureView, itemRow } from './common.js';

export function renderTrash(root) {
    const refs = ensureView(root, 'trash', () => {
        const content = h('div');
        const actions = h('div', { class: 'row' });
        root.append(topbar('回收站', actions), h('div', { class: 'page' }, content));
        return { content, actions };
    });
    const items = state.items.filter((i) => i.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    clear(refs.actions, items.length ? h('button', { class: 'btn sm danger', onclick: async () => {
        if (!(await confirmDialog(`永久删除回收站中的 ${items.length} 项？此操作无法撤销。`, { danger: true, ok: '永久删除' }))) return;
        await api.post('/api/batch', { ids: items.map((i) => i.id), action: 'purge' });
        toast('已清空');
    } }, '清空回收站') : null);
    if (!items.length) { clear(refs.content, h('div', { class: 'empty' }, h('div', { class: 'big' }, '🗑️'), '回收站是空的')); return; }
    clear(refs.content, h('div', { class: 'list' }, items.map((it) => itemRow(it, {
        right: h('div', { class: 'row' },
            h('span', { class: 'muted small desktop-only' }, timeAgo(it.deletedAt)),
            h('button', { class: 'btn sm', onclick: async (e) => { e.stopPropagation(); await api.post(`/api/items/${it.id}/restore`); toast('已恢复', 'ok'); } }, '恢复'),
            h('button', { class: 'btn sm danger', onclick: async (e) => {
                e.stopPropagation();
                if (await confirmDialog(`永久删除「${it.name}」？`, { danger: true })) await api.del(`/api/items/${it.id}?hard=1`);
            } }, '删除')),
    }))));
}
