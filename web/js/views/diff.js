// 版本对比：数值变化、长文本逐行差异、条目增删改
import { h, clear, sheet, icon } from '../ui.js';
import { api } from '../api.js';
import { lineDiff } from '../textdiff.js';
import { aiReady, explainPanel } from './ai.js';

export { lineDiff };

export function diffView(a, b) {
    const ops = lineDiff(a || '', b || '');
    if (!ops) {
        return h('div', { class: 'diff-split' },
            h('div', {}, h('div', { class: 'sub-label' }, '旧版本'), h('pre', { class: 'code' }, a)),
            h('div', {}, h('div', { class: 'sub-label' }, '新版本'), h('pre', { class: 'code' }, b)));
    }
    const rows = [];
    const CONTEXT = 2;
    for (let k = 0; k < ops.length; k++) {
        const [t, s] = ops[k];
        if (t !== 'same') { rows.push(h('div', { class: `dl ${t}` }, h('i', {}, t === 'add' ? '+' : '−'), h('span', {}, s || ' '))); continue; }
        // 折叠较长的未变化片段
        let end = k;
        while (end + 1 < ops.length && ops[end + 1][0] === 'same') end++;
        const run = end - k + 1;
        const head = k === 0 ? 0 : CONTEXT;
        const tail = end === ops.length - 1 ? 0 : CONTEXT;
        if (run > head + tail + 2) {
            for (let x = k; x < k + head; x++) rows.push(h('div', { class: 'dl same' }, h('i'), h('span', {}, ops[x][1] || ' ')));
            rows.push(h('div', { class: 'dl skip' }, h('i'), h('span', {}, `… ${run - head - tail} 段未变化 …`)));
            for (let x = end - tail + 1; x <= end; x++) rows.push(h('div', { class: 'dl same' }, h('i'), h('span', {}, ops[x][1] || ' ')));
        } else {
            for (let x = k; x <= end; x++) rows.push(h('div', { class: 'dl same' }, h('i'), h('span', {}, ops[x][1] || ' ')));
        }
        k = end;
    }
    return h('div', { class: 'diff-lines' }, rows);
}

const fold = (title, count, body, { open = false, cls = '' } = {}) => h('details', { class: `fold ${cls}`, open },
    h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), h('span', { class: 'fold-title' }, title), count != null ? h('span', { class: 'fold-count' }, count) : null),
    h('div', { class: 'fold-body' }, body));

/** 渲染服务端返回的对比结果 */
export function renderDiff(d, { aLabel = '旧版本', bLabel = '新版本' } = {}) {
    const changedFacts = d.facts.filter((f) => f.changed);
    const sameFacts = d.facts.filter((f) => !f.changed);
    const parts = [];
    parts.push(h('div', { class: 'diff-head' },
        h('span', { class: 'diff-side a' }, aLabel), icon('chevronRight', { size: 14 }), h('span', { class: 'diff-side b' }, bLabel)));
    if (d.sameContent) parts.push(h('div', { class: 'note ok' }, icon('checkCircle', { size: 15 }), h('span', {}, d.sameBytes ? '两个文件完全相同。' : '内容相同，只是文件字节不同（比如被酒馆重新导出过）。')));
    else if (!d.changes) parts.push(h('div', { class: 'note' }, icon('info', { size: 15 }), h('span', {}, '没有识别到具体字段差异，文件内容不同。')));
    if (d.typeA && d.typeA !== d.type) parts.push(h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, '两个文件被识别成不同的类型。')));
    if (d.image) parts.push(h('div', { class: `note ${d.image.changed ? 'warn' : ''}` }, icon('image', { size: 15 }), h('span', {}, d.image.changed ? `图片数据有变化${d.image.a && d.image.b ? `（${d.image.a} → ${d.image.b}）` : ''}` : '图片未变化')));

    const factRow = (f) => h('div', { class: `diff-fact ${f.changed ? 'changed' : ''}` }, h('span', { class: 'df-label' }, f.label), h('span', { class: 'df-a' }, f.a), icon('chevronRight', { size: 12 }), h('span', { class: 'df-b' }, f.b));
    if (changedFacts.length) parts.push(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('sliders', { size: 16 }), h('h3', {}, '数值与信息')), h('div', { class: 'diff-facts' }, changedFacts.map(factRow))));

    if (d.texts.length) {
        parts.push(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('fileText', { size: 16 }), h('h3', {}, `文本改动 · ${d.texts.length}`)),
            h('div', { class: 'stack-s' }, d.texts.map((t, i) => fold(t.label, `${t.aLen} → ${t.bLen} 字`, diffView(t.a, t.b), { open: i === 0 && d.texts.length <= 3 })))));
    }
    for (const l of d.lists) {
        const items = [
            ...l.added.map((x) => fold(x.title, '新增', h('pre', { class: 'code' }, x.b), { cls: 'diff-add' })),
            ...l.removed.map((x) => fold(x.title, '删除', h('pre', { class: 'code' }, x.a), { cls: 'diff-del' })),
            ...l.changed.map((x) => fold(x.title, '修改', diffView(x.a, x.b), { cls: 'diff-mod' })),
        ];
        const count = [l.added.length && `+${l.added.length}`, l.removed.length && `-${l.removed.length}`, l.changed.length && `改 ${l.changed.length}`, l.same && `${l.same} 项未变`].filter(Boolean).join(' · ');
        parts.push(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon('list', { size: 16 }), h('h3', {}, l.label), h('span', { class: 'grow' }), h('span', { class: 'fold-count' }, count)), h('div', { class: 'stack-s' }, items)));
    }
    if (d.unchangedTexts?.length || sameFacts.length) {
        parts.push(h('div', { class: 'muted small diff-same' }, `未变化：${[...sameFacts.map((f) => f.label), ...(d.unchangedTexts || [])].join('、')}`));
    }
    return h('div', { class: 'stack diff' }, parts);
}

/**
 * 打开对比弹层
 * @param {{sha, name, label}} a 旧
 * @param {{sha, name, label}} b 新
 * @param {{title?: string, foot?: (close) => Node[]}} opts
 */
export function openDiff(a, b, { title = '版本对比', foot } = {}) {
    const body = h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, '正在对比'));
    const s = sheet({ title, body, full: true });
    if (foot) {
        const f = h('div', { class: 'sheet-foot' }, foot(s.close));
        s.el.append(f);
    }
    api.diff({ sha: a.sha, name: a.name }, { sha: b.sha, name: b.name })
        .then((d) => {
            const view = renderDiff(d, { aLabel: a.label || '旧版本', bLabel: b.label || '新版本' });
            if (aiReady() && !d.sameContent && d.changes) view.firstChild.after(explainPanel({ ...a, label: a.label || '旧版本' }, { ...b, label: b.label || '新版本' }));
            clear(s.body, view);
        })
        .catch((e) => clear(s.body, h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, `对比失败：${e.message}`))));
    return s;
}
