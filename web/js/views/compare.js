// 并排对比：2～3 个条目一列一个，逐项摆在一起看；可以只看不一样的地方
import { h, clear, sheet, icon, btn, switchEl } from '../ui.js';
import { api } from '../api.js';
import { state, typeMeta, savePrefs } from '../state.js';
import { entriesOf, entryKeys } from '../cardfmt.js';
import { coverImg } from '../thumbs.js';
import { openDiff } from './diff.js';

const str = (v) => (v == null ? '' : String(v)).trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const bookTitles = (book) => entriesOf(book).map((e) => str(e?.comment || e?.name) || entryKeys(e)[0] || '(未命名)');

/** 一个条目 → [[行名, 文字, 备注]]。文字用来比较和显示，备注（字数、条数）只显示 */
function rowsOf(it, c) {
    const out = [
        ['作者', str(it.author)],
        ['版本', str(it.version)],
        ['标签', [...it.tags].sort((a, b) => a.localeCompare(b, 'zh')).join('、')],
    ];
    const text = (label, v) => { const t = str(v); out.push([label, t, t ? `${t.length} 字` : '']); };
    const list = (label, items, unit = '条') => out.push([label, items.join('\n'), items.length ? `${items.length} ${unit}` : '']);
    if (c?.kind === 'card') {
        const d = c.data || {};
        text('描述', d.description); text('性格', d.personality); text('场景', d.scenario);
        text('主开场白', d.first_mes);
        const alt = arr(d.alternate_greetings).map(str).filter(Boolean);
        out.push(['备选开场白', alt.map((g, i) => `【${i + 1}】${g}`).join('\n\n'), alt.length ? `${alt.length} 条` : '']);
        text('对话示例', d.mes_example); text('系统提示词', d.system_prompt); text('后置指令', d.post_history_instructions);
        text('作者注释', d.creator_notes);
        list('内嵌世界书', bookTitles(d.character_book));
        list('内嵌正则', arr(d.extensions?.regex_scripts).map((r) => str(r?.scriptName) || '(未命名)'));
    } else if (c?.kind === 'json' && it.type === 'worldbook') {
        list('条目', bookTitles(c.data));
    } else if (c?.kind === 'json' && it.type === 'preset' && Array.isArray(c.data?.prompts)) {
        list('提示词', c.data.prompts.map((p) => str(p?.name) || '(未命名)'));
    } else if (c?.kind === 'json' && it.type === 'regex') {
        list('脚本', (Array.isArray(c.data) ? c.data : [c.data]).map((r) => str(r?.scriptName) || '(未命名)'));
    } else if (c?.kind === 'text') {
        text('内容', c.text);
    }
    out.push(['简介', str(it.description)], ['笔记', str(it.notes)]);
    return out;
}

/** @param items 2～3 个条目 */
export function openCompare(items) {
    const cols = items.slice(0, 3);
    const body = h('div', { class: 'cmp' }, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, '正在读取')));
    let onlyDiff = state.prefs.cmpOnlyDiff === true;
    let data = null;
    const pf = (it) => it.files.find((f) => f.primary) || it.files[0];
    const toggle = h('label', { class: 'check-line cmp-toggle' }, switchEl(onlyDiff, (v) => { onlyDiff = v; state.prefs.cmpOnlyDiff = v; savePrefs(); draw(); }), h('span', {}, '只看不一样的'));
    const s = sheet({ title: `并排对比 ${cols.length} 项`, body, full: true, headExtra: toggle,
        foot: cols.length === 2 && cols.every(pf) ? [h('span', { class: 'grow muted small' }, '想看具体改了哪几行：'),
            btn('逐行对比', { icon: 'layers', onclick: () => openDiff({ sha: pf(cols[0]).sha, name: pf(cols[0]).name, label: cols[0].name }, { sha: pf(cols[1]).sha, name: pf(cols[1]).name, label: cols[1].name }, { title: '逐行对比' }) })] : null });
    s.el.classList.add('cmp-sheet');

    function draw() {
        if (!data) return;
        // 行名取并集，保持第一次出现的顺序
        const labels = [];
        for (const rows of data) for (const [l] of rows) if (!labels.includes(l)) labels.push(l);
        const cell = (rows, l) => rows.find((r) => r[0] === l) || [l, '', ''];
        const lines = labels.map((l) => { const cells = data.map((rows) => cell(rows, l)); return { l, cells, same: cells.every((x) => x[1] === cells[0][1]), empty: cells.every((x) => !x[1]) }; })
            .filter((x) => !x.empty);
        const shown = lines.filter((x) => !onlyDiff || !x.same);
        const diffN = lines.filter((x) => !x.same).length;
        clear(body,
            h('div', { class: 'cmp-grid', style: { '--n': cols.length } },
                h('div', { class: 'cmp-row cmp-head' }, h('div', { class: 'cmp-label' }, `${diffN} 处不同`),
                    cols.map((it) => h('div', { class: 'cmp-cell' },
                        h('div', { class: 'cmp-cover', style: { '--tc': typeMeta(it.type).color } }, it.cover ? coverImg(it) : icon(typeMeta(it.type).icon, { size: 20 })),
                        h('div', { class: 'cmp-name' }, h('b', {}, it.name), h('span', { class: 'muted small' }, typeMeta(it.type).label))))),
                shown.map(({ l, cells, same }) => h('div', { class: `cmp-row ${same ? 'same' : 'diff'}` },
                    h('div', { class: 'cmp-label' }, l, same ? h('span', { class: 'chip-s' }, '相同') : null),
                    cells.map(([, v, note]) => {
                        const long = v.length > 220 || v.split('\n').length > 6;
                        const box = h('div', { class: `cmp-text ${long ? 'clamped' : ''}` }, v || h('span', { class: 'muted' }, '（没有）'));
                        return h('div', { class: 'cmp-cell' }, note ? h('div', { class: 'cmp-note' }, note) : null, box,
                            long ? h('button', { class: 'cmp-more', onclick: (e) => { const on = box.classList.toggle('clamped'); e.currentTarget.textContent = on ? '展开' : '收起'; } }, '展开') : null);
                    })))),
            !shown.length ? h('div', { class: 'muted cmp-empty' }, lines.length ? '这几项在能比较的内容上完全一样。' : '没有可以比较的内容。') : null);
    }

    Promise.all(cols.map((it) => (pf(it) ? api.get(`/api/items/${it.id}/content`).catch(() => null) : null))).then((contents) => {
        if (!s.el.isConnected) return;
        data = cols.map((it, i) => rowsOf(it, contents[i]));
        draw();
    });
}
