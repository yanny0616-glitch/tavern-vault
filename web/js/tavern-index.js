// 酒馆里已有哪些内容（按类型 + 名字），给藏馆卡片的「酒馆」角标、「未导入酒馆」筛选和详情页用。
// 只有在酒馆插件里打开时才有；酒馆页读到的列表也会顺手更新这里
import { bridge } from './bridge.js';
import { notify } from './state.js';

export const TAVERN_KINDS = ['character', 'worldbook', 'preset', 'regex', 'quickreply', 'theme', 'background'];
const KIND_SET = new Set(TAVERN_KINDS);

/** 和 findByName 一样的名字比较：忽略大小写、首尾空格和文件扩展名 */
export const normName = (s) => String(s || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp|gif|avif|bmp|json)$/, '');

const names = new Map();
let loading = null;

export function setTavernList(kind, list) {
    names.set(kind, new Set((list || []).map((r) => normName(r.name))));
    notify();
}

/** 读取酒馆里各类内容的名字；kinds 不传就全部重读 */
export function loadTavernIndex(kinds = TAVERN_KINDS) {
    if (!bridge.host) return Promise.resolve();
    const run = async () => {
        for (const kind of kinds) {
            try { names.set(kind, new Set((await bridge.call('list', { kind }, [], 30000)).map((r) => normName(r.name)))); } catch { /* 这类读不到就不标 */ }
        }
        notify();
    };
    loading = (loading || Promise.resolve()).then(run);
    return loading;
}

/** true：酒馆里有同名的；false：没有；null：不知道（没在酒馆里打开、这类还没读到、酒馆不支持这个类型） */
export function inTavern(it) {
    if (!bridge.host || !KIND_SET.has(it.type)) return null;
    const set = names.get(it.type);
    return set ? set.has(normName(it.name)) : null;
}

bridge.on((event) => { if (event === 'tavern-changed') loadTavernIndex(); });
