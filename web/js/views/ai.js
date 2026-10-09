// AI 助手：服务配置、整理（草稿 → 审核 → 写入）、任务状态
import { h, clear, toast, sheet, btn, icon, switchEl, confirmDialog, promptDialog, choiceDialog, fmtDate, emptyState } from '../ui.js';
import { api } from '../api.js';
import { state, typeMeta } from '../state.js';
import { typeBadge } from './common.js';
import { openDetail } from './detail.js';
import { coverImg } from '../thumbs.js';

const AI_KINDS = new Set(['text', 'textarea', 'select', 'checkbox', 'number', 'tags']);
const SKIP_FIELDS = new Set(['source', 'author', 'version', 'rating', 'downloadedAt', 'status']);
const SCOPES = {
    brief: ['精简', '名称、简介、作者注释、世界书标题，最省'],
    standard: ['标准', '再加性格、场景、开场白、对话示例和世界书条目摘要'],
    full: ['完整', '几乎全部内容，适合内容少的卡或想要更准的结果'],
};

export const aiReady = () => Boolean(state.settings.ai?.ready);
const k = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ---------------- 状态（SSE 推送） ----------------
const listeners = new Set();
export function onAiEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function handleAiEvent(summary) {
    state.settings.ai = { ...(state.settings.ai || {}), ...summary };
    renderChip();
    for (const fn of listeners) fn(summary);
}

let chipEl = null;
/** 右下角的任务提示：整理中 / 待审核 */
export function renderChip() {
    const a = state.settings.ai || {};
    const busy = (a.queued || 0) + (a.running || 0);
    const pending = (a.done || 0) + (a.error || 0);
    if (!chipEl) {
        chipEl = h('button', { class: 'ai-chip', onclick: () => openAiReview() });
        document.body.append(chipEl);
    }
    chipEl.hidden = !busy && !pending;
    if (chipEl.hidden) return;
    clear(chipEl,
        busy ? h('span', { class: 'spinner sm' }) : icon('sparkles', { size: 15 }),
        h('span', {}, busy ? `AI 整理中 ${pending}/${busy + pending}` : `AI 待审核 ${a.done || 0}`),
        a.error ? h('span', { class: 'ai-chip-err' }, `失败 ${a.error}`) : null);
}

// ---------------- 设置 ----------------
let cfg = null;
let rules = null;
let rulesOpen = false;
export async function loadAiConfig() {
    cfg = await api.get('/api/ai/config');
    rules = structuredClone(cfg.organize);
    return cfg;
}

export function aiSettings() {
    const box = h('div', { class: 'stack-s' });
    const draw = () => {
        if (!cfg) return;
        const formats = cfg.formats;
        const profiles = cfg.profiles;
        clear(box,
            h('div', { class: 'note' }, icon('lock', { size: 15 }), h('span', {}, '密钥只保存在藏馆服务器上，网页和酒馆插件都拿不到；AI 请求由服务器发出，手机上也不会遇到跨域问题。')),
            profiles.length ? h('div', { class: 'field-list' }, profiles.map((p) => {
                const active = p.id === cfg.active;
                return h('div', { class: `field-def ai-profile ${active ? 'active' : ''}` },
                    h('button', { class: `radio ${active ? 'on' : ''}`, title: '使用这个服务', onclick: async () => { await api.put('/api/ai/config', { active: p.id }); await loadAiConfig(); draw(); } }),
                    h('div', { class: 'grow min0' },
                        h('div', { class: 'field-def-name' }, p.name, active ? h('span', { class: 'chip-s ok' }, '使用中') : null),
                        h('div', { class: 'field-def-meta' }, [formats[p.format]?.label, p.model || '未填模型', p.hasKey ? `密钥 ${p.keyHint}` : p.noKey ? '无需密钥' : '未填密钥'].join(' · '))),
                    h('div', { class: 'field-def-acts' },
                        btn('', { icon: 'zap', cls: 'sm ghost', title: '测试连接', onclick: (e) => testProfile(p.id, e.currentTarget) }),
                        btn('', { icon: 'pencil', cls: 'sm ghost', title: '编辑', onclick: () => editProfile(p, draw) }),
                        btn('', { icon: 'trash', cls: 'sm ghost danger', title: '删除', onclick: async () => {
                            if (!(await confirmDialog(`删除「${p.name}」？保存的密钥也会一起删除。`, { danger: true }))) return;
                            await api.put('/api/ai/config', { profiles: profiles.filter((x) => x.id !== p.id) });
                            await loadAiConfig();
                            draw();
                        } })));
            })) : h('div', { class: 'muted small' }, '还没有 AI 服务。支持 OpenAI 兼容接口（各类中转、DeepSeek、本地模型等）和 Claude 官方接口。'),
            btn('添加 AI 服务', { icon: 'plus', cls: 'sm', onclick: () => editProfile(null, draw) }),
            rulesForm(draw));
    };
    if (cfg) draw(); else box.append(h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
    if (!cfg) loadAiConfig().then(draw).catch((e) => clear(box, h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, `读取 AI 配置失败：${e.message}`))));
    return box;
}

async function testProfile(profile, b) {
    if (b) b.disabled = true;
    try {
        const r = await api.post('/api/ai/test', { profile });
        toast(`连接成功 · ${r.model} · ${(r.ms / 1000).toFixed(1)} 秒`, 'ok');
        return r;
    } catch (e) {
        toast(e.message, 'err');
        return null;
    } finally { if (b) b.disabled = false; }
}

function editProfile(p, done) {
    const isNew = !p;
    const np = p ? { ...p } : { id: Math.random().toString(36).slice(2, 10), name: '', format: 'openai', baseUrl: '', model: '', temperature: null, maxTokens: 2048 };
    const formats = cfg.formats;
    const name = h('input', { class: 'input', value: np.name, placeholder: '例如「DeepSeek」「Claude」' });
    const base = h('input', { class: 'input', value: np.baseUrl, placeholder: formats[np.format].base, autocapitalize: 'off', spellcheck: false });
    const key = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: p?.hasKey ? `已保存（${p.keyHint}），留空不修改` : '密钥' });
    const noKey = h('input', { type: 'checkbox', checked: Boolean(np.noKey) });
    const modelList = h('datalist', { id: `models-${np.id}` });
    const model = h('input', { class: 'input', value: np.model, placeholder: '模型名', list: modelList.id, autocapitalize: 'off', spellcheck: false });
    const temp = h('input', { class: 'input', type: 'number', step: '0.1', min: '0', max: '2', value: np.temperature ?? '', placeholder: '不发送' });
    const maxTok = h('input', { class: 'input', type: 'number', step: '256', min: '256', max: '32000', value: np.maxTokens || 2048 });
    const result = h('div', { class: 'muted small' });
    let format = np.format;
    const fmtOpts = h('div', { class: 'opts' });
    const drawFmt = () => clear(fmtOpts, Object.entries(formats).map(([fk, f]) => h('button', { class: `opt ${format === fk ? 'active' : ''}`, onclick: () => { format = fk; base.placeholder = f.base; drawFmt(); } }, f.label)));
    drawFmt();
    const collect = () => ({ ...np, name: name.value.trim() || formats[format].label, format, baseUrl: base.value.trim() || formats[format].base, apiKey: key.value.trim() || undefined, noKey: noKey.checked, model: model.value.trim(), temperature: temp.value === '' ? null : Number(temp.value), maxTokens: Number(maxTok.value) || 2048 });
    const s = sheet({
        title: isNew ? '添加 AI 服务' : `编辑 · ${np.name}`,
        body: h('div', { class: 'fields' },
            h('div', { class: 'field wide' }, h('label', {}, '接口格式'), fmtOpts),
            h('div', { class: 'field' }, h('label', {}, '名称'), name),
            h('div', { class: 'field wide' }, h('label', {}, 'API 地址'), base, h('div', { class: 'muted small' }, '填到 /v1 即可，也可以直接粘贴完整的 /chat/completions 地址。')),
            h('div', { class: 'field wide' }, h('label', {}, '密钥'), key, h('label', { class: 'check-line' }, noKey, h('span', {}, '这个服务不需要密钥（本地模型等）'))),
            h('div', { class: 'field wide' }, h('label', {}, '模型'), h('div', { class: 'input-group' }, model, btn('拉取列表', { cls: 'sm', onclick: async (e) => {
                const b = e.currentTarget;
                b.disabled = true;
                try {
                    const { models } = await api.post('/api/ai/models', { profile: collect() });
                    clear(modelList, models.map((m) => h('option', { value: m })));
                    result.textContent = `共 ${models.length} 个模型，点模型输入框可以选择。`;
                    if (!model.value && models[0]) model.value = models[0];
                } catch (err) { toast(err.message, 'err'); }
                b.disabled = false;
            } })), modelList),
            h('div', { class: 'field' }, h('label', {}, '温度（留空 = 不发送）'), temp),
            h('div', { class: 'field' }, h('label', {}, '最大输出 tokens'), maxTok),
            h('div', { class: 'field wide' }, result)),
        foot: [
            btn('测试连接', { icon: 'zap', onclick: async (e) => {
                const r = await testProfile(collect(), e.currentTarget);
                result.textContent = r ? `连接成功：${r.model}，用时 ${(r.ms / 1000).toFixed(1)} 秒，回复「${r.text}」` : '连接失败，看看上方提示。';
            } }),
            btn('保存', { icon: 'check', cls: 'primary', onclick: async () => {
                const v = collect();
                if (!v.model) { toast('请填写模型', 'err'); return; }
                const profiles = isNew ? [...cfg.profiles, v] : cfg.profiles.map((x) => (x.id === v.id ? v : x));
                try {
                    await api.put('/api/ai/config', { profiles, active: cfg.active || v.id });
                    await loadAiConfig();
                    toast('已保存', 'ok');
                    s.close();
                    done();
                } catch (err) { toast(err.message, 'err'); }
            } }),
        ],
    });
}

function rulesForm(redraw) {
    const r = rules;
    const saveBtn = btn('保存规则', { cls: 'sm primary', disabled: true, onclick: async () => {
        await api.put('/api/ai/config', { organize: r });
        await loadAiConfig();
        toast('整理规则已保存', 'ok');
        redraw();
    } });
    const mark = () => { saveBtn.disabled = false; };
    const num = (key, min, max) => h('input', { class: 'input', type: 'number', min, max, value: r[key], oninput: (e) => { r[key] = Number(e.target.value); mark(); } });
    const fieldOpts = state.fields.filter((f) => !SKIP_FIELDS.has(f.id) && AI_KINDS.has(f.kind) && !f.hidden);
    const fieldBox = h('div', { class: 'opts' });
    const drawFields = () => clear(fieldBox, fieldOpts.map((f) => h('button', { class: `opt ${r.fields.includes(f.id) ? 'active' : ''}`, onclick: () => {
        r.fields = r.fields.includes(f.id) ? r.fields.filter((x) => x !== f.id) : [...r.fields, f.id];
        mark();
        drawFields();
    } }, f.label)));
    drawFields();
    const scopeBox = h('div', { class: 'opts' });
    const scopeHint = h('div', { class: 'muted small' });
    const drawScope = () => {
        clear(scopeBox, Object.entries(SCOPES).map(([key, [label]]) => h('button', { class: `opt ${r.scope === key ? 'active' : ''}`, onclick: () => { r.scope = key; mark(); drawScope(); } }, label)));
        scopeHint.textContent = SCOPES[r.scope][1];
    };
    drawScope();
    return h('details', { class: 'fold ai-rules', open: rulesOpen, ontoggle: (e) => { rulesOpen = e.target.open; } },
        h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), icon('sliders', { size: 15 }), h('span', { class: 'fold-title' }, '整理规则')),
        h('div', { class: 'fold-body' }, h('div', { class: 'fields' },
            h('div', { class: 'field wide' }, h('label', {}, '读取范围'), scopeBox, scopeHint),
            h('div', { class: 'field' }, h('label', {}, '标签最多几个'), num('tagLimit', 1, 20)),
            h('div', { class: 'field' }, h('label', {}, '简介最多几个字'), num('summaryChars', 10, 300)),
            h('div', { class: 'field wide row-between' }, h('label', {}, '允许新建标签（关闭后只从已有标签里选）'), switchEl(r.allowNewTags, (v) => { r.allowNewTags = v; mark(); })),
            h('div', { class: 'field wide' }, h('label', {}, '让 AI 顺便填写的字段'), fieldOpts.length ? fieldBox : h('div', { class: 'muted small' }, '没有适合 AI 填写的字段，可以在「自定义字段」里添加。')),
            h('div', { class: 'field wide' }, h('label', {}, '你的整理习惯（可选）'), h('textarea', { class: 'textarea', value: r.extra, placeholder: '例如：标签用简体中文；NSFW 内容加「R18」标签；简介不要用感叹号', oninput: (e) => { r.extra = e.target.value; mark(); } })),
            h('div', { class: 'field' }, h('label', {}, '同时处理几项'), h('select', { class: 'select', onchange: (e) => { r.concurrency = Number(e.target.value); mark(); } }, [1, 2, 3, 4].map((n) => h('option', { value: n, selected: r.concurrency === n }, `${n} 项`))))),
        h('div', { class: 'row-actions' }, saveBtn)));
}

// ---------------- 整理 ----------------
export async function startOrganize(ids) {
    ids = ids.filter((id) => state.byId.has(id));
    if (!ids.length) return;
    if (!aiReady()) {
        toast('先到「设置 → AI 助手」添加 AI 服务', 'err');
        location.hash = '#/settings';
        return;
    }
    let est;
    try { est = await api.post('/api/ai/organize/estimate', { ids }); } catch (e) { toast(e.message, 'err'); return; }
    const extra = h('input', { class: 'input', placeholder: '本次额外要求（可选），例如「标签偏向玩法」' });
    for (;;) {
        const choice = await choiceDialog(h('div', { class: 'stack-s' },
            h('div', {}, `用「${est.profile}」整理 ${est.count} 项`, h('span', { class: 'muted' }, ` · ${est.model}`)),
            h('div', { class: 'muted small' }, `预计输入约 ${k(est.inTokens)} tokens，输出约 ${k(est.outTokens)} tokens。结果先存为草稿，你确认后才会写入。`),
            est.empty.length ? h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, `${est.empty.length} 项几乎没有可读的内容，只能根据名称判断：${est.empty.slice(0, 5).join('、')}${est.empty.length > 5 ? ' 等' : ''}`)) : null,
            extra),
        [{ key: 'preview', label: '看看发送内容' }, { key: 'go', label: '开始整理', cls: 'primary' }], { title: 'AI 整理' });
        if (choice === 'preview') { await showPreview(ids[0], extra.value); continue; }
        if (choice !== 'go') return;
        break;
    }
    try {
        const r = await api.post('/api/ai/organize', { ids, extra: extra.value });
        handleAiEvent(r);
        toast(`已加入 ${r.queued} 项，可以关掉页面，服务器会继续处理`, 'ok');
        openAiReview();
    } catch (e) { toast(e.message, 'err'); }
}

function showPreview(id, extra) {
    return new Promise((resolve) => {
        const body = h('div', { class: 'loading' }, h('span', { class: 'spinner' }));
        sheet({ title: '发送内容预览', body, full: true, onClose: resolve });
        api.post('/api/ai/organize/preview', { id, extra }).then((p) => clear(body,
            h('div', { class: 'stack-s' },
                h('div', { class: 'muted small' }, `以「${state.byId.get(id)?.name}」为例，约 ${k(p.tokens)} tokens。条目内容放在 <item> 标签里，并告诉 AI 其中的指令一律不执行。`),
                h('div', { class: 'sub-label' }, '系统提示'), h('pre', { class: 'code' }, p.system),
                h('div', { class: 'sub-label' }, '条目内容'), h('pre', { class: 'code' }, p.user)))).catch((e) => clear(body, h('div', { class: 'note warn' }, e.message)));
    });
}

// ---------------- 审核 ----------------
let reviewOpen = null;
const fmtVal = (v) => (v === true ? '是' : v === false ? '否' : Array.isArray(v) ? v.join('、') : v == null || v === '' ? '—' : String(v));

export function openAiReview() {
    if (reviewOpen) return reviewOpen;
    const choices = new Map();
    const cards = new Map();
    let drafts = [];
    const head = h('div', { class: 'ai-head' });
    const list = h('div', { class: 'stack-s ai-list' });
    const s = sheet({ title: 'AI 整理', body: h('div', { class: 'stack' }, head, list), full: true, onClose: () => { off(); reviewOpen = null; } });
    s.el.classList.add('ai-review');
    reviewOpen = s;
    const off = onAiEvent(() => refresh());

    async function refresh() {
        try {
            const r = await api.get('/api/ai/drafts');
            drafts = r.drafts.sort((a, b) => (a.queuedAt || '').localeCompare(b.queuedAt || ''));
            state.settings.ai = { ...(state.settings.ai || {}), ...r.summary };
            renderChip();
            draw();
        } catch (e) { clear(list, h('div', { class: 'note warn' }, e.message)); }
    }

    function choiceFor(d, it) {
        const sig = d.at || '';
        let c = choices.get(d.id);
        if (!c || c.sig !== sig) {
            const desc = (it.description || '').trim();
            const card = it.meta?.card || {};
            // 导入时自动填的简介（作者注释 / 描述摘录）视为可以替换
            const auto = !desc || desc.length > 120 || desc === (card.creatorNotesPreview || '').trim() || desc === (card.descriptionPreview || '').trim();
            c = {
                sig,
                tags: new Set(d.result.tags.map((t) => t.name)),
                tagMode: 'append',
                summary: d.result.summary,
                summaryMode: d.result.summary && auto ? 'replace' : 'keep',
                fields: Object.fromEntries(Object.keys(d.result.fields).map((f) => [f, true])),
            };
            choices.set(d.id, c);
        }
        return c;
    }

    const payload = (d) => {
        const c = choices.get(d.id);
        return { id: d.id, tags: [...c.tags], tagMode: c.tagMode, summary: c.summary, summaryMode: c.summaryMode, fields: Object.fromEntries(Object.entries(d.result.fields).filter(([f]) => c.fields[f])) };
    };

    async function apply(list2) {
        if (!list2.length) return;
        try {
            const r = await api.post('/api/ai/drafts/apply', { items: list2.map(payload) });
            toast(`已写入 ${r.applied} 项`, 'ok');
            for (const d of list2) { choices.delete(d.id); cards.delete(d.id); }
            refresh();
        } catch (e) { toast(e.message, 'err'); }
    }
    async function discard(ids) {
        await api.post('/api/ai/drafts/discard', { ids });
        for (const id of ids) cards.delete(id);
        refresh();
    }
    async function retry(ids, extra) {
        try {
            const r = await api.post('/api/ai/organize', { ids, extra });
            for (const id of ids) { choices.delete(id); cards.delete(id); }
            handleAiEvent(r);
        } catch (e) { toast(e.message, 'err'); }
    }

    function draw() {
        const c = { queued: 0, running: 0, done: 0, error: 0 };
        for (const d of drafts) c[d.status]++;
        const busy = c.queued + c.running;
        const total = drafts.length;
        const doneList = drafts.filter((d) => d.status === 'done' && state.byId.has(d.id));
        clear(head,
            total ? h('div', { class: 'import-summary' },
                h('div', { class: 'row-between' }, h('b', {}, busy ? `正在整理 ${total - busy}/${total}` : `${c.done} 项待审核`),
                    busy ? btn('停止', { cls: 'sm ghost danger', onclick: async () => { await api.post('/api/ai/cancel'); refresh(); } }) : null),
                busy ? h('div', { class: 'progress' }, h('i', { style: { width: `${((total - busy) / total) * 100}%` } })) : null,
                h('div', { class: 'muted small' }, [c.running && `处理中 ${c.running}`, c.queued && `排队 ${c.queued}`, c.done && `待审核 ${c.done}`, c.error && `失败 ${c.error}`].filter(Boolean).join(' · ') || '—')) : null,
            doneList.length > 1 || c.error ? h('div', { class: 'row-actions wrap' },
                doneList.length > 1 ? btn(`全部写入 · ${doneList.length}`, { icon: 'check', cls: 'sm primary', onclick: () => apply(doneList) }) : null,
                c.error ? btn(`重试失败的 · ${c.error}`, { icon: 'refresh', cls: 'sm', onclick: () => retry(drafts.filter((d) => d.status === 'error').map((d) => d.id)) }) : null,
                btn('全部放弃', { cls: 'sm ghost', onclick: async () => { if (await confirmDialog(`放弃全部 ${total} 项 AI 结果？条目本身不会改动。`)) discard(drafts.map((d) => d.id)); } })) : null);
        if (!total) {
            clear(list, emptyState('sparkles', '没有待审核的结果', '在仓库里多选条目，或在条目详情里点「AI 整理」。'));
            return;
        }
        const nodes = drafts.map((d) => {
            const key = `${d.status}|${d.at || ''}`;
            const cached = cards.get(d.id);
            if (cached && cached.key === key) return cached.el;
            const el = card(d);
            cards.set(d.id, { key, el });
            return el;
        });
        clear(list, nodes);
    }

    function card(d) {
        const it = state.byId.get(d.id);
        if (!it) return h('div', { class: 'ai-card' }, h('div', { class: 'muted' }, '条目已删除'), btn('移除', { cls: 'sm', onclick: () => discard([d.id]) }));
        const tm = typeMeta(it.type);
        const status = { queued: ['排队中', ''], running: ['整理中', 'info'], done: ['待审核', 'ok'], error: ['失败', 'danger'] }[d.status];
        const top = h('div', { class: 'ai-card-head', onclick: () => openDetail(it.id) },
            h('div', { class: 'row-thumb', style: { '--tc': tm.color } }, it.cover ? coverImg(it) : icon(tm.icon, { size: 18 })),
            h('div', { class: 'grow min0' }, h('div', { class: 'row-title' }, h('span', {}, it.name)), h('div', { class: 'row-sub' }, typeBadge(it.type), d.extra ? h('span', { class: 'muted' }, `要求：${d.extra}`) : null)),
            d.status === 'running' ? h('span', { class: 'spinner sm' }) : null,
            h('span', { class: `chip-s ${status[1]}` }, status[0]));
        if (d.status === 'queued' || d.status === 'running') return h('div', { class: `ai-card is-${d.status}` }, top);
        const rawBtn = d.raw ? btn('原始回复', { cls: 'sm ghost', onclick: () => sheet({ title: 'AI 原始回复', body: h('div', { class: 'stack-s' }, d.error ? h('div', { class: 'note warn' }, d.error) : null, h('pre', { class: 'code' }, d.raw)) }) }) : null;
        if (d.status === 'error') {
            return h('div', { class: 'ai-card is-error' }, top,
                h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, d.error)),
                h('div', { class: 'ai-acts' }, rawBtn, h('span', { class: 'grow' }), btn('放弃', { cls: 'sm ghost', onclick: () => discard([d.id]) }), btn('重试', { icon: 'refresh', cls: 'sm', onclick: () => retry([d.id], d.extra) })));
        }
        const c = choiceFor(d, it);
        const have = new Set(it.tags.map((t) => t.toLowerCase()));
        const tagBox = h('div', { class: 'ai-tags' });
        const drawTags = () => clear(tagBox,
            c.tagMode !== 'append' && it.tags.length ? it.tags.map((t) => h('span', { class: `tag ${c.tagMode === 'replace' ? 'struck' : ''}` }, t)) : null,
            d.result.tags.map((t) => {
                const dup = c.tagMode === 'append' && have.has(t.name.toLowerCase());
                return h('button', { class: `ai-tag ${c.tags.has(t.name) && !dup ? 'on' : ''} ${dup ? 'dup' : ''}`, disabled: dup || c.tagMode === 'keep', title: dup ? '条目里已有' : t.existing ? '已有标签' : '新标签',
                    onclick: () => { c.tags.has(t.name) ? c.tags.delete(t.name) : c.tags.add(t.name); drawTags(); } },
                c.tags.has(t.name) && !dup ? icon('check', { size: 11, stroke: 3 }) : null, t.name, !t.existing ? h('i', {}, '新') : null);
            }),
            !d.result.tags.length ? h('span', { class: 'muted small' }, 'AI 没有给出合适的标签') : null);
        drawTags();
        const sel = (value, opts, onchange) => h('select', { class: 'select sm', onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
        const summary = h('textarea', { class: 'textarea', rows: 2, value: c.summary, oninput: (e) => { c.summary = e.target.value; } });
        const fieldDefs = new Map(state.fields.map((f) => [f.id, f]));
        const fieldRows = Object.entries(d.result.fields).map(([fid, v]) => {
            const f = fieldDefs.get(fid);
            if (!f) return null;
            const cur = it.fields?.[fid];
            const cb = h('input', { type: 'checkbox', checked: c.fields[fid], onchange: (e) => { c.fields[fid] = e.target.checked; } });
            return h('label', { class: 'ai-field' }, cb, h('span', { class: 'ai-field-label' }, f.label), h('span', { class: 'muted' }, fmtVal(cur)), icon('chevronRight', { size: 12 }), h('b', {}, fmtVal(v)));
        }).filter(Boolean);
        return h('div', { class: 'ai-card is-done' }, top,
            h('div', { class: 'ai-sec' }, h('div', { class: 'ai-sec-head' }, h('span', {}, '标签'), sel(c.tagMode, [['append', '追加到现有标签'], ['replace', '替换现有标签'], ['keep', '不改标签']], (v) => { c.tagMode = v; drawTags(); })), tagBox),
            h('div', { class: 'ai-sec' }, h('div', { class: 'ai-sec-head' }, h('span', {}, '简介'), sel(c.summaryMode, [['replace', '替换简介'], ['notes', '追加到笔记'], ['keep', '不改简介']], (v) => { c.summaryMode = v; })),
                it.description ? h('div', { class: 'ai-cur' }, h('span', {}, '当前：'), it.description.length > 90 ? `${it.description.slice(0, 90)}…` : it.description) : h('div', { class: 'ai-cur' }, '当前没有简介'),
                summary, d.result.overLength ? h('div', { class: 'muted small' }, '比设定的字数长一些，可以手动删减。') : null),
            fieldRows.length ? h('div', { class: 'ai-sec' }, h('div', { class: 'ai-sec-head' }, h('span', {}, '字段')), fieldRows) : null,
            h('div', { class: 'ai-acts' },
                h('span', { class: 'muted small ai-model' }, [d.model, d.truncated ? '输出被截断' : ''].filter(Boolean).join(' · ')),
                h('span', { class: 'grow' }),
                rawBtn,
                btn('重写', { icon: 'refresh', cls: 'sm ghost', onclick: async () => {
                    const extra = await promptDialog('可以补充一句要求，留空则直接重写', { title: '重写', value: d.extra || '', placeholder: '例如「标签更具体」「简介更短」' });
                    if (extra != null) retry([d.id], extra);
                } }),
                btn('放弃', { cls: 'sm ghost', onclick: () => discard([d.id]) }),
                btn('写入', { icon: 'check', cls: 'sm primary', onclick: () => apply([d]) })));
    }

    clear(list, h('div', { class: 'loading' }, h('span', { class: 'spinner' })));
    refresh();
    return s;
}

/** 条目详情里显示的整理记录 */
export function aiStamp(it) {
    return it.ai?.at ? h('div', { class: 'muted small ai-stamp' }, icon('sparkles', { size: 12 }), `AI 整理于 ${fmtDate(it.ai.at, true)}${it.ai.model ? ` · ${it.ai.model}` : ''}`) : null;
}

// ---------------- 版本解读 ----------------
/** 对比弹层顶部的「AI 解读」 */
export function explainPanel(a, b) {
    const box = h('section', { class: 'panel ai-explain' });
    const run = async (force = false) => {
        clear(box, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, 'AI 正在阅读差异…')));
        try {
            const r = await api.post('/api/ai/explain', { a: { sha: a.sha, name: a.name }, b: { sha: b.sha, name: b.name }, aLabel: a.label, bLabel: b.label, force });
            clear(box,
                h('div', { class: 'panel-head' }, icon('sparkles', { size: 16 }), h('h3', {}, 'AI 解读'), h('span', { class: 'grow' }),
                    r.local ? null : btn('重新生成', { icon: 'refresh', cls: 'sm ghost', onclick: () => run(true) })),
                r.summary ? h('p', { class: 'ai-explain-sum' }, r.summary) : null,
                r.points.length ? h('ul', { class: 'ai-points' }, r.points.map((p) => h('li', {}, p))) : null,
                r.cautions.length ? h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('div', {}, r.cautions.map((p) => h('div', {}, p)))) : null,
                r.local ? null : h('div', { class: 'muted small' }, `${r.model}${r.cached ? ' · 之前生成的结果' : ''}${r.truncated ? ' · 输出被截断' : ''} · AI 的归纳可能有出入，以下方的逐项对比为准`));
        } catch (e) {
            clear(box, h('div', { class: 'note warn' }, icon('alert', { size: 15 }), h('span', {}, `AI 解读失败：${e.message}`)), btn('重试', { icon: 'refresh', cls: 'sm', onclick: () => run(true) }));
        }
    };
    clear(box, h('button', { class: 'ai-explain-btn', onclick: () => run() }, icon('sparkles', { size: 16 }), h('span', {}, 'AI 解读这次改动'), h('span', { class: 'muted small' }, '用几句话说清改了什么、有什么影响')));
    return box;
}

