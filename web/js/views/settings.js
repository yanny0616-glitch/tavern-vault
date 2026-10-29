// 设置
import { h, clear, toast, confirmDialog, choiceDialog, promptDialog, sheet, downloadBlob, switchEl, icon, btn, fmtBytes, fmtDate } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { native, LAUNCHER_URL } from '../native.js';
import { state, savePrefs, applyAccent, reload, TYPE_META, SKINS, uiFont, readZoom, UI_FONT, READ_ZOOM, notify, allTags, resetView, cardPrefOf, setCardPref, resetCardPref } from '../state.js';
import { CARD_PARTS, ENTRY_FLAGS } from '../sig.js';
import { SORTS } from './library.js';
import { topbar, ensureView, MARK_POS, DEFAULT_MARKS, MARK_FIELD_KINDS, markRules, markName } from './common.js';
import { aiSettings, aiReady } from './ai.js';
import { findDuplicates, openDuplicates } from './dupes.js';

const KINDS = { text: '单行文本', textarea: '多行文本', number: '数字', url: '链接', date: '日期', select: '下拉选择', tags: '标签列表', checkbox: '开关', rating: '星级评分', color: '颜色' };
const PLUGIN_REPO = 'https://github.com/yanny0616-glitch/tavern-vault';
const ACCENTS = ['', '#8b4a2b', '#007aff', '#d4a24c', '#e0607e', '#c23a2b', '#22d3ee', '#2f8f6f', '#8a5cb8'];

const SECTIONS = [
    { key: 'appearance', title: '外观', icon: 'palette', desc: () => `${SKINS[state.settings.skin]?.name || '典藏'} · ${{ auto: '跟随系统', light: '浅色', dark: '深色' }[state.prefs.mode || 'auto']}`, render: appearance },
    { key: 'browse', title: '浏览', icon: 'grid', desc: () => '打开页面、卡片显示、详情页', render: browse },
    { key: 'import', title: '导入与导出', icon: 'upload', desc: () => `同时上传 ${state.prefs.uploadConc || 3} 个 · 同名${CONFLICTS[state.prefs.conflict] || CONFLICTS.ask}`, render: importPrefs },
    { key: 'tags', title: '标签', icon: 'tag', desc: () => `${tagCounts().size} 个标签`, render: tagsSection },
    { key: 'fields', title: '自定义字段', icon: 'sliders', desc: () => `${state.fields.filter((f) => !f.hidden).length} 个字段在用`, render: fieldsSection },
    { key: 'ai', title: 'AI 助手', icon: 'sparkles', desc: () => (state.settings.ai?.ready ? '已配置' : '还没有配置'), render: () => panel('AI 助手', 'sparkles', null, aiSettings()) },
    { key: 'connect', title: '连接与设备', icon: 'beer', desc: () => (bridge.host ? `已连接 ${bridge.host.host}` : '酒馆插件、iPhone'), render: () => (native ? [iosApp(), connection()] : [connection(), shortcut()]) },
    { key: 'security', title: '访问密码', icon: 'lock', desc: () => (state.settings.auth ? '已启用' : '未设置'), render: () => [security(), state.settings.auth ? loginLogPanel() : null] },
    { key: 'data', title: '数据与存储', icon: 'database', desc: () => `${state.stats?.total ?? 0} 项 · ${fmtBytes(state.stats?.bytes || 0)}`, render: data },
    { key: 'about', title: '关于', icon: 'info', desc: () => `v${state.settings.version || '1.0.0'}`, render: about },
];
const CONFLICTS = { ask: '每次询问', version: '存为新版本', new: '另存为新条目', skip: '跳过' };
const wideMq = matchMedia('(min-width: 900px)');
let lastSec = null;

const rerender = () => renderSettings(document.querySelector('main.main'));
wideMq.addEventListener?.('change', () => { if (document.documentElement.dataset.route === 'settings') rerender(); });

export function renderSettings(root) {
    const refs = ensureView(root, 'settings', () => {
        const nav = h('nav', { class: 'set-nav' });
        const content = h('div', { class: 'set-content stack' });
        const layout = h('div', { class: 'set-layout' }, nav, content);
        root.append(topbar('设置', { kicker: 'Preferences' }), h('div', { class: 'page' }, layout));
        return { nav, content, layout };
    });
    if (refs.content.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const key = location.hash.split('?')[0].split('/')[2] || '';
    // 手机：先显示分类列表，点进去是单独一页；电脑：左边分类，右边内容
    const sec = SECTIONS.find((x) => x.key === key) || (wideMq.matches ? SECTIONS[0] : null);
    refs.layout.classList.toggle('has-sec', !!key);
    clear(refs.nav, h('div', { class: 'rows' }, SECTIONS.map((x) => h('a', { class: `row-item set-nav-item ${sec === x ? 'selected' : ''}`, href: `#/settings/${x.key}` },
        h('div', { class: 'row-thumb' }, icon(x.icon, { size: 19 })),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('span', {}, x.title)), h('div', { class: 'row-sub' }, h('span', {}, x.desc()))),
        icon('chevronRight', { size: 16, cls: 'row-chev' })))),
    h('div', { class: 'footnote' }, `TavernVault v${state.settings.version || '1.0.0'} · ${bridge.host ? `已连接 ${bridge.host.host}` : '独立网页模式'}`));
    if (!sec) { clear(refs.content); lastSec = null; return; }
    clear(refs.content,
        h('div', { class: 'set-head' },
            h('a', { class: 'set-back', href: '#/settings' }, icon('chevronLeft', { size: 18 }), h('span', {}, '设置')),
            h('h2', { class: 'set-title' }, sec.title)),
        sec.render());
    if (lastSec !== sec.key) window.scrollTo(0, 0);
    lastSec = sec.key;
}

/** 说明文字默认收起，点面板标题或设置名称旁边的「?」才显示 */
const help = (...kids) => h('div', { class: 'muted small set-help' }, ...kids);
// 记住展开过的说明：改了设置页面会重画，不要每次都收回去
const openHelp = new Set();
const helpBtn = (target, cls, key) => h('button', { class: 'help-btn', title: '说明', 'aria-label': '说明', onclick: (e) => {
    e.stopPropagation();
    const on = target().classList.toggle(cls);
    if (on) openHelp.add(key); else openHelp.delete(key);
} }, '?');

function panel(title, ic, head, ...children) {
    const key = `panel:${title}`;
    const el = h('section', { class: `panel ${openHelp.has(key) ? 'show-help' : ''}` });
    const title_ = h('h3', {}, title);
    const headEl = h('div', { class: 'panel-head' }, icon(ic, { size: 16 }), title_, head ? h('span', { class: 'grow' }) : null, head);
    el.append(headEl, ...children.flat(Infinity).filter(Boolean));
    // 面板里有说明（包括之后重绘出来的）时才显示「?」
    const btn_ = helpBtn(() => el, 'show-help', key);
    title_.after(btn_);
    const sync = () => { btn_.hidden = !el.querySelector('.set-help'); };
    sync();
    new MutationObserver(sync).observe(el, { childList: true, subtree: true });
    return el;
}

/** 一行设置：左边名称和说明，右边开关 / 选项 */
function setRow(label, desc, control) {
    const key = `row:${label}`;
    const row = h('div', { class: `set-row ${control.classList?.contains('switch') ? 'inline' : ''} ${openHelp.has(key) ? 'show-desc' : ''}` });
    row.append(
        h('div', { class: 'set-row-text' }, h('div', { class: 'set-row-label' }, label, desc ? helpBtn(() => row, 'show-desc', key) : null), desc ? h('div', { class: 'set-row-desc' }, desc) : null),
        h('div', { class: 'set-row-ctl' }, control));
    return row;
}
function seg(value, options, onPick) {
    return h('div', { class: 'opts' }, options.map(([v, label, ic]) => h('button', { class: `opt ${value === v ? 'active' : ''}`, onclick: () => onPick(v) }, ic ? icon(ic, { size: 14 }) : null, label)));
}
/** 数字输入框 + 加减按钮：可以直接填，也可以点加减 */
function numStep(value, { min, max, step, unit, reset }, onSet) {
    const fix = (v) => Math.round(Math.min(max, Math.max(min, v)) / step) * step;
    const set = (v) => { if (Number.isFinite(v)) onSet(fix(v)); };
    const input = h('input', { class: 'input sm', type: 'number', inputmode: 'decimal', min, max, step, value: String(value),
        onchange: (e) => { if (e.target.value === '') { e.target.value = String(value); return; } set(Number(e.target.value)); },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
    return h('div', { class: 'num-step' },
        h('button', { class: 'opt', title: '小一点', disabled: value <= min, onclick: () => set(value - step) }, icon('minus', { size: 14 })),
        input, h('span', { class: 'num-unit' }, unit),
        h('button', { class: 'opt', title: '大一点', disabled: value >= max, onclick: () => set(value + step) }, icon('plus', { size: 14 })),
        value !== reset ? h('button', { class: 'opt', onclick: () => set(reset) }, '恢复标准') : null);
}

function setPref(patch) {
    Object.assign(state.prefs, patch);
    savePrefs();
    applyAccent();
    rerender();
}
const deviceNote = () => help('这一页的设置只对这台设备生效，手机和电脑可以分别设置。');

function skinPreview(key) {
    const mode = document.documentElement.dataset.mode;
    return h('div', { class: 'skin-pv', dataset: { skin: key, mode } },
        h('div', { class: 'pv-top' }, h('span', { class: 'pv-kicker' }, SKINS[key].en), h('span', { class: 'pv-title' }, '藏馆')),
        h('div', { class: 'pv-tabs' }, h('i', { class: 'on' }), h('i'), h('i')),
        h('div', { class: 'pv-cards' },
            h('div', { class: 'pv-card' }, h('div', { class: 'pv-img' }), h('b')),
            h('div', { class: 'pv-card pv-doc' }, h('div', { class: 'pv-lines' }, h('i'), h('i'), h('i')), h('b'))),
        h('div', { class: 'pv-nav' }, h('i', { class: 'on' }), h('i'), h('i'), h('i')));
}

function appearance() {
    const current = SKINS[state.settings.skin] ? state.settings.skin : 'atelier';
    const title = h('input', { class: 'input', value: state.settings.title || '', placeholder: '酒馆藏馆', onchange: () => api.put('/api/settings', { title: title.value }) });
    return [
        panel('风格', 'palette', null,
            h('div', { class: 'skin-grid' }, Object.entries(SKINS).map(([k, v]) => h('button', {
                class: `skin-opt ${current === k ? 'active' : ''}`,
                onclick: async () => {
                    state.settings.skin = k;
                    applyAccent();
                    await api.put('/api/settings', { skin: k });
                },
            }, skinPreview(k), h('div', { class: 'skin-name' }, h('b', {}, v.name), h('span', {}, v.desc)), current === k ? h('span', { class: 'skin-check' }, icon('check', { size: 13, stroke: 3 })) : null))),
            help( '风格、强调色和仓库名称对所有设备生效（网页和酒馆插件里一致）。'),
            setRow('强调色', '按钮、选中状态等使用的颜色', h('div', { class: 'color-picker' }, ACCENTS.map((c) => h('button', {
                class: `${(state.settings.accent || '') === c ? 'active' : ''} ${c ? '' : 'auto'}`, style: { '--sw': c || 'var(--accent)' }, title: c || '跟随风格',
                onclick: () => api.put('/api/settings', { accent: c }),
            })))),
            setRow('仓库名称', '显示在浏览器标签和登录页上', title)),
        panel('这台设备', 'monitor', null,
            setRow('明暗', null, seg(state.prefs.mode || 'auto', [['auto', '跟随系统', 'monitor'], ['light', '浅色', 'sun'], ['dark', '深色', 'moon']], (v) => setPref({ mode: v }))),
            setRow('界面字号', `列表、按钮、设置等界面文字的大小，单位像素，可填 ${UI_FONT.min}～${UI_FONT.max}。标准是 15，没设过时手机默认 14`,
                numStep(uiFont(state.prefs), { ...UI_FONT, unit: 'px', reset: 15 }, (v) => setPref({ uiFont: v }))),
            setRow('阅读字号', `详情页里简介、开场白、角色卡内容的文字大小，可填 ${READ_ZOOM.min}～${READ_ZOOM.max}%`,
                numStep(readZoom(state.prefs), { ...READ_ZOOM, unit: '%', reset: 100 }, (v) => setPref({ readZoom: v }))),
            setRow('减少动画', '关闭弹出、切换时的过渡动画，旧手机上更跟手', switchEl(!!state.prefs.reduceMotion, (v) => setPref({ reduceMotion: v })))),
    ];
}

function browse() {
    const p = state.prefs;
    const viewVal = p.view === 'list' ? 'list' : p.dense ? 'dense' : 'grid';
    const cols = h('select', { class: 'select', onchange: () => setPref({ cols: Number(cols.value) }) },
        [0, 1, 2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: (p.cols || 0) === n }, n ? `${n} 个` : '自动')));
    const sort = h('select', { class: 'select', onchange: () => setPref(sort.value === 'group' ? { groupTime: true } : { sort: sort.value, groupTime: false }) },
        Object.entries(SORTS).map(([k, [label]]) => h('option', { value: k, selected: !p.groupTime && (p.sort || 'updated') === k }, label)),
        h('option', { value: 'group', selected: Boolean(p.groupTime) }, '按添加时间分组'));
    const userName = h('input', { class: 'input', value: p.userName || '', placeholder: '你', maxlength: 20, onchange: () => setPref({ userName: userName.value.trim() }) });
    return [
        panel('打开与视图', 'grid', null,
            deviceNote(),
            setRow('打开时进入', null, seg(p.start || 'library', [['library', '仓库'], ['collections', '合集'], ['stats', '统计']], (v) => setPref({ start: v }))),
            setRow('仓库视图', '「全部」和没单独设置过的类型用这个。在仓库里选了某个类型后再改显示方式，就只改那个类型', seg(viewVal, [['grid', '卡片', 'grid'], ['dense', '紧凑', 'grid3'], ['list', '列表', 'list']], (v) => setPref({ view: v === 'list' ? 'list' : 'grid', dense: v === 'dense' }))),
            setRow('每行显示', '卡片视图下每行放几个，「自动」按屏幕宽度决定', cols),
            Object.keys(p.viewByType || {}).length ? setRow('单独设置过的类型', null,
                h('div', { class: 'view-own' }, Object.entries(p.viewByType).map(([t, v]) => h('span', { class: 'chip' },
                    `${TYPE_META[t]?.label || t} · ${v.view === 'list' ? '列表' : v.dense ? '紧凑' : '卡片'}${v.view !== 'list' && v.cols ? ` · ${v.cols} 个` : ''}`,
                    h('button', { class: 'chip-x', title: '恢复成默认', onclick: () => { resetView(t); rerender(); } }, icon('x', { size: 11 })))))) : null,
            setRow('默认排序', null, sort)),
        cardShowPanel(),
        marksPanel(),
        panel('详情页', 'fileText', null,
            setRow('打开时先显示', '角色卡', seg(p.detailTab === 'content' ? 'content' : 'overview', [['overview', '介绍'], ['content', '内容']], (v) => setPref({ detailTab: v }))),
            setRow('其它类型先显示', '世界书、预设、正则等。它们的「内容」页就是条目和设置', seg(p.detailTabOther === 'overview' ? 'overview' : 'content', [['overview', '介绍'], ['content', '内容']], (v) => setPref({ detailTabOther: v }))),
            setRow('长文折叠', '超过这个字数的简介、开场白、作者的话和角色卡段落只显示开头，点「阅读全文」在单独页面看', seg(Number.isFinite(Number(p.foldAt)) ? Number(p.foldAt) : 500, [[300, '300 字'], [500, '500 字'], [1000, '1000 字'], [0, '不折叠']], (v) => setPref({ foldAt: v }))),
            setRow('{{user}} 显示为', '角色卡里出现 {{user}} 的地方替换成这个称呼', userName)),
    ];
}

// 「卡片上显示」和「封面角标」现在设置给哪个类型：all 是默认
let cardScope = 'all';
const scopeLabel = () => (cardScope === 'all' ? '' : TYPE_META[cardScope]?.label || cardScope);
function scopeRow() {
    const own = Object.keys(state.prefs.cardByType || {});
    const sel = h('select', { class: 'select', onchange: () => { cardScope = sel.value; rerender(); } },
        h('option', { value: 'all', selected: cardScope === 'all' }, '默认（所有类型）'),
        Object.entries(TYPE_META).map(([k, m]) => h('option', { value: k, selected: cardScope === k }, `${m.label}${own.includes(k) ? '（单独设置过）' : ''}`)));
    const cp = cardPrefOf(cardScope);
    return h('div', { class: 'stack-s' },
        setRow('设置给', '可以给某个类型单独设置，比如世界书不显示编号、角色卡多显示几个角标。没单独设置过的类型跟着默认走', sel),
        cardScope !== 'all' ? h('div', { class: 'muted small scope-note' }, cp.own
            ? h('span', {}, `下面的改动只对「${scopeLabel()}」生效。`, h('a', { href: '#', onclick: (e) => { e.preventDefault(); resetCardPref(cardScope); applyAccent(); rerender(); } }, '恢复成默认'))
            : `「${scopeLabel()}」还没单独设置过，现在和默认一样；改了下面的选项就只对它生效。`) : null);
}
const setCard = (patch) => { setCardPref(cardScope, patch); applyAccent(); rerender(); };

function cardShowPanel() {
    const p = state.prefs;
    const cp = cardPrefOf(cardScope);
    return panel('卡片上显示', 'image', null,
        scopeRow(),
        setRow('标签', null, switchEl(cp.showTags, (v) => setCard({ showTags: v }))),
        setRow('评分', null, switchEl(cp.showRating, (v) => setCard({ showRating: v }))),
        setRow('编号', '卡片角上的 No.001', switchEl(cp.showNo, (v) => setCard({ showNo: v }))),
        cardScope === 'all' ? [
            setRow('AI 简介', 'AI 整理写的一句话简介，显示在卡片标题和列表行下面（所有类型共用）', switchEl(p.showAi !== false, (v) => setPref({ showAi: v }))),
            setRow('模糊 NSFW 封面', '资料里勾了 NSFW 的条目，在列表里模糊封面；打开详情时正常显示（所有类型共用）', switchEl(!!p.blurNsfw, (v) => setPref({ blurNsfw: v }))),
        ] : null);
}

/** 封面角标：每种标记选一个角显示（列表视图里排在名字下面）。跟着上面「设置给」选的类型 */
function marksPanel() {
    const rules = markRules(cardScope);
    const save = (list) => setCard({ marks: list });
    const has = (src) => rules.some((r) => r.src === src);
    const add = (src) => { if (!has(src)) save([...rules, { src, pos: 'br' }]); };
    const pickTag = () => {
        const list = h('div', { class: 'menu' });
        const draw = (q = '') => clear(list, allTags().filter(([t]) => !has(`tag:${t}`) && (!q || t.toLowerCase().includes(q))).slice(0, 80)
            .map(([t, n]) => h('button', { class: 'menu-item', onclick: () => { s.close(); add(`tag:${t}`); } }, icon('tag', { size: 16 }), h('span', { class: 'grow' }, t), h('span', { class: 'muted small' }, String(n)))));
        const s = sheet({ title: '用哪个标签做角标', body: h('div', { class: 'stack-s' },
            h('label', { class: 'search inline' }, icon('search', { size: 15 }), h('input', { class: 'input search-input', placeholder: '搜索标签', oninput: (e) => draw(e.target.value.toLowerCase()) })), list) });
        draw();
    };
    const pickSource = () => {
        const opt = (ic, label, note, fn) => h('button', { class: 'menu-item', onclick: () => { s.close(); fn(); } }, icon(ic, { size: 17 }), h('span', { class: 'grow' }, h('span', { class: 'menu-label' }, label), note ? h('span', { class: 'menu-note' }, note) : null));
        const fields = state.fields.filter((f) => !f.hidden && MARK_FIELD_KINDS.has(f.kind) && !has(`field:${f.id}`));
        const s = sheet({ title: '添加角标', body: h('div', { class: 'menu' },
            !has('tavern') ? opt('beer', '酒馆里已有', '在酒馆插件里打开时，酒馆里已经有同名内容的条目', () => add('tavern')) : null,
            !has('ver') ? opt('layers', '版本数', '有多个版本时显示「3 版」', () => add('ver')) : null,
            !has('dupe') ? opt('copy', '可能重复', '和别的条目可能重复时显示', () => add('dupe')) : null,
            !has('tags') ? opt('tag', '标签（这张卡自己的）', '把卡片自己的标签显示在封面上，最多 3 个，多的显示「+数量」', () => add('tags')) : null,
            opt('tag', '指定标签', '只在带有某个标签（比如「推荐」）的卡片上显示', pickTag),
            fields.map((f) => opt('fileText', `字段：${f.label}`, f.kind === 'checkbox' ? '勾选了就显示' : '填了就显示填的内容', () => add(`field:${f.id}`)))) });
    };
    const posPick = (r, i) => h('div', { class: 'pos-pick', title: '显示在哪个角' }, Object.entries(MARK_POS).map(([k, label]) =>
        h('button', { class: `pos-cell ${r.pos === k ? 'on' : ''}`, title: label, 'aria-label': label, onclick: () => save(rules.map((x, j) => (j === i ? { ...x, pos: k } : x))) })));
    return panel(scopeLabel() ? `封面角标 · ${scopeLabel()}` : '封面角标', 'tag', null,
        help((scopeLabel() ? `只对「${scopeLabel()}」生效，在上面「设置给」里切换。` : '') + '选择卡片封面四个角上显示什么。每个角最多显示 3 个，多的显示「+数量」；列表视图里排在名字下面。已有的收藏星标、多选勾、评分会自动让开。'),
        rules.length ? h('div', { class: 'mark-rules' }, rules.map((r, i) => h('div', { class: 'mark-rule' },
            h('span', { class: 'grow mark-rule-name' }, markName(r.src)),
            h('span', { class: 'muted small' }, MARK_POS[r.pos]),
            posPick(r, i),
            btn('', { icon: 'x', cls: 'sm ghost icon', title: '不显示这个角标', onclick: () => save(rules.filter((_, j) => j !== i)) }))))
            : h('div', { class: 'muted small' }, '现在封面上不显示任何角标'),
        h('div', { class: 'row-actions' },
            btn('添加角标', { icon: 'plus', cls: 'sm', onclick: pickSource }),
            btn('恢复默认', { cls: 'sm ghost', onclick: () => save(DEFAULT_MARKS.map((x) => ({ ...x }))) })));
}

function importPrefs() {
    const p = state.prefs;
    return [
        panel('这台设备', 'upload', null,
            setRow('同时上传', '一次导入很多文件时同时传几个；网络不稳定可以调小', seg(Number(p.uploadConc) || 3, [1, 2, 3, 4, 5, 6].map((n) => [n, String(n)]), (v) => setPref({ uploadConc: v }))),
            setRow('同名条目', '导入的文件和已有条目同名但内容不同时怎么处理。内容完全一样的会自动跳过', seg(CONFLICTS[p.conflict] ? p.conflict : 'ask', Object.entries(CONFLICTS), (v) => setPref({ conflict: v })))),
        syncIgnorePanel(),
        syncExcludePanel(),
        dupPanel(),
        panel('导出与推送到酒馆', 'download', null,
            setRow('写入藏馆的整理信息', '下载、导出 ZIP、推送到酒馆的角色卡里，附上藏馆里的标签、评分、收藏、笔记和合集（放在卡的扩展字段里，不影响酒馆使用）。以后再导入这张卡，会自动恢复这些信息。卡里已经带着的，不管这里开没开都会读回来',
                switchEl(state.settings.exportMeta === true, async (v) => { state.settings.exportMeta = v; await api.put('/api/settings', { exportMeta: v }); toast('已保存', 'ok'); }))),
    ];
}

/** 重复判断：名字里带这些分隔符的算衍生版本，不提示重复（所有设备共用） */
const SEP_CHOICES = ['-', '·', '_', '~', '#', '/', '|', '+'];
function dupPanel() {
    const cur = state.settings.dupSeparators || [];
    const save = async (list) => {
        state.settings.dupSeparators = list;
        await api.put('/api/settings', { dupSeparators: list });
        toast('已保存', 'ok');
        notify();
        rerender();
    };
    const toggle = (c) => save(cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
    const custom = h('input', { class: 'input sm sep-input', maxlength: 4, placeholder: '其它符号',
        onkeydown: (e) => { if (e.key === 'Enter') add(); } });
    const add = () => { const v = custom.value.trim(); if (v && !cur.includes(v)) save([...cur, v]); };
    const all = [...new Set([...SEP_CHOICES, ...cur])];
    return panel('重复判断', 'layers', null,
        setRow('衍生版本的分隔符', '名字里带选中符号的，算作不同的衍生版本，不提示「可能重复」。例如选了「-」和「·」，「蔚轶-31」和「蔚轶-34」、「赵长卿·重置版」和「赵长卿·鬓边花」都算不同的卡，名字完全一样才算重复。内容完全相同的仍然会提示；「-v2」「(2)」「副本」这类写法仍然算同一张卡的版本。导入时判断同名也按这个规则',
            h('div', { class: 'stack-s' },
                h('div', { class: 'opts' }, all.map((c) => h('button', { class: `opt sep-opt ${cur.includes(c) ? 'active' : ''}`, title: c === '·' ? '也包括 ・ 和 •' : '', onclick: () => toggle(c) }, cur.includes(c) ? icon('check', { size: 12, stroke: 3 }) : null, c))),
                h('div', { class: 'row-actions' }, custom, btn('添加', { cls: 'sm', onclick: add })))));
}

/** 从酒馆同步时排除的世界书条目（所有设备共用） */
/** 从酒馆同步角色卡时，忽略自己在酒馆里改过的部分 */
function syncIgnorePanel() {
    const box = h('div');
    const draw = () => {
        const ign = new Set(state.settings.syncIgnore || []);
        const keep = state.settings.syncKeep !== false;
        const save = async (patch, local = patch) => {
            Object.assign(state.settings, local);
            draw();
            await api.put('/api/settings', patch);
            toast('已保存', 'ok');
        };
        const chips = (opts) => h('div', { class: 'opts' }, Object.entries(opts).map(([k, label]) => h('button', { class: `opt ${ign.has(k) ? 'active' : ''}`, onclick: () => {
            const on = !ign.has(k);
            save({ syncIgnoreSet: { [k]: on } }, { syncIgnore: on ? [...ign, k] : [...ign].filter((x) => x !== k) });
        } }, ign.has(k) ? icon('check', { size: 13, stroke: 3 }) : null, label)));
        clear(box,
            help( '在酒馆里改过以后，酒馆页会显示「酒馆有改动」，收藏时会存成新版本。'
                + '勾选的部分，比对时不看它们的差异：只有这些不同，就算「已同步」，也不会存成新版本。角色的名字、作者、版本号始终会比对。默认都不勾选。'),
            h('div', { class: 'sub-label' }, '角色卡'),
            chips(CARD_PARTS),
            help( '角色设定 = 描述、性格、场景、对话示例、系统提示词、后置指令、深度提示词。「内嵌世界书」整本不比对，只建议在 TT 里对这张卡选过「保留当前版本」时使用：卡里的内嵌世界书平时就是作者原版，你在世界书编辑器里的改动不会进卡。'),
            h('div', { class: 'sub-label' }, '世界书条目（内嵌世界书和单独的世界书都适用）'),
            chips(ENTRY_FLAGS),
            help( '比如在酒馆里开关了某些条目、把蓝灯改成绿灯，勾选后这些改动不算差异。条目的关键词和内容始终比对；顺序、插入位置、深度、概率本来就不算差异。'),
            ign.size ? setRow('收新版本时保留藏馆原来的这些部分', '其它部分有真正的改动、存成新版本时，勾选的部分仍用藏馆当前版本的内容（条目状态按关键词和内容对应到原来的条目），不把自己在酒馆里的改动存进去。关掉则原样保存',
                switchEl(keep, (v) => save({ syncKeep: v }))) : null,
            ign.size ? help('「用藏馆版本覆盖酒馆」会整张替换酒馆里的卡，自己改过的这几部分也会被换掉。酒馆里单独的世界书文件不受影响。') : null);
    };
    draw();
    return panel('从酒馆同步时哪些不算差异', 'user', null, box);
}

// ---------------- 标签管理 ----------------
const TAG_SPLIT = /[，、,;；]/;
const CARD_TAG_MODES = [['all', '全部收下'], ['known', '只收已有的'], ['none', '不收']];
let tagQuery = '';
let tagSort = 'count';
let tagSelecting = false;
const tagSel = new Set();

/** 标签 → 使用次数（不含回收站） */
function tagCounts() {
    const m = new Map();
    for (const it of state.items) if (!it.deletedAt) for (const t of it.tags) m.set(t, (m.get(t) || 0) + 1);
    return m;
}

/** remember：把合并掉的写法记成同义词，以后自动换成合并后的标签 */
async function replaceTags(ops, done, remember = false) {
    try {
        const r = await api.post('/api/tags/replace', { ops, remember });
        toast(done(r.count), 'ok');
        await reload();
        return true;
    } catch (e) { toast(e.message, 'err'); return false; }
}

const REMEMBER_HELP = '以后导入的卡、AI 整理、手动打标签时，遇到合并掉的写法会自动换成保留的标签。记下的写法在下面的「同义词」里，可以删掉。';

/** 合并几个标签：选一个保留（或者起个新名字）。返回 { ops, remember, to }，取消时返回 null */
async function mergeTagsDialog(tags, counts) {
    let target = [...tags].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))[0];
    let remember = true;
    const custom = h('input', { class: 'input', placeholder: '或者合并成一个新名字', maxlength: 60, oninput: () => draw() });
    const list = h('div', { class: 'opts' });
    const draw = () => clear(list, tags.map((t) => h('button', { class: `opt ${!custom.value.trim() && t === target ? 'active' : ''}`, onclick: () => { target = t; custom.value = ''; draw(); } },
        t, h('span', { class: 'opt-n' }, counts.get(t) || 0))));
    draw();
    const body = h('div', { class: 'stack' },
        h('div', { class: 'muted small' }, `把这 ${tags.length} 个标签合成一个，保留哪个写法？`),
        list, custom,
        setRow('记住合并掉的写法', REMEMBER_HELP, switchEl(remember, (v) => { remember = v; })));
    const choice = await choiceDialog(body, [{ key: 'ok', label: '合并', cls: 'primary' }], { title: '合并标签' });
    if (choice !== 'ok') return null;
    const to = custom.value.trim() || target;
    return { ops: [{ from: tags.filter((t) => t !== to), to: [to] }], remember, to };
}

/** AI 看全部标签，建议哪些可以合并；勾选后一次合并 */
function aiTagSuggest(total) {
    const body = h('div', {}, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, `AI 正在看 ${total} 个标签…`)));
    const foot = h('div', { class: 'sheet-foot' });
    foot.hidden = true;
    const s = sheet({ title: 'AI 合并建议', body, full: true });
    s.el.append(foot);
    api.post('/api/ai/tags/suggest').then((r) => {
        if (!r.groups.length) {
            clear(body, h('div', { class: 'stack-s' }, h('div', { class: 'muted' }, `AI 看了 ${r.total} 个标签，没有找到需要合并的。`)));
            return;
        }
        let remember = true;
        const picks = r.groups.map((g) => ({ on: true, to: g.to, all: [...(g.toCount || !g.from.some((f) => f.tag === g.to) ? [{ tag: g.to, count: g.toCount }] : []), ...g.from], g }));
        const okBtn = btn('', { icon: 'merge', cls: 'primary', onclick: async () => {
            const ops = picks.filter((p) => p.on).map((p) => ({ from: p.all.map((x) => x.tag).filter((t) => t !== p.to), to: [p.to] }));
            okBtn.disabled = true;
            if (await replaceTags(ops, (n) => `已合并 ${ops.length} 组，涉及 ${n} 项`, remember)) s.close(); else okBtn.disabled = false;
        } });
        const count = () => { const n = picks.filter((p) => p.on).length; clear(okBtn, icon('merge', { size: 16 }), `合并选中的 ${n} 组`); okBtn.disabled = !n; };
        const card = (p) => {
            const el = h('section', { class: `tag-sug ${p.on ? '' : 'off'}` });
            const draw = () => clear(el,
                h('div', { class: 'tag-sug-head' },
                    h('button', { class: `row-check ${p.on ? 'on' : ''}`, title: p.on ? '不合并这组' : '合并这组', onclick: () => { p.on = !p.on; el.classList.toggle('off', !p.on); draw(); count(); } }, p.on ? icon('check', { size: 13, stroke: 3 }) : null),
                    h('div', { class: 'grow tag-sug-to' }, '合并成 ', h('b', {}, p.to), p.g.toCount ? null : h('span', { class: 'chip-s info' }, '新标签'))),
                h('div', { class: 'opts' }, p.all.map((x) => h('button', { class: `opt ${x.tag === p.to ? 'active' : ''}`, title: '保留这个写法', onclick: () => { p.to = x.tag; draw(); } }, x.tag, h('span', { class: 'opt-n' }, x.count || 0)))),
                p.g.reason ? h('div', { class: 'muted small' }, p.g.reason) : null);
            draw();
            return el;
        };
        clear(body, h('div', { class: 'stack-s' },
            h('div', { class: 'muted small' }, `AI 看了 ${r.total} 个标签，建议合并下面 ${r.groups.length} 组。点标签可以换成保留那个写法；不想合并的取消勾选。`),
            picks.map(card),
            setRow('记住合并掉的写法', REMEMBER_HELP, switchEl(remember, (v) => { remember = v; }))));
        foot.hidden = false;
        clear(foot, btn('取消', { onclick: () => s.close() }), okBtn);
        count();
    }).catch((e) => clear(body, h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, e.message))));
}

/** 同义词：旧写法 → 现在用的标签 */
function aliasPanel() {
    const aliases = { ...(state.settings.tagAliases || {}) };
    const entries = Object.entries(aliases).sort((a, b) => a[1].localeCompare(b[1], 'zh') || a[0].localeCompare(b[0], 'zh'));
    const save = async (next, msg) => {
        try { await api.put('/api/tags/aliases', { aliases: next }); toast(msg, 'ok'); await reload(); } catch (e) { toast(e.message, 'err'); }
    };
    const from = h('input', { class: 'input', placeholder: '旧写法，例如 都市', maxlength: 60 });
    const to = h('input', { class: 'input', placeholder: '换成，例如 现代', maxlength: 60 });
    const add = () => {
        const a = from.value.trim();
        const b = to.value.trim();
        if (!a || !b || a === b) { toast('两边都要填，而且不能一样', 'err'); return; }
        save({ ...aliases, [a]: b }, `以后「${a}」会自动换成「${b}」`);
    };
    return panel(`同义词${entries.length ? ` · ${entries.length}` : ''}`, 'merge', null,
        help('左边的写法以后会自动换成右边的标签：导入卡片、AI 整理、手动打标签都算。合并标签时勾选「记住合并掉的写法」会自动加到这里。已经打上的标签不受影响，要改用上面的合并。'),
        entries.length ? h('div', { class: 'rule-list' }, entries.map(([a, b]) => h('span', { class: 'rule-chip' }, h('span', {}, `${a} → ${b}`),
            h('button', { title: '删除', onclick: () => { const next = { ...aliases }; delete next[a]; save(next, `已删除「${a}」`); } }, icon('x', { size: 12 })))))
            : h('div', { class: 'muted small' }, '还没有同义词'),
        h('div', { class: 'input-group' }, from, to, btn('添加', { icon: 'plus', onclick: add })));
}

function tagsSection() {
    const counts = tagCounts();
    const all = [...counts.entries()];
    const splittable = all.filter(([t]) => TAG_SPLIT.test(t));
    const mode = state.settings.cardTags || 'all';
    const list = h('div', { class: 'rows tag-admin' });
    const search = h('input', { class: 'input search-input', type: 'search', placeholder: `在 ${all.length} 个标签里找`, value: tagQuery, oninput: () => { tagQuery = search.value.trim(); draw(); } });
    const sortSeg = h('div');

    const rename = async (t) => {
        const v = await promptDialog(`把「${t}」改成：`, { value: t, title: '改名', ok: '改名' });
        const to = String(v ?? '').trim();
        if (!to || to === t) return;
        if (counts.has(to) && !(await confirmDialog(`已经有「${to}」这个标签（${counts.get(to)} 项）。改名后两个标签会合并成「${to}」。`, { ok: '合并', title: '合并标签' }))) return;
        replaceTags([{ from: [t], to: [to] }], (n) => `已改名，涉及 ${n} 项`, true);
    };
    const split = (t) => {
        const parts = t.split(TAG_SPLIT).map((x) => x.trim()).filter(Boolean);
        replaceTags([{ from: [t], to: parts }], (n) => `已拆成 ${parts.length} 个标签，涉及 ${n} 项`);
    };
    const remove = async (t) => {
        if (!(await confirmDialog(`从 ${counts.get(t)} 个条目里去掉标签「${t}」？`, { ok: '删除', danger: true, title: '删除标签' }))) return;
        replaceTags([{ from: [t], to: [] }], (n) => `已从 ${n} 项里删除`);
    };
    const show = (t) => {
        Object.assign(state.filter, { tagsIn: [t], tagsOut: [], quick: [], type: 'all', q: '' });
        location.hash = '#/library';
    };

    const draw = () => {
        clear(sortSeg, seg(tagSort, [['count', '按次数'], ['name', '按名称']], (v) => { tagSort = v; draw(); }));
        const q = tagQuery.toLowerCase();
        const rows = all.filter(([t]) => !q || t.toLowerCase().includes(q))
            .sort(tagSort === 'name' ? (a, b) => a[0].localeCompare(b[0], 'zh') : (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
        const toggle = (t) => { if (tagSel.has(t)) tagSel.delete(t); else tagSel.add(t); draw(); };
        clear(list, rows.length ? rows.map(([t, n]) => h('div', { class: 'row-item tag-admin-row' },
            tagSelecting ? h('button', { class: `row-check ${tagSel.has(t) ? 'on' : ''}`, title: '选择', onclick: () => toggle(t) }, tagSel.has(t) ? icon('check', { size: 13, stroke: 3 }) : null) : null,
            h('button', { class: 'tag-admin-name', title: tagSelecting ? '选择' : '在仓库里查看带这个标签的条目', onclick: () => (tagSelecting ? toggle(t) : show(t)) }, h('span', { class: 'min0' }, t), h('span', { class: 'fold-count' }, n)),
            tagSelecting ? null : [
                TAG_SPLIT.test(t) ? btn('拆开', { cls: 'sm ghost', title: '按逗号拆成几个标签', onclick: () => split(t) }) : null,
                btn('', { icon: 'pencil', cls: 'sm ghost icon', title: '改名 / 合并', onclick: () => rename(t) }),
                btn('', { icon: 'trash', cls: 'sm ghost icon', title: '删除', onclick: () => remove(t) })]))
            : h('div', { class: 'muted small' }, all.length ? '没有匹配的标签' : '还没有标签'));
        for (const t of [...tagSel]) if (!counts.has(t)) tagSel.delete(t);
        clear(selBar, tagSelecting ? [
            h('span', { class: 'grow muted small' }, tagSel.size ? `已选 ${tagSel.size} 个` : '点标签选择要合并的几个'),
            btn('取消', { cls: 'sm ghost', onclick: () => { tagSelecting = false; tagSel.clear(); draw(); } }),
            btn(`合并${tagSel.size > 1 ? ` ${tagSel.size} 个` : ''}`, { icon: 'merge', cls: 'sm primary', disabled: tagSel.size < 2, onclick: async () => {
                const m = await mergeTagsDialog([...tagSel], counts);
                if (!m) return;
                // 先退出多选：合并后页面会按新数据重画
                tagSelecting = false;
                tagSel.clear();
                replaceTags(m.ops, (n) => `已合并成「${m.to}」，涉及 ${n} 项`, m.remember);
            } })] : null);
        selBar.hidden = !tagSelecting;
    };
    const selBar = h('div', { class: 'tag-sel-bar' });
    draw();

    return [
        panel('导入时', 'upload', null,
            setRow('卡里自带的标签', '作者常在卡里塞很多标签。「只收已有的」：只收你仓库里已经有的标签；「不收」：一个都不要，自己打。用逗号连在一起的会自动拆开',
                seg(mode, CARD_TAG_MODES, async (v) => { state.settings.cardTags = v; rerender(); await api.put('/api/settings', { cardTags: v }); toast('已保存', 'ok'); }))),
        panel(`所有标签 · ${all.length}`, 'tag', null,
            help('点标签名在仓库里查看。改名成已有的标签就是合并；要一次合并好几个，用「多选合并」。回收站里的条目会一起改。'),
            all.length > 1 ? h('div', { class: 'row-actions tag-admin-acts' },
                btn('多选合并', { icon: 'checkSquare', cls: 'sm', onclick: () => { tagSelecting = !tagSelecting; tagSel.clear(); draw(); } }),
                aiReady() ? btn('AI 找可合并的', { icon: 'sparkles', cls: 'sm', onclick: () => aiTagSuggest(all.length) }) : null) : null,
            splittable.length ? h('div', { class: 'note' }, icon('info', { size: 15 }),
                h('span', { class: 'grow' }, `有 ${splittable.length} 个标签是几个词用逗号连在一起的，比如「${splittable[0][0].slice(0, 16)}${splittable[0][0].length > 16 ? '…' : ''}」`),
                btn('全部拆开', { cls: 'sm', onclick: () => replaceTags(splittable.map(([t]) => ({ from: [t], to: t.split(TAG_SPLIT).map((x) => x.trim()).filter(Boolean) })), (n) => `已拆开，涉及 ${n} 项`) })) : null,
            all.length > 8 ? h('div', { class: 'tag-admin-tools' }, h('label', { class: 'search inline grow' }, icon('search', { size: 15 }), search), sortSeg) : null,
            selBar,
            list),
        aliasPanel(),
    ];
}

function syncExcludePanel() {
    const rules = [...(state.settings.syncExclude || [])];
    const save = async (next) => {
        await api.put('/api/settings', { syncExclude: next });
        toast('已保存', 'ok');
    };
    const input = h('input', { class: 'input', placeholder: '条目标题里的文字，例如 TavernDB-ACU', maxlength: 60, onkeydown: (e) => { if (e.key === 'Enter') add(); } });
    const add = () => {
        const v = input.value.trim();
        if (!v) return;
        if (!rules.includes(v)) save([...rules, v]);
        input.value = '';
    };
    return panel('从酒馆同步时排除', 'beer', null,
        help( '酒馆保存角色卡时，会把角色主绑定的世界书整本写进卡里，总结类脚本（例如「数据库」）写进这本世界书的条目也会跟着进来。'
            + '标题包含下面任一文字的条目，在从酒馆收藏、存为新版本、对比和判断是否同步时都会去掉；酒馆里的数据不受影响。对所有设备生效。'),
        h('div', { class: 'rule-list' }, rules.length
            ? rules.map((r) => h('span', { class: 'rule-chip' }, h('code', {}, r), h('button', { title: '删除', onclick: () => save(rules.filter((x) => x !== r)) }, icon('x', { size: 12 }))))
            : h('span', { class: 'muted small' }, '没有规则，酒馆世界书里的条目会全部同步')),
        h('div', { class: 'input-group' }, input, btn('添加', { icon: 'plus', onclick: add })),
        h('div', { class: 'row-actions' }, btn('恢复默认', { cls: 'sm ghost', onclick: () => save(['TavernDB-ACU']) })));
}

function fieldsSection() {
    const fields = structuredClone(state.fields);
    const list = h('div', { class: 'field-list' });
    const saveBtn = btn('保存', { cls: 'sm primary', disabled: true, onclick: async () => {
        await api.put('/api/fields', { fields });
        saveBtn.disabled = true;
        toast('字段已保存', 'ok');
    } });
    const mark = () => { saveBtn.disabled = false; };
    const draw = () => clear(list, fields.map((f, i) => h('div', { class: `field-def ${f.hidden ? 'off' : ''}` },
        h('div', { class: 'grow min0' },
            h('div', { class: 'field-def-name' }, f.label, f.builtin ? h('span', { class: 'chip-s' }, '内置') : null),
            h('div', { class: 'field-def-meta' }, KINDS[f.kind] || f.kind, ' · ', f.types?.length ? f.types.map((t) => TYPE_META[t]?.label).join('、') : '所有类型')),
        switchEl(!f.hidden, (v) => { f.hidden = !v; mark(); draw(); }),
        h('div', { class: 'field-def-acts' },
            btn('', { icon: 'arrowUp', cls: 'sm ghost', disabled: i === 0, onclick: () => { [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]]; mark(); draw(); } }),
            btn('', { icon: 'arrowDown', cls: 'sm ghost', disabled: i === fields.length - 1, onclick: () => { [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]]; mark(); draw(); } }),
            btn('', { icon: 'pencil', cls: 'sm ghost', onclick: () => editField(f, (nf) => { fields[i] = nf; mark(); draw(); }) }),
            !f.builtin ? btn('', { icon: 'trash', cls: 'sm ghost danger', onclick: () => { fields.splice(i, 1); mark(); draw(); } }) : null))));
    draw();
    return panel('字段列表', 'sliders', h('div', { class: 'row-actions' },
        btn('新增', { icon: 'plus', cls: 'sm', onclick: () => editField({ id: `f_${Date.now().toString(36)}`, label: '', kind: 'text', types: [], options: [] }, (nf) => { fields.push(nf); mark(); draw(); }) }),
        saveBtn),
    help( '决定每个条目详情里记录哪些信息。可以限定只对某些类型显示，例如只给角色卡加「推荐模型」。'),
    list,
    btn('恢复默认字段', { icon: 'restore', cls: 'sm ghost', onclick: async () => {
        if (await confirmDialog('恢复为默认字段？已填写的数据不会丢失，只是字段定义会重置。')) { await api.post('/api/fields/reset'); toast('已恢复默认'); }
    } }));
}

function editField(f, onSave) {
    const nf = structuredClone(f);
    const label = h('input', { class: 'input', value: nf.label, placeholder: '例如「推荐模型」' });
    const options = h('textarea', { class: 'textarea', value: (nf.options || []).join('\n'), placeholder: '每行一个选项' });
    const optRow = h('div', { class: 'field wide', hidden: nf.kind !== 'select' }, h('label', {}, '选项'), options);
    const kind = h('select', { class: 'select', disabled: nf.builtin, onchange: () => { optRow.hidden = kind.value !== 'select'; } },
        Object.entries(KINDS).map(([k, l]) => h('option', { value: k, selected: nf.kind === k }, l)));
    const types = new Set(nf.types || []);
    const typeBox = h('div', { class: 'opts' });
    const drawTypes = () => clear(typeBox, Object.entries(TYPE_META).map(([k, v]) => h('button', { class: `opt ${types.has(k) ? 'active' : ''}`, onclick: () => { types.has(k) ? types.delete(k) : types.add(k); drawTypes(); } }, icon(v.icon, { size: 13 }), v.label)));
    drawTypes();
    const s = sheet({
        title: f.label ? `编辑字段 · ${f.label}` : '新增字段',
        body: h('div', { class: 'fields' },
            h('div', { class: 'field' }, h('label', {}, '名称'), label),
            h('div', { class: 'field' }, h('label', {}, '类型'), kind),
            optRow,
            h('div', { class: 'field wide' }, h('label', {}, '适用于（都不选 = 所有类型）'), typeBox)),
        foot: [btn('取消', { onclick: () => s.close() }), btn('确定', { icon: 'check', cls: 'primary', onclick: () => {
            if (!label.value.trim()) { toast('请输入字段名称', 'err'); return; }
            Object.assign(nf, { label: label.value.trim(), kind: kind.value, options: options.value.split('\n').map((x) => x.trim()).filter(Boolean), types: [...types] });
            onSave(nf);
            s.close();
        } })],
    });
}

function loginLogPanel() {
    const box = h('div', { class: 'rows login-log' }, h('span', { class: 'muted small' }, '正在读取…'));
    api.get('/api/security/log').then(({ log, locked }) => clear(box,
        locked.length ? h('div', { class: 'note warn' }, icon('alert', { size: 15 }), `${locked.map((l) => l.ip).join('、')} 因多次输错密码，正在暂停登录`) : null,
        log.length ? log.map((l, i) => h('div', { class: 'row-item login-row', hidden: i >= 8 },
            h('div', { class: `row-thumb ${l.ok ? 'ok' : 'bad'}` }, icon(l.ok ? 'checkCircle' : 'xCircle', { size: 18 })),
            h('div', { class: 'row-main' },
                h('div', { class: 'row-title' }, h('span', {}, l.ok ? '登录成功' : '密码错误')),
                h('div', { class: 'row-sub' }, h('span', {}, fmtDate(l.at, true)), h('span', {}, l.device), h('span', {}, l.ip)))))
            : h('span', { class: 'muted small' }, '还没有登录记录'),
        log.length > 8 ? btn(`显示全部（${log.length}）`, { cls: 'sm ghost', onclick: (e) => { box.querySelectorAll('.login-row[hidden]').forEach((r) => { r.hidden = false; }); e.currentTarget.remove(); } }) : null)).catch((e) => clear(box, h('span', { class: 'muted small' }, e.message)));
    return panel('最近的登录', 'clock', null,
        help( '同一来源连续输错 5 次密码会暂停登录，之后每多错一次暂停时间翻倍（最长 30 分钟）。已经登录的设备不受影响。'),
        box);
}

function security() {
    const pw = h('input', { class: 'input', type: 'password', placeholder: state.settings.auth ? '新密码' : '设置访问密码（至少 4 位）', autocomplete: 'new-password' });
    return panel('访问密码', 'lock', null,
        h('div', { class: `note ${state.settings.auth ? 'ok' : 'warn'}` }, icon(state.settings.auth ? 'checkCircle' : 'alert', { size: 15 }),
            state.settings.auth ? '已启用密码保护。修改密码后，所有设备（包括酒馆插件）需要重新登录。' : '当前没有密码，任何知道网址的人都能访问。部署到公网前务必设置。'),
        h('div', { class: 'input-group' }, pw, btn(state.settings.auth ? '修改' : '启用', { cls: 'primary', onclick: async () => {
            if (pw.value.length < 4) { toast('密码至少 4 位', 'err'); return; }
            const { token } = await api.post('/api/password', { password: pw.value });
            api.setToken(token);
            toast('密码已更新', 'ok');
            pw.value = '';
        } })),
        state.settings.auth ? h('div', { class: 'row-actions' },
            btn('退出登录', { icon: 'logout', cls: 'sm', onclick: () => { api.setToken(''); location.reload(); } }),
            btn('关闭密码', { cls: 'sm ghost danger', onclick: async () => {
                if (!(await confirmDialog('关闭密码保护？公网部署时非常不安全。', { danger: true }))) return;
                await api.post('/api/password', { password: '' });
                api.setToken('');
                toast('已关闭密码');
            } })) : null);
}

function copyBox(text) {
    return h('div', { class: 'copy-box' }, h('code', {}, text), btn('', { icon: 'copy', cls: 'sm', title: '复制', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); } catch { toast('复制失败，请手动复制', 'err'); }
    } }));
}

function connection() {
    return panel('连接酒馆插件', 'beer', null,
        h('div', { class: 'sub-label' }, '插件安装地址'), copyBox(PLUGIN_REPO),
        help( '在 SillyTavern / TauriTavern 里：扩展 → 安装扩展 → 粘贴这个地址。已经装过的，在扩展管理里点更新。'),
        h('div', { class: 'small' }, '装好后在插件设置里填入：'),
        h('div', { class: 'sub-label' }, '服务器地址'), copyBox(location.origin),
        help( '密码就是上面设置的访问密码。iOS 版 TauriTavern 需要 https 地址。'),
        btn('下载插件压缩包', { icon: 'download', cls: 'sm', href: '/api/extension.zip', download: 'tavern-vault-extension.zip' }));
}

function iosApp() {
    return panel('iOS App', 'phone', null,
        h('div', { class: 'sub-label' }, '当前服务器'), copyBox(location.origin),
        help('在别的 App 或「文件」里分享角色卡、世界书、压缩包等文件，选「藏馆」就会打开导入。下载和导出的文件会弹出系统分享面板，选「存储到文件」或「存储图像」保存。'),
        btn('更换服务器', { icon: 'refresh', cls: 'sm', onclick: () => { location.href = LAUNCHER_URL; } }));
}

function shortcut() {
    return panel('iPhone 使用', 'phone', null,
        h('ol', { class: 'steps' },
            h('li', {}, 'Safari 打开本页 → 分享 → 添加到主屏幕，像 App 一样使用。'),
            h('li', {}, '快捷指令分享上传：新建快捷指令，开启「在共享表单中显示」并接收文件和图像，添加「获取 URL 内容」：'),
            h('li', { class: 'plain' }, copyBox(`${location.origin}/api/items?filename=快捷指令上传`)),
            h('li', { class: 'plain' }, '方法选 POST，请求体选「文件」并选择快捷指令输入。', state.settings.auth ? '头部添加 Authorization，值为 Bearer 加空格加访问令牌。' : ''),
            h('li', {}, '之后在任何 App 里分享文件，选这个快捷指令，就会直接存进藏馆。')),
        state.settings.auth ? h('details', { class: 'fold' }, h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), icon('key', { size: 15 }), h('span', { class: 'fold-title' }, '显示访问令牌')), h('div', { class: 'fold-body' }, copyBox(api.token))) : null);
}

function data() {
    const st = state.stats || {};
    const storage = h('div', { class: 'storage' }, h('span', { class: 'muted small' }, '正在统计…'));
    api.get('/api/storage').then((r) => clear(storage,
        h('div', { class: 'facts' },
            h('div', { class: 'fact' }, h('b', {}, fmtBytes(r.blobs)), h('span', {}, `文件（${st.files ?? 0} 个）`)),
            h('div', { class: 'fact' }, h('b', {}, fmtBytes(r.thumbs)), h('span', {}, `缩略图（${r.thumbCount} 张）`)),
            h('div', { class: 'fact' }, h('b', {}, fmtBytes(r.db)), h('span', {}, '数据库'))))).catch((e) => clear(storage, h('span', { class: 'muted small' }, e.message)));
    const days = state.settings.trashDays || 0;
    return [
        panel('备份与还原', 'database', null,
            h('div', { class: 'row-actions wrap' },
                btn('下载完整备份', { icon: 'download', cls: 'primary', onclick: async (e) => {
                    const b = e.currentTarget;
                    b.disabled = true;
                    try { downloadBlob(await api.req('GET', '/api/backup', undefined, { blob: true }), `TavernVault-backup-${new Date().toISOString().slice(0, 10)}.zip`); } catch (err) { toast(err.message, 'err'); }
                    b.disabled = false;
                } }),
                btn('从备份还原', { icon: 'restore', onclick: () => restoreInput.click() }), restoreInput),
            help( '备份 ZIP 包含全部条目、合集、字段和所有版本的文件（不含缩略图和 AI 密钥）。还原前会自动保存一份当前数据库，放在服务端 data/restore-points 目录。')),
        autoBackupPanel(),
        panel('重复条目', 'merge', btn('查找重复', { cls: 'sm', onclick: () => openDuplicates() }),
            h('div', { class: 'muted small' }, (() => { const n = findDuplicates().length; return n ? `现在有 ${n} 组可能重复的条目。` : '现在没有发现重复的条目。'; })(),
                '同一个文件、内容相同，或者同类型同名、作者不冲突的条目会被认为可能重复。合并时文件会作为旧版本保留，不会丢。')),
        panel('回收站', 'trash', btn(`打开回收站${st.trash ? ` · ${st.trash}` : ''}`, { cls: 'sm', href: '#/trash' }),
            setRow('自动清空', '删除超过这个天数的条目会被彻底清除，文件一起删掉。对所有设备生效', seg(days, [[0, '不自动'], [7, '7 天'], [30, '30 天'], [90, '90 天']], async (v) => {
                if (v && st.trash && !(await confirmDialog(`开启后，回收站里超过 ${v} 天的条目会立即被彻底删除，无法恢复。继续？`, { danger: true, ok: '开启' }))) return;
                await api.put('/api/settings', { trashDays: v });
                toast(v ? `已设为 ${v} 天自动清空` : '已关闭自动清空', 'ok');
            }))),
        panel('存储', 'box', null, storage,
            h('div', { class: 'row-actions wrap' },
                btn('清理无用文件', { icon: 'eraser', cls: 'sm', onclick: async () => { const r = await api.post('/api/maintenance/gc'); toast(`已清理 ${r.removed} 个文件`, 'ok'); rerender(); } }),
                btn('重建缩略图', { icon: 'refresh', cls: 'sm', onclick: async () => {
                    if (!(await confirmDialog('删除全部缩略图？之后浏览仓库时会按原图重新生成，第一次加载会慢一些。'))) return;
                    const r = await api.del('/api/thumbs');
                    toast(`已删除 ${r.removed} 张缩略图`, 'ok');
                    await reload();
                    rerender();
                } })),
            help( '「清理无用文件」会删掉已经没有条目引用的文件（例如彻底删除后剩下的）。')),
    ];
}

function autoBackupPanel() {
    const body = h('div', { class: 'stack-s' }, h('span', { class: 'muted small' }, '正在读取…'));
    const draw = (cfg) => clear(body,
        cfg.guard ? h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, `自动备份已暂停：现在连回收站一共只有 ${cfg.guard.items} 个条目，最近一份备份里有 ${cfg.guard.ref} 个。如果不是你自己删的，用下面列表里条目数正常的那份还原；是自己删的，回到仓库页点「是我删的，继续备份」。`)) : null,
        setRow('每天自动备份', '每天在服务器上存一份完整备份，内容没变化的日子不重复存。条目数突然少了一半以上时会暂停，免得好的备份被挤掉', switchEl(cfg.on, async (v) => { await api.put('/api/settings', { autoBackup: { on: v } }); load(); })),
        setRow('保留', '只保留最近几份自动备份，手动备份不会被自动删除', seg(cfg.keep, [[3, '3 份'], [7, '7 份'], [14, '14 份'], [30, '30 份']], async (v) => { await api.put('/api/settings', { autoBackup: { keep: v } }); load(); })),
        h('div', { class: 'row-actions' }, btn('立即备份', { icon: 'database', cls: 'sm', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { await api.post('/api/backups'); toast('已备份', 'ok'); } catch (err) { toast(err.message, 'err'); }
            load();
        } })),
        cfg.list.length ? h('div', { class: 'rows backup-list' }, cfg.list.map((b) => h('div', { class: 'row-item' },
            h('div', { class: 'row-thumb' }, icon('archive', { size: 18 })),
            h('div', { class: 'row-main' },
                h('div', { class: 'row-title' }, h('span', {}, fmtDate(b.at, true))),
                h('div', { class: 'row-sub' }, h('span', {}, b.auto ? '自动' : '手动'), cfg.counts?.[b.name] >= 0 ? h('span', {}, `${cfg.counts[b.name]} 个条目`) : null, h('span', {}, fmtBytes(b.size)))),
            h('div', { class: 'row-actions' },
                btn('', { icon: 'download', cls: 'sm ghost', title: '下载', href: `/api/backups/${b.name}${api.token ? `?token=${encodeURIComponent(api.token)}` : ''}`, download: b.name }),
                btn('', { icon: 'restore', cls: 'sm ghost', title: '从这份还原', onclick: () => restoreServerBackup(b) }),
                btn('', { icon: 'trash', cls: 'sm ghost danger', title: '删除', onclick: async () => {
                    if (!(await confirmDialog(`删除 ${fmtDate(b.at, true)} 的备份？`, { danger: true, ok: '删除' }))) return;
                    await api.del(`/api/backups/${b.name}`);
                    load();
                } })))))
            : h('div', { class: 'muted small' }, '还没有备份，开启后一分钟内会存第一份。'),
        cfg.list.length > 1 && cfg.disk ? h('div', { class: 'muted small' }, `${cfg.list.length} 份备份合计 ${fmtBytes(cfg.list.reduce((n, b) => n + b.size, 0))}，没变过的文件各份共用，实际只多占 ${fmtBytes(cfg.disk.extra)}。`) : null,
        help( '备份放在服务器数据目录的 backups 文件夹里。服务器整个出问题时这些备份也会一起丢，建议偶尔用上面的「下载完整备份」存一份到自己的设备。'));
    const load = () => api.get('/api/backups').then(draw).catch((e) => clear(body, h('span', { class: 'muted small' }, e.message)));
    load();
    return panel('自动备份', 'clock', null, body);
}

async function restoreServerBackup(b) {
    const mode = await pickRestoreMode(`从 ${fmtDate(b.at, true)} 的备份还原。`);
    if (!mode) return;
    const s = sheet({ title: '还原中', body: h('div', { class: 'stack-s' }, h('div', { class: 'progress-label' }, '正在还原…')) });
    try {
        const r = await api.post(`/api/backups/${b.name}/restore?mode=${mode}`);
        clear(s.body, h('div', { class: 'progress-label' }, restoreText(r)));
        toast('还原完成', 'ok');
    } catch (e) {
        clear(s.body, h('div', { class: 'progress-label' }, `还原失败：${e.message}`));
    }
    s.body.append(btn('关闭', { cls: 'block', onclick: () => s.close() }));
}

function about() {
    return panel('TavernVault 酒馆藏馆', 'info', null,
        h('div', { class: 'facts' },
            h('div', { class: 'fact' }, h('b', {}, `v${state.settings.version || '1.0.0'}`), h('span', {}, '服务端版本')),
            h('div', { class: 'fact' }, h('b', {}, bridge.host ? '酒馆内' : '网页'), h('span', {}, bridge.host ? `已连接 ${bridge.host.host}` : '独立网页模式'))),
        h('div', { class: 'sub-label' }, '项目地址'), copyBox(PLUGIN_REPO),
        h('div', { class: 'muted small' }, '界面图标来自 Lucide（ISC 许可）。'));
}

const restoreInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: () => { const f = restoreInput.files[0]; restoreInput.value = ''; if (f) restoreFrom(f); } });

async function pickRestoreMode(intro) {
    const mode = await choiceDialog(
        h('div', { class: 'stack-s' },
            h('div', {}, intro),
            h('div', { class: 'muted small' }, '合并：保留现有内容，加入备份里没有的条目；两边都有的保留较新的一份，并补齐历史版本。'),
            h('div', { class: 'muted small' }, '替换：用备份完全替换现有条目、合集和字段（密码和风格设置不变）。')),
        [{ key: 'replace', label: '替换', cls: 'danger' }, { key: 'merge', label: '合并', cls: 'primary' }],
        { title: '从备份还原' });
    if (!mode) return null;
    if (mode === 'replace' && !(await confirmDialog('替换会清空当前所有条目，改为备份里的内容。继续？', { danger: true, ok: '替换' }))) return null;
    return mode;
}

const restoreText = (r) => `完成：新增 ${r.added} 项${r.updated ? `，更新 ${r.updated} 项` : ''}${r.kept ? `，${r.kept} 项保留本地较新版本` : ''}，文件 ${r.files} 个${r.bad ? `，${r.bad} 个文件校验失败已跳过` : ''}`;

async function restoreFrom(file) {
    const mode = await pickRestoreMode(`从「${file.name}」还原。`);
    if (!mode) return;
    const bar = h('i', { style: { width: '0%' } });
    const label = h('div', { class: 'progress-label' }, '正在上传备份');
    const s = sheet({ title: '还原中', body: h('div', { class: 'stack-s' }, h('div', { class: 'progress' }, bar), label) });
    try {
        const r = await api.restore(file, mode, (p) => { bar.style.width = `${p * 100}%`; label.textContent = p < 1 ? `正在上传 ${Math.round(p * 100)}%` : '正在写入文件…'; });
        bar.style.width = '100%';
        label.textContent = restoreText(r);
        toast('还原完成', 'ok');
    } catch (e) {
        label.textContent = `还原失败：${e.message}`;
        toast(e.message, 'err');
    }
    s.body.append(btn('关闭', { cls: 'block', onclick: () => s.close() }));
}
