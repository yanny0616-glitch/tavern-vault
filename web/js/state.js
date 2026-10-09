// 全局状态
import { api } from './api.js';

export const TYPE_META = {
    character: { icon: '🎭', color: '#c084fc', label: '角色卡' },
    worldbook: { icon: '📖', color: '#60a5fa', label: '世界书' },
    preset: { icon: '🎛️', color: '#f59e0b', label: '预设' },
    regex: { icon: '🧩', color: '#34d399', label: '正则' },
    script: { icon: '⚙️', color: '#f472b6', label: '脚本' },
    quickreply: { icon: '⚡', color: '#facc15', label: '快速回复' },
    theme: { icon: '🎨', color: '#fb7185', label: '主题' },
    extension: { icon: '🧱', color: '#a3e635', label: '扩展' },
    background: { icon: '🖼️', color: '#38bdf8', label: '背景/图片' },
    chat: { icon: '💬', color: '#2dd4bf', label: '聊天记录' },
    prompt: { icon: '📝', color: '#e879f9', label: '提示词' },
    other: { icon: '📦', color: '#94a3b8', label: '其他' },
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
    prefs: Object.assign({ view: 'grid', dense: false, sort: 'updated', theme: 'auto' }, lsGet('tv_prefs', {})),
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

export function applyAccent() {
    const root = document.documentElement;
    if (state.settings.accent) root.style.setProperty('--accent', state.settings.accent);
    const t = state.prefs.theme;
    if (t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
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
