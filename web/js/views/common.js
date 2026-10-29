// 视图共用组件：标题栏、卡片、列表行
// 卡片包含所有可能用到的元素（编号、叠字、角标、评分……），由各风格的 CSS 决定显示哪些。
import { h, icon, starsEl } from '../ui.js';
import { coverImg } from '../thumbs.js';
import { api } from '../api.js';
import { typeMeta, state, SKINS, viewOf, cardPrefOf } from '../state.js';
import { bridge } from '../bridge.js';
import { inTavern } from '../tavern-index.js';

/** 页面标题栏：kicker / 标题 / 副标题 + 右侧操作 */
export function topbar(title, { kicker = '', sub = '', actions = [] } = {}) {
    return h('header', { class: 'topbar' },
        h('div', { class: 'tb-row' },
            h('div', { class: 'tb-titles' },
                h('div', { class: 'tb-kicker' }, kicker || (SKINS[state.settings.skin]?.en || 'Atelier')),
                h('h1', { class: 'tb-title' }, title),
                sub ? h('div', { class: 'tb-sub' }, sub) : null),
            h('div', { class: 'tb-actions' }, actions,
                // 在酒馆插件里全屏打开时，插件自己的标题栏会隐藏，关闭按钮放在这里
                bridge.embedded ? h('button', { class: 'btn ghost icon tb-close', title: '关闭，回到酒馆', 'aria-label': '关闭', onclick: () => bridge.close() }, icon('x', { size: 19 })) : null)));
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
    else if (it.ai?.summary || it.searchText || it.description || it.notes) body = h('p', { class: 'doc-text' }, (it.ai?.summary || it.description || it.notes || it.searchText).slice(0, 160));
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
        // 藏馆里改过的作者优先，没填才用卡里自带的
        if (it.author || m.card.creator) parts.push(it.author || m.card.creator);
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

// 列表重画时，没变过的卡片直接复用（图片不用重新解码）
const cardCache = new Map();
const cardNo = (i) => `No.${String(i + 1).padStart(3, '0')}`;

/** 版本数：当前版本和有内容指纹的旧版本（不算附件） */
export const versionCount = (it) => it.files.filter((x) => x.primary || x.sig).length;

/**
 * 封面角标：每种标记放在哪个角由「设置 → 外观 → 封面角标」决定（每台设备各自设置）。
 * src：ver 版本数 · dupe 可能重复 · tavern 酒馆里已有 · tag:<标签> · field:<字段 id>；pos：tl / tr / bl / br
 */
export const MARK_POS = { tl: '左上', tr: '右上', bl: '左下', br: '右下' };
export const DEFAULT_MARKS = [{ src: 'ver', pos: 'bl' }, { src: 'dupe', pos: 'bl' }, { src: 'tavern', pos: 'br' }];
/** type 不传或是 'all' 就是默认规则 */
export const markRules = (type) => { const m = cardPrefOf(type).marks; return (Array.isArray(m) ? m : DEFAULT_MARKS).filter((x) => x && MARK_POS[x.pos]); };
// 能当角标的字段：值短、一眼能看懂的
export const MARK_FIELD_KINDS = new Set(['checkbox', 'select', 'text', 'number', 'tags']);
const TOP_FIELDS = new Set(['author', 'version', 'rating']);
// 每个角最多显示几个，多的折成「+n」；紧凑视图卡片小，少放一个
const maxPerCorner = () => (viewOf().dense ? 2 : 3);

/** 规则的名字（设置页里显示） */
export function markName(src) {
    if (src === 'ver') return '版本数';
    if (src === 'dupe') return '可能重复';
    if (src === 'tavern') return '酒馆里已有';
    if (src === 'tags') return '标签（这张卡自己的）';
    if (src.startsWith('tag:')) return `标签「${src.slice(4)}」`;
    if (src.startsWith('field:')) return state.fields.find((f) => f.id === src.slice(6))?.label || '（已删除的字段）';
    return src;
}

function fieldMark(it, id) {
    const f = state.fields.find((x) => x.id === id);
    if (!f || !MARK_FIELD_KINDS.has(f.kind) || (f.types?.length && !f.types.includes(it.type))) return null;
    const v = TOP_FIELDS.has(id) ? it[id] : it.fields?.[id];
    if (f.kind === 'checkbox') return v ? f.label : null;
    const t = Array.isArray(v) ? v[0] : v;
    if (t == null || t === '') return null;
    const str = String(t);
    return str.length > 10 ? `${str.slice(0, 9)}…` : str;
}

/** 这个条目要显示的角标：[{ k, label, pos, title }] */
function marksOf(it, dupe) {
    const out = [];
    const rules = markRules(it.type);
    for (const { src, pos } of rules) {
        let label = null;
        let k = src;
        let title = '';
        if (src === 'ver') { const n = versionCount(it); if (n > 1) label = `${n} 版`; } else if (src === 'dupe') { if (dupe) label = '可能重复'; } else if (src === 'tavern') { if (inTavern(it)) { label = '酒馆'; title = '酒馆里已经有同名的'; } } else if (src === 'tags') { for (const t of it.tags) if (!rules.some((r) => r.src === `tag:${t}`)) out.push({ k: 'tag', label: t, pos, title: '标签' }); } else if (src.startsWith('tag:')) { k = 'tag'; if (it.tags.includes(src.slice(4))) label = src.slice(4); } else if (src.startsWith('field:')) { k = 'field'; label = fieldMark(it, src.slice(6)); title = markName(src); }
        if (label) out.push({ k, label, pos, title });
    }
    return out;
}
const marksKey = (marks) => `${maxPerCorner()}|${marks.map((m) => `${m.pos}:${m.k}:${m.label}`).join(',')}`;

function markEl(m) {
    return h('span', { class: `badge-${m.k}`, title: m.title || null }, m.k === 'tavern' ? icon('beer', { size: 11 }) : null, m.label);
}

/** 卡片：四个角各一组，每组最多 3 个（紧凑视图 2 个），多的显示「+n」 */
function cornerEls(marks) {
    return Object.keys(MARK_POS).map((pos) => {
        const list = marks.filter((m) => m.pos === pos);
        if (!list.length) return null;
        const max = maxPerCorner();
        const el = h('span', { class: `card-corner corner-${pos}`, dataset: { extra: Math.max(0, list.length - max) } }, list.slice(0, max).map(markEl));
        el.tvRest = list.slice(max).map((m) => m.label);
        return el;
    });
}

// 每个角最多占封面一半高度。小卡片上放不下的角标整个收进「+n」，不会被切掉一半：
// 卡片第一次出现在屏幕上时量一次，窗口大小变了再量
function fitCorners(card) {
    for (const c of card.querySelectorAll('.card-corner')) {
        const chips = [...c.children].filter((x) => !x.classList.contains('badge-more'));
        for (const x of chips) x.classList.remove('is-cut');
        const box = c.getBoundingClientRect();
        if (!box.height) continue;
        let more = c.querySelector('.badge-more');
        const cut = [];
        const setMore = () => {
            const n = Number(c.dataset.extra || 0) + cut.length;
            if (!n) { more?.remove(); more = null; return; }
            if (!more) { more = h('span', { class: 'badge-more' }); c.append(more); }
            more.textContent = `+${n}`;
            more.title = [...cut.map((x) => x.textContent), ...(c.tvRest || [])].join('、');
        };
        const outside = (x) => { const r = x.getBoundingClientRect(); return r.top < box.top - 1 || r.bottom > box.bottom + 1; };
        setMore();
        for (let i = chips.length - 1; i >= 0 && [...chips.filter((x) => !x.classList.contains('is-cut')), more].some((x) => x && outside(x)); i--) {
            chips[i].classList.add('is-cut');
            cut.unshift(chips[i]);
            setMore();
        }
    }
}
const fitIO = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) fitCorners(e.target); }, { rootMargin: '150px' }) : null;
const fitCards = new Set();
let fitTimer = 0;
const refitSoon = () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { for (const el of fitCards) { fitIO?.unobserve(el); fitIO?.observe(el); } }, 150);
};
window.addEventListener('resize', refitSoon);
// 换风格、改字号、隐藏评分 / 编号时，角上能用的空间也变了
new MutationObserver(refitSoon).observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin', 'style'] });

export function itemCard(it, { onClick, selected = false, selecting = false, index = 0, dupe = false } = {}) {
    const marks = marksOf(it, dupe);
    const key = [it.updatedAt, it.thumb, it.cover, it.favorite, it.rating, it.files.length, marksKey(marks), hideCls(it)].join('|');
    const hit = cardCache.get(it.id);
    if (hit && hit.key === key) {
        hit.el.tvClick = onClick;
        hit.el.classList.toggle('selected', selected);
        hit.el.classList.toggle('selecting', selecting);
        const no = hit.el.querySelector('.card-no');
        if (no) no.textContent = cardNo(index);
        return hit.el;
    }
    const el = buildCard(it, { selected, selecting, index, marks });
    el.dataset.id = it.id;
    el.tvClick = onClick;
    el.addEventListener('click', (e) => el.tvClick?.(e));
    if (el.querySelector('.card-corner')) { fitCards.add(el); fitIO?.observe(el); }
    cardCache.set(it.id, { key, el });
    if (cardCache.size > 2000) {
        const [oldId, old] = cardCache.entries().next().value;
        cardCache.delete(oldId);
        if (fitCards.delete(old.el)) fitIO?.unobserve(old.el);
    }
    return el;
}

function buildCard(it, { selected, selecting, index, marks }) {
    const tm = typeMeta(it.type);
    const media = it.cover ? coverImg(it) : docPreview(it);
    const sub = metaLine(it);
    return h('article', { class: `card ${it.cover ? 'has-cover' : 'is-doc'} ${it.fields?.nsfw ? 'nsfw' : ''} ${selected ? 'selected' : ''} ${selecting ? 'selecting' : ''} ${hideCls(it)}`, style: { '--tc': tm.color }, dataset: { type: it.type } },
        h('div', { class: 'card-media' },
            h('div', { class: 'card-frame' }, media, cornerEls(marks)),
            h('span', { class: 'card-no' }, cardNo(index)),
            h('span', { class: 'card-type' }, icon(tm.icon, { size: 11 }), h('span', {}, tm.label)),
            it.favorite ? h('span', { class: 'card-fav' }, icon('star', { size: 13, fill: true })) : null,
            it.rating ? h('span', { class: 'card-rank' }, icon('star', { size: 10, fill: true }), String(it.rating)) : null,
            h('span', { class: 'card-check' }, icon('check', { size: 14, stroke: 3 })),
            it.cover ? h('div', { class: 'card-overlay' }, h('div', { class: 'card-title' }, it.name), sub ? h('div', { class: 'card-sub' }, sub) : null) : null),
        h('div', { class: 'card-body' },
            h('div', { class: 'card-title' }, it.name),
            h('div', { class: 'card-sub' }, sub || tm.label),
            aiLine(it, 'card-ai'),
            it.tags.length ? h('div', { class: 'card-tags' }, it.tags.slice(0, 3).map((t) => h('span', {}, t))) : null,
            it.rating ? h('div', { class: 'card-stars' }, starsEl(it.rating, null, { size: 11 })) : null));
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** 把 text 里出现的搜索词包上 <mark>，返回安全的 HTML */
export function markTerms(text, terms) {
    const src = String(text ?? '');
    const ts = [...new Set((terms || []).filter(Boolean))].sort((a, b) => b.length - a.length);
    if (!ts.length) return escHtml(src);
    const re = new RegExp(ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
    let out = '';
    let last = 0;
    for (const m of src.matchAll(re)) {
        out += `${escHtml(src.slice(last, m.index))}<mark>${escHtml(m[0])}</mark>`;
        last = m.index + m[0].length;
    }
    return out + escHtml(src.slice(last));
}

/**
 * 搜索时：名称里的搜索词高亮；命中在正文里的，在名称下面显示「开场白：…片段…」。
 * hit = { terms, where?, snip? }；hit 为 null 时还原成普通样子（卡片元素是缓存复用的）
 */
export function applyHit(el, it, hit) {
    const titles = el.querySelectorAll('.card-title, .row-title > span:last-child');
    const sig = hit ? `${hit.terms.join(' ')}|${hit.where || ''}|${hit.snip || ''}` : '';
    if ((el.tvHit || '') === sig) return el;
    el.tvHit = sig;
    for (const t of titles) { if (hit?.terms.length) t.innerHTML = markTerms(it.name, hit.terms); else t.textContent = it.name; }
    el.querySelector('.search-hit')?.remove();
    if (hit?.snip) {
        const box = h('div', { class: 'search-hit' }, h('span', { class: 'search-hit-where' }, hit.where));
        box.insertAdjacentHTML('beforeend', markTerms(hit.snip, hit.terms));
        (el.querySelector('.card-body') || el.querySelector('.row-main'))?.append(box);
    }
    return el;
}

/** 这个类型设置了不显示的部分：no-tags / no-rating / no-no */
function hideCls(it) {
    const c = cardPrefOf(it.type);
    return [c.showTags ? '' : 'no-tags', c.showRating ? '' : 'no-rating', c.showNo ? '' : 'no-no'].filter(Boolean).join(' ');
}

// 仓库列表视图的行同样复用；其他地方（right 是按钮等）每次新建
const rowCache = new Map();

export function itemRow(it, opts = {}) {
    if (!opts.cache) return buildRow(it, opts);
    const { onClick, selected = false, right = null, index = null, dupe = false } = opts;
    const key = [it.updatedAt, it.thumb, it.cover, selected, index, right ? right.className : '', it.files.length, marksKey(marksOf(it, dupe)), hideCls(it)].join('|');
    const hit = rowCache.get(it.id);
    if (hit && hit.key === key) { hit.el.tvClick = onClick; return hit.el; }
    const el = buildRow(it, { selected, right, index, dupe });
    el.dataset.id = it.id;
    el.tvClick = onClick;
    el.addEventListener('click', (e) => el.tvClick?.(e));
    rowCache.set(it.id, { key, el });
    if (rowCache.size > 2000) rowCache.delete(rowCache.keys().next().value);
    return el;
}

function buildRow(it, { onClick, selected = false, right = null, index = null, dupe = false } = {}) {
    const tm = typeMeta(it.type);
    return h('div', { class: `row-item ${it.fields?.nsfw ? 'nsfw' : ''} ${selected ? 'selected' : ''} ${hideCls(it)}`, style: { '--tc': tm.color }, onclick: onClick },
        index != null ? h('span', { class: 'row-no' }, String(index + 1).padStart(2, '0')) : null,
        h('div', { class: 'row-thumb' }, it.cover ? coverImg(it) : icon(tm.icon, { size: 20 })),
        h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, it.favorite ? icon('star', { size: 13, fill: true, cls: 'row-fav' }) : null, h('span', {}, it.name)),
            h('div', { class: 'row-sub' }, h('span', { class: 'row-type' }, tm.label), badgeEls(it, dupe), metaLine(it) ? h('span', {}, metaLine(it)) : null,
                it.tags.slice(0, 2).map((t) => h('span', { class: 'row-tag' }, t))),
            aiLine(it, 'row-ai')),
        right ?? icon('chevronRight', { size: 16, cls: 'row-chev' }));
}

/** AI 整理写的一句话简介（设置里可以关掉） */
function aiLine(it, cls) {
    const s = it.ai?.summary;
    return s ? h('div', { class: `ai-line ${cls}`, title: `AI 简介：${s}` }, s) : null;
}

/** 列表行没有封面，角标排在名字下面 */
function badgeEls(it, dupe) {
    const list = marksOf(it, dupe);
    return list.length ? h('span', { class: 'row-badges' }, list.map(markEl)) : null;
}

export function collectionName(id) {
    return state.collections.find((c) => c.id === id)?.name || '';
}

export function section(title, ic, ...children) {
    return h('section', { class: 'panel' },
        title ? h('div', { class: 'panel-head' }, ic ? icon(ic, { size: 16 }) : null, h('h3', {}, title)) : null,
        children);
}
