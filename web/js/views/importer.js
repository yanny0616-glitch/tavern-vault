// 添加资源：文件上传 / 链接导入 / 手动新建
import { h, clear, sheet, toast } from '../ui.js';
import { api } from '../api.js';
import { state, TYPE_META, typeMeta } from '../state.js';
import { openDetail } from './detail.js';

export function openImporter(initialFiles = []) {
    let tab = 'file';
    const opts = { type: '', tags: [], collections: [] };
    const results = [];
    const s = sheet({ title: '添加资源', body: h('div') });

    const typeSel = h('select', { class: 'select', onchange: () => { opts.type = typeSel.value; } },
        h('option', { value: '' }, '🪄 自动识别类型'),
        Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k }, `${v.icon} ${v.label}`)));
    const tagInput = h('input', { class: 'input', placeholder: '统一添加标签（逗号分隔，可选）', onchange: () => { opts.tags = tagInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean); } });
    const colSel = h('select', { class: 'select', onchange: () => { opts.collections = colSel.value ? [colSel.value] : []; } },
        h('option', { value: '' }, '不加入合集'), state.collections.map((c) => h('option', { value: c.id }, `${c.icon} ${c.name}`)));
    const optsBox = h('details', { class: 'fold', style: { marginTop: '12px' } }, h('summary', {}, '⚙️ 导入选项'),
        h('div', { class: 'fold-body' }, h('div', { class: 'kv' }, h('label', {}, '类型'), typeSel, h('label', {}, '标签'), tagInput, h('label', {}, '合集'), colSel)));

    const resultBox = h('div', { style: { marginTop: '14px' } });

    function drawResults() {
        clear(resultBox, results.length ? h('div', { class: 'list' }, results.map((r) => {
            const it = r.item;
            const tm = it ? typeMeta(it.type) : null;
            let status;
            if (r.state === 'uploading') status = h('span', { class: 'spinner' });
            else if (r.state === 'error') status = h('span', { class: 'badge warn', title: r.error }, '失败');
            else if (r.duplicate) status = h('span', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'badge warn' }, '已存在'),
                h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); uploadOne(r, 'new'); } }, '仍然保存'));
            else status = h('span', { class: 'badge ok' }, '已保存');
            return h('div', { class: 'list-row', onclick: () => it && state.byId.has(it.id) && openDetail(it.id) },
                h('div', { class: 'thumb' }, it?.cover ? h('img', { src: api.fileUrl(it.cover), alt: '' }) : tm?.icon || '📄'),
                h('div', { class: 'grow' },
                    h('div', { class: 'title ellipsis' }, it?.name || r.label),
                    h('div', { class: 'meta ellipsis' }, tm ? `识别为 ${tm.icon} ${tm.label}` : r.state === 'error' ? r.error : r.label)),
                status);
        })) : null);
    }

    async function uploadOne(r, mode = 'auto') {
        r.state = 'uploading';
        drawResults();
        try {
            const res = r.url
                ? await api.post('/api/import-url', { url: r.url, ...opts, mode })
                : await api.upload(r.file, { ...opts, mode });
            Object.assign(r, res, { state: 'done' });
        } catch (e) {
            r.state = 'error';
            r.error = e.message;
        }
        drawResults();
    }

    async function addFiles(files) {
        const batch = [...files].map((file) => ({ file, label: file.name, state: 'queued' }));
        results.unshift(...batch);
        drawResults();
        for (const r of batch) await uploadOne(r);
        const ok = batch.filter((r) => r.state === 'done' && !r.duplicate).length;
        const dup = batch.filter((r) => r.duplicate).length;
        toast(`导入完成：新增 ${ok} 项${dup ? `，${dup} 项已存在` : ''}`, 'ok');
    }

    function fileTab() {
        const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { addFiles(input.files); input.value = ''; } });
        const drop = h('div', {
            class: 'drop', onclick: () => input.click(),
            ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
            ondragleave: () => drop.classList.remove('over'),
            ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); },
        },
        h('div', { class: 'big' }, '📥'),
        h('div', { style: { fontWeight: 600, marginTop: '6px' } }, '点击选择文件，或拖拽到这里'),
        h('div', { class: 'muted small', style: { marginTop: '4px' } }, '支持角色卡 PNG/JSON、世界书、预设、正则、快速回复、主题、酒馆助手脚本、JS/CSS、聊天记录 JSONL、图片、ZIP 等，可多选'),
        input);
        return h('div', {}, drop, optsBox);
    }

    function urlTab() {
        const ta = h('textarea', { class: 'textarea', placeholder: '粘贴文件直链，每行一个\n例如 https://example.com/card.png' });
        return h('div', {},
            ta,
            h('div', { class: 'muted small', style: { margin: '6px 0 10px' } }, '由服务器下载链接中的文件（需要是直链，例如 GitHub raw、图床、网盘直链）。'),
            h('button', { class: 'btn primary', style: { width: '100%' }, onclick: async () => {
                const urls = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
                if (!urls.length) return;
                const batch = urls.map((url) => ({ url, label: url, state: 'queued' }));
                results.unshift(...batch);
                ta.value = '';
                drawResults();
                for (const r of batch) await uploadOne(r);
                toast('链接导入完成', 'ok');
            } }, '⬇️ 下载并导入'),
            optsBox);
    }

    function manualTab() {
        const name = h('input', { class: 'input', placeholder: '名称' });
        const type = h('select', { class: 'select' }, Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k, selected: k === 'prompt' }, `${v.icon} ${v.label}`)));
        const source = h('input', { class: 'input', type: 'url', placeholder: 'https://（可选）' });
        const desc = h('textarea', { class: 'textarea', placeholder: '简介 / 内容 / 笔记' });
        return h('div', {},
            h('div', { class: 'muted small', style: { marginBottom: '10px' } }, '不上传文件，只记录一条收藏（例如别处看到的卡的链接、灵感、提示词片段），之后也可以再补充文件。'),
            h('div', { class: 'kv' }, h('label', {}, '名称'), name, h('label', {}, '类型'), type, h('label', {}, '来源链接'), source, h('label', {}, '内容'), desc),
            h('button', { class: 'btn primary', style: { width: '100%', marginTop: '12px' }, onclick: async () => {
                if (!name.value.trim()) { toast('请填写名称', 'err'); return; }
                const it = await api.post('/api/items/manual', { name: name.value.trim(), type: type.value, source: source.value, notes: desc.value, tags: opts.tags, collections: opts.collections });
                toast('已创建', 'ok');
                s.close();
                setTimeout(() => openDetail(it.id), 300);
            } }, '创建'));
    }

    function render() {
        clear(s.body,
            h('div', { class: 'tabs', style: { marginTop: 0 } },
                [['file', '📁 上传文件'], ['url', '🔗 链接导入'], ['manual', '✍️ 手动记录']].map(([k, l]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; render(); } }, l))),
            tab === 'file' ? fileTab() : tab === 'url' ? urlTab() : manualTab(),
            resultBox);
        drawResults();
    }
    render();
    if (initialFiles.length) addFiles(initialFiles);
}
