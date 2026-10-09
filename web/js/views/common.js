// 视图共用组件
import { h } from '../ui.js';
import { api } from '../api.js';
import { typeMeta, state } from '../state.js';

export function topbar(title, ...right) {
    return h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, h('h1', {}, title), ...right));
}

/** 保证页面骨架只创建一次，避免重渲染时输入框失焦 */
export function ensureView(root, name, build) {
    if (root.dataset.view !== name) {
        root.dataset.view = name;
        root.replaceChildren();
        root._refs = build(root) || {};
    }
    return root._refs;
}

export function coverEl(it, cls = '') {
    const tm = typeMeta(it.type);
    if (it.cover) {
        return h('img', { class: cls, src: api.fileUrl(it.cover), loading: 'lazy', decoding: 'async', alt: '' });
    }
    return h('div', { class: 'ph', style: { '--c': tm.color } }, tm.icon, snippet(it) ? h('div', { class: 'snip' }, snippet(it)) : null);
}

function snippet(it) {
    const m = it.meta || {};
    if (it.description) return it.description.slice(0, 120);
    if (m.titles?.length) return m.titles.slice(0, 6).join(' · ');
    if (m.promptNames?.length) return m.promptNames.slice(0, 6).join(' · ');
    if (m.labels?.length) return m.labels.slice(0, 6).join(' · ');
    if (m.scripts?.length) return m.scripts.slice(0, 6).join(' · ');
    if (m.findRegex) return m.findRegex.slice(0, 80);
    if (it.notes) return it.notes.slice(0, 120);
    return '';
}

export function itemCard(it, { onClick, selected = false, selecting = false } = {}) {
    const tm = typeMeta(it.type);
    const sub = [];
    if (it.type === 'character' && it.meta?.card) {
        const c = it.meta.card;
        if (c.creator) sub.push(c.creator);
        if (c.bookEntries) sub.push(`📖${c.bookEntries}`);
        if (c.greetings > 1) sub.push(`💬${c.greetings}`);
    } else if (it.type === 'worldbook' && it.meta?.entries != null) sub.push(`${it.meta.entries} 条目`);
    else if (it.type === 'preset' && it.meta?.prompts != null) sub.push(`${it.meta.prompts} 提示词`);
    else if (it.author) sub.push(it.author);
    if (!sub.length && it.tags[0]) sub.push(`#${it.tags[0]}`);
    return h('div', { class: `card ${selected ? 'selected' : ''}`, onclick: onClick },
        h('div', { class: 'cover' }, coverEl(it),
            h('span', { class: 'type-pill' }, `${tm.icon} ${tm.label}`),
            selecting ? h('span', { class: 'check' }, selected ? '✓' : '') : it.favorite ? h('span', { class: 'fav' }, '⭐') : null),
        h('div', { class: 'body' },
            h('div', { class: 'name', title: it.name }, it.name),
            h('div', { class: 'sub' }, sub.join(' · ') || tm.label)));
}

export function itemRow(it, { onClick, selected = false, right = null } = {}) {
    const tm = typeMeta(it.type);
    return h('div', { class: `list-row ${selected ? 'selected' : ''}`, onclick: onClick },
        h('div', { class: 'thumb' }, it.cover ? h('img', { src: api.fileUrl(it.cover), loading: 'lazy', alt: '' }) : tm.icon),
        h('div', { class: 'grow' },
            h('div', { class: 'title ellipsis' }, it.favorite ? '⭐ ' : '', it.name),
            h('div', { class: 'meta ellipsis' }, `${tm.label}`, it.author ? ` · ${it.author}` : '', it.tags.length ? ` · ${it.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}` : '')),
        right);
}

export function collectionName(id) {
    return state.collections.find((c) => c.id === id)?.name || '';
}
