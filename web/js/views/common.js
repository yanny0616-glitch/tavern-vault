// 视图共用组件：标题栏、卡片、列表行
// 卡片包含所有可能用到的元素（编号、叠字、角标、评分……），由各风格的 CSS 决定显示哪些。
import { h, icon, starsEl } from '../ui.js';
import { api } from '../api.js';
import { typeMeta, state, SKINS } from '../state.js';

/** 页面标题栏：kicker / 标题 / 副标题 + 右侧操作 */
export function topbar(title, { kicker = '', sub = '', actions = [] } = {}) {
    return h('header', { class: 'topbar' },
        h('div', { class: 'tb-row' },
            h('div', { class: 'tb-titles' },
                h('div', { class: 'tb-kicker' }, kicker || (SKINS[state.settings.skin]?.en || 'Atelier')),
                h('h1', { class: 'tb-title' }, title),
                sub ? h('div', { class: 'tb-sub' }, sub) : null),
            h('div', { class: 'tb-actions' }, actions)));
}

/** 保证页面骨架只创建一次，避免重渲染时输入框失焦 */
export function ensureView(root, name, build) {
    const skin = document.documentElement.dataset.skin;
    if (root.dataset.view !== name || root.dataset.builtSkin !== skin) {
        root.dataset.view = name;
        root.dataset.builtSkin = skin;
        root.replaceChildren();
        root._refs = build(root) || {};
    }
    return root._refs;
}

export function typeIcon(type, size = 16) {
    return icon(typeMeta(type).icon, { size });
}

export function typeBadge(type) {
    const tm = typeMeta(type);
    return h('span', { class: 'type-badge', style: { '--tc': tm.color } }, icon(tm.icon, { size: 12 }), h('span', {}, tm.label));
}

function coverImg(it) {
    return h('img', { src: api.fileUrl(it.cover), loading: 'lazy', decoding: 'async', alt: '' });
}

/** 非图片条目的内容预览 */
function docPreview(it) {
    const tm = typeMeta(it.type);
    const m = it.meta || {};
    let body = null;
    const lines = (arr) => h('ul', { class: 'doc-lines' }, arr.slice(0, 6).map((t) => h('li', {}, t)));
    if (it.type === 'worldbook' && m.titles?.length) body = lines(m.titles);
    else if (it.type === 'preset' && m.promptNames?.length) body = lines(m.promptNames);
    else if (it.type === 'quickreply' && m.labels?.length) body = lines(m.labels);
    else if (it.type === 'regex' && (m.findRegex || m.scripts?.length)) body = m.findRegex ? h('pre', { class: 'doc-code' }, m.findRegex) : lines(m.scripts);
    else if (it.type === 'theme' && m.colors?.length) body = h('div', { class: 'doc-swatches' }, m.colors.slice(0, 7).map((c) => h('i', { style: { background: c } })));
    else if (it.type === 'chat' && m.messages != null) body = h('div', { class: 'doc-big' }, h('b', {}, String(m.messages)), h('span', {}, '条消息'));
    else if (it.searchText || it.description || it.notes) body = h('p', { class: 'doc-text' }, (it.description || it.notes || it.searchText).slice(0, 160));
    const foot = metaLine(it);
    return h('div', { class: 'doc', style: { '--tc': tm.color } },
        h('div', { class: 'doc-head' }, icon(tm.icon, { size: 14 }), h('span', {}, tm.label)),
        h('div', { class: 'doc-title' }, it.name),
        body,
        foot ? h('div', { class: 'doc-foot' }, foot) : null,
        h('div', { class: 'doc-mark' }, icon(tm.icon, { size: 64, stroke: 1 })));
}

/** 卡片副标题 */
export function metaLine(it) {
    const m = it.meta || {};
    const parts = [];
    if (it.type === 'character' && m.card) {
        if (m.card.creator) parts.push(m.card.creator);
        if (m.card.greetings > 1) parts.push(`${m.card.greetings} 开场`);
        if (m.card.bookEntries) parts.push(`${m.card.bookEntries} 词条`);
    } else if (it.type === 'worldbook' && m.entries != null) parts.push(`${m.entries} 条目`);
    else if (it.type === 'preset' && m.prompts != null) parts.push(`${m.prompts} 段提示词`);
    else if (it.type === 'regex') parts.push(`${m.count || 1} 条规则`);
    else if (it.type === 'quickreply' && m.count != null) parts.push(`${m.count} 个按钮`);
    else if (it.author) parts.push(it.author);
    if (!parts.length && it.tags[0]) parts.push(it.tags[0]);
    return parts.join(' · ');
}

export function itemCard(it, { onClick, selected = false, selecting = false, index = 0 } = {}) {
    const tm = typeMeta(it.type);
    const media = it.cover ? coverImg(it) : docPreview(it);
    const sub = metaLine(it);
    return h('article', { class: `card ${it.cover ? 'has-cover' : 'is-doc'} ${selected ? 'selected' : ''} ${selecting ? 'selecting' : ''}`, style: { '--tc': tm.color }, onclick: onClick, dataset: { type: it.type } },
        h('div', { class: 'card-media' },
            h('div', { class: 'card-frame' }, media),
            h('span', { class: 'card-no' }, `No.${String(index + 1).padStart(3, '0')}`),
            h('span', { class: 'card-type' }, icon(tm.icon, { size: 11 }), h('span', {}, tm.label)),
            it.favorite ? h('span', { class: 'card-fav' }, icon('star', { size: 13, fill: true })) : null,
            it.rating ? h('span', { class: 'card-rank' }, icon('star', { size: 10, fill: true }), String(it.rating)) : null,
            h('span', { class: 'card-check' }, icon('check', { size: 14, stroke: 3 })),
            it.cover ? h('div', { class: 'card-overlay' }, h('div', { class: 'card-title' }, it.name), sub ? h('div', { class: 'card-sub' }, sub) : null) : null),
        h('div', { class: 'card-body' },
            h('div', { class: 'card-title' }, it.name),
            h('div', { class: 'card-sub' }, sub || tm.label),
            it.tags.length ? h('div', { class: 'card-tags' }, it.tags.slice(0, 3).map((t) => h('span', {}, t))) : null,
            it.rating ? h('div', { class: 'card-stars' }, starsEl(it.rating, null, { size: 11 })) : null));
}

export function itemRow(it, { onClick, selected = false, right = null, index = null } = {}) {
    const tm = typeMeta(it.type);
    return h('div', { class: `row-item ${selected ? 'selected' : ''}`, style: { '--tc': tm.color }, onclick: onClick },
        index != null ? h('span', { class: 'row-no' }, String(index + 1).padStart(2, '0')) : null,
        h('div', { class: 'row-thumb' }, it.cover ? coverImg(it) : icon(tm.icon, { size: 20 })),
        h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, it.favorite ? icon('star', { size: 13, fill: true, cls: 'row-fav' }) : null, h('span', {}, it.name)),
            h('div', { class: 'row-sub' }, h('span', { class: 'row-type' }, tm.label), metaLine(it) ? h('span', {}, metaLine(it)) : null,
                it.tags.slice(0, 2).map((t) => h('span', { class: 'row-tag' }, t)))),
        right ?? icon('chevronRight', { size: 16, cls: 'row-chev' }));
}

export function collectionName(id) {
    return state.collections.find((c) => c.id === id)?.name || '';
}

export function section(title, ic, ...children) {
    return h('section', { class: 'panel' },
        title ? h('div', { class: 'panel-head' }, ic ? icon(ic, { size: 16 }) : null, h('h3', {}, title)) : null,
        children);
}
