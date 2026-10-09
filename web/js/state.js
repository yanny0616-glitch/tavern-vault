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
    ink: { name: '墨白', en: 'Ink', desc: '杂志排版：直角细线、大号编号、黑白影像' },
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
    prefs: Object.assign({ view: 'grid', dense: false, sort: 'updated', mode: 'auto' }, lsGet('tv_prefs', {})),
    // 仓库筛选（会话内）
    filter: { q: '', type: 'all', tag: '', collection: '', fav: false },
    selection: new Set(),
    selecting: false,
};

export function savePrefs() { lsSet('tv_prefs', state.prefs); }

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() { for (const fn of subs) fn(); }

export async function reload() {
    const s = await api.get('/api/state');
    state.items = s.items;
    state.byId = new Map(s.items.map((i) => [i.id, i]));
    state.collections = s.collections.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    state.fields = s.fields;
    state.settings = s.settings;
    state.stats = s.stats;
    state.loaded = true;
    for (const id of [...state.selection]) if (!state.byId.has(id)) state.selection.delete(id);
    applyAccent();
    notify();
}

const darkMq = matchMedia('(prefers-color-scheme: dark)');
darkMq.addEventListener?.('change', () => applyAccent());

/** 应用风格（全局，存服务器）与明暗（每台设备） */
export function applyAccent() {
    const root = document.documentElement;
    const skin = SKINS[state.settings.skin] ? state.settings.skin : 'atelier';
    root.dataset.skin = skin;
    try { localStorage.setItem('tv_skin', skin); } catch { /* ignore */ }
    const mode = state.prefs.mode === 'auto' || !state.prefs.mode ? (darkMq.matches ? 'dark' : 'light') : state.prefs.mode;
    root.dataset.mode = mode;
    if (state.settings.accent) root.style.setProperty('--accent', state.settings.accent);
    else root.style.removeProperty('--accent');
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
