// 全局状态
import { api } from './api.js';

export const TYPE_META = {
    character: { icon: 'user', color: '#b4637a', label: '角色卡', en: 'Character' },
    worldbook: { icon: 'book', color: '#3e7cb1', label: '世界书', en: 'Lorebook' },
    preset: { icon: 'sliders', color: '#c08a2b', label: '预设', en: 'Preset' },
    regex: { icon: 'braces', color: '#2f8f6f', label: '正则', en: 'Regex' },
    script: { icon: 'terminal', color: '#8a5cb8', label: '脚本', en: 'Script' },
    quickreply: { icon: 'zap', color: '#b88a1e', label: '快速回复', en: 'Quick Reply' },
    theme: { icon: 'palette', color: '#c2554a', label: '主题', en: 'Theme' },
    extension: { icon: 'blocks', color: '#5e8a2e', label: '扩展', en: 'Extension' },
    background: { icon: 'image', color: '#3a8aa6', label: '背景图片', en: 'Image' },
    chat: { icon: 'message', color: '#2e8a87', label: '聊天记录', en: 'Chat' },
    prompt: { icon: 'feather', color: '#9a5b9e', label: '提示词', en: 'Prompt' },
    other: { icon: 'box', color: '#7d8590', label: '其他', en: 'Other' },
};

export const SKINS = {
    atelier: { name: '典藏', en: 'Atelier', desc: '精装收藏册：宋体、卡纸边框、编号目录' },
    minimal: { name: '极简', en: 'Minimal', desc: 'iOS 原生风：大标题、毛玻璃、悬浮胶囊导航' },
    sakura: { name: '樱色图鉴', en: 'Sakura', desc: '手游图鉴：大圆角、彩色描边、评分角标' },
    ink: { name: '墨白', en: 'Ink', desc: '杂志排版：直角细线、大号编号、红黑点缀' },
    neon: { name: '霓虹', en: 'Neon', desc: '终端 HUD：等宽字体、切角发光、方括号标签' },
};

export const typeMeta = (t) => TYPE_META[t] || TYPE_META.other;

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

export const state = {
    items: [],
    byId: new Map(),
    collections: [],
    fields: [],
    settings: {},
    stats: {},
    online: false,
    loaded: false,
    // 视图偏好（存本地）
    prefs: Object.assign({
        view: 'grid', dense: false, sort: 'updated', mode: 'auto', cols: 0,
        start: 'library', reduceMotion: false,
        showTags: true, showRating: true, showNo: true, showAi: true, blurNsfw: false,
        detailTab: 'overview', userName: '', foldAt: 500,
        uploadConc: 3, conflict: 'ask',
    }, lsGet('tv_prefs', {})),
    // 仓库筛选（会话内）
    // tagsIn：都要有；tagsOut：都不能有；quick：未打标签 / 未整理 / 多版本
    filter: { q: '', type: 'all', tagsIn: [], tagsOut: [], quick: [], collection: '', fav: false, ai: '' },
    selection: new Set(),
    selecting: false,
};

/** {{user}} 的称呼是不是用自己填的：没碰过开关、但以前填过称呼的，当作开着 */
export const userNameOn = () => state.prefs.userNameOn ?? Boolean(state.prefs.userName?.trim());
/** {{user}} 显示成什么：开关没开或没填就是「你」 */
export const userLabel = () => (userNameOn() && state.prefs.userName?.trim()) || '你';
export function savePrefs() { lsSet('tv_prefs', state.prefs); }

/**
 * 仓库的显示方式（卡片 / 紧凑 / 列表、每行几个）。每个类型可以单独设置，比如世界书用列表、角色卡用卡片；
 * 「全部」和没单独设置过的类型用默认（设置 → 浏览）
 */
export function viewOf(type = state.filter.type) {
    const own = type && type !== 'all' ? state.prefs.viewByType?.[type] : null;
    return { view: own?.view ?? state.prefs.view, dense: own?.dense ?? state.prefs.dense, cols: own?.cols ?? state.prefs.cols, own: Boolean(own) };
}
export function setView(patch, type = state.filter.type) {
    if (!type || type === 'all') Object.assign(state.prefs, patch);
    else {
        const { own: _own, ...cur } = viewOf(type);
        state.prefs.viewByType = { ...state.prefs.viewByType, [type]: { ...cur, ...patch } };
    }
    savePrefs();
}
/**
 * 卡片上显示什么（标签、评分、编号、封面角标）。和显示方式一样，每个类型可以单独设置，只存改过的那几项，
 * 没改的跟着默认走
 */
export function cardPrefOf(type) {
    const p = state.prefs;
    const own = type && type !== 'all' ? p.cardByType?.[type] : null;
    return {
        showTags: own?.showTags ?? p.showTags !== false,
        showRating: own?.showRating ?? p.showRating !== false,
        showNo: own?.showNo ?? p.showNo !== false,
        marks: own?.marks ?? p.marks,
        own: Boolean(own),
    };
}
export function setCardPref(type, patch) {
    if (!type || type === 'all') Object.assign(state.prefs, patch);
    else state.prefs.cardByType = { ...state.prefs.cardByType, [type]: { ...state.prefs.cardByType?.[type], ...patch } };
    savePrefs();
}
export function resetCardPref(type) {
    const { [type]: _gone, ...rest } = state.prefs.cardByType || {};
    state.prefs.cardByType = rest;
    savePrefs();
}

/** 详情页先打开哪一页：角色卡默认「介绍」；世界书、预设这些内容就是条目和设置，默认「内容」 */
export function detailTabOf(type) {
    const own = state.prefs.detailTabByType?.[type];
    if (own) return own;
    return type === 'character' ? (state.prefs.detailTab === 'content' ? 'content' : 'overview') : (state.prefs.detailTabOther === 'overview' ? 'overview' : 'content');
}

export function resetView(type) {
    const { [type]: _gone, ...rest } = state.prefs.viewByType || {};
    state.prefs.viewByType = rest;
    savePrefs();
}

/** 标签分类（设置里建的）：[{ name, tags }]，只留现在还在用的标签 */
export function tagGroups() {
    const g = state.settings.tagGroups;
    return Array.isArray(g) ? g.filter((x) => x && typeof x.name === 'string' && Array.isArray(x.tags)) : [];
}

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() { for (const fn of subs) fn(); }

let lastState = '';
let reloadSeq = 0;
export async function reload() {
    const mine = ++reloadSeq;
    const s = await api.get('/api/state');
    // 连着触发了几次：只用最后发出的那次结果，先发的晚到了也不能把新的盖回去
    if (mine !== reloadSeq) return;
    // 切回页面、别处的改动通知都会触发重新加载；内容没变就不重画
    const sig = JSON.stringify(s);
    if (sig === lastState && state.loaded) return;
    lastState = sig;
    state.items = s.items;
    state.byId = new Map(s.items.map((i) => [i.id, i]));
    state.collections = s.collections.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    state.fields = s.fields;
    state.settings = s.settings;
    state.stats = s.stats;
    state.health = s.health || {};
    state.loaded = true;
    for (const id of [...state.selection]) if (!state.byId.has(id)) state.selection.delete(id);
    applyAccent();
    notify();
}

const darkMq = matchMedia('(prefers-color-scheme: dark)');
darkMq.addEventListener?.('change', () => applyAccent());

/** 应用风格（全局，存服务器）与明暗（每台设备） */
// 字号可以自己填：界面字号按像素（基准 15），阅读字号按百分比。以前存的「小 / 标准 / 大」换算成数字
const UI_PX = { xs: 13, sm: 14, md: 15, lg: 16 };
const READ_PCT = { sm: 92, md: 100, lg: 112, xl: 126 };
export const UI_FONT = { min: 11, max: 24, step: 0.5 };
export const READ_ZOOM = { min: 70, max: 200, step: 5 };
const clampNum = (v, { min, max }, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.min(max, Math.max(min, Number(v))) : d);
/** 界面字号（px）：没设过时手机默认 14，电脑 15 */
export const uiFont = (p) => clampNum(p.uiFont, UI_FONT, UI_PX[p.uiSize] || (Math.min(screen.width, screen.height) < 600 ? 14 : 15));
/** 阅读字号（%） */
export const readZoom = (p) => clampNum(p.readZoom, READ_ZOOM, READ_PCT[p.readSize] || 100);

export function applyAccent() {
    const root = document.documentElement;
    const skin = SKINS[state.settings.skin] ? state.settings.skin : 'atelier';
    root.dataset.skin = skin;
    try { localStorage.setItem('tv_skin', skin); } catch { /* ignore */ }
    const mode = state.prefs.mode === 'auto' || !state.prefs.mode ? (darkMq.matches ? 'dark' : 'light') : state.prefs.mode;
    root.dataset.mode = mode;
    if (state.settings.accent) root.style.setProperty('--accent', state.settings.accent);
    else root.style.removeProperty('--accent');
    // 每台设备自己的显示偏好，通过 html 上的属性交给 CSS
    const p = state.prefs;
    root.style.setProperty('--fs', String(uiFont(p) / 15));
    root.style.setProperty('--read-zoom', String(readZoom(p) / 100));
    const flag = (k, on) => { if (on) root.dataset[k] = ''; else delete root.dataset[k]; };
    flag('motion', p.reduceMotion);
    // 标签、评分、编号可以按类型分开设置，由每张卡片自己的 class 控制（见 common.js）
    flag('hideAi', p.showAi === false);
    flag('blurNsfw', p.blurNsfw);
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#000');
}

export const live = () => state.items.filter((i) => !i.deletedAt);

export function allTags() {
    const m = new Map();
    for (const it of live()) for (const t of it.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** 按名字匹配仓库中已有条目（用于酒馆页显示“已收藏”） */
export function findByName(type, name) {
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp|gif|avif|bmp|json)$/, '');
    const n = norm(name);
    if (!n) return null;
    return live().find((i) => i.type === type && norm(i.name) === n) || null;
}
/** 仓库里所有同名条目（同名不同作者的卡会有好几个） */
export function findAllByName(type, name) {
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp|gif|avif|bmp|json)$/, '');
    const n = norm(name);
    return n ? live().filter((i) => i.type === type && norm(i.name) === n) : [];
}

/**
 * 这份聊天记录像是哪张角色卡的：按记录里的角色名找同名的卡。
 * 记录里没写角色名时，用文件名「角色名 - 日期」前面那一段猜。
 */
export function chatCardGuess(it) {
    const name = String(it?.meta?.character || '').trim() || (/^(.+?) - \d{4}-\d/.exec(String(it?.name || ''))?.[1] || '').trim();
    if (!name) return { name: '', cards: [] };
    const k = name.toLowerCase();
    return { name, cards: live().filter((x) => x.type === 'character' && x.name.trim().toLowerCase() === k) };
}

/** 智能合集的条件：写了的每一条都要满足 */
export function ruleMatch(it, r) {
    if (r.type && it.type !== r.type) return false;
    if (r.tagsIn?.length && !r.tagsIn.every((t) => it.tags.includes(t))) return false;
    if (r.tagsOut?.length && r.tagsOut.some((t) => it.tags.includes(t))) return false;
    if (r.minRating && (it.rating || 0) < r.minRating) return false;
    if (r.fav && !it.favorite) return false;
    if (r.text) { const k = r.text.toLowerCase(); if (!`${it.name}\n${it.author || ''}`.toLowerCase().includes(k)) return false; }
    return true;
}
export const ruleEmpty = (r) => !r || !(r.type || r.tagsIn?.length || r.tagsOut?.length || r.minRating || r.fav || r.text);
/** 条目在不在这个合集里：智能合集按条件算，普通合集看有没有手动放进去 */
export const inCollection = (it, c) => (c.rule ? ruleMatch(it, c.rule) : it.collections.includes(c.id));
/** 可以手动往里放东西的合集（智能合集不行） */
export const manualCollections = () => state.collections.filter((c) => !c.rule);

export function fieldsFor(type) {
    return state.fields.filter((f) => !f.hidden && (!f.types?.length || f.types.includes(type)));
}
