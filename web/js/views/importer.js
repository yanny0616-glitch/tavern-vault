// 添加资源：文件上传 / 链接导入 / 手动记录
import { h, clear, sheet, toast, icon, btn } from '../ui.js';
import { api } from '../api.js';
import { state, TYPE_META, typeMeta } from '../state.js';
import { openDetail } from './detail.js';

export function openImporter(initialFiles = []) {
    let tab = 'file';
    const opts = { type: '', tags: [], collections: [] };
    const results = [];
    const s = sheet({ title: '添加藏品', body: h('div') });

    const typeSel = h('select', { class: 'select', onchange: () => { opts.type = typeSel.value; } },
        h('option', { value: '' }, '自动识别'), Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k }, v.label)));
    const tagInput = h('input', { class: 'input', placeholder: '逗号分隔，可选', onchange: () => { opts.tags = tagInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean); } });
    const colSel = h('select', { class: 'select', onchange: () => { opts.collections = colSel.value ? [colSel.value] : []; } },
        h('option', { value: '' }, '不加入'), state.collections.map((c) => h('option', { value: c.id }, c.name)));
    const optsBox = h('details', { class: 'fold' },
        h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), icon('sliders', { size: 15 }), h('span', { class: 'fold-title' }, '导入选项')),
        h('div', { class: 'fold-body' }, h('div', { class: 'fields' },
            h('div', { class: 'field' }, h('label', {}, '类型'), typeSel),
            h('div', { class: 'field' }, h('label', {}, '合集'), colSel),
            h('div', { class: 'field wide' }, h('label', {}, '统一添加标签'), tagInput))));
    const resultBox = h('div', { class: 'results' });

    function drawResults() {
        if (!results.length) { clear(resultBox); return; }
        clear(resultBox, h('div', { class: 'sub-label' }, `本次导入 · ${results.length}`), h('div', { class: 'rows' }, results.map((r) => {
            const it = r.item;
            const tm = it ? typeMeta(it.type) : null;
            let status;
            if (r.state === 'uploading' || r.state === 'queued') status = h('span', { class: 'spinner' });
            else if (r.state === 'error') status = h('span', { class: 'chip-s warn', title: r.error }, '失败');
            else if (r.duplicate) status = h('span', { class: 'row-actions' }, h('span', { class: 'chip-s warn' }, '已存在'), btn('仍保存', { cls: 'sm', onclick: (e) => { e.stopPropagation(); uploadOne(r, 'new'); } }));
            else status = h('span', { class: 'chip-s ok' }, icon('check', { size: 11, stroke: 3 }), '已收录');
            return h('div', { class: 'row-item', style: { '--tc': tm?.color || '' }, onclick: () => it && state.byId.has(it.id) && openDetail(it.id) },
                h('div', { class: 'row-thumb' }, it?.cover ? h('img', { src: api.fileUrl(it.cover), alt: '' }) : icon(tm?.icon || 'file', { size: 20 })),
                h('div', { class: 'row-main' },
                    h('div', { class: 'row-title' }, h('span', {}, it?.name || r.label)),
                    h('div', { class: 'row-sub' }, h('span', {}, tm ? `识别为 ${tm.label}` : r.state === 'error' ? r.error : r.label))),
                status);
        })));
    }

    async function uploadOne(r, mode = 'auto') {
        r.state = 'uploading';
        drawResults();
        try {
            const res = r.url ? await api.post('/api/import-url', { url: r.url, ...opts, mode }) : await api.upload(r.file, { ...opts, mode });
            Object.assign(r, res, { state: 'done' });
        } catch (e) {
            r.state = 'error';
            r.error = e.message;
        }
        drawResults();
    }

    async function runBatch(batch) {
        results.unshift(...batch);
        drawResults();
        for (const r of batch) await uploadOne(r);
        const ok = batch.filter((r) => r.state === 'done' && !r.duplicate).length;
        const dup = batch.filter((r) => r.duplicate).length;
        toast(`新增 ${ok} 项${dup ? `，${dup} 项已存在` : ''}`, 'ok');
    }

    function fileTab() {
        const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { runBatch([...input.files].map((file) => ({ file, label: file.name, state: 'queued' }))); input.value = ''; } });
        const drop = h('div', {
            class: 'drop', onclick: () => input.click(),
            ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
            ondragleave: () => drop.classList.remove('over'),
            ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); runBatch([...e.dataTransfer.files].map((file) => ({ file, label: file.name, state: 'queued' }))); },
        },
        h('div', { class: 'drop-ic' }, icon('upload', { size: 26, stroke: 1.5 })),
        h('div', { class: 'drop-title' }, '选择文件，或拖到这里'),
        h('div', { class: 'drop-text' }, '角色卡 PNG / JSON、世界书、预设、正则、快速回复、主题、酒馆助手脚本、JS / CSS、聊天记录、图片、ZIP，可多选'),
        input);
        return h('div', { class: 'stack' }, drop, optsBox);
    }

    function urlTab() {
        const ta = h('textarea', { class: 'textarea', placeholder: '每行一个文件直链\nhttps://example.com/card.png' });
        return h('div', { class: 'stack' },
            ta,
            h('div', { class: 'muted small' }, '由服务器下载链接里的文件，需要是直链（GitHub raw、图床、网盘直链等）。'),
            btn('下载并导入', { icon: 'download', cls: 'primary block', onclick: () => {
                const urls = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
                if (!urls.length) return;
                ta.value = '';
                runBatch(urls.map((url) => ({ url, label: url, state: 'queued' })));
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
        drawResults();
    }
    render();
    if (initialFiles.length) runBatch(initialFiles.map((file) => ({ file, label: file.name, state: 'queued' })));
}
