// 条目详情：概览 / 内容 / 文件
import { h, clear, sheet, toast, confirmDialog, promptDialog, lightbox, fmtBytes, fmtDate, timeAgo, debounce, downloadBlob, switchEl, icon, btn, starsEl, emptyState } from '../ui.js';
import { api } from '../api.js';
import { bridge } from '../bridge.js';
import { state, typeMeta, TYPE_META, fieldsFor, subscribe } from '../state.js';
import { collectionName, typeBadge } from './common.js';
import { pickCollection } from './library.js';
import { importItemsToTavern, TAVERN_IMPORTABLE } from './tavern.js';

const TOP_LEVEL_FIELDS = new Set(['source', 'author', 'version', 'rating']);

export function openDetail(id) {
    let tab = 'overview';
    let content = null;
    let contentSha = '';
    const s = sheet({ title: '', body: h('div'), full: true, onClose: () => unsub() });
    s.el.classList.add('detail-sheet');
    const unsub = subscribe(() => {
        const it = state.byId.get(id);
        if (!it) { s.close(); return; }
        if (primary(it)?.sha !== contentSha) content = null;
        const ae = document.activeElement;
        const typing = ae && s.el.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== 'checkbox';
        if (!typing) render();
    });

    const primary = (it) => it.files.find((f) => f.primary) || it.files[0];
    const save = (patch) => api.patch(`/api/items/${id}`, patch).catch((e) => toast(e.message, 'err'));

    async function loadContent(it) {
        contentSha = primary(it)?.sha || '';
        content = await api.get(`/api/items/${id}/content`).catch((e) => ({ kind: 'error', error: e.message }));
        render();
    }

    function render() {
        const it = state.byId.get(id);
        if (!it) return;
        s.title.textContent = typeMeta(it.type).label;
        const scroll = s.body.scrollTop;
        clear(s.body,
            hero(it),
            h('div', { class: 'tabs' }, [['overview', '概览'], ['content', '内容'], ['files', `文件 · ${it.files.length}`]].map(([k, label]) =>
                h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; render(); } }, label))),
            h('div', { class: 'detail-body' }, tab === 'overview' ? overview(it) : tab === 'content' ? contentTab(it) : filesTab(it)));
        s.body.scrollTop = scroll;
        if (!s.foot) { s.foot = h('div', { class: 'sheet-foot' }); s.el.append(s.foot); }
        const p = primary(it);
        clear(s.foot,
            p ? btn('下载', { icon: 'download', href: api.fileUrl(p.sha, p.name, true), download: p.name }) : null,
            bridge.host && TAVERN_IMPORTABLE.has(it.type) ? btn('导入到酒馆', { icon: 'beer', cls: 'primary', onclick: () => importItemsToTavern([it]) }) : null,
            it.deletedAt
                ? btn('恢复', { icon: 'restore', onclick: async () => { await api.post(`/api/items/${id}/restore`); toast('已恢复', 'ok'); } })
                : btn('删除', { icon: 'trash', cls: 'danger', onclick: async () => {
                    if (await confirmDialog(`把「${it.name}」移入回收站？`, { danger: true, ok: '删除' })) { await api.del(`/api/items/${id}`); toast('已移入回收站'); s.close(); }
                } }));
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
            `约 ${c.estTokens} tokens`,
        ].filter(Boolean) : [];
        return h('div', { class: `hero ${it.cover ? 'has-cover' : ''}`, style: { '--tc': tm.color } },
            it.cover ? h('div', { class: 'hero-bg', style: { backgroundImage: `url("${api.fileUrl(it.cover)}")` } }) : null,
            h('div', { class: 'hero-inner' },
                h('div', { class: 'hero-cover', onclick: () => it.cover && lightbox(api.fileUrl(it.cover)) },
                    it.cover ? h('img', { src: api.fileUrl(it.cover), alt: '' }) : h('div', { class: 'hero-ph' }, icon(tm.icon, { size: 44, stroke: 1.3 }))),
                h('div', { class: 'hero-info' },
                    h('div', { class: 'hero-badges' }, typeBadge(it.type),
                        it.subtype ? h('span', { class: 'chip-s' }, it.subtype.replace('chara_card_', '').toUpperCase()) : null,
                        it.origin === 'tavern' ? h('span', { class: 'chip-s ok' }, '来自酒馆') : null,
                        it.deletedAt ? h('span', { class: 'chip-s warn' }, '已删除') : null),
                    h('h2', { class: 'hero-title' }, it.name),
                    it.author ? h('div', { class: 'hero-author' }, icon('user', { size: 13 }), it.author) : null,
                    facts.length ? h('div', { class: 'hero-facts' }, facts.map((f) => h('span', {}, f))) : null,
                    h('div', { class: 'hero-actions' },
                        h('button', { class: `fav-btn ${it.favorite ? 'on' : ''}`, onclick: () => save({ favorite: !it.favorite }) }, icon('star', { size: 16, fill: it.favorite }), h('span', {}, it.favorite ? '已收藏' : '收藏')),
                        starsEl(it.rating, (v) => save({ rating: v }), { size: 17 })),
                    h('div', { class: 'hero-time' }, `收录于 ${fmtDate(it.createdAt)} · ${timeAgo(it.updatedAt)}更新`))));
    }

    // ---------- 概览 ----------
    function overview(it) {
        const lazy = debounce((patch) => save(patch), 500);
        const tagInput = h('input', {
            class: 'input inline', placeholder: '添加标签，回车确认',
            onkeydown: (e) => {
                if (e.key === 'Enter' && tagInput.value.trim()) {
                    save({ tags: [...it.tags, ...tagInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean)] });
                    tagInput.value = '';
                }
            },
        });
        const nameInput = h('input', { class: 'input', value: it.name, onchange: () => save({ name: nameInput.value.trim() || it.name }) });
        const typeSel = h('select', { class: 'select', onchange: () => save({ type: typeSel.value }) },
            Object.entries(TYPE_META).map(([k, v]) => h('option', { value: k, selected: it.type === k }, v.label)));
        const descInput = h('textarea', { class: 'textarea', value: it.description, placeholder: '一句话介绍', oninput: () => lazy({ description: descInput.value }) });
        const notes = h('textarea', { class: 'textarea notes', value: it.notes, placeholder: '玩法心得、搭配建议、修改记录……', oninput: () => lazy({ notes: notes.value }) });

        const fieldRows = fieldsFor(it.type).map((f) => {
            const top = TOP_LEVEL_FIELDS.has(f.id);
            const val = top ? it[f.id] : it.fields?.[f.id];
            const set = (v, now = false) => {
                const patch = top ? { [f.id]: v } : { fields: { ...it.fields, [f.id]: v } };
                (now ? save : lazy)(patch);
                if (!top) it.fields = { ...it.fields, [f.id]: v };
            };
            return h('div', { class: 'field' }, h('label', {}, f.label), fieldInput(f, val, set));
        });

        return h('div', { class: 'stack' },
            quickInfo(it),
            panel('标签', 'tag', h('div', { class: 'tag-edit' },
                it.tags.map((t) => h('span', { class: 'tag' }, t, h('button', { class: 'tag-x', onclick: () => save({ tags: it.tags.filter((x) => x !== t) }) }, icon('x', { size: 11 })))),
                tagInput)),
            panel('合集', 'layers', h('div', { class: 'tag-edit' },
                it.collections.map((cid) => h('span', { class: 'tag' }, collectionName(cid) || '（已删除）', h('button', { class: 'tag-x', onclick: () => save({ collections: it.collections.filter((x) => x !== cid) }) }, icon('x', { size: 11 })))),
                btn('加入合集', { icon: 'plus', cls: 'sm', onclick: () => pickCollection((cid) => { if (!it.collections.includes(cid)) save({ collections: [...it.collections, cid] }); }) }))),
            panel('资料', 'fileText', h('div', { class: 'fields' },
                h('div', { class: 'field' }, h('label', {}, '名称'), nameInput),
                h('div', { class: 'field' }, h('label', {}, '类型'), typeSel),
                h('div', { class: 'field wide' }, h('label', {}, '简介'), descInput),
                fieldRows)),
            panel('笔记', 'feather', notes));
    }

    function quickInfo(it) {
        const m = it.meta || {};
        const stats = [];
        if (it.type === 'character' && m.card) {
            const c = m.card;
            stats.push(['开场白', c.greetings], ['世界书词条', c.bookEntries], ['内嵌正则', c.regexCount], ['内嵌脚本', c.scriptCount], ['估算 Token', c.estTokens]);
            if (m.image) stats.push(['立绘尺寸', `${m.image.width}×${m.image.height}`]);
        } else if (it.type === 'worldbook') stats.push(['条目', m.entries], ['常驻', m.constant], ['禁用', m.disabled]);
        else if (it.type === 'preset') stats.push(['提示词', m.prompts], ['已启用', m.enabledPrompts], ['温度', m.temperature], ['上下文', m.maxContext], ['回复长度', m.maxTokens]);
        else if (it.type === 'regex') stats.push(['规则数', m.count || 1]);
        else if (it.type === 'quickreply') stats.push(['按钮', m.count]);
        else if (it.type === 'chat') stats.push(['消息', m.messages], ['角色', m.character], ['用户', m.user]);
        else if (m.image) stats.push(['尺寸', `${m.image.width}×${m.image.height}`]);
        const p = it.files.find((f) => f.primary) || it.files[0];
        if (p) stats.push(['文件大小', fmtBytes(p.size)]);
        const shown = stats.filter(([, v]) => v !== undefined && v !== null && v !== '');
        const c = m.card;
        if (!shown.length && !c) return null;
        return h('section', { class: 'panel facts-panel' },
            h('div', { class: 'facts' }, shown.map(([k, v]) => h('div', { class: 'fact' }, h('b', {}, String(v)), h('span', {}, k)))),
            c?.creatorNotesPreview ? h('blockquote', { class: 'quote' }, c.creatorNotesPreview) : null,
            c?.world ? h('div', { class: 'muted small' }, '绑定世界书：', c.world) : null);
    }

    // ---------- 内容 ----------
    function contentTab(it) {
        if (!it.files.length) return emptyState('file', '没有文件', '这个条目只是一条记录，可以在「文件」页补充上传');
        if (!content) { loadContent(it); return h('div', { class: 'loading' }, h('span', { class: 'spinner' })); }
        if (content.kind === 'error') return emptyState('alert', '加载失败', content.error);
        if (content.kind === 'card') return cardView(it, content);
        if (content.kind === 'image') return h('img', { class: 'content-img', src: api.fileUrl(content.file.sha), alt: '' });
        if (content.kind === 'json') {
            const d = content.data;
            if (it.type === 'worldbook') return worldbookView(d);
            if (it.type === 'preset' && Array.isArray(d.prompts)) return presetView(d);
            if (it.type === 'regex') return regexView(Array.isArray(d) ? d : [d]);
            if (it.type === 'quickreply' && Array.isArray(d.qrList)) return qrView(d);
            if (it.type === 'theme') return themeView(d);
            return codeView(d);
        }
        if (content.kind === 'text') return h('pre', { class: 'code' }, content.text);
        return emptyState('file', '无法预览', '二进制文件，可在「文件」页下载');
    }

    function fold(title, body, { open = false, count = '', ic = null } = {}) {
        return h('details', { class: 'fold', open },
            h('summary', {}, icon('chevronRight', { size: 14, cls: 'fold-chev' }), ic ? icon(ic, { size: 15 }) : null, h('span', { class: 'fold-title' }, title), count !== '' ? h('span', { class: 'fold-count' }, count) : null),
            h('div', { class: 'fold-body' }, body));
    }
    const textFold = (title, text, open = false) => (text && String(text).trim() ? fold(title, h('div', { class: 'prose' }, text), { open, count: `${String(text).length} 字` }) : null);

    function cardView(it, c) {
        const d = c.data || {};
        const ext = d.extensions || {};
        const book = d.character_book;
        const regex = ext.regex_scripts || [];
        const greetings = [d.first_mes, ...(d.alternate_greetings || [])].filter((x) => x != null && x !== '');
        return h('div', { class: 'stack' },
            h('div', { class: 'toolbar-row' },
                h('span', { class: 'muted small grow' }, c.spec || ''),
                btn('编辑角色卡', { icon: 'pencil', cls: 'sm', onclick: () => editCard(it, c) }),
                btn('JSON', { icon: 'download', cls: 'sm', onclick: () => downloadBlob(new Blob([JSON.stringify(c.card, null, 2)], { type: 'application/json' }), `${d.name || 'card'}.json`) })),
            textFold('描述', d.description, true),
            textFold('性格', d.personality),
            textFold('场景', d.scenario),
            greetings.length ? fold('开场白', h('div', { class: 'stack-s' }, greetings.map((g, i) => h('div', {},
                h('div', { class: 'sub-label' }, i === 0 ? '主开场白' : `备选 ${i}`), h('div', { class: 'prose' }, g)))), { count: greetings.length }) : null,
            textFold('对话示例', d.mes_example),
            textFold('系统提示词', d.system_prompt),
            textFold('后置指令', d.post_history_instructions),
            textFold('深度提示词', ext.depth_prompt?.prompt),
            textFold('作者注释', d.creator_notes),
            book?.entries?.length ? fold('内嵌世界书', worldbookView(book), { count: book.entries.length, ic: 'book' }) : null,
            regex.length ? fold('内嵌正则', regexView(regex), { count: regex.length, ic: 'braces' }) : null,
            fold('原始 JSON', h('pre', { class: 'code' }, JSON.stringify(c.card, null, 2)), { ic: 'braces' }));
    }

    function worldbookView(d) {
        const entries = Array.isArray(d.entries) ? d.entries : Object.values(d.entries || {});
        let q = '';
        const list = h('div', { class: 'stack-s' });
        const draw = () => {
            const f = entries.filter((e) => !q || JSON.stringify([e.comment, e.key, e.keys, e.content]).toLowerCase().includes(q));
            clear(list, f.slice(0, 300).map((e) => {
                const keys = [].concat(e.key || e.keys || []).join('、');
                const off = e.disable || e.enabled === false;
                return h('details', { class: `fold entry ${off ? 'off' : ''}` },
                    h('summary', {}, h('span', { class: `entry-dot ${e.constant ? 'const' : ''}` }), h('span', { class: 'fold-title' }, e.comment || e.name || keys || '（无标题）'),
                        e.constant ? h('span', { class: 'chip-s' }, '常驻') : null, off ? h('span', { class: 'chip-s' }, '禁用') : null),
                    h('div', { class: 'fold-body' }, keys ? h('div', { class: 'sub-label' }, `关键词：${keys}`) : null, h('div', { class: 'prose' }, e.content || '')));
            }), f.length > 300 ? h('div', { class: 'muted small' }, `仅显示前 300 条，共 ${f.length} 条`) : null);
        };
        draw();
        return h('div', { class: 'stack-s' },
            h('label', { class: 'search inline' }, icon('search', { size: 15 }), h('input', { class: 'input search-input', placeholder: `在 ${entries.length} 个条目中搜索`, oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } })),
            list);
    }

    function presetView(d) {
        const order = d.prompt_order?.find((o) => o.character_id === 100001)?.order || d.prompt_order?.[0]?.order || [];
        const enabled = new Map(order.map((o) => [o.identifier, o.enabled]));
        const params = ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'openai_max_context', 'openai_max_tokens'].filter((k) => d[k] !== undefined);
        return h('div', { class: 'stack' },
            h('section', { class: 'panel facts-panel' }, h('div', { class: 'facts' }, params.map((k) => h('div', { class: 'fact' }, h('b', {}, String(d[k])), h('span', {}, k))))),
            h('div', { class: 'stack-s' }, d.prompts.map((p) => h('details', { class: `fold entry ${enabled.get(p.identifier) === false ? 'off' : ''}` },
                h('summary', {}, h('span', { class: 'entry-dot' }), h('span', { class: 'fold-title' }, p.name || p.identifier), p.role ? h('span', { class: 'chip-s' }, p.role) : null, p.marker ? h('span', { class: 'chip-s' }, '占位') : null),
                p.content ? h('div', { class: 'fold-body' }, h('div', { class: 'prose' }, p.content)) : null))),
            fold('原始 JSON', h('pre', { class: 'code' }, JSON.stringify(d, null, 2)), { ic: 'braces' }));
    }

    function regexView(list) {
        return h('div', { class: 'stack-s' }, list.map((r) => h('details', { class: `fold entry ${r.disabled ? 'off' : ''}` },
            h('summary', {}, h('span', { class: 'entry-dot' }), h('span', { class: 'fold-title' }, r.scriptName || '（未命名）')),
            h('div', { class: 'fold-body' },
                h('div', { class: 'sub-label' }, '查找'), h('pre', { class: 'code' }, r.findRegex || ''),
                h('div', { class: 'sub-label' }, '替换为'), h('pre', { class: 'code' }, r.replaceString || '')))));
    }

    function qrView(d) {
        return h('div', { class: 'stack-s' }, d.qrList.map((q) => fold(q.label || '（无标签）', h('pre', { class: 'code' }, q.message || ''), { ic: 'zap' })));
    }

    function themeView(d) {
        const colors = Object.entries(d).filter(([, v]) => typeof v === 'string' && /^(#|rgba?\()/.test(v));
        return h('div', { class: 'stack' },
            h('section', { class: 'panel' }, h('div', { class: 'swatch-list' }, colors.map(([k, v]) => h('div', { class: 'swatch-item' }, h('i', { style: { background: v } }), h('span', {}, k))))),
            codeView(d));
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
        const es = sheet({
            title: `编辑 · ${d.name}`, full: true,
            body: h('div', { class: 'stack' },
                h('div', { class: 'note' }, icon('info', { size: 15 }), '保存后生成新版本，旧版本保留在「文件」页，可随时切回。PNG 卡会保留原立绘。'),
                h('div', { class: 'fields' }, FIELDS.map(([k, label, kind]) => {
                    inputs[k] = kind === 'input' ? h('input', { class: 'input', value: d[k] || '' }) : h('textarea', { class: 'textarea', value: d[k] || '', style: { minHeight: k === 'description' || k === 'first_mes' ? '200px' : '100px' } });
                    return h('div', { class: `field ${kind === 'textarea' ? 'wide' : ''}` }, h('label', {}, label), inputs[k]);
                }), h('div', { class: 'field wide' }, h('label', {}, '标签'), tagsInput), h('div', { class: 'field wide' }, h('label', {}, '备选开场白'), greetBox))),
            foot: [
                btn('取消', { onclick: () => es.close() }),
                btn('保存', { icon: 'check', cls: 'primary', onclick: async (e) => {
                    const b = e.currentTarget;
                    b.disabled = true;
                    for (const [k] of FIELDS) d[k] = inputs[k].value;
                    d.tags = tagsInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
                    d.alternate_greetings = greets.filter((g) => g.trim());
                    try {
                        await api.put(`/api/items/${id}/card`, { card: { ...c.card, data: d } });
                        toast('已保存为新版本', 'ok');
                        content = null;
                        es.close();
                    } catch (err) { toast(err.message, 'err'); b.disabled = false; }
                } }),
            ],
        });
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
        return h('div', { class: 'stack' },
            h('section', { class: 'panel' },
                h('div', { class: 'panel-head' }, icon('file', { size: 16 }), h('h3', {}, '文件与版本'), h('span', { class: 'grow' }), btn('上传', { icon: 'upload', cls: 'sm primary', onclick: () => fileInput.click() }), fileInput),
                h('label', { class: 'check-line' }, asPrimary, h('span', {}, '上传的文件设为主文件（新版本）；不勾选则作为附件')),
                h('div', { class: 'file-list' }, sorted.map((f) => h('div', { class: `file-row ${f.primary ? 'primary' : ''}` },
                    h('div', { class: 'file-ic' }, icon(/^image\//.test(f.mime) ? 'image' : 'file', { size: 18 })),
                    h('div', { class: 'grow min0' },
                        h('div', { class: 'file-name' }, f.name, f.primary ? h('span', { class: 'chip-s ok' }, '主文件') : null),
                        h('div', { class: 'file-meta' }, `${fmtBytes(f.size)} · ${fmtDate(f.addedAt, true)}`, f.label ? ` · ${f.label}` : '')),
                    btn('', { icon: 'download', cls: 'sm ghost', href: api.fileUrl(f.sha, f.name, true), download: f.name, title: '下载' }),
                    btn('', { icon: 'more', cls: 'sm ghost', onclick: () => fileMenu(it, f) }))))),
            h('div', { class: 'muted small' }, '主文件决定条目的解析信息，以及「导入到酒馆」时使用的文件。'));
    }

    function fileMenu(it, f) {
        const item = (ic, label, fn, cls = '') => h('button', { class: `menu-item ${cls}`, onclick: async () => { m.close(); await fn(); } }, icon(ic, { size: 17 }), h('span', {}, label));
        const m = sheet({
            title: f.name,
            body: h('div', { class: 'menu' },
                !f.primary ? item('star', '设为主文件', async () => { await api.patch(`/api/items/${id}/files/${f.id}`, { primary: true }); toast('已切换主文件', 'ok'); }) : null,
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

    function panel(title, ic, ...children) {
        return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, icon(ic, { size: 16 }), h('h3', {}, title)), children);
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
