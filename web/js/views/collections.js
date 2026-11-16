// 合集管理
import { h, clear, toast, confirmDialog, sheet, icon, btn, emptyState, switchEl } from '../ui.js';
import { api } from '../api.js';
import { state, live, allTags, TYPE_META, inCollection, ruleMatch, ruleEmpty } from '../state.js';
import { tagCloud } from '../tagcloud.js';
import { COLLECTION_ICONS } from '../icons.js';
import { topbar, ensureView } from './common.js';
import { coverImg } from '../thumbs.js';

const COLORS = ['', '#b4637a', '#c2554a', '#c08a2b', '#5e8a2e', '#2f8f6f', '#3a8aa6', '#3e7cb1', '#8a5cb8'];

export function renderCollections(root, { go }) {
    const refs = ensureView(root, 'collections', () => {
        const content = h('div');
        const sub = h('div', { class: 'tb-sub' });
        const head = topbar('合集', { kicker: 'Shelves', actions: [btn('新建', { icon: 'plus', cls: 'primary sm', onclick: () => editCollection() })] });
        head.querySelector('.tb-titles').append(sub);
        root.append(head, h('div', { class: 'page' }, content));
        return { content, sub };
    });
    const items = live();
    refs.sub.textContent = `${state.collections.length} 个合集`;
    if (!state.collections.length) {
        clear(refs.content, emptyState('layers', '还没有合集', '用合集把藏品分组，比如「常用」「某个世界观」「待测试」', btn('新建合集', { icon: 'plus', cls: 'primary', onclick: () => editCollection() })));
        return;
    }
    clear(refs.content, h('div', { class: 'shelves' }, state.collections.map((c) => {
        const members = items.filter((i) => inCollection(i, c));
        const covers = members.filter((i) => i.cover).slice(0, 3);
        return h('article', { class: 'shelf', style: { '--cc': c.color || 'var(--accent)' }, onclick: () => { Object.assign(state.filter, { collection: c.id, type: 'all', tagsIn: [], tagsOut: [], quick: [], fav: false }); go('library'); } },
            h('div', { class: 'shelf-covers' }, covers.length ? covers.map((i) => coverImg(i)) : h('div', { class: 'shelf-ph' }, icon(c.icon, { size: 34, stroke: 1.3 }))),
            h('div', { class: 'shelf-body' },
                h('div', { class: 'shelf-ic' }, icon(c.icon, { size: 16 })),
                h('div', { class: 'grow min0' }, h('div', { class: 'shelf-name' }, c.name, c.rule ? h('span', { class: 'chip-s info shelf-auto', title: ruleText(c.rule) }, '自动') : null), h('div', { class: 'shelf-meta' }, `${members.length} 件`, c.rule ? ` · ${ruleText(c.rule)}` : c.description ? ` · ${c.description}` : '')),
                btn('', { icon: 'more', cls: 'sm ghost', onclick: (e) => { e.stopPropagation(); editCollection(c); } })));
    })));
}

/** 条件写成一句话 */
export function ruleText(r) {
    return [
        r.type && (TYPE_META[r.type]?.label || r.type),
        r.tagsIn?.length && `带 ${r.tagsIn.join('、')}`,
        r.tagsOut?.length && `不带 ${r.tagsOut.join('、')}`,
        r.minRating && `${r.minRating} 星以上`,
        r.fav && '已收藏',
        r.text && `名称或作者含「${r.text}」`,
    ].filter(Boolean).join(' · ');
}

/** 挑条件里的标签：点一次「要有」，再点「不要」，再点取消 */
function pickRuleTags(rule, onDone) {
    const tin = new Set(rule.tagsIn || []);
    const tout = new Set(rule.tagsOut || []);
    const count = new Map(allTags());
    for (const t of [...tin, ...tout]) if (!count.has(t)) count.set(t, 0);
    const tags = [...count.entries()].sort((a, b) => b[1] - a[1]);
    const ui = { rare: false, sort: 'count' };
    let q = '';
    const list = h('div');
    const draw = () => tagCloud(list, { tags, q, ui, redraw: draw, picked: new Set([...tin, ...tout]), chip: (t, n) => {
        const st = tin.has(t) ? 'in' : tout.has(t) ? 'out' : '';
        return h('button', { class: `opt tag-opt ${st ? `active ${st}` : ''}`, onclick: () => { tin.delete(t); tout.delete(t); if (!st) tin.add(t); else if (st === 'in') tout.add(t); draw(); } },
            st === 'in' ? icon('check', { size: 13, stroke: 3 }) : st === 'out' ? icon('minus', { size: 13, stroke: 3 }) : null, h('span', {}, t), n ? h('span', { class: 'opt-n' }, n) : null);
    } });
    const find = h('input', { class: 'input search-input', type: 'search', placeholder: '找标签', oninput: () => { q = find.value; draw(); } });
    const s = sheet({ title: '条件里的标签',
        body: h('div', { class: 'stack-s' }, h('div', { class: 'muted small' }, '点一次要有，再点排除，再点取消。选了几个「要有」的，就得几个都有。'),
            tags.length > 12 ? h('label', { class: 'search inline' }, icon('search', { size: 15 }), find) : null, list),
        foot: [btn('确定', { icon: 'check', cls: 'primary', onclick: () => { s.close(); onDone([...tin], [...tout]); } })] });
    draw();
}

function editCollection(c = null) {
    const name = h('input', { class: 'input', value: c?.name || '', placeholder: '合集名称' });
    const desc = h('textarea', { class: 'textarea', value: c?.description || '', placeholder: '描述（可选）' });
    let ic = COLLECTION_ICONS.includes(c?.icon) ? c.icon : 'folder';
    let color = c?.color || '';
    const iconBox = h('div', { class: 'icon-picker' });
    const colorBox = h('div', { class: 'color-picker' });
    const draw = () => {
        clear(iconBox, COLLECTION_ICONS.map((n) => h('button', { class: n === ic ? 'active' : '', onclick: () => { ic = n; draw(); } }, icon(n, { size: 18 }))));
        clear(colorBox, COLORS.map((cl) => h('button', { class: `${cl === color ? 'active' : ''} ${cl ? '' : 'auto'}`, style: { '--sw': cl || 'var(--accent)' }, title: cl ? cl : '跟随风格', onclick: () => { color = cl; draw(); } })));
    };
    draw();
    // 智能合集：不用手动往里放，符合条件的自动算进来
    let smart = Boolean(c?.rule);
    const rule = structuredClone(c?.rule || {});
    const ruleBox = h('div', { class: 'rule-box' });
    const drawRule = () => {
        if (!smart) { clear(ruleBox); ruleBox.hidden = true; return; }
        ruleBox.hidden = false;
        const hit = ruleEmpty(rule) ? 0 : live().filter((i) => ruleMatch(i, rule)).length;
        clear(ruleBox,
            h('div', { class: 'fields' },
                h('div', { class: 'field' }, h('label', {}, '类型'), h('select', { class: 'select rule-type', onchange: (e) => { rule.type = e.target.value; drawRule(); } },
                    h('option', { value: '' }, '不限'), Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k, selected: rule.type === k }, v.label)))),
                h('div', { class: 'field' }, h('label', {}, '评分至少'), h('select', { class: 'select rule-rating', onchange: (e) => { rule.minRating = Number(e.target.value) || 0; drawRule(); } },
                    h('option', { value: 0 }, '不限'), [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: rule.minRating === n }, `${n} 星`)))),
                h('div', { class: 'field wide' }, h('label', {}, '标签'),
                    h('div', { class: 'rule-tags' },
                        (rule.tagsIn || []).map((t) => h('span', { class: 'chip-s ok' }, icon('check', { size: 11, stroke: 3 }), t)),
                        (rule.tagsOut || []).map((t) => h('span', { class: 'chip-s warn' }, icon('minus', { size: 11, stroke: 3 }), t)),
                        btn(rule.tagsIn?.length || rule.tagsOut?.length ? '改' : '选标签', { icon: 'tag', cls: 'sm', onclick: () => pickRuleTags(rule, (tin, tout) => { rule.tagsIn = tin; rule.tagsOut = tout; drawRule(); }) }))),
                h('div', { class: 'field wide' }, h('label', {}, '名称或作者里有'), h('input', { class: 'input rule-text', value: rule.text || '', placeholder: '可选，比如某个作者的名字', oninput: (e) => { rule.text = e.target.value.trim(); hitEl.textContent = hitText(); } })),
                h('label', { class: 'check-line field wide' }, switchEl(Boolean(rule.fav), (v) => { rule.fav = v; drawRule(); }), h('span', {}, '只要已收藏的'))),
            hitEl);
        hitEl.textContent = hitText(hit);
    };
    const hitEl = h('div', { class: 'muted small rule-hit' });
    const hitText = (n = ruleEmpty(rule) ? 0 : live().filter((i) => ruleMatch(i, rule)).length) => (ruleEmpty(rule) ? '至少填一个条件。' : `现在有 ${n} 件符合。以后符合条件的会自动出现在这里，不符合了自动离开。`);
    const wasManual = c && !c.rule && live().some((i) => i.collections.includes(c.id));
    drawRule();
    const s = sheet({
        title: c ? '编辑合集' : '新建合集',
        body: h('div', { class: 'fields' },
            h('div', { class: 'field wide' }, h('label', {}, '名称'), name),
            h('div', { class: 'field wide' }, h('label', {}, '图标'), iconBox),
            h('div', { class: 'field wide' }, h('label', {}, '颜色'), colorBox),
            h('div', { class: 'field wide' }, h('label', {}, '描述'), desc),
            h('label', { class: 'check-line field wide rule-switch' }, switchEl(smart, (v) => { smart = v; drawRule(); }), h('span', {}, '按条件自动收录（智能合集）')),
            h('div', { class: 'field wide' }, ruleBox)),
        foot: [
            c ? btn('删除', { icon: 'trash', cls: 'danger', onclick: async () => {
                if (!(await confirmDialog(`删除合集「${c.name}」？其中的藏品不会被删除。`, { danger: true }))) return;
                await api.del(`/api/collections/${c.id}`);
                s.close();
            } }) : null,
            btn('保存', { icon: 'check', cls: 'primary', onclick: async () => {
                if (!name.value.trim()) { toast('请输入名称', 'err'); return; }
                if (smart && ruleEmpty(rule)) { toast('智能合集至少要填一个条件', 'err'); return; }
                if (smart && wasManual && !(await confirmDialog('改成按条件收录后，以前手动放进这个合集的条目不再算在里面（条目本身不会删）。继续吗？', { ok: '继续' }))) return;
                const body = { name: name.value.trim(), icon: ic, color, description: desc.value };
                if (smart || c?.rule) body.rule = smart ? rule : null;
                if (c) await api.patch(`/api/collections/${c.id}`, body); else await api.post('/api/collections', body);
                s.close();
                toast('已保存', 'ok');
            } }),
        ],
    });
}
