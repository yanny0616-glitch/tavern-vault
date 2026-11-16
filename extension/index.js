// Cardbox 卡匣 —— SillyTavern / TauriTavern 插件
// 作用：1) 全屏内嵌卡匣网页；2) 作为桥，替卡匣页面读写酒馆本地数据（角色卡、世界书、预设、正则、快速回复、主题、背景）

const EXT_KEY = 'tavernVault';
const VERSION = '1.3.0';
// jump：打开卡匣时跳到正在聊的角色卡
// sync：酒馆里改了卡或世界书 → ask 提醒我 / auto 自动存成新版本 / off 不管
// updates：卡匣里有新版本时提醒
// chats：聊天记录自动存进卡匣 → off 不存 / idle 聊天停下来后存一份
const DEFAULTS = { url: '', token: '', fab: true, fabPos: null, jump: true, sync: 'ask', updates: true, chats: 'off' };
const isTT = () => Boolean(window.__TAURITAVERN__);

const ctx = () => SillyTavern.getContext();

function settings() {
    const es = ctx().extensionSettings;
    es[EXT_KEY] ??= {};
    for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in es[EXT_KEY])) es[EXT_KEY][k] = v;
    return es[EXT_KEY];
}
const save = () => ctx().saveSettingsDebounced();
const baseUrl = () => String(settings().url || '').trim().replace(/\/+$/, '');

// 上次打开时卡匣的样子（是否全屏、什么颜色）。下次打开直接照这个显示，不用等卡匣加载完才变全屏
const LOOK_KEY = 'tavernVault.look';
function look() {
    try { return JSON.parse(localStorage.getItem(LOOK_KEY) || '{}') || {}; } catch { return {}; }
}
function saveLook(patch) {
    try { localStorage.setItem(LOOK_KEY, JSON.stringify({ ...look(), ...patch })); } catch { /* 存不了就下次再等 */ }
}
const safeColor = (v) => (typeof v === 'string' && v.length < 80 && /^[#a-z0-9(),.%\s/-]+$/i.test(v) ? v : '');
function paint({ bg, fg, line } = {}) {
    const set = (k, v) => { if (safeColor(v)) panel.style.setProperty(k, v); else panel.style.removeProperty(k); };
    set('--tv-bg', bg);
    set('--tv-fg', fg);
    set('--tv-line', line);
}

function toast(msg, kind = 'info') {
    const t = window.toastr;
    if (t && t[kind]) t[kind](msg, '卡匣');
    else console.log('[Cardbox]', msg);
}

function headers(json = true) {
    const c = ctx();
    let h;
    try { h = c.getRequestHeaders(json ? undefined : { omitContentType: true }); } catch { h = c.getRequestHeaders(); }
    h = { ...h };
    if (!json) delete h['Content-Type'];
    return h;
}

async function stPost(path, body) {
    const res = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body ?? {}) });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return res;
}

async function stUpload(path, file, extra = {}) {
    const fd = new FormData();
    fd.append('avatar', file);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const res = await fetch(path, { method: 'POST', headers: headers(false), body: fd });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
}

// ---------------- 酒馆数据访问 ----------------
let settingsCache = null;
async function stSettings(force = false) {
    if (!settingsCache || force) settingsCache = await (await stPost('/api/settings/get', {})).json();
    return settingsCache;
}

const PRESET_GROUPS = [
    { apiId: 'openai', label: '对话补全预设', names: 'openai_setting_names', values: 'openai_settings', json: true },
    { apiId: 'textgenerationwebui', label: '文本补全预设', names: 'textgenerationwebui_preset_names', values: 'textgenerationwebui_presets', json: true },
    { apiId: 'instruct', label: '指令模板', objects: 'instruct' },
    { apiId: 'context', label: '上下文模板', objects: 'context' },
    { apiId: 'sysprompt', label: '系统提示词', objects: 'sysprompt' },
];

function presetEntries(s) {
    const out = [];
    for (const g of PRESET_GROUPS) {
        if (g.objects) {
            for (const o of s[g.objects] || []) if (o?.name) out.push({ id: `${g.apiId}::${o.name}`, name: o.name, sub: g.label, apiId: g.apiId, data: o });
        } else {
            const names = s[g.names] || [];
            const values = s[g.values] || [];
            names.forEach((name, i) => {
                let data = values[i];
                if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
                if (data) out.push({ id: `${g.apiId}::${name}`, name, sub: g.label, apiId: g.apiId, data });
            });
        }
    }
    return out;
}

async function backgroundList() {
    const res = await stPost('/api/backgrounds/all', {});
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.images || data.backgrounds || [];
    return list.map((x) => (typeof x === 'string' ? x : x.filename || x.name)).filter(Boolean);
}

/** 酒馆里一张角色卡的完整内容 */
async function charData(avatar) {
    const ch = (ctx().characters || []).find((x) => x.avatar === avatar);
    const parse = (x) => { if (x && typeof x.json_data === 'string') { try { return JSON.parse(x.json_data); } catch { /* ignore */ } } return x; };
    if (ch && !ch.shallow) return parse(ch);
    return parse(await (await stPost('/api/characters/get', { avatar_url: avatar })).json());
}

/** 现在正在聊的角色卡。群聊、没开聊天时是 null */
function current() {
    const c = ctx();
    if (c.groupId || c.characterId == null || c.characterId === '') return null;
    const ch = (c.characters || [])[c.characterId];
    if (!ch?.avatar) return null;
    let chatId = '';
    try { chatId = String(c.getCurrentChatId?.() || ''); } catch { /* ignore */ }
    return { avatar: ch.avatar, name: ch.name, chatId };
}

const jsonFile = (name, obj) => ({ filename: `${String(name).replace(/[\\/:*?"<>|]/g, '_')}.json`, data: new TextEncoder().encode(JSON.stringify(obj, null, 2)).buffer });

const handlers = {
    hello: async () => ({ host: isTT() ? 'TauriTavern' : 'SillyTavern', version: VERSION, features: ['raw', 'replace', 'theme', 'insets', 'image', 'current', 'openChat', 'applyTheme', 'linkWorld'] }),

    /** 卡匣告诉插件当前风格的颜色：面板顶部（状态栏那一条）和标题栏跟着变，不再是固定的深色 */
    async theme({ bg, fg, line } = {}) {
        if (!panel) return { ok: false };
        paint({ bg, fg, line });
        saveLook({ bg: safeColor(bg), fg: safeColor(fg), line: safeColor(line) });
        return { ok: true };
    },

    /**
     * 全屏：面板不再留边距、隐藏自己的标题栏，卡匣铺满整个屏幕；
     * 灵动岛 / 状态栏、底部 Home 条、横屏两侧的安全区高度交给卡匣自己留
     */
    async insets() {
        if (!panel) return { top: 0, bottom: 0, left: 0, right: 0 };
        const measure = (side) => {
            const probe = document.createElement('div');
            probe.style.cssText = `position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:var(--tt-inset-${side}, env(safe-area-inset-${side}, 0px))`;
            panel.append(probe);
            const v = Math.round(probe.getBoundingClientRect().height);
            probe.remove();
            return v;
        };
        panel.classList.add('tv-edge');
        edgeOk = true;
        clearTimeout(edgeTimer);
        saveLook({ edge: true });
        return { top: measure('top'), bottom: measure('bottom'), left: measure('left'), right: measure('right') };
    },

    /** 现在正在和谁聊（群聊、没开聊天时是 null），以及要不要一打开就跳过去 */
    async current() {
        return { current: current(), jump: settings().jump !== false };
    },

    /** 关掉卡匣，打开和这张卡的聊天 */
    async openChat({ avatar = '', name = '' } = {}) {
        const c = ctx();
        const find = () => (c.characters || []).findIndex((x) => (avatar ? x.avatar === avatar : x.name === name));
        let i = find();
        if (i < 0) { try { await c.getCharacters?.(); } catch { /* ignore */ } i = find(); }
        if (i < 0) throw new Error('酒馆里没找到这张卡');
        closePanel();
        if (c.selectCharacterById) await c.selectCharacterById(i);
        else document.querySelector(`.character_select[chid="${i}"]`)?.click();
        return { ok: true };
    },

    /**
     * 在酒馆里换上一套主题。酒馆里没有同名的：走酒馆自己的「导入主题」再选中；
     * 已经有同名的：直接选中它，不覆盖（酒馆的导入不允许重名）
     */
    async applyTheme({ name, data }) {
        const sel = document.getElementById('themes');
        const input = document.getElementById('ui_preset_import_file');
        const n = String(name || data?.name || '').trim();
        if (!sel || !n) throw new Error('这个版本的酒馆不支持从插件切换主题');
        const has = () => [...sel.options].some((o) => o.value === n);
        const existed = has();
        closePanel(); // 让出屏幕：主题带 @import 时酒馆会先弹窗确认，换上以后也能马上看到
        if (!existed) {
            if (!input) throw new Error('这个版本的酒馆不支持从插件导入主题');
            const dt = new DataTransfer();
            dt.items.add(new File([JSON.stringify({ ...data, name: n })], `${n}.json`, { type: 'application/json' }));
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            for (let i = 0; i < 300 && !has(); i++) await new Promise((r) => setTimeout(r, 200));
            if (!has()) throw new Error('酒馆没有导入这套主题（可能在确认的弹窗里点了取消）');
        }
        if (window.jQuery?.fn) window.jQuery(sel).val(n).trigger('change');
        else { sel.value = n; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        settingsCache = null;
        return { existed, message: existed ? `酒馆里已经有同名主题「${n}」，直接换上了它，没有覆盖` : `已导入并换上主题「${n}」` };
    },

    /** 把一本世界书存进酒馆，并绑到这张角色卡上（酒馆里角色卡用的是绑定的世界书文件） */
    async linkWorld({ avatar, name, world }) {
        const c = ctx();
        const i = (c.characters || []).findIndex((x) => x.avatar === avatar);
        if (i < 0) throw new Error('酒馆里没找到这张卡');
        const n = String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
        if (!n) throw new Error('世界书没有名字');
        await stUpload('/api/worldinfo/import', new File([JSON.stringify(world)], `${n}.json`, { type: 'application/json' }));
        try { (await import('/scripts/world-info.js')).updateWorldInfoList?.(); } catch { /* ignore */ }
        if (c.writeExtensionField) await c.writeExtensionField(i, 'world', n);
        else await stPost('/api/characters/merge-attributes', { avatar, data: { extensions: { world: n } } });
        // 正开着这张卡：界面上绑定的世界书也跟着换
        if (String(c.characterId) === String(i)) {
            const el = document.getElementById('character_world');
            if (el) el.value = n;
            document.querySelectorAll('#set_character_world, #world_button').forEach((b) => b.classList.add('world_set'));
        }
        settingsCache = null;
        told.delete(avatar);
        return { message: `酒馆里「${c.characters[i].name}」绑定的世界书换成了「${n}」` };
    },

    /** 返回酒馆里条目的原始内容（JSON），卡匣用它计算内容指纹，判断两边是否一致 */
    async raw({ kind, ids = [] }) {
        const c = ctx();
        const out = [];
        const pool = async (list, fn, n = 4) => {
            let i = 0;
            await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
                while (i < list.length) {
                    const id = list[i++];
                    try { const data = await fn(id); if (data) out.push({ id, data }); } catch { /* 单个失败不影响其它 */ }
                }
            }));
        };
        switch (kind) {
            case 'character':
                await pool(ids, charData);
                break;
            case 'worldbook':
                await pool(ids, async (id) => (await stPost('/api/worldinfo/get', { name: id })).json());
                break;
            case 'preset': {
                const all = presetEntries(await stSettings(true));
                for (const id of ids) { const p = all.find((x) => x.id === id); if (p) out.push({ id, data: p.data }); }
                break;
            }
            case 'regex':
                for (const id of ids) { const r = (c.extensionSettings?.regex || []).find((x) => x.id === id); if (r) out.push({ id, data: r }); }
                break;
            case 'quickreply': case 'theme': {
                const s = await stSettings(true);
                const list = kind === 'theme' ? s.themes || [] : s.quickReplyPresets || [];
                for (const id of ids) { const x = list.find((y) => y?.name === id); if (x) out.push({ id, data: x }); }
                break;
            }
            default:
                break;
        }
        return out;
    },

    async list({ kind }) {
        const c = ctx();
        switch (kind) {
            case 'character':
                return (c.characters || []).map((ch) => ({
                    id: ch.avatar,
                    name: ch.name,
                    sub: [ch.data?.creator || ch.creator, (ch.data?.tags || ch.tags || []).slice(0, 3).join(' ')].filter(Boolean).join(' · '),
                    thumb: true,
                }));
            case 'worldbook': {
                const s = await stSettings(true);
                return (s.world_names || []).map((n) => ({ id: n, name: n }));
            }
            case 'preset':
                return presetEntries(await stSettings(true)).map(({ id, name, sub }) => ({ id, name, sub }));
            case 'regex':
                return (c.extensionSettings?.regex || []).map((r) => ({ id: r.id, name: r.scriptName || '(未命名)', sub: r.disabled ? '已禁用' : '' }));
            case 'quickreply': {
                const s = await stSettings(true);
                return (s.quickReplyPresets || []).filter((q) => q?.name).map((q) => ({ id: q.name, name: q.name, sub: `${(q.qrList || []).length} 个按钮` }));
            }
            case 'theme': {
                const s = await stSettings(true);
                return (s.themes || []).filter((t) => t?.name).map((t) => ({ id: t.name, name: t.name }));
            }
            case 'background':
                return (await backgroundList()).map((f) => ({ id: f, name: f, thumb: true }));
            default:
                throw new Error(`不支持的类型：${kind}`);
        }
    },

    /** full：取原图（预览大图用），取不到时退回缩略图 */
    async thumb({ kind, id, full = false }) {
        const type = kind === 'background' ? 'bg' : 'avatar';
        if (full) {
            const res = await fetch(`/${kind === 'background' ? 'backgrounds' : 'characters'}/${encodeURIComponent(id)}`, { headers: headers() }).catch(() => null);
            if (res?.ok && /^image\//.test(res.headers.get('content-type') || '')) return { mime: res.headers.get('content-type'), data: await res.arrayBuffer(), transfer: true };
        }
        const res = await fetch(`/thumbnail?type=${type}&file=${encodeURIComponent(id)}`, { headers: headers() });
        if (!res.ok) throw new Error('缩略图获取失败');
        return { mime: res.headers.get('content-type') || 'image/png', data: await res.arrayBuffer(), transfer: true };
    },

    async export({ kind, id }) {
        const c = ctx();
        switch (kind) {
            case 'character': {
                const ch = (c.characters || []).find((x) => x.avatar === id);
                const res = await stPost('/api/characters/export', { format: 'png', avatar_url: id });
                return { filename: `${ch?.name || id.replace(/\.png$/i, '')}.png`, data: await res.arrayBuffer(), transfer: true };
            }
            case 'worldbook': {
                const data = await (await stPost('/api/worldinfo/get', { name: id })).json();
                return { ...jsonFile(id, data), transfer: true };
            }
            case 'preset': {
                const p = presetEntries(await stSettings()).find((x) => x.id === id);
                if (!p) throw new Error('预设不存在');
                return { ...jsonFile(p.name, { ...p.data, name: p.data.name || p.name }), transfer: true };
            }
            case 'regex': {
                const r = (c.extensionSettings?.regex || []).find((x) => x.id === id);
                if (!r) throw new Error('正则不存在');
                return { ...jsonFile(r.scriptName || 'regex', r), transfer: true };
            }
            case 'quickreply': {
                const q = ((await stSettings()).quickReplyPresets || []).find((x) => x.name === id);
                if (!q) throw new Error('快速回复不存在');
                return { ...jsonFile(q.name, q), transfer: true };
            }
            case 'theme': {
                const t = ((await stSettings()).themes || []).find((x) => x.name === id);
                if (!t) throw new Error('主题不存在');
                return { ...jsonFile(t.name, t), transfer: true };
            }
            case 'background': {
                const res = await fetch(`/backgrounds/${encodeURIComponent(id)}`, { headers: headers() });
                if (!res.ok) throw new Error('背景读取失败');
                return { filename: id, data: await res.arrayBuffer(), transfer: true };
            }
            default:
                throw new Error(`不支持的类型：${kind}`);
        }
    },

    /**
     * 导入到酒馆
     * replace：要覆盖的酒馆条目 id（角色卡头像文件名、世界书名、预设 id、正则 id……）
     * asNew：和已有条目重名时另存一份（自动加编号）
     */
    async import({ kind, filename, name, apiId, data, replace = '', asNew = false }) {
        const c = ctx();
        const file = new File([data], filename || 'file');
        const parseJson = () => JSON.parse(new TextDecoder().decode(data).replace(/^\uFEFF/, ''));
        const clean = (n) => String(n || '').replace(/[\\/:*?"<>|]/g, '_');
        const unique = (n, taken) => {
            const set = new Set(taken);
            if (!set.has(n)) return n;
            let i = 2;
            while (set.has(`${n} (${i})`)) i++;
            return `${n} (${i})`;
        };
        switch (kind) {
            case 'character': {
                const ext = (filename.split('.').pop() || 'png').toLowerCase();
                const up = await stUpload('/api/characters/import', file, replace ? { file_type: ext, preserved_name: replace } : { file_type: ext });
                try { await c.getCharacters?.(); } catch { /* ignore */ }
                const avatar = replace || (up?.file_name ? `${up.file_name}.png` : '');
                return { message: replace ? '已覆盖酒馆里的角色卡（聊天记录保留）' : '已导入角色卡', avatar };
            }
            case 'worldbook': {
                let n = clean(name || filename.replace(/\.json$/i, ''));
                if (replace) n = replace;
                else if (asNew) n = unique(n, (await stSettings(true)).world_names || []);
                await stUpload('/api/worldinfo/import', new File([data], `${n}.json`, { type: 'application/json' }));
                try { (await import('/scripts/world-info.js')).updateWorldInfoList?.(); } catch { /* ignore */ }
                settingsCache = null;
                return { message: `${replace ? '已覆盖' : '已导入'}世界书「${n}」` };
            }
            case 'preset': {
                const obj = parseJson();
                let id = apiId || 'openai';
                let n = obj.name || name || filename.replace(/\.json$/i, '');
                if (replace) [id, n] = [replace.split('::')[0], replace.split('::').slice(1).join('::')];
                else if (asNew) n = unique(n, presetEntries(await stSettings(true)).filter((p) => p.apiId === id).map((p) => p.name));
                if ('name' in obj) obj.name = n;
                await stPost('/api/presets/save', { apiId: id, name: n, preset: obj });
                settingsCache = null;
                return { message: `已${replace ? '覆盖' : '保存'}预设「${n}」，刷新酒馆后在预设列表中可见` };
            }
            case 'regex': {
                const obj = parseJson();
                const list = Array.isArray(obj) ? obj : [obj];
                c.extensionSettings.regex ??= [];
                const all = c.extensionSettings.regex;
                const newId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
                if (replace && list.length === 1) {
                    const idx = all.findIndex((x) => x.id === replace);
                    if (idx >= 0) {
                        all[idx] = { ...list[0], id: replace, disabled: all[idx].disabled };
                        save();
                        return { message: `已覆盖正则「${all[idx].scriptName}」，刷新后生效` };
                    }
                }
                let added = 0;
                for (const r of list) {
                    if (!asNew && all.some((x) => x.scriptName === r.scriptName && x.findRegex === r.findRegex)) continue;
                    const scriptName = asNew ? unique(r.scriptName || '正则', all.map((x) => x.scriptName)) : r.scriptName;
                    all.push({ ...r, scriptName, id: newId() });
                    added++;
                }
                save();
                return { message: `已添加 ${added} 条全局正则${added < list.length ? `（${list.length - added} 条已存在）` : ''}，刷新后在正则面板可见` };
            }
            case 'quickreply': case 'theme': {
                const obj = parseJson();
                obj.name ||= name;
                if (replace) obj.name = replace;
                else if (asNew) {
                    const s = await stSettings(true);
                    obj.name = unique(obj.name, (kind === 'theme' ? s.themes || [] : s.quickReplyPresets || []).map((x) => x?.name));
                }
                await stPost(kind === 'theme' ? '/api/themes/save' : '/api/quick-replies/save', obj);
                settingsCache = null;
                return { message: `已${replace ? '覆盖' : '保存'}${kind === 'theme' ? '主题' : '快速回复'}「${obj.name}」，刷新后可见` };
            }
            case 'background': {
                let fname = filename;
                if (replace) fname = replace;
                else if (asNew) {
                    const dot = filename.lastIndexOf('.');
                    const stem = dot > 0 ? filename.slice(0, dot) : filename;
                    const ext = dot > 0 ? filename.slice(dot) : '';
                    const taken = new Set(await backgroundList());
                    let i = 2;
                    while (taken.has(fname)) fname = `${stem} (${i++})${ext}`;
                }
                await stUpload('/api/backgrounds/upload', new File([data], fname));
                return { message: replace ? '已覆盖背景' : '已上传背景' };
            }
            default:
                throw new Error(`酒馆不支持直接导入该类型：${kind}`);
        }
    },
};

// ---------------- 不打开面板也在做的事：改动提醒、新版本提醒、聊天归档 ----------------
/** 直接请求卡匣服务 */
async function vault(path, { method = 'GET', json, body } = {}) {
    const h = {};
    if (settings().token) h.Authorization = `Bearer ${settings().token}`;
    if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    const res = await fetch(baseUrl() + path, { method, headers: h, body, cache: 'no-store' });
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
        throw new Error(msg);
    }
    return res;
}
const postEvent = (event, data) => iframe?.contentWindow?.postMessage({ tv: 1, kind: 'event', event, data }, vaultOrigin() || '*');

/** 一条可以点的提醒：点了才做事，不点过一会儿自己消失 */
function notice(msg, onclick) {
    const t = window.toastr;
    if (t?.info) t.info(msg, '卡匣', { timeOut: 15000, extendedTimeOut: 5000, closeButton: true, onclick: () => { Promise.resolve(onclick()).catch((e) => toast(e.message, 'error')); } });
    else console.log('[Cardbox]', msg);
}

// 同一份内容只提醒一次：角色卡按头像文件名记，世界书按「w:名字」记
const told = new Map();
let checking = false;

/** 把酒馆里的这张卡存成卡匣里的新版本 */
async function pushCard(cur, r) {
    const buf = await (await stPost('/api/characters/export', { format: 'png', avatar_url: cur.avatar })).arrayBuffer();
    const q = new URLSearchParams({ filename: `${cur.name}.png`, origin: 'tavern', target: r.itemId, match: 'version', label: '酒馆里改的' });
    const out = await (await vault(`/api/items?${q}`, { method: 'POST', body: buf })).json();
    toast(out.duplicate ? `「${cur.name}」卡匣里已经是这个内容了` : `已把「${cur.name}」存成卡匣里的新版本`, 'success');
    postEvent('tavern-changed');
}
/** 用卡匣里的当前版本覆盖酒馆里的这张卡 */
async function pullCard(cur, r) {
    const data = await (await vault(`/api/files/${r.sha}`)).arrayBuffer();
    await handlers.import({ kind: 'character', filename: r.fileName || `${cur.name}.png`, data, replace: cur.avatar });
    toast(`已把「${cur.name}」更新成卡匣里的版本，聊天记录保留。重新打开这个角色后生效`, 'success');
    postEvent('tavern-changed');
}

/** 正在聊的这张卡和卡匣里的比一下：酒馆里改过 → 提醒存进卡匣；卡匣里更新 → 提醒更新酒馆 */
async function checkCurrent() {
    const s = settings();
    if (!baseUrl() || (s.sync === 'off' && !s.updates) || checking) return;
    const cur = current();
    if (!cur) return;
    checking = true;
    try {
        const data = await charData(cur.avatar);
        if (!data) return;
        const r = await (await vault('/api/tavern/status', { method: 'POST', json: { kind: 'character', name: cur.name, data } })).json();
        if (!r.mark || told.get(cur.avatar) === r.mark) return;
        if (r.status === 'changed' && s.sync !== 'off') {
            told.set(cur.avatar, r.mark);
            if (s.sync === 'auto') await pushCard(cur, r);
            else notice(`「${cur.name}」在酒馆里改过了，和卡匣里的不一样。点这里存成卡匣里的新版本`, () => pushCard(cur, r));
        } else if (r.status === 'older' && s.updates) {
            told.set(cur.avatar, r.mark);
            notice(`卡匣里有「${cur.name}」的新版本。点这里更新酒馆里的这张卡（聊天记录保留）`, () => pullCard(cur, r));
        }
    } catch (e) {
        console.debug('[Cardbox] 比对失败', e);
    } finally { checking = false; }
}

/** 世界书在酒馆里改了：和卡匣里同名的比一下 */
async function checkWorld(name, data) {
    const s = settings();
    if (!baseUrl() || s.sync === 'off' || !name) return;
    try {
        data ||= await (await stPost('/api/worldinfo/get', { name })).json();
        const r = await (await vault('/api/tavern/status', { method: 'POST', json: { kind: 'worldbook', name, data } })).json();
        if (r.status !== 'changed' || told.get(`w:${name}`) === r.mark) return;
        told.set(`w:${name}`, r.mark);
        const push = async () => {
            const q = new URLSearchParams({ filename: `${name}.json`, origin: 'tavern', target: r.itemId, match: 'version', label: '酒馆里改的' });
            await vault(`/api/items?${q}`, { method: 'POST', body: JSON.stringify(data, null, 2) });
            toast(`已把世界书「${name}」存成卡匣里的新版本`, 'success');
            postEvent('tavern-changed');
        };
        if (s.sync === 'auto') await push();
        else notice(`世界书「${name}」在酒馆里改过了。点这里存成卡匣里的新版本`, push);
    } catch (e) { console.debug('[Cardbox] 比对失败', e); }
}

// 聊天归档：每来一条消息记下当时的整段聊天，停下来一会儿后存进卡匣；切走聊天时马上存
const CHAT_IDLE = 45000;
let chatSnap = null;
let chatTimer = 0;
function snapChat() {
    if (settings().chats === 'off' || !baseUrl()) return;
    const c = ctx();
    const cur = current();
    const msgs = c.chat || [];
    // 只有开场白、还没聊的不存
    if (!cur?.chatId || msgs.filter((m) => !m.is_system).length < 2) return;
    const head = { user_name: c.name1, character_name: c.name2, create_date: msgs[0]?.send_date || '', chat_metadata: c.chatMetadata || {} };
    chatSnap = { key: `${cur.avatar}/${cur.chatId}`, filename: `${cur.name} - ${cur.chatId}.jsonl`, char: cur.name, text: [head, ...msgs].map((x) => JSON.stringify(x)).join('\n') };
    clearTimeout(chatTimer);
    chatTimer = setTimeout(flushChat, CHAT_IDLE);
}
async function flushChat() {
    clearTimeout(chatTimer);
    const snap = chatSnap;
    chatSnap = null;
    if (!snap) return null;
    try {
        const q = new URLSearchParams({ key: snap.key, filename: snap.filename, char: snap.char });
        return await (await vault(`/api/tavern/chat?${q}`, { method: 'POST', body: snap.text })).json();
    } catch (e) { console.debug('[Cardbox] 聊天归档失败', e); return null; }
}

// ---------------- 面板 & 消息桥 ----------------
let panel;
let iframe;
let loadedSrc = '';
let edgeOk = false;
let edgeTimer = 0;

const SVG = (d, size = 18) => `<svg class="tv-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="m2 2 20 20"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

function vaultOrigin() {
    try { return new URL(baseUrl()).origin; } catch { return ''; }
}

function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'tv-panel';
    panel.innerHTML = `
        <div class="tv-bar">
            <span class="tv-title">${SVG(IC.archive, 17)}<span>卡匣</span></span>
            <button type="button" data-act="reload" title="刷新">${SVG(IC.refresh)}</button>
            <button type="button" data-act="close" title="关闭">${SVG(IC.x)}</button>
        </div>
        <iframe allow="clipboard-write; clipboard-read; fullscreen" referrerpolicy="no-referrer"></iframe>
        <div class="tv-error"><div class="tv-error-ic">${SVG(IC.wifiOff, 40)}</div><div class="tv-error-msg"></div>
            <button type="button" class="menu_button" data-act="retry">重试</button></div>`;
    document.body.append(panel);
    iframe = panel.querySelector('iframe');
    panel.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'close') closePanel();
        if (act === 'reload') {
            // 地址没变时改 src 只是页内跳转、不会重新加载，换一个新的 iframe
            const fresh = iframe.cloneNode();
            iframe.replaceWith(fresh);
            iframe = fresh;
            loadedSrc = '';
            openPanel();
        }
        if (act === 'retry') openPanel();
    });
    if (isTT()) {
        import('/scripts/tauritavern/layout-kit.js')
            .then(async (kit) => { await kit.waitForHostReady?.(); kit.applySurface?.(panel, kit.SURFACE.FullscreenWindow); })
            .catch(() => { /* 旧版本没有 layout-kit */ });
    }
}

async function openPanel() {
    if (!baseUrl()) {
        toast('请先在扩展设置里填写卡匣服务器地址', 'warning');
        document.querySelector('#tv-settings .inline-drawer-toggle')?.click();
        return;
    }
    if (!panel) buildPanel();
    // 卡匣以前用过全屏：一打开就全屏、用上次的颜色，加载过程中不再先显示插件自己的标题栏
    const l = look();
    paint(l);
    if (l.edge) panel.classList.add('tv-edge');
    panel.classList.add('open');
    panel.classList.remove('error');
    try {
        const r = await fetch(`${baseUrl()}/api/health`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
        panel.classList.remove('tv-edge'); // 连不上时要显示插件自己的标题栏（有关闭按钮）
        panel.classList.add('error');
        panel.querySelector('.tv-error-msg').innerHTML = `无法连接卡匣服务：${e.message}<br><small>请检查地址是否正确、服务是否在运行。iOS 版 TauriTavern 请使用 https 地址。</small>`;
        return;
    }
    const po = location.origin && location.origin !== 'null' ? location.origin : '*';
    const q = new URLSearchParams({ embed: 'tavern', po });
    if (settings().token) q.set('token', settings().token);
    const src = `${baseUrl()}/#/library?${q}`;
    // 页面已经开着：告诉它面板又被打开了，好跳到现在正在聊的卡
    if (loadedSrc === src) postEvent('opened', await handlers.current());
    if (loadedSrc !== src) {
        loadedSrc = src;
        iframe.src = src;
        // 卡匣一直没接手全屏（加载卡住、旧版卡匣）：退回显示标题栏，保证能关掉
        edgeOk = false;
        clearTimeout(edgeTimer);
        if (panel.classList.contains('tv-edge')) edgeTimer = setTimeout(() => { if (!edgeOk) panel.classList.remove('tv-edge'); }, 15000);
    }
}

function closePanel() {
    panel?.classList.remove('open');
}

window.addEventListener('message', async (e) => {
    if (!iframe || e.source !== iframe.contentWindow) return;
    if (e.origin !== vaultOrigin()) return;
    const m = e.data;
    if (!m || m.tv !== 1) return;
    if (m.kind === 'close') { closePanel(); return; }
    if (m.kind !== 'req') return;
    const reply = (payload, transfer = []) => iframe.contentWindow.postMessage({ tv: 1, kind: 'res', id: m.id, ...payload }, e.origin, transfer);
    try {
        const fn = handlers[m.method];
        if (!fn) throw new Error(`未知方法：${m.method}`);
        const result = await fn(m.params || {});
        const transfer = result?.transfer && result.data instanceof ArrayBuffer ? [result.data] : [];
        if (result?.transfer) delete result.transfer;
        reply({ ok: true, result }, transfer);
    } catch (err) {
        console.error('[Cardbox]', err);
        reply({ ok: false, error: err?.message || String(err) });
    }
});

// ---------------- 悬浮按钮 ----------------
function renderFab() {
    let fab = document.getElementById('tv-fab');
    if (!settings().fab) { fab?.remove(); return; }
    if (fab) return;
    fab = document.createElement('button');
    fab.id = 'tv-fab';
    fab.type = 'button';
    fab.title = '卡匣';
    fab.innerHTML = SVG(IC.archive, 24);
    const pos = settings().fabPos;
    if (pos) { fab.style.left = `${pos.x}px`; fab.style.top = `${pos.y}px`; fab.style.right = 'auto'; fab.style.bottom = 'auto'; }
    let start = null;
    let moved = false;
    fab.addEventListener('pointerdown', (e) => {
        start = { x: e.clientX, y: e.clientY, l: fab.offsetLeft, t: fab.offsetTop };
        moved = false;
        fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true;
        const x = Math.max(4, Math.min(window.innerWidth - fab.offsetWidth - 4, start.l + dx));
        const y = Math.max(4, Math.min(window.innerHeight - fab.offsetHeight - 4, start.t + dy));
        Object.assign(fab.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
    });
    fab.addEventListener('pointerup', () => {
        if (moved) { settings().fabPos = { x: fab.offsetLeft, y: fab.offsetTop }; save(); } else openPanel();
        start = null;
    });
    document.body.append(fab);
    if (isTT()) {
        import('/scripts/tauritavern/layout-kit.js').then((kit) => kit.applySurface?.(fab, kit.SURFACE.FreeWindow)).catch(() => {});
    }
}

// ---------------- 设置面板 ----------------
function buildSettings() {
    const s = settings();
    const html = `
    <div id="tv-settings" class="tv-settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Cardbox 卡匣</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div class="tv-row"><label>服务器</label><input id="tv-url" class="text_pole" type="text" placeholder="https://vault.example.com"></div>
          <div class="tv-row"><label>密码</label><input id="tv-pass" class="text_pole" type="password" placeholder="卡匣访问密码（未设置可留空）"></div>
          <div class="tv-row">
            <div id="tv-connect" class="menu_button">${SVG(IC.link, 15)} 连接</div>
            <div id="tv-open" class="menu_button">${SVG(IC.archive, 15)} 打开卡匣</div>
          </div>
          <div id="tv-status" class="tv-status"></div>
          <label class="checkbox_label"><input id="tv-fab-toggle" type="checkbox"> 显示悬浮按钮（可拖动）</label>
          <label class="checkbox_label"><input id="tv-jump" type="checkbox"> 打开卡匣时，跳到正在聊的角色卡</label>
          <div class="tv-row"><label>酒馆里改了卡或世界书</label><select id="tv-sync" class="text_pole">
            <option value="ask">提醒我，点一下存成新版本</option><option value="auto">自动存成卡匣里的新版本</option><option value="off">不管</option></select></div>
          <label class="checkbox_label"><input id="tv-updates" type="checkbox"> 卡匣里有新版本时提醒我更新酒馆里的卡</label>
          <div class="tv-row"><label>聊天记录</label><select id="tv-chats" class="text_pole">
            <option value="off">不自动存</option><option value="idle">聊天停下来后自动存进卡匣</option></select></div>
          <small style="opacity:.7">改动和新版本只比对正在聊的这张卡（要卡匣里有同名的卡）。自动存的聊天每段只留最新的一份，会绑到卡匣里同名的角色卡上；群聊不存。</small>
          <small style="opacity:.7">也可以从左下角「魔棒」扩展菜单里打开。密码只用于换取访问令牌，不会保存明文。</small>
        </div>
      </div>
    </div>`;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    host?.insertAdjacentHTML('beforeend', html);
    const $ = (id) => document.getElementById(id);
    $('tv-url').value = s.url;
    $('tv-fab-toggle').checked = s.fab;
    const status = (msg, kind = '') => { const el = $('tv-status'); el.textContent = msg; el.className = `tv-status ${kind}`; };
    status(s.url ? (s.token ? '已保存连接信息' : '已保存地址') : '尚未配置');
    $('tv-url').addEventListener('change', () => { s.url = $('tv-url').value.trim().replace(/\/+$/, ''); save(); loadedSrc = ''; });
    $('tv-fab-toggle').addEventListener('change', () => { s.fab = $('tv-fab-toggle').checked; save(); renderFab(); });
    $('tv-jump').checked = s.jump !== false;
    $('tv-updates').checked = s.updates !== false;
    $('tv-sync').value = ['ask', 'auto', 'off'].includes(s.sync) ? s.sync : 'ask';
    $('tv-chats').value = s.chats === 'idle' ? 'idle' : 'off';
    $('tv-jump').addEventListener('change', () => { s.jump = $('tv-jump').checked; save(); });
    $('tv-updates').addEventListener('change', () => { s.updates = $('tv-updates').checked; save(); told.clear(); });
    $('tv-sync').addEventListener('change', () => { s.sync = $('tv-sync').value; save(); told.clear(); });
    $('tv-chats').addEventListener('change', () => { s.chats = $('tv-chats').value; save(); if (s.chats === 'off') { clearTimeout(chatTimer); chatSnap = null; } });
    $('tv-open').addEventListener('click', openPanel);
    $('tv-connect').addEventListener('click', async () => {
        s.url = $('tv-url').value.trim().replace(/\/+$/, '');
        save();
        if (!s.url) { status('请填写服务器地址', 'err'); return; }
        status('连接中…');
        try {
            const health = await (await fetch(`${s.url}/api/health`, { cache: 'no-store' })).json();
            if (health.app !== 'tavern-vault') throw new Error('这个地址不是卡匣服务');
            if (health.auth) {
                const pw = $('tv-pass').value;
                if (pw) {
                    const r = await fetch(`${s.url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
                    const j = await r.json();
                    if (!r.ok) throw new Error(j.error || '登录失败');
                    s.token = j.token;
                } else if (!s.token) {
                    throw new Error('该卡匣设置了密码，请填写密码');
                }
                const check = await fetch(`${s.url}/api/state`, { headers: { Authorization: `Bearer ${s.token}` } });
                if (check.status === 401) { s.token = ''; throw new Error('令牌已失效，请重新输入密码'); }
            } else {
                s.token = '';
            }
            $('tv-pass').value = '';
            save();
            loadedSrc = '';
            status(`已连接：${health.title || '卡匣'} v${health.version}`, 'ok');
        } catch (e) {
            status(`连接失败：${e.message}`, 'err');
        }
    });
}

function addMenuItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('tv-menu-item')) return;
    const item = document.createElement('div');
    item.id = 'tv-menu-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = `<span class="tv-menu-ic">${SVG(IC.archive, 16)}</span><span>卡匣</span>`;
    item.addEventListener('click', openPanel);
    menu.append(item);
}

// ---------------- 启动 ----------------
async function init() {
    if (window.__TAURITAVERN__?.ready) {
        try { await window.__TAURITAVERN__.ready; } catch { /* ignore */ }
    }
    settings();
    buildSettings();
    addMenuItem();
    renderFab();
    // 角色列表变化时，让卡匣页面知道（用于刷新酒馆页）
    const c = ctx();
    const notify = () => iframe?.contentWindow?.postMessage({ tv: 1, kind: 'event', event: 'tavern-changed' }, vaultOrigin() || '*');
    for (const ev of ['CHARACTER_EDITED', 'CHARACTER_DELETED', 'CHARACTER_PAGE_LOADED', 'WORLDINFO_UPDATED', 'SETTINGS_UPDATED']) {
        if (c.event_types?.[ev]) c.eventSource.on(c.event_types[ev], () => { settingsCache = null; notify(); });
    }
    const on = (ev, fn) => { if (c.event_types?.[ev]) c.eventSource.on(c.event_types[ev], fn); };
    const later = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    // 换了聊天：上一段没存的先存掉，再看看这张卡两边是不是一样
    const checkSoon = later(checkCurrent, 1500);
    on('CHAT_CHANGED', () => { flushChat(); checkSoon(); });
    // 编辑角色卡时每改一个字段都会触发，等停手了再比
    on('CHARACTER_EDITED', later(checkCurrent, 8000));
    const worldSoon = new Map();
    on('WORLDINFO_UPDATED', (name, data) => {
        if (typeof name !== 'string') return;
        if (!worldSoon.has(name)) worldSoon.set(name, later((d) => checkWorld(name, d), 8000));
        worldSoon.get(name)(data);
    });
    for (const ev of ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED']) on(ev, snapChat);
    // 给测试和排查用
    window.__cardbox = { checkCurrent, checkWorld, snapChat, flushChat, current };
}

jQuery(() => { init().catch((e) => console.error('[Cardbox] init failed', e)); });
