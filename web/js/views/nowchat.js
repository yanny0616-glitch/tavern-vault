// 在酒馆插件里打开时，和「酒馆里正在用的东西」打交道：
// 跳到正在聊的角色卡、从卡匣直接开聊、把主题换到酒馆、把一套世界书绑到酒馆里的角色上
import { h, toast, icon } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { findAllByName, reload } from '../state.js';
import { normName, loadTavernIndex } from '../tavern-index.js';
import { openDetail } from './detail.js';

/** 带一个按钮的提示条，过一会儿自己消失 */
function banner(text, label, fn) {
    const t = h('div', { class: 'toast act' }, icon('message', { size: 16 }), h('span', {}, text),
        h('button', { class: 'toast-btn', onclick: () => { t.remove(); fn(); } }, label),
        h('button', { class: 'toast-x', 'aria-label': '关闭', onclick: () => t.remove() }, icon('x', { size: 14 })));
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), 12000);
}

/** 酒馆里和这个条目同名的角色卡（头像文件名）。没有是空的 */
async function tavernCards(name) {
    const rows = await bridge.call('list', { kind: 'character' }, [], 30000);
    return rows.filter((r) => normName(r.name) === normName(name));
}

async function collectCurrent(cur) {
    try {
        const exp = await bridge.call('export', { kind: 'character', id: cur.avatar });
        const res = await api.upload(new Blob([exp.data]), { filename: exp.filename, origin: 'tavern', match: 'ask' });
        if (res.status === 'conflict') { toast('卡匣里有名字相近的条目，到「酒馆」页里决定是存成新版本还是另存', 'err'); return; }
        await reload();
        toast(`已把「${cur.name}」收进卡匣`, 'ok');
        if (res.item?.id) openDetail(res.item.id);
    } catch (e) { toast(e.message, 'err'); }
}

let last = '';
/**
 * 卡匣面板打开了（或者页面刚加载完）：info = { current: { avatar, name }, jump }
 * 正在聊的卡和上次不一样时才动：卡匣里有就打开它的详情，没有就问要不要收藏
 */
export function onTavernOpen(info) {
    const cur = info?.current;
    if (!info?.jump || !cur?.avatar || cur.avatar === last) return;
    last = cur.avatar;
    const all = findAllByName('character', cur.name);
    if (!all.length) { banner(`正在聊的「${cur.name}」还没收进卡匣`, '收藏', () => collectCurrent(cur)); return; }
    // 正开着别的弹窗（可能有没保存的修改）就不抢，给个按钮
    if (document.querySelector('.overlay')) banner(`正在聊「${cur.name}」`, '查看', () => openDetail(all[0].id));
    else openDetail(all[0].id);
}

/** 从卡匣直接开聊：酒馆里还没有这张卡就先导入，然后关掉卡匣、打开和它的聊天 */
export async function startChat(it) {
    try {
        let avatar = (await tavernCards(it.name))[0]?.id || '';
        if (!avatar) {
            const f = it.files.find((x) => x.primary) || it.files[0];
            if (!f) throw new Error('这个条目没有文件');
            const data = await (await api.fetchFile(f.sha, it.id)).arrayBuffer();
            const res = await bridge.call('import', { kind: 'character', filename: f.name, name: it.name, data }, [data]);
            avatar = res?.avatar || '';
            loadTavernIndex(['character']);
        }
        await bridge.call('openChat', { avatar, name: it.name });
    } catch (e) { toast(e.message, 'err'); }
}

/** 在酒馆里换上这套主题 */
export async function applyStTheme(it, d) {
    try {
        const r = await bridge.call('applyTheme', { name: String(d.name || it.name), data: d }, [], 120000);
        toast(r.message, 'ok');
        loadTavernIndex(['theme']);
    } catch (e) { toast(e.message, 'err'); }
}

/** 把这张卡的某一套世界书（fid，current 是卡里现在这套）存进酒馆并绑到酒馆里的这张卡上。成功返回 true */
export async function linkBookSet(it, fid) {
    try {
        const hits = await tavernCards(it.name);
        if (!hits.length) throw new Error('酒馆里没有这张卡，先把它导入酒馆');
        if (hits.length > 1) throw new Error(`酒馆里有 ${hits.length} 张同名的卡，分不清要换哪张`);
        const w = await api.get(`/api/items/${it.id}/booksets/${fid}/world`);
        const r = await bridge.call('linkWorld', { avatar: hits[0].id, name: w.name, world: w.world });
        toast(r.message, 'ok');
        loadTavernIndex(['worldbook']);
        return true;
    } catch (e) { toast(e.message, 'err'); return false; }
}
