// 合集管理
import { h, clear, toast, confirmDialog, sheet, icon, btn, emptyState } from '../ui.js';
import { api } from '../api.js';
import { state, live } from '../state.js';
import { COLLECTION_ICONS } from '../icons.js';
import { topbar, ensureView } from './common.js';
import { coverImg } from '../thumbs.js';

const COLORS = ['', '#b4637a', '#c2554a', '#c08a2b', '#5e8a2e', '#2f8f6f', '#3a8aa6', '#3e7cb1', '#8a5cb8'];

export function renderCollections(root, { go }) {
    const refs = ensureView(root, 'collections', () => {
        const content = h('div');
        const sub = h('div', { class: 'tb-sub' });
        const head = topbar('合集', { kicker: 'Shelves', actions: [btn('新建', { icon: 'plus', cls: 'primary sm', onclick: () => editCollection() })] });
        head.querySelector('.tb-titles').append(sub);
        root.append(head, h('div', { class: 'page' }, content));
        return { content, sub };
    });
    const items = live();
    refs.sub.textContent = `${state.collections.length} 个合集`;
    if (!state.collections.length) {
        clear(refs.content, emptyState('layers', '还没有合集', '用合集把藏品分组，比如「常用」「某个世界观」「待测试」', btn('新建合集', { icon: 'plus', cls: 'primary', onclick: () => editCollection() })));
        return;
    }
    clear(refs.content, h('div', { class: 'shelves' }, state.collections.map((c) => {
        const members = items.filter((i) => i.collections.includes(c.id));
        const covers = members.filter((i) => i.cover).slice(0, 3);
        return h('article', { class: 'shelf', style: { '--cc': c.color || 'var(--accent)' }, onclick: () => { Object.assign(state.filter, { collection: c.id, type: 'all', tag: '', fav: false }); go('library'); } },
            h('div', { class: 'shelf-covers' }, covers.length ? covers.map((i) => coverImg(i)) : h('div', { class: 'shelf-ph' }, icon(c.icon, { size: 34, stroke: 1.3 }))),
            h('div', { class: 'shelf-body' },
                h('div', { class: 'shelf-ic' }, icon(c.icon, { size: 16 })),
                h('div', { class: 'grow min0' }, h('div', { class: 'shelf-name' }, c.name), h('div', { class: 'shelf-meta' }, `${members.length} 件`, c.description ? ` · ${c.description}` : '')),
                btn('', { icon: 'more', cls: 'sm ghost', onclick: (e) => { e.stopPropagation(); editCollection(c); } })));
    })));
}

function editCollection(c = null) {
    const name = h('input', { class: 'input', value: c?.name || '', placeholder: '合集名称' });
    const desc = h('textarea', { class: 'textarea', value: c?.description || '', placeholder: '描述（可选）' });
    let ic = COLLECTION_ICONS.includes(c?.icon) ? c.icon : 'folder';
    let color = c?.color || '';
    const iconBox = h('div', { class: 'icon-picker' });
    const colorBox = h('div', { class: 'color-picker' });
    const draw = () => {
        clear(iconBox, COLLECTION_ICONS.map((n) => h('button', { class: n === ic ? 'active' : '', onclick: () => { ic = n; draw(); } }, icon(n, { size: 18 }))));
        clear(colorBox, COLORS.map((cl) => h('button', { class: `${cl === color ? 'active' : ''} ${cl ? '' : 'auto'}`, style: { '--sw': cl || 'var(--accent)' }, title: cl ? cl : '跟随风格', onclick: () => { color = cl; draw(); } })));
    };
    draw();
    const s = sheet({
        title: c ? '编辑合集' : '新建合集',
        body: h('div', { class: 'fields' },
            h('div', { class: 'field wide' }, h('label', {}, '名称'), name),
            h('div', { class: 'field wide' }, h('label', {}, '图标'), iconBox),
            h('div', { class: 'field wide' }, h('label', {}, '颜色'), colorBox),
            h('div', { class: 'field wide' }, h('label', {}, '描述'), desc)),
        foot: [
            c ? btn('删除', { icon: 'trash', cls: 'danger', onclick: async () => {
                if (!(await confirmDialog(`删除合集「${c.name}」？其中的藏品不会被删除。`, { danger: true }))) return;
                await api.del(`/api/collections/${c.id}`);
                s.close();
            } }) : null,
            btn('保存', { icon: 'check', cls: 'primary', onclick: async () => {
                if (!name.value.trim()) { toast('请输入名称', 'err'); return; }
                const body = { name: name.value.trim(), icon: ic, color, description: desc.value };
                if (c) await api.patch(`/api/collections/${c.id}`, body); else await api.post('/api/collections', body);
                s.close();
                toast('已保存', 'ok');
            } }),
        ],
    });
}
