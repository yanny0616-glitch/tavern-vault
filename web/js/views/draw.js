// 抽一张：从仓库当前筛选出来的条目里随便抽，或者说一句想找什么样的让 AI 挑
import { h, clear, sheet, toast, icon, btn } from '../ui.js';
import { api } from '../api.js';
import { state, typeMeta } from '../state.js';
import { coverImg } from '../thumbs.js';
import { openDetail } from './detail.js';
import { aiReady } from './ai.js';

const AI_MAX = 400; // 和服务端一致：一次最多拿这么多个给 AI 看

/** @param list 仓库里当前看到的条目（已经按类型、筛选、搜索缩小过） */
export function openDraw(list) {
    const pool = list.filter((it) => !it.deletedAt);
    const label = typeMeta(pool[0]?.type).label || '条目';
    const seen = new Set(); // 这次打开抽到过的，抽完一轮之前不重复
    const out = h('div', { class: 'draw-out' });
    const s = sheet({ title: '抽一张', body: h('div', { class: 'stack' }) });

    const card = (it, reason) => h('button', { class: 'draw-card', style: { '--tc': typeMeta(it.type).color }, onclick: () => { s.close(); setTimeout(() => openDetail(it.id), 200); } },
        h('div', { class: 'draw-cover' }, it.cover ? coverImg(it) : icon(typeMeta(it.type).icon, { size: 26 })),
        h('div', { class: 'draw-info' },
            h('b', {}, it.name),
            reason ? h('div', { class: 'draw-reason' }, icon('sparkles', { size: 13 }), h('span', {}, reason)) : null,
            it.tags.length ? h('div', { class: 'draw-tags' }, it.tags.slice(0, 6).map((t) => h('span', { class: 'chip-s' }, t))) : null,
            h('div', { class: 'draw-desc' }, it.ai?.summary || it.description || it.notes || '还没有简介'),
            h('span', { class: 'draw-open' }, '点开看看', icon('chevronRight', { size: 13 }))));

    const roll = () => {
        if (seen.size >= pool.length) { seen.clear(); if (pool.length > 1) toast('都抽过一遍了，重新开始', 'ok'); }
        const left = pool.filter((it) => !seen.has(it.id));
        const it = left[Math.floor(Math.random() * left.length)];
        seen.add(it.id);
        clear(out, card(it), h('div', { class: 'muted small draw-count' }, `第 ${seen.size} / ${pool.length} 个`));
    };

    const want = h('input', { class: 'input', placeholder: '比如：轻松日常、慢热、有反转', maxlength: 300, onkeydown: (e) => { if (e.key === 'Enter') ask(); } });
    const askBtn = btn('让 AI 挑', { icon: 'sparkles', onclick: () => ask() });
    async function ask() {
        const v = want.value.trim();
        if (!v) { want.focus(); return; }
        askBtn.disabled = true;
        clear(out, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, 'AI 正在挑')));
        try {
            const r = await api.post('/api/ai/recommend', { ids: pool.slice(0, AI_MAX).map((it) => it.id), want: v });
            const picks = r.picks.map((x) => [state.byId.get(x.id), x.reason]).filter(([it]) => it);
            clear(out, picks.length ? picks.map(([it, reason]) => card(it, reason)) : h('div', { class: 'muted draw-none' }, '这些里面没有特别合适的。换个说法，或者放宽仓库里的筛选再试。'));
        } catch (e) {
            clear(out, h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, e.message)));
        } finally { askBtn.disabled = false; }
    }

    clear(s.body,
        h('div', { class: 'muted small' }, `从仓库里现在看到的 ${pool.length} 个${label}里挑。想换范围，先在仓库里筛选或搜索。`),
        out,
        btn(pool.length > 1 ? '随便抽一张' : '就这一个', { icon: 'dice', cls: 'primary block', onclick: roll }),
        aiReady() ? h('div', { class: 'draw-ai' },
            h('div', { class: 'form-label' }, '或者说说想找什么样的'),
            h('div', { class: 'draw-ai-row' }, want, askBtn),
            h('div', { class: 'muted small' }, `只把名称、标签、简介和笔记发给 AI，不发文件内容。${pool.length > AI_MAX ? `条目太多，只看前 ${AI_MAX} 个。` : ''}`)) : null);
    clear(out, h('div', { class: 'draw-empty' }, icon('dice', { size: 30, stroke: 1.5 }), h('span', {}, '不知道看哪张？抽一张试试')));
}
