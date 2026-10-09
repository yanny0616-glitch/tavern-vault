// 酒馆联通页：浏览酒馆本地内容、收藏进仓库；比对两边版本；把仓库条目导入（或覆盖）到酒馆
import { h, clear, toast, sheet, icon, btn, emptyState, choiceDialog } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, findByName, typeMeta, reload } from '../state.js';
import { sigOf, stripSyncEntries } from '../sig.js';
import { topbar, ensureView } from './common.js';
import { openDetail } from './detail.js';
import { openDiff } from './diff.js';

const KINDS = [
    ['character', '角色卡'],
    ['worldbook', '世界书'],
    ['preset', '预设'],
    ['regex', '正则'],
    ['quickreply', '快速回复'],
    ['theme', '主题'],
    ['background', '背景'],
];
export const TAVERN_IMPORTABLE = new Set(KINDS.map(([k]) => k));
const SIG_KINDS = new Set(['character', 'worldbook', 'preset', 'regex', 'quickreply', 'theme']);

const ui = { kind: 'character', lists: {}, loading: false, selected: new Set(), q: '', filter: 'all', sigs: new Map(), checking: null };
const thumbCache = new Map();

// 酒馆数据变化时，下次进入酒馆页重新读取
bridge.on((event) => {
    if (event !== 'tavern-changed') return;
    ui.lists = {};
    ui.sigs.clear();
    const root = document.querySelector('main.main');
    if (root?.dataset.view === 'tavern' && !ui.loading) renderTavern(root);
});

const sigKey = (kind, id) => `${kind}:${id}`;

/**
 * 酒馆条目和藏馆的关系
 * new 未收藏 · collected 已收藏（无法比对）· synced 内容一致 · changed 酒馆里改过
 * older 酒馆里是藏馆的某个旧版本（藏馆较新）· other 酒馆里是藏馆的另一个版本，但不是当前版本
 */
function statusOf(kind, r) {
    const item = findByName(kind, r.name);
    if (!item) return { s: 'new' };
    const sig = ui.sigs.get(sigKey(kind, r.id));
    const cur = item.files.find((f) => f.primary) || item.files[item.files.length - 1];
    if (!sig || !cur?.sig) return { s: 'collected', item };
    if (cur.sig === sig) return { s: 'synced', item };
    const same = item.files.find((f) => f.sig === sig);
    if (same) return { s: same.addedAt < cur.addedAt ? 'older' : 'other', item };
    return { s: 'changed', item };
}

const FILTERS = [['all', '全部'], ['new', '未收藏'], ['diff', '有差异']];

export function renderTavern(root) {
    const refs = ensureView(root, 'tavern', () => {
        const seg = h('div', { class: 'seg' });
        const actions = h('div', { class: 'tb-actions-inner' });
        const head = topbar('酒馆', { kicker: bridge.host ? `Connected · ${bridge.host.host}` : 'Tavern', sub: '浏览酒馆里的内容，收藏进仓库，比对两边的版本', actions: [actions] });
        const searchInput = h('input', { class: 'input search-input', type: 'search', placeholder: '筛选', oninput: (e) => { ui.q = e.target.value; renderTavern(root); } });
        head.append(h('label', { class: 'search' }, icon('search', { size: 16 }), searchInput), seg);
        const toolbar = h('div', { class: 'toolbar-row' });
        const note = h('div');
        const content = h('div');
        const selbar = h('div', { class: 'selbar', hidden: true });
        root.append(head, h('div', { class: 'page' }, note, toolbar, content), selbar);
        clear(actions, btn('', { icon: 'refresh', cls: 'ghost', title: '重新读取', onclick: () => refresh(true) }));
        return { seg, toolbar, note, content, selbar };
    });
    if (!bridge.host) {
        clear(refs.content, emptyState('beer', '未连接酒馆', '这个页面需要在酒馆插件里打开'));
        return;
    }
    clear(refs.note, !bridge.has('raw')
        ? h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, '酒馆里的插件版本较旧，无法比对版本和覆盖导入。请在酒馆的扩展管理里更新「酒馆藏馆」插件。'))
        : null);
    clear(refs.seg, KINDS.map(([k, label]) => h('button', { class: `seg-item ${ui.kind === k ? 'active' : ''}`, onclick: () => { ui.kind = k; ui.selected.clear(); refresh(); } },
        icon(typeMeta(k).icon, { size: 14 }), h('span', { class: 'seg-label' }, label), ui.lists[k] ? h('span', { class: 'seg-n' }, ui.lists[k].length) : null)));

    const kind = ui.kind;
    const list = ui.lists[kind];
    if (!list) {
        if (!ui.loading) refresh();
        clear(refs.content, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, '正在读取酒馆数据')));
        clear(refs.toolbar);
        refs.selbar.hidden = true;
        return;
    }

    const withStatus = list.map((r) => ({ r, st: statusOf(kind, r) }));
    const isDiff = (st) => st.s === 'changed' || st.s === 'older' || st.s === 'other';
    const q = ui.q.toLowerCase();
    const rows = withStatus.filter(({ r, st }) => (!q || `${r.name} ${r.sub || ''}`.toLowerCase().includes(q))
        && (ui.filter === 'all' || (ui.filter === 'new' && st.s === 'new') || (ui.filter === 'diff' && isDiff(st))));
    const count = { all: list.length, new: withStatus.filter((x) => x.st.s === 'new').length, diff: withStatus.filter((x) => isDiff(x.st)).length };
    clear(refs.toolbar,
        FILTERS.map(([k, l]) => (k === 'diff' && !SIG_KINDS.has(kind) ? null : h('button', { class: `pill ${ui.filter === k ? 'active' : ''}`, onclick: () => { ui.filter = k; renderTavern(root); } }, h('span', {}, `${l} · ${count[k]}`)))),
        ui.checking?.kind === kind ? h('span', { class: 'muted small tv-checking' }, h('span', { class: 'spinner' }), `比对中 ${ui.checking.done}/${ui.checking.total}`) : null,
        h('span', { class: 'grow' }),
        btn('全选', { cls: 'sm ghost', onclick: () => { const all = rows.every(({ r }) => ui.selected.has(r.id)); rows.forEach(({ r }) => (all ? ui.selected.delete(r.id) : ui.selected.add(r.id))); renderTavern(root); } }));

    if (!rows.length) {
        clear(refs.content, emptyState(typeMeta(kind).icon, list.length ? '没有符合条件的内容' : '酒馆里还没有这类内容'));
    } else {
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); loadThumb(e.target); }
        }, { rootMargin: '200px' });
        const toggle = (r) => { ui.selected.has(r.id) ? ui.selected.delete(r.id) : ui.selected.add(r.id); renderTavern(root); };
        const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
        clear(refs.content, h('div', { class: 'rows' }, rows.map(({ r, st }) => {
            const sel = ui.selected.has(r.id);
            const thumb = h('div', { class: 'row-thumb', dataset: { kind, id: r.id } }, icon(typeMeta(kind).icon, { size: 20 }));
            if (r.thumb) io.observe(thumb);
            let right;
            let note = '';
            switch (st.s) {
                case 'new':
                    right = btn('收藏', { icon: 'download', cls: 'sm', onclick: stop(() => collect([r])) });
                    break;
                case 'synced':
                    right = h('button', { class: 'chip-s ok as-btn', title: '在仓库中查看', onclick: stop(() => openDetail(st.item.id)) }, icon('check', { size: 11, stroke: 3 }), '已同步');
                    break;
                case 'changed':
                    note = '酒馆里的内容和藏馆当前版本不同';
                    right = h('div', { class: 'row-actions' },
                        btn('对比', { icon: 'eye', cls: 'sm ghost', onclick: stop(() => compareWithTavern(r, st.item)) }),
                        btn('存为新版本', { cls: 'sm primary', onclick: stop(() => collect([r])) }));
                    break;
                case 'older':
                case 'other':
                    note = st.s === 'older' ? '酒馆里是旧版本，藏馆有更新' : '酒馆里是藏馆的另一个版本（不是当前版本）';
                    right = h('div', { class: 'row-actions' },
                        btn('对比', { icon: 'eye', cls: 'sm ghost', onclick: stop(() => compareWithTavern(r, st.item)) }),
                        btn('更新到酒馆', { cls: 'sm primary', onclick: stop(() => importItemsToTavern([st.item], { decide: 'replace' })) }));
                    break;
                default:
                    right = h('button', { class: 'chip-s ok as-btn', title: '在仓库中查看', onclick: stop(() => openDetail(st.item.id)) }, icon('check', { size: 11, stroke: 3 }), '已收藏');
            }
            return h('div', { class: `row-item ${sel ? 'selected' : ''} ${isDiff(st) ? `tv-${st.s}` : ''}`, style: { '--tc': typeMeta(kind).color }, onclick: () => toggle(r) },
                h('span', { class: `row-check ${sel ? 'on' : ''}` }, icon('check', { size: 13, stroke: 3 })),
                thumb,
                h('div', { class: 'row-main' },
                    h('div', { class: 'row-title' }, h('span', {}, r.name)),
                    isDiff(st)
                        ? h('div', { class: 'row-sub' }, h('span', { class: `chip-s ${st.s === 'changed' ? 'warn' : 'info'}` }, { changed: '酒馆有改动', older: '藏馆较新', other: '版本不同' }[st.s]), h('span', { title: note }, note))
                        : r.sub ? h('div', { class: 'row-sub' }, h('span', {}, r.sub)) : null),
                right);
        })));
    }

    const n = ui.selected.size;
    refs.selbar.hidden = !n;
    if (n) {
        const picked = withStatus.filter(({ r }) => ui.selected.has(r.id));
        const olderItems = picked.filter(({ st }) => st.s === 'older' || st.s === 'other').map(({ st }) => st.item);
        clear(refs.selbar, h('div', { class: 'sel-top' }, h('span', { class: 'sel-count' }, `已选 ${n} 项`),
            h('span', { class: 'grow' }),
            btn('取消', { cls: 'sm ghost', onclick: () => { ui.selected.clear(); renderTavern(root); } }),
            olderItems.length ? btn(`更新到酒馆 · ${olderItems.length}`, { cls: 'sm', onclick: () => importItemsToTavern(olderItems, { decide: 'replace' }) }) : null,
            btn('收藏到仓库', { icon: 'download', cls: 'sm primary', onclick: () => collect(picked.map(({ r }) => r)) })));
    }
}

async function refresh(force = false) {
    const kind = ui.kind;
    if (force) { ui.lists = {}; ui.sigs.clear(); thumbCache.clear(); }
    ui.loading = true;
    try {
        ui.lists[kind] = await bridge.call('list', { kind });
    } catch (e) {
        ui.lists[kind] = [];
        toast(`读取失败：${e.message}`, 'err');
    }
    ui.loading = false;
    rerender();
    checkSigs(kind, ui.lists[kind]);
}

/** 读取酒馆里已收藏条目的内容，计算指纹，判断是否和藏馆一致 */
async function checkSigs(kind, list, { force = false } = {}) {
    if (!SIG_KINDS.has(kind) || !bridge.has('raw') || !list?.length) return;
    const todo = list.filter((r) => findByName(kind, r.name) && (force || !ui.sigs.has(sigKey(kind, r.id))));
    if (!todo.length) return;
    const job = { kind, done: 0, total: todo.length };
    ui.checking = job;
    rerender();
    for (let i = 0; i < todo.length; i += 20) {
        const chunk = todo.slice(i, i + 20);
        try {
            const res = await bridge.call('raw', { kind, ids: chunk.map((r) => r.id) }, [], 60000);
            for (const { id, data } of res) ui.sigs.set(sigKey(kind, id), sigOf(kind, stripSyncEntries(kind, data, state.settings.syncExclude).obj));
        } catch { /* 读取失败的保持「已收藏」 */ }
        for (const r of chunk) if (!ui.sigs.has(sigKey(kind, r.id))) ui.sigs.set(sigKey(kind, r.id), '');
        job.done += chunk.length;
        if (ui.checking === job) rerender();
    }
    if (ui.checking === job) ui.checking = null;
    rerender();
}

function rerender() {
    const root = document.querySelector('main.main');
    if (root?.dataset.view === 'tavern') renderTavern(root);
}

async function loadThumb(el) {
    const key = `${el.dataset.kind}:${el.dataset.id}`;
    try {
        let url = thumbCache.get(key);
        if (!url) {
            const r = await bridge.call('thumb', { kind: el.dataset.kind, id: el.dataset.id }, [], 30000);
            if (!r?.data) return;
            url = URL.createObjectURL(new Blob([r.data], { type: r.mime || 'image/png' }));
            thumbCache.set(key, url);
        }
        clear(el, h('img', { src: url, alt: '' }));
    } catch { /* 忽略缩略图失败 */ }
}

async function exportFromTavern(kind, r) {
    const exp = await bridge.call('export', { kind, id: r.id });
    return { blob: new Blob([exp.data]), filename: exp.filename };
}

/** 对比：把酒馆里的版本临时上传（不建条目），和藏馆当前版本做对比 */
async function compareWithTavern(r, item) {
    const kind = ui.kind;
    try {
        const { blob, filename } = await exportFromTavern(kind, r);
        const res = await api.upload(blob, { filename, target: item.id, match: 'ask', origin: 'tavern' });
        const cur = item.files.find((f) => f.primary) || item.files[item.files.length - 1];
        if (res.status === 'duplicate') {
            toast(res.current ? '内容和藏馆当前版本相同' : '酒馆里是藏馆中的一个旧版本', 'ok');
            if (res.current) return;
        }
        const tavernFile = res.status === 'duplicate' ? item.files.find((f) => f.sha === res.sha) || item.files.find((f) => f.sig && f.sig === ui.sigs.get(sigKey(kind, r.id))) : { sha: res.sha, name: res.filename };
        if (!tavernFile) return;
        openDiff({ sha: cur.sha, name: cur.name, label: `藏馆 · 当前版本` }, { sha: tavernFile.sha, name: tavernFile.name, label: '酒馆里的版本' }, {
            title: `对比：${item.name}`,
            foot: (close) => [
                btn('关闭', { cls: 'ghost', onclick: close }),
                btn('用藏馆版本覆盖酒馆', { onclick: () => { close(); importItemsToTavern([item], { decide: 'replace' }); } }),
                res.status === 'conflict' ? btn('把酒馆版本存为新版本', { cls: 'primary', onclick: async () => {
                    close();
                    await api.resolve(res, 'version', { target: item.id });
                    toast('已存为新版本', 'ok');
                    await reload();
                    rerender();
                } }) : null,
            ],
        });
    } catch (e) {
        toast(`对比失败：${e.message}`, 'err');
    }
}

/** 从酒馆导出并上传到仓库；已收藏的条目会存为新版本 */
async function collect(rows) {
    const kind = ui.kind;
    const prog = progressSheet(`收藏到仓库（${rows.length}）`);
    const n = { created: 0, version: 0, duplicate: 0, fail: 0 };
    const conflicts = [];
    for (const [i, r] of rows.entries()) {
        prog.update(i, rows.length, r.name);
        try {
            const { blob, filename } = await exportFromTavern(kind, r);
            const item = findByName(kind, r.name);
            const res = await api.upload(blob, { filename, origin: 'tavern', type: kind === 'background' ? 'background' : '', ...(item ? { target: item.id, match: 'version' } : { match: 'ask' }) });
            if (res.status === 'conflict') conflicts.push(res);
            else n[res.status === 'version' ? 'version' : res.duplicate ? 'duplicate' : 'created']++;
        } catch (e) {
            n.fail++;
            prog.log(`${r.name}：${e.message}`, 'err');
        }
    }
    const msg = [n.created && `新增 ${n.created}`, n.version && `新版本 ${n.version}`, n.duplicate && `已是最新 ${n.duplicate}`, n.fail && `失败 ${n.fail}`, conflicts.length && `同名待处理 ${conflicts.length}`].filter(Boolean).join('，');
    if (conflicts.length) {
        prog.log(`${conflicts.length} 项和藏馆里的条目同名（名字写法略有不同），请选择：`, '');
        prog.actions(
            btn('全部存为新版本', { cls: 'sm primary', onclick: async () => { for (const c of conflicts) await api.resolve(c, 'version'); toast('已处理', 'ok'); prog.close(); await reload(); } }),
            btn('全部另存', { cls: 'sm', onclick: async () => { for (const c of conflicts) await api.resolve(c, 'new'); toast('已处理', 'ok'); prog.close(); await reload(); } }),
            btn('跳过', { cls: 'sm ghost', onclick: () => prog.close() }));
    }
    prog.done(`完成：${msg || '没有变化'}`, { keepOpen: conflicts.length > 0 });
    ui.selected.clear();
    await reload();
    rerender();
    checkSigs(kind, ui.lists[kind]);
}

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp|gif|avif|bmp|json)$/, '');

/**
 * 把仓库条目导入酒馆
 * opts.decide: 遇到酒馆里同名条目时的处理，'replace' | 'new' | 'skip'；不传则询问
 */
export async function importItemsToTavern(items, { decide } = {}) {
    if (!bridge.host) { toast('未连接酒馆', 'err'); return; }
    const supported = items.filter((it) => TAVERN_IMPORTABLE.has(it.type) && it.files.length);
    const skipped = items.length - supported.length;
    if (!supported.length) { toast('所选内容不支持直接导入酒馆（支持：角色卡、世界书、预设、正则、快速回复、主题、背景）', 'err'); return; }

    // 找出酒馆里的同名条目
    const canReplace = bridge.has('replace');
    const plan = [];
    for (const kind of new Set(supported.map((it) => it.type))) {
        if (!ui.lists[kind]) { try { ui.lists[kind] = await bridge.call('list', { kind }); } catch { ui.lists[kind] = []; } }
        const its = supported.filter((it) => it.type === kind);
        const matches = its.map((it) => ({ it, existing: ui.lists[kind].find((r) => normName(r.name) === normName(it.name)) || null }));
        if (canReplace) await checkSigs(kind, matches.filter((m) => m.existing).map((m) => m.existing));
        plan.push(...matches);
    }
    // 内容已经一致的直接跳过
    const same = [];
    const todo = [];
    for (const m of plan) {
        const cur = m.it.files.find((f) => f.primary) || m.it.files[m.it.files.length - 1];
        const sig = m.existing ? ui.sigs.get(sigKey(m.it.type, m.existing.id)) : '';
        if (m.existing && sig && cur?.sig === sig) same.push(m); else todo.push(m);
    }
    const clashes = todo.filter((m) => m.existing);
    let action = decide;
    if (clashes.length && canReplace && !action) {
        const names = clashes.slice(0, 6).map((m) => `「${m.it.name}」`).join('、') + (clashes.length > 6 ? ` 等 ${clashes.length} 项` : '');
        action = await choiceDialog(
            h('div', { class: 'stack-s' },
                h('div', {}, `${names}在酒馆里已经有同名的了。`),
                clashes.some((m) => m.it.type === 'character') ? h('div', { class: 'muted small' }, '覆盖角色卡会保留它在酒馆里的聊天记录。') : null),
            [{ key: 'skip', label: '跳过' }, { key: 'new', label: '另存一份' }, { key: 'replace', label: '覆盖', cls: 'primary' }],
            { title: '酒馆里已有同名' });
        if (!action) return;
    }
    if (!todo.length) {
        toast(`${same.length} 项和酒馆里的内容完全一致，无需导入`, 'ok');
        return;
    }
    const run = todo.filter((m) => !(m.existing && action === 'skip'));
    if (!run.length) { toast('没有需要导入的内容'); return; }

    const prog = progressSheet(`导入到酒馆（${run.length}）`);
    let ok = 0;
    for (const [i, m] of run.entries()) {
        const it = m.it;
        prog.update(i, run.length, it.name);
        try {
            const f = it.files.find((x) => x.primary) || it.files[0];
            const data = await (await api.fetchFile(f.sha)).arrayBuffer();
            const extra = m.existing && canReplace ? (action === 'replace' ? { replace: m.existing.id } : action === 'new' ? { asNew: true } : {}) : {};
            const res = await bridge.call('import', { kind: it.type, filename: f.name, name: it.name, apiId: it.meta?.apiId || '', data, ...extra }, [data]);
            ok++;
            if (res?.message) prog.log(`${it.name}：${res.message}`, 'ok');
        } catch (e) {
            prog.log(`${it.name}：${e.message}`, 'err');
        }
    }
    const extraMsg = [same.length && `${same.length} 项内容一致已跳过`, skipped && `${skipped} 项不支持已跳过`, clashes.length && action === 'skip' && `${clashes.length} 项同名已跳过`].filter(Boolean).join('，');
    prog.done(`已导入 ${ok}/${run.length}${extraMsg ? `，${extraMsg}` : ''}`);
    for (const kind of new Set(run.map((m) => m.it.type))) delete ui.lists[kind];
    for (const m of run) if (m.existing) ui.sigs.delete(sigKey(m.it.type, m.existing.id));
    rerender();
}

function progressSheet(title) {
    const bar = h('i', { style: { width: '0%' } });
    const label = h('div', { class: 'progress-label' }, '准备中');
    const log = h('div', { class: 'progress-log' });
    const acts = h('div', { class: 'row-actions wrap' });
    const s = sheet({ title, body: h('div', { class: 'stack-s' }, h('div', { class: 'progress' }, bar), label, log, acts) });
    return {
        update(i, n, name) { bar.style.width = `${(i / n) * 100}%`; label.textContent = `${i + 1} / ${n} · ${name}`; },
        log(msg, kind = '') { log.append(h('div', { class: `log-line ${kind}` }, icon(kind === 'err' ? 'xCircle' : kind === 'ok' ? 'checkCircle' : 'info', { size: 14 }), h('span', {}, msg))); },
        actions(...nodes) { acts.append(...nodes); },
        close: () => s.close(),
        done(msg, { keepOpen = false } = {}) {
            bar.style.width = '100%';
            label.textContent = msg;
            toast(msg, 'ok');
            if (!log.childElementCount && !keepOpen) setTimeout(() => s.close(), 900);
        },
    };
}
