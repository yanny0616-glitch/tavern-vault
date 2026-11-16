// 来源追踪：来源链接是 Discord 帖子的条目，服务器定期看帖子标题有没有变（设置 → 连接与设备里开）
import { h, clear, icon, btn, toast, timeAgo } from '../ui.js';
import { api } from '../api.js';
import { state, savePrefs } from '../state.js';
import { sourceLinkProps } from '../source-links.js';

export const sourceChanged = (it) => Boolean(it.track?.changed) && !it.deletedAt;

const seen = async (it) => { try { await api.post(`/api/items/${it.id}/track/seen`); } catch (e) { toast(e.message, 'err'); } };

/** 详情「介绍」页顶上的提示：来源帖标题变了 / 检查失败 */
export function trackNote(it) {
    const t = it.track;
    if (!t || it.deletedAt) return null;
    if (t.changed) {
        return h('div', { class: 'note warn track-note' }, icon('refresh', { size: 15 }),
            h('div', { class: 'grow' },
                h('div', {}, '来源帖的标题变了，可能有更新：'),
                h('div', { class: 'track-titles' }, h('s', {}, t.seen), h('b', {}, t.title)),
                h('div', { class: 'track-acts' },
                    h('a', { class: 'btn sm', ...sourceLinkProps(it.source) }, icon('external', { size: 14 }), h('span', {}, '打开帖子')),
                    btn('看过了', { icon: 'check', cls: 'sm ghost', title: '不再提醒这次变化；下次标题再变还会提醒', onclick: () => seen(it) }),
                    h('span', { class: 'muted small' }, `${timeAgo(new Date(t.changedAt || t.checkedAt).toISOString())}发现`))));
    }
    if (t.error) return h('div', { class: 'muted small track-err' }, `来源帖检查失败：${t.error}（${timeAgo(new Date(t.checkedAt).toISOString())}）`);
    return null;
}

/** 仓库顶上的提示条：有几张卡的来源帖变了 */
export function renderTrackNotice(el, busy, onShow) {
    const ids = state.items.filter(sourceChanged).map((it) => it.id).sort();
    const sig = ids.join('|');
    el.hidden = busy || !ids.length || state.prefs.trackSeen === sig;
    if (el.hidden) return;
    clear(el, icon('refresh', { size: 15 }),
        h('span', { class: 'grow' }, `${ids.length} 个条目的来源帖标题变了，可能有更新`),
        btn('查看', { cls: 'sm', onclick: onShow }),
        btn('', { icon: 'x', cls: 'sm ghost', title: '先不看', onclick: () => { state.prefs.trackSeen = sig; savePrefs(); el.hidden = true; } }));
}
