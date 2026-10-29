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
    tavern: { name: '暗夜酒馆', en: 'Tavern', desc: '深木与琥珀：金色画框、装饰线、烛光氛围' },
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

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() { for (const fn of subs) fn(); }

let lastState = '';
export async function reload() {
    const s = await api.get('/api/state');
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

export function fieldsFor(type) {
    return state.fields.filter((f) => !f.hidden && (!f.types?.length || f.types.includes(type)));
}
