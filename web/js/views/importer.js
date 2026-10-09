// 添加资源：批量上传（文件 / 文件夹 / 压缩包）、链接导入、手动记录
// 遇到同名条目时可以选择：存为新版本 / 另存为新条目 / 跳过，支持一键应用到全部
import { h, clear, sheet, toast, icon, btn } from '../ui.js';
import { api } from '../api.js';
import { state, TYPE_META, typeMeta } from '../state.js';
import { openDetail } from './detail.js';
import { openDiff } from './diff.js';
import { filesFromDrop, filesFromInput, canPickFolder, topFolder } from '../files.js';
import { coverImg } from '../thumbs.js';

const concurrency = () => Math.min(6, Math.max(1, Number(state.prefs.uploadConc) || 3));
const PREF_KEY = 'tv_import_opts';
const MATCH_LABEL = { ask: '每次询问', version: '自动存为新版本', new: '另存为新条目', skip: '跳过' };

function loadPrefs() {
    try { return { match: 'ask', zipCollection: true, folderCollection: true, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { match: 'ask', zipCollection: true, folderCollection: true }; }
}
function savePrefs(p) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ match: p.match, zipCollection: p.zipCollection, folderCollection: p.folderCollection })); } catch { /* ignore */ }
}

const STATUS = {
    created: { text: '已收录', cls: 'ok', icon: 'check' },
    version: { text: '新版本', cls: 'ok', icon: 'layers' },
    duplicate: { text: '已存在', cls: '' },
    skipped: { text: '已跳过', cls: '' },
    conflict: { text: '同名条目', cls: 'warn' },
    error: { text: '失败', cls: 'danger' },
};

/** @param {(File | {file: File, path: string})[]} initialFiles */
export function openImporter(initialFiles = []) {
    let tab = 'file';
    const prefs = loadPrefs();
    const opts = { type: '', tags: [], collections: [] };
    const rows = [];            // 每一行一个结果（压缩包会展开成多行）
    const queue = [];           // 待上传任务
    let running = 0;
    let finishedToast = false;

    const s = sheet({ title: '添加藏品', body: h('div'), full: true });

    // ---------- 选项 ----------
    const typeSel = h('select', { class: 'select', onchange: () => { opts.type = typeSel.value; } },
        h('option', { value: '' }, '自动识别'), Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k }, v.label)));
    const tagInput = h('input', { class: 'input', placeholder: '逗号分隔，可选', onchange: () => { opts.tags = tagInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean); } });
    const colSel = h('select', { class: 'select', onchange: () => { opts.collections = colSel.value ? [colSel.value] : []; } },
        h('option', { value: '' }, '不加入'), state.collections.map((c) => h('option', { value: c.id }, c.name)));
    const matchSel = h('select', { class: 'select', onchange: () => { prefs.match = matchSel.value; savePrefs(prefs); optsBox.querySelector('.fold-count').textContent = `同名：${MATCH_LABEL[prefs.match]}`; } },
        Object.entries(MATCH_LABEL).map(([k, v]) => h('option', { value: k, selected: prefs.match === k }, v)));
    const check = (key, label) => {
        const input = h('input', { type: 'checkbox', checked: prefs[key], onchange: () => { prefs[key] = input.checked; savePrefs(prefs); } });
        return h('label', { class: 'check-line' }, input, h('span', {}, label));
    };
    const optsBox = h('details', { class: 'fold' },
        h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), icon('sliders', { size: 15 }), h('span', { class: 'fold-title' }, '导入选项'),
            h('span', { class: 'fold-count' }, `同名：${MATCH_LABEL[prefs.match]}`)),
        h('div', { class: 'fold-body' },
            h('div', { class: 'fields' },
                h('div', { class: 'field wide' }, h('label', {}, '遇到同名条目（可能是新版本）'), matchSel),
                h('div', { class: 'field' }, h('label', {}, '类型'), typeSel),
                h('div', { class: 'field' }, h('label', {}, '加入合集'), colSel),
                h('div', { class: 'field wide' }, h('label', {}, '统一添加标签'), tagInput)),
            h('div', { class: 'stack-s' },
                check('zipCollection', '压缩包：按包名自动建合集'),
                check('folderCollection', '文件夹：按文件夹名自动建合集'))));

    // ---------- 结果区 ----------
    const summaryEl = h('div', { class: 'import-summary', hidden: true });
    const bulkEl = h('div', { class: 'import-bulk', hidden: true });
    const listEl = h('div', { class: 'rows import-rows' });
    const resultBox = h('div', { class: 'results' }, summaryEl, bulkEl, listEl);

    const counts = () => {
        const c = { total: rows.length, pending: 0, created: 0, version: 0, duplicate: 0, skipped: 0, conflict: 0, error: 0 };
        for (const r of rows) {
            if (r.state === 'queued' || r.state === 'uploading') c.pending++;
            else c[r.status] = (c[r.status] || 0) + 1;
        }
        return c;
    };

    function drawSummary() {
        const c = counts();
        summaryEl.hidden = !rows.length;
        if (!rows.length) return;
        const done = c.total - c.pending;
        const parts = [
            c.created && `新增 ${c.created}`, c.version && `新版本 ${c.version}`, c.duplicate && `已存在 ${c.duplicate}`,
            c.skipped && `跳过 ${c.skipped}`, c.conflict && `待决定 ${c.conflict}`, c.error && `失败 ${c.error}`,
        ].filter(Boolean);
        clear(summaryEl,
            h('div', { class: 'import-summary-top' },
                h('b', {}, c.pending ? `正在导入 ${done} / ${c.total}` : `完成 ${c.total} 项`),
                h('span', { class: 'grow' }),
                c.error && !c.pending ? btn('重试失败项', { icon: 'refresh', cls: 'sm', onclick: retryFailed }) : null),
            h('div', { class: 'progress' }, h('i', { style: { width: `${c.total ? (done / c.total) * 100 : 0}%` } })),
            parts.length ? h('div', { class: 'muted small' }, parts.join(' · ')) : null);
        // 批量处理冲突
        bulkEl.hidden = !c.conflict;
        if (c.conflict) {
            clear(bulkEl,
                h('div', { class: 'import-bulk-text' }, icon('layers', { size: 16 }), h('span', {}, `${c.conflict} 项和已有条目同名，可能是新版本`)),
                h('div', { class: 'row-actions wrap' },
                    btn('全部存为新版本', { cls: 'sm primary', onclick: () => resolveAll('version') }),
                    btn('全部另存', { cls: 'sm', onclick: () => resolveAll('new') }),
                    btn('全部跳过', { cls: 'sm ghost', onclick: () => resolveAll('skip') })));
        }
        if (!c.pending && !finishedToast && c.total) {
            finishedToast = true;
            toast(parts.join('，') || '完成', c.error ? 'err' : 'ok');
        }
    }

    function rowEl(r) {
        const it = r.result?.item;
        const tm = typeMeta(it?.type || r.result?.detected?.type);
        const st = r.state === 'done' ? STATUS[r.status] : null;
        let sub = r.path && r.path !== r.label ? r.path : '';
        if (r.state === 'uploading') sub = r.progress != null && r.progress < 1 ? `上传中 ${Math.round(r.progress * 100)}%` : '处理中…';
        else if (r.state === 'queued') sub = '等待中';
        else if (r.status === 'error') sub = r.error;
        else if (r.status === 'conflict') sub = r.result.summary || '与已有条目同名';
        else if (r.status === 'duplicate') sub = r.result.current === false ? '和某个旧版本相同' : r.result.exact ? '完全相同的文件' : '内容相同（文件字节不同）';
        else if (r.status === 'version') sub = `已作为「${it.name}」的新版本`;
        else if (it) sub = `识别为 ${tm.label}${it.author ? ` · ${it.author}` : ''}`;

        let right;
        if (r.state === 'uploading' || r.state === 'queued') right = h('span', { class: 'spinner' });
        else if (r.status === 'conflict') {
            const cand = r.result.candidates[0];
            right = h('div', { class: 'row-actions wrap conflict-acts' },
                btn('对比', { icon: 'eye', cls: 'sm ghost', onclick: (e) => { e.stopPropagation(); compare(r); } }),
                btn('存为新版本', { cls: 'sm primary', onclick: (e) => { e.stopPropagation(); resolveOne(r, 'version'); } }),
                btn('另存', { cls: 'sm', onclick: (e) => { e.stopPropagation(); resolveOne(r, 'new'); } }),
                btn('跳过', { cls: 'sm ghost', onclick: (e) => { e.stopPropagation(); resolveOne(r, 'skip'); } }));
            sub = `${sub} · 已有：${cand.name}${cand.version ? ` v${cand.version}` : ''}`;
        } else if (r.status === 'error' && r.retry) {
            right = h('div', { class: 'row-actions' }, h('span', { class: 'chip-s warn' }, '失败'), btn('', { icon: 'refresh', cls: 'sm ghost', title: '重试', onclick: (e) => { e.stopPropagation(); r.retry(); } }));
        } else if (r.status === 'duplicate') {
            right = h('div', { class: 'row-actions' }, h('span', { class: 'chip-s' }, '已存在'),
                btn('仍保存', { cls: 'sm ghost', onclick: (e) => { e.stopPropagation(); resolveOne(r, 'new'); } }));
        } else if (st) right = h('span', { class: `chip-s ${st.cls}` }, st.icon ? icon(st.icon, { size: 11, stroke: 3 }) : null, st.text);

        const openable = it && state.byId.has(it.id) && ['created', 'version', 'duplicate'].includes(r.status);
        return h('div', { class: `row-item import-row ${r.status === 'conflict' ? 'is-conflict' : ''}`, style: { '--tc': tm.color }, onclick: () => openable && openDetail(it.id) },
            h('div', { class: 'row-thumb' }, it?.cover && r.status !== 'conflict' ? coverImg(it) : icon(r.isZip && !it ? 'archive' : tm.icon, { size: 20 })),
            h('div', { class: 'row-main' },
                h('div', { class: 'row-title' }, h('span', {}, r.status === 'conflict' ? r.result.detected.name : it?.name || r.label)),
                h('div', { class: 'row-sub' }, h('span', {}, sub))),
            right);
    }

    function draw(r) {
        const el = rowEl(r);
        if (r.el?.parentNode) r.el.replaceWith(el); else listEl.append(el);
        r.el = el;
        drawSummary();
    }

    function setResult(r, res) {
        r.result = res;
        r.status = res.status || (res.duplicate ? 'duplicate' : 'created');
        r.state = 'done';
        draw(r);
        // 设置里选了同名默认处理方式，就不再逐个询问
        if (r.status === 'conflict' && ['version', 'new', 'skip'].includes(state.prefs.conflict)) resolveOne(r, state.prefs.conflict);
    }

    // ---------- 上传 ----------
    function pump() {
        while (running < concurrency() && queue.length) {
            const task = queue.shift();
            running++;
            task().finally(() => { running--; pump(); });
        }
    }

    function enqueue(r, run) {
        r.state = 'queued';
        r.retry = () => { finishedToast = false; enqueue(r, run); pump(); };
        draw(r);
        queue.push(async () => {
            r.state = 'uploading';
            r.progress = 0;
            draw(r);
            try {
                const res = await run((p) => { r.progress = p; if (r.el) { const sub = r.el.querySelector('.row-sub span'); if (sub) sub.textContent = p < 1 ? `上传中 ${Math.round(p * 100)}%` : '处理中…'; } });
                if (res?.batch) expandZip(r, res);
                else setResult(r, res);
            } catch (e) {
                r.state = 'done';
                r.status = 'error';
                r.error = e.message;
                draw(r);
            }
        });
    }

    /** 压缩包结果：原行变成「压缩包」标题，下面展开每个文件 */
    function expandZip(r, res) {
        r.state = 'done';
        r.status = 'zip';
        const n = res.results.length;
        const el = h('div', { class: 'import-group' }, icon('archive', { size: 15 }),
            h('span', {}, `${r.label} · 解压出 ${n} 个文件${res.collection ? ` · 合集「${res.collection.name}」` : ''}`));
        r.el.replaceWith(el);
        r.el = el;
        rows.splice(rows.indexOf(r), 1);
        let anchor = el;
        for (const x of res.results) {
            const child = { label: x.filename || x.entry, path: x.entry, isZip: false, opts: { ...r.opts, zipCollection: false, collectionName: res.collection?.name || r.opts.collectionName } };
            rows.push(child);
            if (x.status === 'error') { child.state = 'done'; child.status = 'error'; child.error = x.error; } else { child.state = 'done'; child.result = x; child.status = x.status; }
            child.el = rowEl(child);
            anchor.after(child.el);
            anchor = child.el;
            if (child.status === 'conflict' && ['version', 'new', 'skip'].includes(state.prefs.conflict)) resolveOne(child, state.prefs.conflict);
        }
        if (!n) el.append(h('span', { class: 'muted' }, '（没有可导入的文件）'));
        drawSummary();
    }

    function baseOpts() {
        return { ...opts, match: prefs.match };
    }

    function addFiles(list) {
        finishedToast = false;
        for (const x of list) {
            const file = x.file || x;
            const path = x.path || file.name;
            const isZip = /\.zip$/i.test(file.name);
            const folder = topFolder(path);
            const o = { ...baseOpts(), filename: file.name, zipCollection: isZip && prefs.zipCollection, collectionName: folder && prefs.folderCollection ? folder : '' };
            const r = { label: file.name, path: folder ? path : '', isZip, opts: o, size: file.size };
            rows.push(r);
            enqueue(r, (onProgress) => api.upload(file, { ...o, onProgress: file.size > 512 * 1024 ? onProgress : null }));
        }
        pump();
    }

    function addUrls(urls) {
        finishedToast = false;
        for (const url of urls) {
            const r = { label: url, isZip: /\.zip(\?|$)/i.test(url), opts: baseOpts() };
            rows.push(r);
            enqueue(r, () => api.post('/api/import-url', { url, ...r.opts, zipCollection: prefs.zipCollection }));
        }
        pump();
    }

    function retryFailed() {
        for (const r of rows.filter((x) => x.status === 'error' && x.retry)) r.retry();
    }

    // ---------- 冲突处理 ----------
    async function resolveOne(r, action) {
        const pending = r.result;
        const o = r.opts || baseOpts();
        r.state = 'uploading';
        r.progress = 1;
        draw(r);
        try {
            const res = await api.resolve(pending, action, { tags: o.tags, collections: o.collections, collectionName: o.collectionName, type: o.type });
            if (action === 'skip') setResult(r, { ...pending, status: 'skipped', item: pending.candidates?.[0] || pending.item });
            else setResult(r, res);
        } catch (e) {
            r.state = 'done';
            r.status = 'error';
            r.error = e.message;
            r.retry = null;
            draw(r);
        }
    }

    async function resolveAll(action) {
        const list = rows.filter((r) => r.status === 'conflict');
        const n = concurrency();
        for (let i = 0; i < list.length; i += n) await Promise.all(list.slice(i, i + n).map((r) => resolveOne(r, action)));
        toast(`已处理 ${list.length} 项`, 'ok');
    }

    function compare(r) {
        const cand = r.result.candidates[0];
        const prev = cand.files.find((f) => f.primary) || cand.files[cand.files.length - 1];
        openDiff({ sha: prev.sha, name: prev.name, label: `已有 · ${prev.name}` }, { sha: r.result.sha, name: r.result.filename, label: `导入 · ${r.result.filename}` }, {
            title: `对比：${cand.name}`,
            foot: (close) => [
                btn('跳过', { cls: 'ghost', onclick: () => { close(); resolveOne(r, 'skip'); } }),
                btn('另存为新条目', { onclick: () => { close(); resolveOne(r, 'new'); } }),
                btn('存为新版本', { cls: 'primary', onclick: () => { close(); resolveOne(r, 'version'); } }),
            ],
        });
    }

    // ---------- 页签 ----------
    function fileTab() {
        const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { addFiles(filesFromInput(input)); input.value = ''; } });
        const dirInput = h('input', { type: 'file', multiple: true, hidden: true, webkitdirectory: true, onchange: () => { addFiles(filesFromInput(dirInput)); dirInput.value = ''; } });
        const drop = h('div', {
            class: 'drop', onclick: () => input.click(),
            ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
            ondragleave: () => drop.classList.remove('over'),
            ondrop: async (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(await filesFromDrop(e.dataTransfer)); },
        },
        h('div', { class: 'drop-ic' }, icon('upload', { size: 26, stroke: 1.5 })),
        h('div', { class: 'drop-title' }, canPickFolder ? '选择文件，或把文件 / 文件夹拖到这里' : '选择文件（可多选）'),
        h('div', { class: 'drop-text' }, '角色卡 PNG / JSON / CHARX、世界书、预设、正则、快速回复、主题、脚本、聊天记录、图片。ZIP 压缩包会自动解压，逐个识别。'),
        input, dirInput);
        return h('div', { class: 'stack' },
            drop,
            h('div', { class: 'row-actions wrap' },
                btn('选择文件', { icon: 'file', cls: 'sm', onclick: () => input.click() }),
                canPickFolder ? btn('选择文件夹', { icon: 'folder', cls: 'sm', onclick: () => dirInput.click() }) : null),
            optsBox);
    }

    function urlTab() {
        const ta = h('textarea', { class: 'textarea', placeholder: '每行一个文件直链\nhttps://example.com/card.png\nhttps://example.com/pack.zip' });
        return h('div', { class: 'stack' },
            ta,
            h('div', { class: 'muted small' }, '由服务器下载链接里的文件，需要是直链（GitHub raw、图床、网盘直链等）。ZIP 同样会自动解压。'),
            btn('下载并导入', { icon: 'download', cls: 'primary block', onclick: () => {
                const urls = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
                if (!urls.length) return;
                ta.value = '';
                addUrls(urls);
            } }),
            optsBox);
    }

    function manualTab() {
        const name = h('input', { class: 'input', placeholder: '名称' });
        const type = h('select', { class: 'select' }, Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k, selected: k === 'prompt' }, v.label)));
        const source = h('input', { class: 'input', type: 'url', placeholder: 'https://（可选）' });
        const desc = h('textarea', { class: 'textarea', placeholder: '内容、灵感、提示词片段……' });
        return h('div', { class: 'stack' },
            h('div', { class: 'muted small' }, '不上传文件，只记录一条收藏，比如别处看到的卡的链接、灵感或提示词片段。之后可以再补充文件。'),
            h('div', { class: 'fields' },
                h('div', { class: 'field' }, h('label', {}, '名称'), name),
                h('div', { class: 'field' }, h('label', {}, '类型'), type),
                h('div', { class: 'field wide' }, h('label', {}, '来源链接'), source),
                h('div', { class: 'field wide' }, h('label', {}, '内容'), desc)),
            btn('创建', { icon: 'check', cls: 'primary block', onclick: async () => {
                if (!name.value.trim()) { toast('请填写名称', 'err'); return; }
                const it = await api.post('/api/items/manual', { name: name.value.trim(), type: type.value, source: source.value, notes: desc.value, tags: opts.tags, collections: opts.collections });
                toast('已创建', 'ok');
                s.close();
                setTimeout(() => openDetail(it.id), 300);
            } }));
    }

    function render() {
        clear(s.body,
            h('div', { class: 'tabs' }, [['file', '上传文件', 'upload'], ['url', '链接导入', 'link'], ['manual', '手动记录', 'pencil']].map(([k, l, ic]) =>
                h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; render(); } }, icon(ic, { size: 14 }), l))),
            tab === 'file' ? fileTab() : tab === 'url' ? urlTab() : manualTab(),
            resultBox);
    }
    render();
    if (initialFiles.length) addFiles(initialFiles);
}

