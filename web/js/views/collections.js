// 合集管理
import { h, clear, toast, confirmDialog, sheet } from '../ui.js';
import { api } from '../api.js';
import { state, live } from '../state.js';
import { topbar, ensureView, coverEl } from './common.js';

const ICONS = ['📁', '⭐', '❤️', '🔥', '🌙', '🌸', '⚔️', '🏰', '🎮', '📚', '🧪', '💼', '🎀', '👑', '🐉', '🌊'];

export function renderCollections(root, { go }) {
    const refs = ensureView(root, 'collections', () => {
        const content = h('div');
        root.append(topbar('合集', h('button', { class: 'btn primary sm', onclick: () => editCollection() }, '＋ 新建合集')), h('div', { class: 'page' }, content));
        return { content };
    });
    const items = live();
    if (!state.collections.length) {
        clear(refs.content, h('div', { class: 'empty' }, h('div', { class: 'big' }, '📚'), '用合集把资源分组：比如「常用」「某个世界观」「待测试」',
            h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: () => editCollection() }, '新建合集'))));
        return;
    }
    clear(refs.content, h('div', { class: 'grid' }, state.collections.map((c) => {
        const members = items.filter((i) => i.collections.includes(c.id));
        const covers = members.filter((i) => i.cover).slice(0, 4);
        return h('div', { class: 'card', onclick: () => { Object.assign(state.filter, { collection: c.id, type: 'all', tag: '', fav: false }); go('library'); } },
            h('div', { class: 'cover', style: { display: 'grid', gridTemplateColumns: covers.length > 1 ? '1fr 1fr' : '1fr', gap: '2px' } },
                covers.length ? covers.map((i) => h('div', { style: { overflow: 'hidden' } }, coverEl(i))) : h('div', { class: 'ph', style: { '--c': c.color || 'var(--accent)' } }, c.icon)),
            h('div', { class: 'body row' },
                h('div', { class: 'grow' }, h('div', { class: 'name' }, `${c.icon} ${c.name}`), h('div', { class: 'sub' }, `${members.length} 项`)),
                h('button', { class: 'btn sm icon ghost', onclick: (e) => { e.stopPropagation(); editCollection(c); } }, '⋯')));
    })));
}

function editCollection(c = null) {
    const name = h('input', { class: 'input', value: c?.name || '', placeholder: '合集名称' });
    const desc = h('textarea', { class: 'textarea', value: c?.description || '', placeholder: '描述（可选）' });
    let icon = c?.icon || '📁';
    const iconBox = h('div', { class: 'row wrap' });
    const drawIcons = () => clear(iconBox, ICONS.map((i) => h('button', { class: `btn sm icon ${i === icon ? 'primary' : ''}`, onclick: () => { icon = i; drawIcons(); } }, i)));
    drawIcons();
    const s = sheet({
        title: c ? '编辑合集' : '新建合集',
        body: h('div', { class: 'kv' }, h('label', {}, '名称'), name, h('label', {}, '图标'), iconBox, h('label', {}, '描述'), desc),
        foot: [
            c ? h('button', { class: 'btn danger', onclick: async () => {
                if (!(await confirmDialog(`删除合集「${c.name}」？（不会删除其中的资源）`, { danger: true }))) return;
                await api.del(`/api/collections/${c.id}`);
                s.close();
            } }, '删除') : null,
            h('button', { class: 'btn primary', onclick: async () => {
                if (!name.value.trim()) { toast('请输入名称', 'err'); return; }
                const body = { name: name.value.trim(), icon, description: desc.value };
                if (c) await api.patch(`/api/collections/${c.id}`, body); else await api.post('/api/collections', body);
                s.close();
                toast('已保存', 'ok');
            } }, '保存'),
        ],
    });
}
