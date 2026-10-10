// 条目详情：介绍（预览）/ 内容（阅读排版）/ 文件；资料在单独的编辑面板里修改
import { h, clear, sheet, toast, debounce, confirmDialog, promptDialog, lightbox, fmtBytes, fmtDate, timeAgo, downloadBlob, switchEl, icon, btn, starsEl, emptyState } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, typeMeta, TYPE_META, fieldsFor, subscribe, allTags, notify, savePrefs, applyAccent, readZoom, READ_ZOOM } from '../state.js';
import { collectionName, typeBadge } from './common.js';
import { pickCollection } from './library.js';
import { importItemsToTavern, TAVERN_IMPORTABLE } from './tavern.js';
import { openDiff } from './diff.js';
import { startOrganize, aiReady, aiStamp } from './ai.js';
import { openAiChat } from './aichat.js';
import { richText, dialogView } from '../richtext.js';
import { coverImg, coverSrc } from '../thumbs.js';
import { runRegex, applyScripts, displayScripts, looksHtml, stView, hasHtmlFence, hasScript, PLACEMENT } from '../stview.js';
import { cardPng } from '../pngcard.js';
import { entriesOf, entryKeys, entryKeys2, effectivePrompts, presetRegex } from '../cardfmt.js';

const TOP_LEVEL_FIELDS = new Set(['source', 'author', 'version', 'rating']);
const SHOWN_IN_HERO = new Set(['author', 'version', 'rating']);
// 超过这个字数的段落只显示开头（设置 → 浏览 → 长文折叠，0 = 不折叠）
const foldAt = () => (Number.isFinite(Number(state.prefs.foldAt)) ? Number(state.prefs.foldAt) : 500);
const PEEK_TYPES = new Set(['worldbook', 'preset', 'regex', 'quickreply', 'theme']);
const isEmpty = (v) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length);

/** 长文本先收起，点开看全文 */
// 长文只显示开头一段；「阅读全文」在单独的页面里打开，不把当前页面拉长
function clampBox(build, text, title = '全文', onMore = null) {
    const len = text.length;
    const limit = foldAt();
    if (!limit || len <= limit) return build(text);
    const box = h('div', { class: 'clamp' }, build(text.slice(0, 1000)));
    const more = h('button', { class: 'clamp-btn', onclick: () => (onMore ? onMore() : readFull(title, build(text), len)) },
        icon('book', { size: 14 }), h('span', {}, `阅读全文 · ${len} 字`));
    return h('div', { class: 'clamp-wrap' }, box, more);
}

/** 阅读页右上角的字号加减，和「设置 → 阅读字号」是同一个设置，每次 10% */
function readTools() {
    const cur = () => readZoom(state.prefs);
    const step = (d) => {
        state.prefs.readZoom = Math.min(READ_ZOOM.max, Math.max(READ_ZOOM.min, Math.round(cur() / 10) * 10 + d * 10));
        savePrefs();
        applyAccent();
        sync();
    };
    const minus = btn('', { icon: 'minus', cls: 'ghost icon sm', title: '字小一点', onclick: () => step(-1) });
    const plus = btn('', { icon: 'plus', cls: 'ghost icon sm', title: '字大一点', onclick: () => step(1) });
    const sync = () => { minus.disabled = cur() <= READ_ZOOM.min; plus.disabled = cur() >= READ_ZOOM.max; label.textContent = `${cur()}%`; };
    const label = h('span', { class: 'read-tools-label' });
    sync();
    return h('div', { class: 'read-tools' }, minus, label, plus);
}

/** 对话示例有多段时，可以直接跳到第几段 */
function segmentJump(node, scroller) {
    const blocks = [...node.querySelectorAll('.dlg')];
    if (blocks.length < 2) return null;
    return h('select', { class: 'select sm read-jump', onchange: (e) => {
        const b = blocks[Number(e.target.value)];
        if (b) scroller.scrollTop += b.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    } }, blocks.map((b, i) => h('option', { value: i }, `第 ${i + 1} 段 · ${(b.textContent || '').replace(/\s+/g, ' ').slice(0, 14)}`)));
}

/**
 * 单独的阅读页。pager：{ count, index, get(i, styled) → { title, node, len }, styled }
 * 有 pager 时底部可以翻到上一条 / 下一条（键盘左右键也可以）
 */
function readFull(title, node, len, { pager = null } = {}) {
    const wrap = h('div', { class: 'read-full' });
    const tools = readTools();
    let styled = pager?.styled ?? false;
    let i = pager?.index || 0;
    const prev = btn('上一条', { icon: 'chevronLeft', onclick: () => show(i - 1) });
    const next = btn('下一条', { icon: 'chevronRight', onclick: () => show(i + 1) });
    const count = h('span', { class: 'read-count' });
    const styleBtn = pager?.canStyle ? h('div', { class: 'read-mode-wrap' },
        h('label', { class: 'check-line read-script', title: '运行卡里美化的脚本（翻页、点击切换等）。脚本在隔离环境里运行，读不到藏馆的数据' },
            h('input', { type: 'checkbox', checked: Boolean(state.prefs.stScripts), onchange: (e) => { state.prefs.stScripts = e.target.checked; savePrefs(); show(i); } }), h('span', {}, '运行脚本')),
        h('div', { class: 'seg read-mode' },
            h('button', { class: 'seg-item', onclick: () => { styled = false; show(i); } }, '文字'),
            h('button', { class: 'seg-item', onclick: () => { styled = true; show(i); } }, '酒馆效果'))) : null;
    const onKey = (e) => {
        if (!pager || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
        if ([...document.querySelectorAll('.overlay')].pop() !== s.el.parentElement) return;
        if (e.key === 'ArrowLeft' && i > 0) show(i - 1);
        if (e.key === 'ArrowRight' && i < pager.count - 1) show(i + 1);
    };
    const s = sheet({ title, body: wrap, full: true, headExtra: tools,
        foot: pager && pager.count > 1 ? [prev, count, next] : null,
        onClose: () => document.removeEventListener('keydown', onKey) });
    s.el.classList.add('read-sheet');
    const fill = (n, l) => {
        const meta = h('div', { class: 'read-full-meta' }, h('span', {}, `${l} 字`), h('span', { class: 'grow' }), styleBtn);
        clear(wrap, meta, n);
        const jump = segmentJump(n, s.body);
        if (jump) meta.insertBefore(jump, styleBtn || null);
        styleBtn?.querySelectorAll('.seg-item').forEach((b, k) => b.classList.toggle('active', (k === 1) === styled));
        styleBtn?.querySelector('.read-script')?.toggleAttribute('hidden', !styled);
    };
    function show(k) {
        i = Math.max(0, Math.min(pager.count - 1, k));
        const p = pager.get(i, styled);
        s.title.textContent = p.title;
        fill(p.node, p.len);
        count.textContent = `${i + 1} / ${pager.count}`;
        prev.disabled = i === 0;
        next.disabled = i === pager.count - 1;
        s.body.scrollTop = 0;
    }
    if (pager) {
        document.addEventListener('keydown', onKey);
        show(i);
    } else fill(node, len);
    return s;
}

/** 折叠块：第一次展开时才生成里面的内容 */
function lazyDetails(props, summary, build) {
    let built = false;
    const el = h('details', props, summary);
    const fill = () => { if (built || !el.open) return; built = true; el.append(build()); };
    el.addEventListener('toggle', fill);
    fill();
    return el;
}

/** 字段的只读展示 */
function fieldDisplay(f, v) {
    switch (f.kind) {
        case 'url': {
            let label = v;
            try { const u = new URL(v); label = `${u.hostname}${u.pathname.length > 1 ? u.pathname : ''}`; } catch { /* 不是合法链接 */ }
            return h('a', { class: 'info-link', href: v, target: '_blank', rel: 'noopener noreferrer' }, h('span', {}, label), icon('external', { size: 12 }));
        }
        case 'checkbox': return h('span', { class: `chip-s ${v && f.id === 'nsfw' ? 'danger' : v ? 'ok' : ''}` }, v ? '是' : '否');
        case 'tags': return h('span', { class: 'info-tags' }, (Array.isArray(v) ? v : String(v).split(/[,，]/)).map((t) => h('span', { class: 'chip-s' }, t)));
        case 'color': return h('span', { class: 'info-color' }, h('i', { style: { background: v } }), v);
        case 'rating': return h('span', { class: 'info-stars' }, [1, 2, 3, 4, 5].map((n) => icon('star', { size: 13, fill: n <= v, cls: n <= v ? 'on' : '' })));
        case 'textarea': return h('span', { class: 'info-text' }, v);
        default: return String(v);
    }
}

/**
 * 条目详情。opts.seq：从仓库打开时传入当前筛选结果的 id 顺序，可以左右滑动 / 方向键 / 顶部箭头切到上一项、下一项；
 * opts.onLeave(id)：关闭时告诉仓库最后看的是哪一项
 */

/** 12345 → 1.2 万 */
const fmtTok = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')} 万` : String(n));
export function openDetail(id, { seq = null, onLeave = null } = {}) {
    let tab = state.prefs.detailTab === 'content' ? 'content' : 'overview';
    let content = null;
    let contentSha = '';
    let loading = false;
    let greetIdx = 0;
    const order = Array.isArray(seq) && seq.length > 1 && seq.includes(id) ? seq : null;
    const headMore = h('div', { class: 'head-extra' });
    const s = sheet({ title: '', body: h('div'), full: true, headExtra: headMore, onClose: () => { unsub(); document.removeEventListener('keydown', onNavKey); onLeave?.(id); } });
    s.el.classList.add('detail-sheet');

    // ---- 上一项 / 下一项 ----
    function browse(dir) {
        if (!order) return;
        for (let k = order.indexOf(id) + dir; k >= 0 && k < order.length; k += dir) {
            const it = state.byId.get(order[k]);
            if (it && !it.deletedAt) { goTo(order[k], dir); return; }
        }
        toast(dir > 0 ? '已经是最后一项' : '已经是第一项');
    }
    function goTo(nid, dir) {
        id = nid;
        content = null;
        contentSha = '';
        loading = false;
        greetIdx = 0;
        tabCache = null;
        lastSig = '';
        render();
        s.body.scrollTop = 0;
        s.body.animate?.([{ opacity: 0.2, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    }
    const onNavKey = (e) => {
        if (!order || e.altKey || e.ctrlKey || e.metaKey) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
        if ([...document.querySelectorAll('.overlay')].pop() !== s.el.parentElement) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); browse(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); browse(1); }
    };
    if (order) {
        document.addEventListener('keydown', onNavKey);
        // 手机左右滑：避开屏幕左边缘（iOS 返回手势）和本身能横向操作的地方
        let sw = null;
        s.body.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            sw = e.touches.length === 1 && t.clientX > 24 && !e.target.closest('input, textarea, select, pre, .code, iframe, .cover-grid, .tabs, .opts, .chips-row, table, .entry-keys')
                ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
        }, { passive: true });
        s.body.addEventListener('touchend', (e) => {
            if (!sw) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - sw.x;
            const dy = t.clientY - sw.y;
            const quick = Date.now() - sw.at < 700;
            sw = null;
            if (quick && Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && !window.getSelection()?.toString()) browse(dx < 0 ? 1 : -1);
        }, { passive: true });
    }
    const unsub = subscribe(() => {
        const it = state.byId.get(id);
        if (!it) { s.close(); return; }
        if (primary(it)?.sha !== contentSha) content = null;
        const ae = document.activeElement;
        const typing = ae && s.el.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== 'checkbox';
        if (!typing && sigOf(it) !== lastSig) render();
    });
    // 别处的改动也会通知到这里；这个条目没变就不重画
    let lastSig = '';
    const sigOf = (it) => JSON.stringify([it, state.fields, state.collections.map((c) => c.name)]);
    let tabCache = null;
    const contentTabCached = (it) => {
        if (tabCache && tabCache.content === content && tabCache.at === it.updatedAt) return tabCache.node;
        const node = contentTab(it);
        tabCache = content ? { content, at: it.updatedAt, node } : null;
        return node;
    };

    const primary = (it) => it.files.find((f) => f.primary) || it.files[0];
    const save = (patch) => api.patch(`/api/items/${id}`, patch).catch((e) => toast(e.message, 'err'));
    const names = (it) => ({ char: content?.data?.name || it.name, user: state.prefs.userName?.trim() || '你' });

    /** 开场白阅读页：可以左右翻，有美化正则或 HTML 时可以切到「酒馆效果」 */
    function readGreetings(it, list, start = 0) {
        const n = names(it);
        const scripts = displayScripts(content?.data?.extensions?.regex_scripts);
        const styledOf = (t) => applyScripts(t, scripts, n);
        const canStyle = list.some((g) => looksHtml(g) || hasHtmlFence(g) || (scripts.length && styledOf(String(g)).hits));
        const label = (k) => (k === 0 ? '开场白' : `备选开场白 ${k}`);
        readFull(label(start), null, 0, { pager: {
            count: list.length,
            index: start,
            canStyle,
            styled: canStyle && state.prefs.greetStyled !== false,
            get: (k, styled) => {
                const g = String(list[k]);
                if (styled) {
                    state.prefs.greetStyled = true;
                    savePrefs();
                    const out = macroNames(styledOf(g).out, n);
                    return { title: label(k), node: h('div', { class: 'st-wrap' }, stView(out, { scripts: Boolean(state.prefs.stScripts) }),
                        !state.prefs.stScripts && hasScript(out) ? h('div', { class: 'muted small st-tip' }, '这段美化带脚本，翻页、点击切换之类的效果要打开右上方的「运行脚本」才看得到。') : null), len: g.length };
                }
                if (canStyle) { state.prefs.greetStyled = false; savePrefs(); }
                return { title: label(k), node: richText(g, n), len: g.length };
            },
        } });
    }
    const macroNames = (t, n) => String(t).replace(/\{\{char\}\}/gi, n.char).replace(/\{\{user\}\}/gi, n.user);

    async function loadContent(it) {
        if (loading) return;
        loading = true;
        const forId = id;
        contentSha = primary(it)?.sha || '';
        const c = await api.get(`/api/items/${forId}/content`).catch((e) => ({ kind: 'error', error: e.message }));
        if (forId !== id) return; // 已经切到别的条目了，那边会自己加载
        content = c;
        loading = false;
        render();
    }
    const ensureContent = (it) => { if (it.files.length && !content) loadContent(it); return content; };

    function render() {
        const it = state.byId.get(id);
        if (!it) return;
        lastSig = sigOf(it);
        s.title.textContent = typeMeta(it.type).label;
        const scroll = s.body.scrollTop;
        const pos = order ? order.indexOf(id) : -1;
        clear(headMore,
            order ? h('div', { class: 'detail-nav' },
                btn('', { icon: 'chevronLeft', cls: 'ghost icon sm', title: '上一项（也可以左右滑动或按方向键）', disabled: pos <= 0, onclick: () => browse(-1) }),
                h('span', { class: 'detail-pos' }, `${pos + 1} / ${order.length}`),
                btn('', { icon: 'chevronRight', cls: 'ghost icon sm', title: '下一项', disabled: pos >= order.length - 1, onclick: () => browse(1) })) : null,
            btn('', { icon: 'more', cls: 'ghost icon', title: '更多操作', onclick: () => moreMenu(it) }));
        clear(s.body, h('div', { class: 'detail-layout' },
            h('aside', { class: 'detail-aside' }, hero(it)),
            h('div', { class: 'detail-main' },
                h('div', { class: 'tabs-bar' }, h('div', { class: 'tabs' }, [['overview', '介绍'], ['content', '内容'], ['files', `文件 · ${it.files.length}`]].map(([k, label]) =>
                    h('button', { class: tab === k ? 'active' : '', onclick: () => switchTab(k) }, label)))),
                h('div', { class: 'detail-body' }, tab === 'overview' ? overview(it) : tab === 'content' ? contentTabCached(it) : filesTab(it)))));
        s.body.scrollTop = scroll;
        if (!s.foot) { s.foot = h('div', { class: 'sheet-foot' }); s.el.append(s.foot); }
        const p = primary(it);
        const toTavern = bridge.host && TAVERN_IMPORTABLE.has(it.type) && !it.deletedAt;
        clear(s.foot,
            it.deletedAt
                ? btn('恢复', { icon: 'restore', cls: 'primary', onclick: async () => { await api.post(`/api/items/${id}/restore`); toast('已恢复', 'ok'); } })
                : btn('编辑资料', { icon: 'pencil', onclick: () => editItem(it) }),
            p ? btn('下载', { icon: 'download', cls: toTavern || it.deletedAt ? '' : 'primary', href: api.fileUrl(p.sha, p.name, true, it.id), download: p.name }) : null,
            toTavern ? btn('导入到酒馆', { icon: 'beer', cls: 'primary', onclick: () => importItemsToTavern([it]) }) : null);
    }

    /** 切换页签后回到页签位置（手机上封面在上方，内容在下面） */
    function switchTab(k) {
        tab = k;
        render();
        const main = s.body.querySelector('.detail-main');
        if (!main) return;
        const top = main.getBoundingClientRect().top - s.body.getBoundingClientRect().top + s.body.scrollTop;
        s.body.scrollTop = window.innerWidth < 900 ? top - 6 : 0;
    }

    function moreMenu(it) {
        const p = primary(it);
        const item = (ic, label, fn, cls = '') => h('button', { class: `menu-item ${cls}`, onclick: async () => { m.close(); await fn(); } }, icon(ic, { size: 17 }), h('span', {}, label));
        const withCard = async (fn) => {
            if (!content) await loadContent(it);
            if (content?.kind === 'card') fn(content); else toast('读取角色卡失败', 'err');
        };
        const m = sheet({
            title: it.name,
            body: h('div', { class: 'menu' },
                !it.deletedAt ? item('pencil', '编辑资料', () => editItem(it)) : null,
                aiReady() && !it.deletedAt ? item('sparkles', 'AI 整理（标签、简介、字段）', () => startOrganize([it.id])) : null,
                aiReady() && !it.deletedAt ? item('message', '问 AI（把这一项发给 AI 一起看）', () => openAiChat({ refs: [it.id] })) : null,
                it.type === 'character' && p && !it.deletedAt ? item('user', '编辑角色卡内容（保存为新版本）', () => withCard((c) => editCard(it, c))) : null,
                it.type === 'character' && p && it.cover ? item('image', '导出 PNG 角色卡（用当前封面）', () => exportPng(it)) : null,
                it.type === 'character' && p ? item('braces', '导出角色卡 JSON', () => withCard((c) => downloadBlob(new Blob([JSON.stringify(c.card, null, 2)], { type: 'application/json' }), `${c.data?.name || it.name}.json`))) : null,
                p ? item('download', '下载当前文件', () => { h('a', { href: api.fileUrl(p.sha, p.name, true, it.id), download: p.name }).click(); }) : null,
                it.cover ? item('maximize', '查看大图', () => lightbox(api.fileUrl(it.cover))) : null,
                !it.deletedAt ? item('image', '更换封面 / 添加图片', () => switchTab('files')) : null,
                it.deletedAt
                    ? item('restore', '恢复', async () => { await api.post(`/api/items/${id}/restore`); toast('已恢复', 'ok'); })
                    : item('trash', '移入回收站', async () => {
                        if (await confirmDialog(`把「${it.name}」移入回收站？`, { danger: true, ok: '删除' })) { await api.del(`/api/items/${id}`); toast('已移入回收站'); s.close(); }
                    }, 'danger')),
        });
    }

    function filterByTag(t) {
        Object.assign(state.filter, { tagsIn: [t], tagsOut: [] });
        s.close();
        if (!location.hash.startsWith('#/library')) location.hash = '#/library'; else notify();
    }

    // ---------- 头部 ----------
    function hero(it) {
        const tm = typeMeta(it.type);
        const c = it.meta?.card;
        const facts = c ? [
            c.characterVersion && `v${c.characterVersion}`,
            `${c.greetings} 条开场白`,
            c.bookEntries && `${c.bookEntries} 个世界书词条`,
            c.regexCount && `${c.regexCount} 条正则`,
            c.estTokens ? `约 ${fmtTok(c.estTokens)} tokens` : '',
        ].filter(Boolean) : [it.version && `v${it.version}`].filter(Boolean);
        return h('div', { class: `hero ${it.cover ? 'has-cover' : 'no-cover'}`, style: { '--tc': tm.color } },
            it.cover ? h('div', { class: 'hero-bg', style: { backgroundImage: `url("${coverSrc(it)}")` } }) : null,
            h('div', { class: 'hero-inner' },
                h('div', { class: 'hero-cover', onclick: () => it.cover && lightbox(api.fileUrl(it.cover)) },
                    it.cover ? coverImg(it, { loading: null }) : h('div', { class: 'hero-ph' }, icon(tm.icon, { size: 40, stroke: 1.3 }))),
                h('div', { class: 'hero-info' },
                    h('div', { class: 'hero-badges' }, typeBadge(it.type),
                        it.subtype ? h('span', { class: 'chip-s' }, it.subtype.replace('chara_card_', '').toUpperCase()) : null,
                        it.origin === 'tavern' ? h('span', { class: 'chip-s ok' }, '来自酒馆') : null,
                        it.fields?.nsfw ? h('span', { class: 'chip-s danger' }, 'NSFW') : null,
                        it.deletedAt ? h('span', { class: 'chip-s warn' }, '已删除') : null),
                    h('h2', { class: 'hero-title' }, it.name),
                    it.author ? h('div', { class: 'hero-author' }, icon('user', { size: 13 }), it.author) : null,
                    facts.length ? h('div', { class: 'hero-facts' }, facts.map((f) => h('span', {}, f))) : null,
                    it.tags.length ? h('div', { class: 'hero-tags' }, it.tags.map((t) => h('button', { class: 'tag', title: `查看所有「${t}」`, onclick: () => filterByTag(t) }, t))) : null,
                    h('div', { class: 'hero-actions' },
                        h('button', { class: `fav-btn ${it.favorite ? 'on' : ''}`, onclick: () => save({ favorite: !it.favorite }) }, icon('star', { size: 16, fill: it.favorite }), h('span', {}, it.favorite ? '已收藏' : '收藏')),
                        starsEl(it.rating, (v) => save({ rating: v }), { size: 17 })),
                    h('div', { class: 'hero-time' }, `收录于 ${fmtDate(it.createdAt)} · ${timeAgo(it.updatedAt)}更新`))));
    }

    function section(title, ic, body, action) {
        return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon(ic, { size: 16 }), h('h3', {}, title), action ? h('span', { class: 'grow' }) : null, action), body);
    }
    const editLink = (it, focus, label = '编辑') => btn(label, { icon: 'pencil', cls: 'sm ghost', onclick: () => editItem(it, focus) });

    // ---------- 介绍 ----------
    function overview(it) {
        const c = it.meta?.card;
        const desc = (it.description || '').trim();
        if (it.type === 'character' || PEEK_TYPES.has(it.type)) ensureContent(it);
        // 导入时简介是从作者注释（前 500 字）或描述（前 300 字）截出来的；找到原文就提供「阅读全文」
        const card = content?.kind === 'card' ? (content.data?.data || content.data) : null;
        const fullNotes = String(card?.creator_notes || '').trim();
        const fullDesc = String(card?.description || '').trim();
        const source = desc && [fullNotes, fullDesc].find((t) => t.length > desc.length && t.startsWith(desc));
        const note = fullNotes || (c?.creatorNotesPreview || '').trim();
        const lead = !desc ? null : source
            ? h('div', { class: 'clamp-wrap' }, h('p', { class: 'lead' }, `${desc}…`),
                h('button', { class: 'clamp-btn', onclick: () => readFull(source === fullNotes ? '作者注释' : '角色描述', richText(source, names(it)), source.length) },
                    icon('book', { size: 14 }), h('span', {}, `阅读全文 · ${source.length} 字`)))
            : clampBox((t) => h('p', { class: 'lead' }, t), desc, '简介');
        return h('div', { class: 'stack' },
            lead || (!it.deletedAt && !it.ai?.summary ? h('button', { class: 'lead-empty', onclick: () => editItem(it, 'description') }, icon('pencil', { size: 14 }), '写一句简介') : null),
            aiStamp(it, !it.deletedAt ? () => editItem(it, 'ai') : null),
            it.type === 'character' && it.files.length ? greetingCard(it) : null,
            quickInfo(it),
            note && !(desc && note.startsWith(desc)) ? section('作者的话', 'feather', clampBox((t) => h('blockquote', { class: 'quote' }, t), note, '作者的话')) : null,
            peek(it),
            infoPanel(it),
            it.notes ? section('笔记', 'feather', richText(it.notes, null, { cls: 'rt-notes' }), editLink(it, 'notes')) : null);
    }

    function greetingCard(it) {
        if (!content) return h('section', { class: 'greet is-loading' }, h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
        if (content.kind !== 'card') return null;
        const d = content.data || {};
        const list = [d.first_mes, ...(d.alternate_greetings || [])].filter((x) => x && String(x).trim());
        if (!list.length) return null;
        greetIdx = Math.min(greetIdx, list.length - 1);
        const body = h('div', { class: 'greet-body' });
        const label = h('span', { class: 'greet-label' });
        const count = h('span', { class: 'greet-count' });
        const prev = btn('', { icon: 'chevronLeft', cls: 'sm ghost icon', title: '上一条', onclick: () => { greetIdx--; draw(); } });
        const next = btn('', { icon: 'chevronRight', cls: 'sm ghost icon', title: '下一条', onclick: () => { greetIdx++; draw(); } });
        const draw = () => {
            const g = String(list[greetIdx]);
            clear(body, clampBox((t) => richText(t, names(it)), g, greetIdx === 0 ? '开场白' : `备选开场白 ${greetIdx}`, () => readGreetings(it, list, greetIdx)));
            label.textContent = greetIdx === 0 ? '开场白' : `备选开场白 ${greetIdx}`;
            count.textContent = `${greetIdx + 1} / ${list.length}`;
            prev.disabled = greetIdx === 0;
            next.disabled = greetIdx === list.length - 1;
        };
        draw();
        return h('section', { class: 'greet' },
            h('div', { class: 'greet-head' },
                h('div', { class: 'greet-avatar', style: { '--tc': typeMeta(it.type).color } }, it.cover ? coverImg(it) : icon('user', { size: 16 })),
                h('div', { class: 'greet-who' }, h('b', {}, d.name || it.name), label),
                list.length > 1 ? h('div', { class: 'greet-nav' }, prev, count, next) : null,
                btn('', { icon: 'maximize', cls: 'sm ghost icon', title: '全屏阅读', onclick: () => readGreetings(it, list, greetIdx) })),
            body);
    }

    function quickInfo(it) {
        const m = it.meta || {};
        const stats = [];
        if (it.type === 'character' && m.card) {
            const c = m.card;
            stats.push(['开场白', c.greetings], ['世界书词条', c.bookEntries], ['内嵌正则', c.regexCount], ['内嵌脚本', c.scriptCount], ['估算 Token', c.estTokens ? fmtTok(c.estTokens) : '']);
            if (m.image) stats.push(['立绘尺寸', `${m.image.width}×${m.image.height}`]);
        } else if (it.type === 'worldbook') stats.push(['条目', m.entries], ['常驻', m.constant], ['禁用', m.disabled]);
        else if (it.type === 'preset') stats.push(['提示词', m.prompts], ['已启用', m.enabledPrompts], ['温度', m.temperature], ['上下文', m.maxContext], ['回复长度', m.maxTokens]);
        else if (it.type === 'regex') stats.push(['规则数', m.count || 1]);
        else if (it.type === 'quickreply') stats.push(['按钮', m.count]);
        else if (it.type === 'chat') stats.push(['消息', m.messages], ['角色', m.character], ['用户', m.user]);
        else if (m.image) stats.push(['尺寸', `${m.image.width}×${m.image.height}`]);
        const shown = stats.filter(([, v]) => v !== undefined && v !== null && v !== '');
        if (!shown.length) return null;
        return h('section', { class: 'panel facts-panel' },
            h('div', { class: 'facts' }, shown.map(([k, v]) => h('div', { class: 'fact' }, h('b', {}, String(v)), h('span', {}, k)))),
            tokenLine(m.card?.tokens),
            m.card?.bookName ? h('div', { class: 'muted small' }, '内嵌世界书：', m.card.bookName) : null,
            m.card?.world && m.card.world !== m.card.bookName ? h('div', { class: 'muted small' }, '酒馆里绑定的世界书：', m.card.world) : null);
    }

    /** token 分项：常驻、开场白、世界书 */
    function tokenLine(t) {
        if (!t?.total) return null;
        const parts = [
            t.perm && `常驻 ${fmtTok(t.perm)}`,
            t.greet && `开场白 ${fmtTok(t.greet)}${t.greet !== t.first && t.first ? `（主开场白 ${fmtTok(t.first)}）` : ''}`,
            (t.bookConst || t.bookTrig) && `世界书 ${[t.bookConst && `蓝灯 ${fmtTok(t.bookConst)}`, t.bookTrig && `绿灯 ${fmtTok(t.bookTrig)}`].filter(Boolean).join(' / ')}`,
        ].filter(Boolean);
        return h('div', { class: 'muted small token-line', title: '中文每字约 0.7、其它字符约 0.3 估算，不同模型会有出入；禁用的世界书条目不算' }, `Token：${parts.join(' · ')}`);
    }

    /** 其它类型的内容速览 */
    function peek(it) {
        if (!PEEK_TYPES.has(it.type) || !content || content.kind === 'error') return null;
        const all = (n) => btn(`查看全部${n ? ` ${n} 项` : ''}`, { icon: 'chevronRight', cls: 'sm ghost', onclick: () => switchTab('content') });
        if (content.kind === 'image') return h('img', { class: 'content-img peek-img', src: api.fileUrl(content.file.sha), alt: '', onclick: () => lightbox(api.fileUrl(content.file.sha)) });
        const d = content.data;
        if (!d || content.kind !== 'json') return null;
        if (it.type === 'worldbook') {
            const entries = Array.isArray(d.entries) ? d.entries : Object.values(d.entries || {});
            if (!entries.length) return null;
            return section('条目速览', 'book', h('div', { class: 'peek-list' }, entries.slice(0, 6).map((e) => {
                const keys = [].concat(e.key || e.keys || []);
                return h('div', { class: `peek-row ${e.disable || e.enabled === false ? 'off' : ''}` },
                    h('span', { class: `entry-dot ${e.constant ? 'const' : ''}` }),
                    h('span', { class: 'peek-title' }, e.comment || e.name || keys[0] || '（无标题）'),
                    h('span', { class: 'peek-keys' }, keys.slice(0, 3).map((k) => h('span', { class: 'key' }, k))));
            })), entries.length > 6 ? all(entries.length) : null);
        }
        if (it.type === 'preset' && Array.isArray(d.prompts)) {
            const named = d.prompts.filter((p) => p.content);
            return section('提示词', 'sliders', h('div', { class: 'peek-list' }, named.slice(0, 8).map((p) => h('div', { class: 'peek-row' },
                h('span', { class: 'entry-dot' }), h('span', { class: 'peek-title' }, p.name || p.identifier), p.role ? h('span', { class: 'chip-s' }, p.role) : null))), named.length > 8 ? all(named.length) : null);
        }
        if (it.type === 'regex') {
            const list = Array.isArray(d) ? d : [d];
            return section('规则', 'braces', h('div', { class: 'peek-list' }, list.slice(0, 8).map((r) => h('div', { class: `peek-row ${r.disabled ? 'off' : ''}` },
                h('span', { class: 'entry-dot' }), h('span', { class: 'peek-title' }, r.scriptName || '（未命名）'), h('code', { class: 'peek-code' }, String(r.findRegex || '').slice(0, 60))))), list.length > 8 ? all(list.length) : null);
        }
        if (it.type === 'quickreply' && Array.isArray(d.qrList)) {
            return section('按钮', 'zap', h('div', { class: 'qr-chips' }, d.qrList.slice(0, 30).map((q) => h('span', { class: 'qr-chip', title: q.message || '' }, q.label || '（无标签）'))));
        }
        if (it.type === 'theme') {
            const colors = Object.entries(d).filter(([, v]) => typeof v === 'string' && /^(#|rgba?\()/.test(v));
            return colors.length ? section('配色', 'palette', h('div', { class: 'swatch-list' }, colors.map(([k, v]) => h('div', { class: 'swatch-item' }, h('i', { style: { background: v } }), h('span', {}, k))))) : null;
        }
        return null;
    }

    function infoPanel(it) {
        const rows = [];
        let missing = 0;
        for (const f of fieldsFor(it.type)) {
            if (SHOWN_IN_HERO.has(f.id)) continue;
            const v = TOP_LEVEL_FIELDS.has(f.id) ? it[f.id] : it.fields?.[f.id];
            if (isEmpty(v) && f.kind !== 'checkbox') { missing++; continue; }
            if (isEmpty(v)) continue;
            rows.push([f.label, fieldDisplay(f, v)]);
        }
        if (it.collections.length) rows.push(['合集', h('span', { class: 'info-tags' }, it.collections.map((cid) => h('span', { class: 'chip-s' }, collectionName(cid) || '（已删除）')))]);
        const p = primary(it);
        if (p) rows.push(['当前文件', h('span', { class: 'info-text' }, `${p.name} · ${fmtBytes(p.size)}`)]);
        rows.push(['收录', fmtDate(it.createdAt, true)], ['更新', `${fmtDate(it.updatedAt, true)}（${timeAgo(it.updatedAt)}）`]);
        return section('资料', 'fileText', h('div', { class: 'stack-s' },
            h('dl', { class: 'info-list' }, rows.map(([k, v]) => h('div', { class: 'info-row' }, h('dt', {}, k), h('dd', {}, v)))),
            missing && !it.deletedAt ? h('button', { class: 'info-more', onclick: () => editItem(it) }, icon('plus', { size: 13 }), `还有 ${missing} 项资料没填`) : null),
        !it.deletedAt ? editLink(it) : null);
    }

    // ---------- 资料编辑（单独面板，点保存才写入） ----------
    function editItem(it, focus = '') {
        const d = {
            name: it.name, type: it.type, description: it.description || '', notes: it.notes || '', aiSummary: it.ai?.summary || '',
            tags: [...it.tags], collections: [...it.collections], fields: { ...it.fields },
            top: Object.fromEntries([...TOP_LEVEL_FIELDS].map((k) => [k, it[k]])),
        };
        let dirty = false;
        const mark = () => { dirty = true; };
        const name = h('input', { class: 'input', value: d.name, oninput: (e) => { d.name = e.target.value; mark(); } });
        const typeSel = h('select', { class: 'select', onchange: (e) => { d.type = e.target.value; mark(); drawFields(); } },
            Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k, selected: d.type === k }, v.label)));
        const descCount = h('span', { class: 'muted small' }, `${d.description.length} 字`);
        const desc = h('textarea', { class: 'textarea', rows: 3, value: d.description, placeholder: '一句话说清这是什么、有什么看点', oninput: (e) => { d.description = e.target.value; descCount.textContent = `${d.description.length} 字`; mark(); } });
        const aiSum = h('textarea', { class: 'textarea', rows: 2, value: d.aiSummary, placeholder: '用「AI 整理」生成，也可以自己写', oninput: (e) => { d.aiSummary = e.target.value; mark(); } });
        const notes = h('textarea', { class: 'textarea notes', rows: 5, value: d.notes, placeholder: '玩法心得、搭配建议、修改记录……', oninput: (e) => { d.notes = e.target.value; mark(); } });

        // 标签：已选 + 输入 + 常用建议
        const tagBox = h('div', { class: 'tag-edit' });
        const tagInput = h('input', { class: 'input inline', placeholder: '输入标签，回车添加', onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
                e.preventDefault();
                addTags(tagInput.value);
                tagInput.value = '';
            } else if (e.key === 'Backspace' && !tagInput.value && d.tags.length) { d.tags.pop(); mark(); drawTags(); tagInput.focus(); }
        } });
        const suggest = h('div', { class: 'tag-suggest' });
        const addTags = (v) => { for (const t of String(v).split(/[,，]/).map((x) => x.trim()).filter(Boolean)) if (!d.tags.includes(t)) d.tags.push(t); mark(); drawTags(); tagInput.focus(); };
        const drawTags = () => {
            clear(tagBox, d.tags.map((t) => h('span', { class: 'tag' }, t, h('button', { class: 'tag-x', title: '移除', onclick: () => { d.tags = d.tags.filter((x) => x !== t); mark(); drawTags(); } }, icon('x', { size: 11 })))), tagInput);
            const pool = allTags().filter(([t]) => !d.tags.includes(t)).slice(0, 14);
            clear(suggest, pool.length ? [h('span', { class: 'muted small' }, '常用：'), pool.map(([t]) => h('button', { class: 'tag-sug', onclick: () => addTags(t) }, icon('plus', { size: 10 }), t))] : null);
        };
        drawTags();

        const colBox = h('div', { class: 'tag-edit' });
        const drawCols = () => clear(colBox,
            d.collections.map((cid) => h('span', { class: 'tag' }, collectionName(cid) || '（已删除）', h('button', { class: 'tag-x', onclick: () => { d.collections = d.collections.filter((x) => x !== cid); mark(); drawCols(); } }, icon('x', { size: 11 })))),
            btn('加入合集', { icon: 'plus', cls: 'sm', onclick: () => pickCollection((cid) => { if (!d.collections.includes(cid)) { d.collections.push(cid); mark(); drawCols(); } }) }));
        drawCols();

        const fieldBox = h('div', { class: 'fields' });
        const drawFields = () => clear(fieldBox, fieldsFor(d.type).map((f) => {
            const top = TOP_LEVEL_FIELDS.has(f.id);
            const val = top ? d.top[f.id] : d.fields[f.id];
            const set = (v) => { if (top) d.top[f.id] = v; else d.fields[f.id] = v; mark(); };
            return h('div', { class: `field ${f.kind === 'textarea' ? 'wide' : ''}` }, h('label', {}, f.label), fieldInput(f, val, set));
        }));
        drawFields();

        const doSave = async (b) => {
            const patch = {};
            const nm = d.name.trim() || it.name;
            if (nm !== it.name) patch.name = nm;
            if (d.type !== it.type) patch.type = d.type;
            if (d.description !== (it.description || '')) patch.description = d.description;
            if (d.notes !== (it.notes || '')) patch.notes = d.notes;
            if (d.aiSummary.trim() !== (it.ai?.summary || '')) {
                const { summary: _old, ...rest } = it.ai || {};
                patch.ai = d.aiSummary.trim() ? { ...rest, summary: d.aiSummary.trim() } : (Object.keys(rest).length ? rest : null);
            }
            if (JSON.stringify(d.tags) !== JSON.stringify(it.tags)) patch.tags = d.tags;
            if (JSON.stringify(d.collections) !== JSON.stringify(it.collections)) patch.collections = d.collections;
            if (JSON.stringify(d.fields) !== JSON.stringify(it.fields || {})) patch.fields = d.fields;
            for (const k of TOP_LEVEL_FIELDS) if ((d.top[k] ?? '') !== (it[k] ?? '')) patch[k] = d.top[k];
            if (!Object.keys(patch).length) { es.close(); return; }
            b.disabled = true;
            try {
                await api.patch(`/api/items/${id}`, patch);
                toast('已保存', 'ok');
                dirty = false;
                es.close();
            } catch (e) { toast(e.message, 'err'); b.disabled = false; }
        };
        const es = sheet({
            title: '编辑资料',
            full: true,
            body: h('div', { class: 'stack edit-form' },
                h('div', { class: 'fields' },
                    h('div', { class: 'field' }, h('label', {}, '名称'), name),
                    h('div', { class: 'field' }, h('label', {}, '类型'), typeSel),
                    h('div', { class: 'field wide' }, h('div', { class: 'row-between' }, h('label', {}, '简介'), descCount), desc),
                    h('div', { class: 'field wide' }, h('label', {}, 'AI 简介'), aiSum)),
                h('div', { class: 'field' }, h('label', {}, '标签'), tagBox, suggest),
                h('div', { class: 'field' }, h('label', {}, '合集'), colBox),
                h('div', { class: 'edit-sec' }, h('div', { class: 'form-label' }, '资料字段'), fieldBox,
                    h('div', { class: 'muted small' }, '字段可以在「设置 → 自定义字段」里增减。')),
                h('div', { class: 'field' }, h('label', {}, '笔记'), notes),
                it.type === 'character' && it.files.length ? h('div', { class: 'note' }, icon('info', { size: 15 }), h('span', {}, '这里改的是藏馆里的资料。要改角色卡本身（描述、开场白等），用右上角菜单里的「编辑角色卡内容」，会保存为新版本。')) : null),
            foot: [
                btn('取消', { onclick: () => es.tryClose() }),
                btn('保存', { icon: 'check', cls: 'primary', onclick: (e) => doSave(e.currentTarget) }),
            ],
            beforeClose: async () => !dirty || confirmDialog('放弃未保存的修改？', { ok: '放弃' }),
        });
        es.el.classList.add('edit-sheet');
        const target = { description: desc, notes, tags: tagInput, ai: aiSum }[focus];
        if (target) setTimeout(() => { target.focus(); target.scrollIntoView({ block: 'center' }); }, 120);
    }

    // ---------- 内容 ----------
    function contentTab(it) {
        if (!it.files.length) return emptyState('file', '没有文件', '这个条目只是一条记录，可以在「文件」页补充上传');
        if (!ensureContent(it)) return h('div', { class: 'loading' }, h('span', { class: 'spinner' }));
        if (content.kind === 'error') return emptyState('alert', '加载失败', content.error);
        if (content.kind === 'card') return cardView(it, content);
        if (content.kind === 'image') return h('img', { class: 'content-img', src: api.fileUrl(content.file.sha), alt: '', onclick: () => lightbox(api.fileUrl(content.file.sha)) });
        if (content.kind === 'json') {
            const d = content.data;
            if (it.type === 'worldbook') return worldbookView(d, names(it));
            if (it.type === 'preset' && Array.isArray(d.prompts)) return presetView(d, it);
            if (it.type === 'regex') return regexView(Array.isArray(d) ? d : [d], { n: names(it) });
            if (it.type === 'quickreply' && Array.isArray(d.qrList)) return qrView(d);
            if (it.type === 'theme') return themeView(d);
            return codeView(d);
        }
        if (content.kind === 'text') return h('pre', { class: 'code' }, content.text);
        return emptyState('file', '无法预览', '二进制文件，可在「文件」页下载');
    }

    function fold(title, body, { open = false, count = '', ic = null } = {}) {
        return lazyDetails({ class: 'fold', open },
            h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), ic ? icon(ic, { size: 15 }) : null, h('span', { class: 'fold-title' }, title), count !== '' ? h('span', { class: 'fold-count' }, count) : null),
            () => h('div', { class: 'fold-body' }, typeof body === 'function' ? body() : body));
    }

    /** 角色卡阅读视图：分节、目录、排版 */
    function cardView(it, c) {
        const d = c.data || {};
        const ext = d.extensions || {};
        const book = d.character_book;
        const regex = ext.regex_scripts || [];
        const n = names(it);
        const secs = [];
        const txt = (key, title, v, { dialog = false } = {}) => {
            const t = String(v ?? '').trim();
            if (t) secs.push({ key, title, meta: `${t.length} 字`, node: clampBox((x) => (dialog ? dialogView(x, n) : richText(x, n)), t, title) });
        };
        txt('desc', '描述', d.description);
        txt('personality', '性格', d.personality);
        txt('scenario', '场景', d.scenario);
        const greetings = [d.first_mes, ...(d.alternate_greetings || [])].filter((x) => x && String(x).trim());
        if (greetings.length) {
            secs.push({ key: 'greet', title: '开场白', meta: `${greetings.length} 条`,
                action: btn('全屏阅读', { icon: 'maximize', cls: 'sm ghost', onclick: () => readGreetings(it, greetings, 0) }),
                node: h('div', { class: 'greet-list' }, greetings.map((g, i) => h('div', { class: 'greet-item' },
                    h('div', { class: 'greet-item-head' }, h('span', { class: 'sub-label' }, i === 0 ? '主开场白' : `备选 ${i}`), h('span', { class: 'grow' }),
                        btn('', { icon: 'maximize', cls: 'sm ghost icon', title: '全屏阅读', onclick: () => readGreetings(it, greetings, i) })),
                    clampBox((x) => richText(x, n), String(g), i === 0 ? '主开场白' : `备选开场白 ${i}`, () => readGreetings(it, greetings, i))))) });
        }
        txt('example', '对话示例', d.mes_example, { dialog: true });
        const ex = secs.find((x) => x.key === 'example');
        if (ex && (String(d.mes_example).match(/<START>/gi) || []).length > 1) ex.action = btn('全屏阅读', { icon: 'maximize', cls: 'sm ghost', onclick: () => readFull('对话示例', dialogView(String(d.mes_example).trim(), n), String(d.mes_example).trim().length) });
        txt('system', '系统提示词', d.system_prompt);
        txt('post', '后置指令', d.post_history_instructions);
        txt('depth', '深度提示词', ext.depth_prompt?.prompt);
        txt('notes', '作者注释', d.creator_notes);
        const bookN = entriesOf(book).length;
        if (bookN) secs.push({ key: 'book', title: '内嵌世界书', meta: [String(book.name || '').trim(), `${bookN} 条`].filter(Boolean).join(' · '), node: worldbookView(book, n) });
        if (regex.length) secs.push({ key: 'regex', title: '内嵌正则', meta: `${regex.length} 条`, node: regexView(regex, { sample: String(greetings[0] || ''), n }) });
        const anchor = (k) => `sec-${id}-${k}`;
        return h('div', { class: 'reader' },
            h('div', { class: 'reader-tools' },
                c.spec ? h('span', { class: 'chip-s' }, c.spec.replace('chara_card_', '').toUpperCase()) : null,
                d.character_version ? h('span', { class: 'muted small' }, `v${d.character_version}`) : null,
                h('span', { class: 'grow' }),
                !it.deletedAt ? btn('编辑内容', { icon: 'pencil', cls: 'sm', onclick: () => editCard(it, c) }) : null,
                btn('JSON', { icon: 'download', cls: 'sm', onclick: () => downloadBlob(new Blob([JSON.stringify(c.card, null, 2)], { type: 'application/json' }), `${d.name || 'card'}.json`) })),
            secs.length > 2 ? h('nav', { class: 'sec-nav' }, secs.map((sc) => h('button', { onclick: () => document.getElementById(anchor(sc.key))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, sc.title))) : null,
            secs.length ? secs.map((sc) => h('section', { class: 'read-sec', id: anchor(sc.key) },
                h('div', { class: 'read-head' }, h('h3', {}, sc.title), h('span', { class: 'fold-count' }, sc.meta), sc.action ? h('span', { class: 'grow' }) : null, sc.action || null), sc.node))
                : emptyState('fileText', '角色卡里没有文字内容', ''),
            fold('原始 JSON', () => h('pre', { class: 'code' }, JSON.stringify(c.card, null, 2)), { ic: 'braces' }));
    }

    function worldbookView(d, n) {
        const entries = entriesOf(d);
        let q = '';
        const list = h('div', { class: 'stack-s' });
        const draw = () => {
            const f = entries.filter((e) => !q || JSON.stringify([e.comment, e.key, e.keys, e.content]).toLowerCase().includes(q));
            clear(list, f.slice(0, 300).map((e) => {
                const keys = entryKeys(e);
                const keys2 = entryKeys2(e);
                const off = e.disable || e.enabled === false;
                return lazyDetails({ class: `fold entry ${off ? 'off' : ''}` },
                    h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), h('span', { class: `entry-dot ${e.constant ? 'const' : ''}` }),
                        h('span', { class: 'fold-title' }, e.comment || e.name || keys[0] || '（无标题）'),
                        h('span', { class: 'peek-keys' }, keys.slice(0, 2).map((k) => h('span', { class: 'key' }, k))),
                        e.constant ? h('span', { class: 'chip-s' }, '常驻') : null, off ? h('span', { class: 'chip-s' }, '禁用') : null),
                    () => h('div', { class: 'fold-body' },
                        keys.length ? h('div', { class: 'entry-keys' }, h('span', { class: 'sub-label' }, '关键词'), keys.map((k) => h('span', { class: 'key' }, k))) : null,
                        keys2.length ? h('div', { class: 'entry-keys' }, h('span', { class: 'sub-label' }, '次要'), keys2.map((k) => h('span', { class: 'key' }, k))) : null,
                        clampBox((x) => richText(x, n, { cls: 'rt-entry' }), String(e.content || ''), e.comment || e.name || keys[0] || '世界书条目')));
            }), f.length > 300 ? h('div', { class: 'muted small' }, `仅显示前 300 条，共 ${f.length} 条`) : null,
            !f.length ? h('div', { class: 'muted small' }, '没有匹配的条目') : null);
        };
        draw();
        return h('div', { class: 'stack-s' },
            entries.length > 6 ? h('label', { class: 'search inline' }, icon('search', { size: 15 }), h('input', { class: 'input search-input', placeholder: `在 ${entries.length} 个条目中搜索`, oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } })) : null,
            list);
    }

    function presetView(d, it) {
        const list = effectivePrompts(d);
        const rx = presetRegex(d);
        const params = ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'openai_max_context', 'openai_max_tokens'].filter((k) => d[k] !== undefined);
        return h('div', { class: 'stack' },
            params.length ? h('section', { class: 'panel facts-panel' }, h('div', { class: 'facts' }, params.map((k) => h('div', { class: 'fact' }, h('b', {}, String(d[k])), h('span', {}, k))))) : null,
            h('div', { class: 'muted small' }, `按酒馆里的实际顺序排列，启用 ${list.filter((x) => x.enabled).length} / ${list.length} 条`),
            h('div', { class: 'stack-s' }, list.map(({ p, enabled, used }) => lazyDetails({ class: `fold entry ${enabled ? '' : 'off'}` },
                h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), h('span', { class: 'entry-dot' }), h('span', { class: 'fold-title' }, p.name || p.identifier), p.role ? h('span', { class: 'chip-s' }, p.role) : null, p.marker ? h('span', { class: 'chip-s' }, '占位') : null,
                    !used ? h('span', { class: 'chip-s' }, '未加入') : !enabled ? h('span', { class: 'chip-s' }, '关闭') : null),
                () => (p.content ? h('div', { class: 'fold-body' }, h('div', { class: 'prose' }, p.content)) : h('div'))))),
            rx.length ? fold(`附带正则 · ${rx.length} 条`, () => regexView(rx, { n: names(it) }), { ic: 'terminal' }) : null,
            fold('原始 JSON', () => h('pre', { class: 'code' }, JSON.stringify(d, null, 2)), { ic: 'braces' }));
    }

    function regexView(list, { sample = '', n = { char: '角色', user: state.prefs.userName?.trim() || '你' } } = {}) {
        return h('div', { class: 'stack-s' }, list.map((r) => lazyDetails({ class: `fold entry ${r.disabled ? 'off' : ''}` },
            h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), h('span', { class: 'entry-dot' }), h('span', { class: 'fold-title' }, r.scriptName || '（未命名）'),
                looksHtml(r.replaceString) || hasHtmlFence(r.replaceString) ? h('span', { class: 'chip-s info' }, '美化') : null, r.disabled ? h('span', { class: 'chip-s' }, '禁用') : null),
            () => h('div', { class: 'fold-body' },
                regexChips(r),
                h('div', { class: 'sub-label' }, '查找'), h('pre', { class: 'code' }, r.findRegex || ''),
                h('div', { class: 'sub-label' }, '替换为'), lazyCode(r.replaceString || ''),
                regexPreview(r, sample, n)))));
    }

    // 很长的替换内容（美化正则常有几千字的 HTML）先只显示开头
    function lazyCode(text) {
        if (text.length <= 1200) return h('pre', { class: 'code' }, text);
        const pre = h('pre', { class: 'code' }, `${text.slice(0, 1200)}…`);
        return h('div', {}, pre, btn(`显示全部代码 · ${text.length} 字`, { cls: 'sm ghost', onclick: (e) => { pre.textContent = text; e.currentTarget.remove(); } }));
    }

    function regexChips(r) {
        const chips = [
            ...(r.placement || []).map((p) => PLACEMENT[p]).filter(Boolean).map((t) => `作用于${t}`),
            r.markdownOnly ? '只改显示' : '', r.promptOnly ? '只改发给 AI 的内容' : '',
            r.runOnEdit ? '编辑时运行' : '',
            r.minDepth != null && r.minDepth !== '' ? `深度 ≥ ${r.minDepth}` : '', r.maxDepth != null && r.maxDepth !== '' ? `深度 ≤ ${r.maxDepth}` : '',
        ].filter(Boolean);
        return chips.length ? h('div', { class: 'chips-row' }, chips.map((c) => h('span', { class: 'chip-s' }, c))) : null;
    }

    /** 效果预览：用一段示例文本跑一遍这条正则，HTML 在隔离窗口里显示（脚本不会运行） */
    function regexPreview(r, sample, n) {
        const out = h('div', { class: 'st-wrap' });
        const info = h('div', { class: 'muted small' });
        const runJs = h('input', { type: 'checkbox', checked: Boolean(state.prefs.stScripts), onchange: () => { state.prefs.stScripts = runJs.checked; savePrefs(); draw(); } });
        const input = h('textarea', { class: 'textarea st-sample', rows: 3, placeholder: '粘贴一段 AI 回复，看这条正则会把它变成什么样', value: sample });
        let timer = 0;
        const draw = () => {
            const text = input.value;
            const res = text ? runRegex(text, r, n) : { out: '', hits: 0 };
            if (res.error) { info.textContent = res.error; clear(out); return; }
            let html;
            if (res.hits) {
                html = res.out;
                info.textContent = `示例文本里匹配到 ${res.hits} 处，下面是酒馆里大致的显示效果`;
            } else {
                html = String(r.replaceString || '').replace(/\{\{match\}\}/gi, '').replace(/\$(\d{1,2}|&|<[^>]+>)/g, '');
                info.textContent = !html.trim() ? (text ? '示例文本里没有匹配的内容' : '这条正则会删掉匹配到的内容')
                    : text ? '示例文本里没有匹配的内容，下面先显示替换内容本身（$1 这类引用留空）' : '下面是替换内容本身（$1 这类引用留空）';
            }
            html = macroNames(html, n);
            clear(out, !html.trim() ? null : looksHtml(html) || hasHtmlFence(html) ? stView(html, { scripts: runJs.checked }) : richText(html, n));
        };
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 250); });
        draw();
        return h('div', { class: 'st-preview' },
            h('div', { class: 'sub-label' }, '效果预览'), info, out,
            h('details', { class: 'st-sample-box', open: !sample }, h('summary', {}, '换一段示例文本'), input),
            hasScript(r.replaceString) ? h('label', { class: 'check-line' }, runJs, h('span', {}, '运行脚本（翻页、点击切换等效果需要；脚本在隔离环境里运行，读不到藏馆的数据）')) : null);
    }

    function qrView(d) {
        return h('div', { class: 'stack-s' }, d.qrList.map((q) => fold(q.label || '（无标签）', h('pre', { class: 'code' }, q.message || ''), { ic: 'zap' })));
    }

    function themeView(d) {
        const colors = Object.entries(d).filter(([, v]) => typeof v === 'string' && /^(#|rgba?\()/.test(v));
        return h('div', { class: 'stack' },
            colors.length ? h('section', { class: 'panel' }, h('div', { class: 'swatch-list' }, colors.map(([k, v]) => h('div', { class: 'swatch-item' }, h('i', { style: { background: v } }), h('span', {}, k))))) : null,
            d.custom_css ? fold('自定义 CSS', h('pre', { class: 'code' }, d.custom_css), { ic: 'braces', count: `${d.custom_css.length} 字` }) : null,
            fold('原始 JSON', () => codeView(d), { ic: 'braces' }));
    }

    const codeView = (d) => h('pre', { class: 'code' }, JSON.stringify(d, null, 2));

    // ---------- 编辑角色卡 ----------
    function editCard(it, c) {
        const d = structuredClone(c.data || {});
        const FIELDS = [
            ['name', '名称', 'input'], ['nickname', '昵称', 'input'], ['creator', '作者', 'input'], ['character_version', '版本', 'input'],
            ['description', '描述', 'textarea'], ['personality', '性格', 'textarea'], ['scenario', '场景', 'textarea'],
            ['first_mes', '主开场白', 'textarea'], ['mes_example', '对话示例', 'textarea'], ['system_prompt', '系统提示词', 'textarea'],
            ['post_history_instructions', '后置指令', 'textarea'], ['creator_notes', '作者注释', 'textarea'],
        ];
        const inputs = {};
        const tagsInput = h('input', { class: 'input', value: (d.tags || []).join(', ') });
        const greets = (d.alternate_greetings || []).slice();
        const greetBox = h('div', { class: 'stack-s' });
        const drawGreets = () => clear(greetBox, greets.map((g, i) => h('div', {},
            h('div', { class: 'toolbar-row' }, h('span', { class: 'sub-label grow' }, `备选开场白 ${i + 1}`), btn('', { icon: 'trash', cls: 'sm ghost danger', onclick: () => { greets.splice(i, 1); drawGreets(); } })),
            h('textarea', { class: 'textarea', value: g, oninput: (e) => { greets[i] = e.target.value; } }))),
        btn('添加备选开场白', { icon: 'plus', cls: 'sm', onclick: () => { greets.push(''); drawGreets(); } }));
        drawGreets();
        // 防丢稿：改动随手存成草稿（只在这台设备的浏览器里），关闭时有改动先确认
        const baseSha = (it.files.find((f) => f.primary) || it.files[0])?.sha || '';
        const draftKey = `tv_draft_card_${id}_${baseSha.slice(0, 16)}`;
        const snap = () => JSON.stringify({ f: Object.fromEntries(FIELDS.map(([k]) => [k, inputs[k].value])), tags: tagsInput.value, greets });
        let initial = '';
        const dropDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } };
        const saveDraft = debounce(() => {
            try { const s = snap(); if (s === initial) localStorage.removeItem(draftKey); else localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), s })); } catch { /* 存不下就算了 */ }
        }, 500);
        const es = sheet({
            title: `编辑 · ${d.name}`, full: true,
            beforeClose: async () => {
                if (snap() === initial) { dropDraft(); return true; }
                const ok = await confirmDialog('有还没保存的修改，确定放弃？', { ok: '放弃修改', danger: true });
                if (ok) dropDraft();
                return ok;
            },
            body: h('div', { class: 'stack' },
                h('div', { class: 'note' }, icon('info', { size: 15 }), '保存后生成新版本，旧版本保留在「文件」页，可随时切回。PNG 卡会保留原立绘。'),
                h('div', { class: 'fields' }, FIELDS.map(([k, label, kind]) => {
                    inputs[k] = kind === 'input' ? h('input', { class: 'input', value: d[k] || '' }) : h('textarea', { class: 'textarea', value: d[k] || '', style: { minHeight: k === 'description' || k === 'first_mes' ? '200px' : '100px' } });
                    return h('div', { class: `field ${kind === 'textarea' ? 'wide' : ''}` }, h('label', {}, label), inputs[k]);
                }), h('div', { class: 'field wide' }, h('label', {}, '标签'), tagsInput), h('div', { class: 'field wide' }, h('label', {}, '备选开场白'), greetBox))),
            foot: [
                btn('取消', { onclick: () => es.tryClose() }),
                btn('保存', { icon: 'check', cls: 'primary', onclick: async (e) => {
                    const b = e.currentTarget;
                    b.disabled = true;
                    for (const [k] of FIELDS) d[k] = inputs[k].value;
                    d.tags = tagsInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
                    d.alternate_greetings = greets.filter((g) => g.trim());
                    try {
                        await api.put(`/api/items/${id}/card`, { card: { ...c.card, data: d } });
                        toast('已保存为新版本', 'ok');
                        dropDraft();
                        content = null;
                        es.close();
                    } catch (err) { toast(err.message, 'err'); b.disabled = false; }
                } }),
            ],
        });
        initial = snap();
        es.body.addEventListener('input', saveDraft);
        es.body.addEventListener('click', () => setTimeout(saveDraft, 0)); // 增删备选开场白
        let draft = null;
        try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { /* ignore */ }
        if (draft?.s && draft.s !== initial) {
            confirmDialog(`上次编辑这张卡时有没保存的修改（${fmtDate(new Date(draft.at).toISOString(), true)}），要恢复吗？`, { ok: '恢复', title: '恢复草稿' }).then((ok) => {
                if (!ok) { dropDraft(); return; }
                try {
                    const v = JSON.parse(draft.s);
                    for (const [k] of FIELDS) if (typeof v.f?.[k] === 'string') inputs[k].value = v.f[k];
                    if (typeof v.tags === 'string') tagsInput.value = v.tags;
                    if (Array.isArray(v.greets)) { greets.splice(0, greets.length, ...v.greets.map(String)); drawGreets(); }
                    toast('已恢复草稿，记得保存', 'ok');
                } catch { toast('草稿读取失败', 'err'); }
            });
        }
    }

    // ---------- 文件 ----------
    function filesTab(it) {
        const asPrimary = h('input', { type: 'checkbox', checked: true });
        const fileInput = h('input', { type: 'file', hidden: true, multiple: true, onchange: async () => {
            for (const f of fileInput.files) {
                try { await api.uploadVersion(id, f, { primary: asPrimary.checked }); } catch (e) { toast(e.message, 'err'); }
            }
            toast('上传完成', 'ok');
            fileInput.value = '';
        } });
        const sorted = [...it.files].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
        const cur = primary(it);
        // 和主文件同一类的文件算作「版本」，其余（插图等）算附件
        // 带角色卡数据的 PNG（有内容指纹）才算角色卡，其它图片是插图 / 封面收藏
        const family = (f) => ((/^image\/png/.test(f.mime) && (f.sig || f.primary)) || /\.(json|charx)$/i.test(f.name) ? 'card' : /^image\//.test(f.mime) ? 'image' : f.mime);
        const versions = sorted.filter((f) => cur && family(f) === family(cur));
        const verNo = new Map([...versions].reverse().map((f, i) => [f.id, i + 1]));
        const prevOf = (f) => versions[versions.indexOf(f) + 1];
        const label = (f) => `${verNo.has(f.id) ? `版本 ${verNo.get(f.id)}` : '附件'} · ${f.name}`;
        const compare = (a, b) => openDiff({ sha: a.sha, name: a.name, label: label(a) }, { sha: b.sha, name: b.name, label: label(b) }, { title: `对比：${it.name}` });
        return h('div', { class: 'stack' },
            coverPanel(it),
            h('section', { class: 'panel' },
                h('div', { class: 'panel-head' }, icon('layers', { size: 16 }), h('h3', {}, versions.length > 1 ? `文件与版本 · ${versions.length} 个版本` : '文件与版本'), h('span', { class: 'grow' }),
                    versions.length > 1 && cur ? btn('对比上一版', { icon: 'eye', cls: 'sm', onclick: () => compare(prevOf(cur) || versions[1], cur) }) : null,
                    btn('上传', { icon: 'upload', cls: 'sm primary', onclick: () => fileInput.click() }), fileInput),
                h('label', { class: 'check-line' }, asPrimary, h('span', {}, '上传的文件设为主文件（新版本）；不勾选则作为附件')),
                h('div', { class: 'file-list' }, sorted.map((f) => h('div', { class: `file-row ${f.primary ? 'primary' : ''}` },
                    h('div', { class: 'file-ic' }, verNo.has(f.id) ? h('b', { class: 'file-ver' }, `v${verNo.get(f.id)}`) : icon(/^image\//.test(f.mime) ? 'image' : 'file', { size: 18 })),
                    h('div', { class: 'grow min0' },
                        h('div', { class: 'file-name' }, h('span', { class: 'min0' }, f.name), f.primary ? h('span', { class: 'chip-s ok' }, '当前') : null),
                        h('div', { class: 'file-meta' }, `${fmtBytes(f.size)} · ${fmtDate(f.addedAt, true)}`, f.label ? ` · ${f.label}` : '')),
                    !f.primary && cur && verNo.has(f.id) ? btn('', { icon: 'eye', cls: 'sm ghost', title: '与当前版本对比', onclick: () => compare(f, cur) }) : null,
                    btn('', { icon: 'download', cls: 'sm ghost', href: api.fileUrl(f.sha, f.name, true, it.id), download: f.name, title: '下载' }),
                    btn('', { icon: 'more', cls: 'sm ghost', onclick: () => fileMenu(it, f, { compare, prev: prevOf(f), cur }) }))))),
            h('div', { class: 'muted small' }, '「当前」版本决定条目显示的信息，也是「导入到酒馆」时使用的文件。旧版本会一直保留，随时可以切回去。'));
    }

    /** 封面收藏：一个条目可以存多张图，选一张当封面；角色卡可以用这张图导出 PNG */
    function coverPanel(it) {
        const images = it.files.filter((f) => /^image\//.test(f.mime)).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
        const isCard = it.type === 'character' && primary(it);
        if (!images.length && !isCard) return null;
        const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
            const files = [...input.files];
            input.value = '';
            let n = 0;
            for (const f of files) {
                try { await api.uploadVersion(id, f, { primary: false, label: '封面收藏' }); n++; } catch (e) { toast(`${f.name}：${e.message}`, 'err'); }
            }
            if (n) toast(`已添加 ${n} 张图片，点一下就能设为封面`, 'ok');
        } });
        const tile = (f) => {
            const on = f.sha === it.cover;
            return h('button', { class: `cover-tile ${on ? 'on' : ''}`, title: on ? '当前封面，点击看大图' : '设为封面',
                onclick: async () => {
                    if (on) { lightbox(api.fileUrl(f.sha)); return; }
                    await api.patch(`/api/items/${id}/files/${f.id}`, { asCover: true });
                    toast('已设为封面', 'ok');
                } },
            coverImg({ cover: f.sha, thumb: on ? it.thumb : Boolean(f.thumb) }),
            on ? h('span', { class: 'cover-on' }, icon('check', { size: 12, stroke: 3 }), '封面') : null,
            f.primary ? h('span', { class: 'cover-tag' }, '卡图') : null);
        };
        return h('section', { class: 'panel' },
            h('div', { class: 'panel-head' }, icon('image', { size: 16 }), h('h3', {}, '封面'), images.length > 1 ? h('span', { class: 'fold-count' }, `${images.length} 张`) : null, h('span', { class: 'grow' }),
                isCard && it.cover ? btn('导出 PNG', { icon: 'download', cls: 'sm', title: '用当前封面导出酒馆可以导入的角色卡 PNG', onclick: () => exportPng(it) }) : null,
                btn('添加图片', { icon: 'plus', cls: 'sm', onclick: () => input.click() }), input),
            images.length ? h('div', { class: 'cover-grid' }, images.map(tile)) : null,
            h('div', { class: 'muted small' }, isCard
                ? '点一下图片设为封面。「导出 PNG」会把角色卡数据写进当前封面，导入酒馆后用的就是这张图。'
                : '点一下图片设为封面。'));
    }

    async function exportPng(it) {
        if (!content) await loadContent(it);
        if (content?.kind !== 'card' || !content.card) { toast('读取角色卡失败', 'err'); return; }
        if (!it.cover) { toast('这个条目还没有封面', 'err'); return; }
        try {
            toast('正在生成 PNG…');
            const blob = await cardPng(api.fileUrl(it.cover), content.card);
            downloadBlob(blob, `${(content.data?.name || it.name).replace(/[\\/:*?"<>|]/g, '_')}.png`);
        } catch (e) { toast(`导出失败：${e.message}`, 'err'); }
    }

    function fileMenu(it, f, { compare, prev, cur } = {}) {
        const item = (ic, label, fn, cls = '') => h('button', { class: `menu-item ${cls}`, onclick: async () => { m.close(); await fn(); } }, icon(ic, { size: 17 }), h('span', {}, label));
        const m = sheet({
            title: f.name,
            body: h('div', { class: 'menu' },
                !f.primary ? item('restore', '切换到这个版本', async () => { await api.patch(`/api/items/${id}/files/${f.id}`, { primary: true }); toast('已切换为当前版本', 'ok'); }) : null,
                !f.primary && cur && compare ? item('eye', '与当前版本对比', () => compare(f, cur)) : null,
                prev && compare ? item('eye', '与上一个版本对比', () => compare(prev, f)) : null,
                /^image\//.test(f.mime) ? item('image', '设为封面', async () => { await api.patch(`/api/items/${id}/files/${f.id}`, { asCover: true }); toast('已设为封面', 'ok'); }) : null,
                item('pencil', '编辑备注', async () => { const label = await promptDialog('', { title: '版本备注', value: f.label }); if (label != null) await api.patch(`/api/items/${id}/files/${f.id}`, { label }); }),
                item('type', '重命名', async () => { const name = await promptDialog('', { title: '重命名文件', value: f.name }); if (name) await api.patch(`/api/items/${id}/files/${f.id}`, { name }); }),
                item('trash', '删除此文件', async () => {
                    const msg = it.files.length === 1 ? '这是唯一的文件，删除后条目将没有文件。继续？' : `删除文件「${f.name}」？`;
                    if (!(await confirmDialog(msg, { danger: true }))) return;
                    await api.del(`/api/items/${id}/files/${f.id}`);
                    toast('已删除');
                }, 'danger')),
        });
    }

    render();
}

/** 根据字段定义生成输入控件 */
export function fieldInput(f, val, set) {
    switch (f.kind) {
        case 'textarea': { const el = h('textarea', { class: 'textarea', value: val || '', oninput: () => set(el.value) }); return el; }
        case 'number': { const el = h('input', { class: 'input', type: 'number', value: val ?? '', oninput: () => set(el.value === '' ? null : Number(el.value)) }); return el; }
        case 'url': {
            const el = h('input', { class: 'input', type: 'url', value: val || '', placeholder: 'https://', oninput: () => set(el.value) });
            return h('div', { class: 'input-group' }, el, val ? btn('', { icon: 'external', cls: 'sm', href: val, title: '打开链接' }) : null);
        }
        case 'date': { const el = h('input', { class: 'input', type: 'date', value: val || '', onchange: () => set(el.value, true) }); return el; }
        case 'color': { const el = h('input', { class: 'input color', type: 'color', value: val || '#888888', onchange: () => set(el.value, true) }); return el; }
        case 'select': return h('select', { class: 'select', onchange: (e) => set(e.target.value, true) }, h('option', { value: '' }, '未选择'), (f.options || []).map((o) => h('option', { value: o, selected: val === o }, o)));
        case 'checkbox': return switchEl(Boolean(val), (v) => set(v, true));
        case 'rating': return starsEl(val, (v) => set(v, true), { size: 18 });
        case 'tags': { const el = h('input', { class: 'input', value: Array.isArray(val) ? val.join(', ') : val || '', placeholder: '逗号分隔', onchange: () => set(el.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean), true) }); return el; }
        default: { const el = h('input', { class: 'input', value: val ?? '', oninput: () => set(el.value) }); return el; }
    }
}
