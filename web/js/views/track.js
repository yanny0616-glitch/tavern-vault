// 来源追踪：来源链接是 Discord 帖子的条目，服务器定期看帖子标题有没有变（设置 → 连接与设备里开）
import { h, clear, icon, btn, toast, timeAgo, sheet } from '../ui.js';
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
                    btn('取新版本', { icon: 'download', cls: 'sm', title: '在来源帖里用一次 bot 的命令，把文件取回来', onclick: () => openSourceFetch(it) }),
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

export const isDiscordSource = (it) => /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/\d+\/\d+/.test(String(it.source || '').trim());

/**
 * 取新版本：在来源帖里替你用一次社区 bot 的命令，bot 回的每一步都显示在这里，
 * 点哪个按钮、选哪个版本、存哪些文件都由你决定。
 */
export async function openSourceFetch(it) {
    const guild = String(it.source).match(/channels\/(\d+)/)?.[1] || '';
    let info = {};
    try { info = await api.get('/api/discord'); } catch { /* 下面会提示 */ }
    if (!info.hasToken) { toast('先到「设置 → 连接与设备 → Discord 来源追踪」里填令牌', 'err'); return; }
    let sid = ''; let view = null; let busy = false; let alive = true; let results = null;
    const picked = new Map(); // url → 'version' | 'new'
    const body = h('div', { class: 'stack bot-fetch' });
    const cmd = h('input', { class: 'input', value: info.commands?.[guild] || '获取作品', placeholder: '命令名，不带斜杠', spellcheck: false });
    const end = () => { alive = false; if (sid) api.req('DELETE', `/api/discord/fetch/${sid}`).catch(() => {}); };
    const s = sheet({ title: `取新版本 · ${it.name}`, body, full: true, onClose: end });

    const run = async (fn) => {
        if (busy) return;
        busy = true; draw();
        try { const v = await fn(); if (v?.sid) { sid = v.sid; view = v; } } catch (e) { toast(e.message, 'err'); if (/已经结束/.test(e.message)) { sid = ''; view = null; } }
        busy = false; draw();
    };
    // bot 的消息会自己变（比如「加载中」变成文件列表）：一直等着，有变化就重画
    const follow = async (mySid) => {
        while (alive && sid === mySid && view && !view.closed) {
            try { const v = await api.get(`/api/discord/fetch/${mySid}?rev=${view.rev}`); if (!alive || sid !== mySid) return; if (v.rev !== view.rev || v.closed !== view.closed) { view = v; if (!busy) draw(); } } catch { return; }
        }
    };
    const start = () => run(async () => { results = null; picked.clear(); const v = await api.post('/api/discord/fetch', { id: it.id, command: cmd.value }); setTimeout(() => follow(v.sid), 0); return v; });
    const act = (c, value) => run(() => api.post(`/api/discord/fetch/${sid}/act`, { id: c.id, value }));
    const save = () => run(async () => {
        const files = view.files.filter((f) => picked.has(f.url)).map((f) => ({ url: f.url, name: f.name, as: picked.get(f.url) }));
        const r = await api.post(`/api/discord/fetch/${sid}/save`, { files });
        results = r.results;
        return null;
    });
    const md = (t) => String(t || '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1').replace(/[*_`~]{1,3}/g, '').replace(/^#+\s*/gm, '').trim();

    function draw() {
        if (!alive) return;
        const kids = [];
        if (!view) {
            kids.push(
                h('div', { class: 'note' }, icon('info', { size: 15 }), h('span', {}, '会用你的 Discord 账号在这个帖子里发一次下面的命令，和你自己在 Discord 里输入一样。bot 回的内容显示在这里，要点什么由你点。取文件会算进 bot 当天的额度。')),
                h('div', { class: 'field' }, h('label', {}, 'bot 的命令'), h('div', { class: 'row-actions' }, h('span', { class: 'muted' }, '/'), cmd, btn(busy ? '正在连接…' : '开始', { cls: 'primary', disabled: busy, onclick: start }))),
                h('div', { class: 'muted small' }, '每个社区的 bot 命令不一样，填你平时在帖子里输入的那个。这个社区用过的会记住。'));
        } else {
            const empty = !view.content && !view.embeds.length && !view.components.length && !view.files.length;
            kids.push(h('div', { class: 'bot-msg' },
                view.error ? h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, view.error)) : null,
                empty ? h('div', { class: 'muted' }, view.closed ? '连接已经断开。' : 'bot 还没有回消息，等一下…') : null,
                view.content ? h('div', { class: 'bot-text' }, md(view.content)) : null,
                view.embeds.map((e) => h('div', { class: 'bot-embed' },
                    e.title ? h('b', {}, md(e.title)) : null,
                    e.description ? h('div', { class: 'bot-text' }, md(e.description)) : null,
                    e.fields.map((f) => h('div', { class: 'bot-text' }, f.name ? h('b', {}, `${md(f.name)}  `) : null, md(f.value))),
                    e.image ? h('img', { class: 'bot-img', src: e.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
                    e.footer ? h('div', { class: 'muted small' }, md(e.footer)) : null)),
                view.components.filter((c) => c.kind !== 'select').length ? h('div', { class: 'row-actions wrap' }, view.components.filter((c) => c.kind !== 'select').map((c) => (c.kind === 'link'
                    ? h('a', { class: 'btn sm', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.label)
                    : btn(c.label, { cls: `sm bot-btn ${c.style === 3 || c.style === 1 ? 'primary' : c.style === 4 ? 'danger' : ''}`, disabled: busy || c.disabled || view.closed, onclick: () => act(c) })))) : null,
                view.components.filter((c) => c.kind === 'select').map((c) => h('div', { class: 'bot-select' },
                    h('div', { class: 'sub-label' }, c.placeholder || '选一个'),
                    h('div', { class: 'rows' }, c.options.map((o) => h('button', { class: 'row-item bot-opt', disabled: busy || c.disabled || view.closed, onclick: () => act(c, o.value) },
                        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('span', {}, o.label)), o.description ? h('div', { class: 'row-sub' }, h('span', {}, o.description)) : null))))))));
            if (view.files.length && !results) {
                // 默认：和现在这个文件同类的那个存成新版本，其它的单独收录；都不勾，等你选
                kids.push(h('div', { class: 'bot-files' },
                    h('div', { class: 'sub-label' }, '文件 · 勾上要存的'),
                    view.files.map((f) => {
                        const on = picked.has(f.url);
                        const as = h('select', { class: 'select sm', disabled: !on, onchange: () => { picked.set(f.url, as.value); } },
                            h('option', { value: 'version', selected: (picked.get(f.url) || (extra(f.name) ? 'new' : 'version')) === 'version' }, '存成这个条目的新版本'),
                            h('option', { value: 'new', selected: (picked.get(f.url) || (extra(f.name) ? 'new' : 'version')) === 'new' }, '单独收录'));
                        return h('label', { class: 'bot-file' },
                            h('input', { type: 'checkbox', checked: on, onchange: (e) => { if (e.target.checked) picked.set(f.url, sameKind(f.name) ? 'version' : 'new'); else picked.delete(f.url); setTimeout(draw, 0); } }),
                            h('span', { class: 'grow min0' }, h('b', {}, f.name), f.size ? h('span', { class: 'muted small' }, `  ${f.size}`) : null), as);
                    }),
                    btn(busy ? '正在下载…' : `存下选中的 ${picked.size} 个`, { icon: 'download', cls: 'primary block', disabled: busy || !picked.size, onclick: save })));
            }
            if (results) {
                const word = { created: '已收录为新条目', version: '已存成新版本', duplicate: '内容和已有的一样，没有重复存', conflict: '有同名条目，没有存', skipped: '跳过了' };
                kids.push(h('div', { class: 'stack-s bot-results' }, results.map((r) => h('div', { class: `note ${r.error ? 'warn' : 'ok'}` }, icon(r.error ? 'alert' : 'check', { size: 15 }), h('span', {}, `${r.name}：${r.error || word[r.status] || r.status}${r.itemName && r.item !== it.id ? `（${r.itemName}）` : ''}`))),
                    btn('完成', { cls: 'primary block', onclick: () => s.close() })));
            }
            kids.push(h('div', { class: 'row-actions' }, h('span', { class: 'grow muted small' }, view.closed ? '已断开' : '已连接，几分钟不操作会自动断开'), btn('重新开始', { cls: 'sm ghost', disabled: busy, onclick: () => { api.req('DELETE', `/api/discord/fetch/${sid}`).catch(() => {}); sid = ''; view = null; results = null; draw(); } })));
        }
        clear(body, kids);
    }
    // 勾上时的默认去向：第一个看起来是这个条目本体的文件存成新版本，其它的（世界书、正则、预设这些附带的）单独收录
    const extra = (name) => it.type === 'character' && /世界书|world|lore|正则|regex|预设|preset/i.test(name);
    const sameKind = (name) => !extra(name) && ![...picked.values()].includes('version');
    draw();
}
