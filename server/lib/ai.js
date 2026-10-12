// AI 服务：配置（密钥只存在服务器）、请求（OpenAI 兼容 / Claude）、JSON 解析
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const FORMATS = {
    openai: { label: 'OpenAI 兼容', base: 'https://api.openai.com/v1' },
    anthropic: { label: 'Claude', base: 'https://api.anthropic.com/v1' },
};

export const DEFAULT_ORGANIZE = {
    scope: 'standard', // brief | standard | full
    template: 'default', // 用哪套提示词模板
    fields: ['nsfw', 'language'],
    concurrency: 2,
    batch: 1, // 每次请求整理几项；1 = 逐张请求，大于 1 = 合并请求（按次计费的接口更省）
    batchChars: 24000, // 合并请求时一次最多发送多少字的内容
};

/** 内置的整理提示词：不能改，想改就复制一份。防注入和输出格式是固定的，不放进模板 */
export const DEFAULT_TEMPLATE = Object.freeze({
    id: 'default',
    name: '默认',
    role: '你是「酒馆藏馆」的整理助手，替用户给 SillyTavern 的资源（角色卡、世界书、预设、正则等）打标签、写简介、填资料字段，让它们以后好找。',
    tagLimit: 6,
    allowNewTags: true,
    tagRule: '每个标签 2 到 8 个字，写题材、世界观、身份、性格、人物关系、玩法、文风这类能帮助筛选的特点。名称、作者、文件类型不要当标签。',
    summaryChars: 60,
    summaryRule: '一句话说清这是什么、看点在哪。不剧透关键情节，不用“这是一张角色卡”之类的开头，也不要重复名称。',
    forbidden: '卡里没写的设定不要补；“有趣”“精彩”“角色”这类空泛的词不做标签；意思相同的标签只留一个；没有合适的就少给，不凑数。',
    extra: '',
});
const TEMPLATE_TEXT = ['role', 'tagRule', 'summaryRule', 'forbidden', 'extra'];

const clampNum = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** ai.json：服务配置与整理规则。不进 db.json，不进备份，不下发密钥 */
export class AiConfig {
    constructor(dir) {
        this.path = path.join(dir, 'ai.json');
        this.data = { profiles: [], active: '', organize: { ...DEFAULT_ORGANIZE }, templates: [] };
        try {
            const raw = JSON.parse(fs.readFileSync(this.path, 'utf8'));
            this.data = { ...this.data, ...raw, organize: { ...DEFAULT_ORGANIZE, ...(raw.organize || {}) }, templates: Array.isArray(raw.templates) ? raw.templates : [] };
            this.migrate();
        } catch { /* 首次使用 */ }
    }

    /** 旧版把标签数、简介字数、整理习惯放在 organize 里：和默认不一样的，转成一套「我的规则」模板 */
    migrate() {
        const o = this.data.organize;
        if (!['tagLimit', 'summaryChars', 'allowNewTags', 'extra'].some((k) => k in o)) return;
        const changed = (o.tagLimit != null && o.tagLimit !== DEFAULT_TEMPLATE.tagLimit) || (o.summaryChars != null && o.summaryChars !== DEFAULT_TEMPLATE.summaryChars)
            || o.allowNewTags === false || String(o.extra || '').trim();
        if (changed && !this.data.templates.length) {
            this.data.templates.push(this.sanitizeTemplate({ ...DEFAULT_TEMPLATE, id: 'mine', name: '我的规则', tagLimit: o.tagLimit ?? 6, summaryChars: o.summaryChars ?? 60, allowNewTags: o.allowNewTags !== false, extra: o.extra || '' }));
            o.template = 'mine';
        }
        for (const k of ['tagLimit', 'summaryChars', 'allowNewTags', 'extra']) delete o[k];
        this.save();
    }

    sanitizeTemplate(t) {
        const out = {
            id: String(t.id || '').replace(/[^\w-]/g, '').slice(0, 24) || crypto.randomBytes(4).toString('hex'),
            name: String(t.name || '').trim().slice(0, 20) || '未命名模板',
            tagLimit: clampNum(t.tagLimit, 1, 20, DEFAULT_TEMPLATE.tagLimit),
            allowNewTags: t.allowNewTags !== false,
            summaryChars: clampNum(t.summaryChars, 10, 300, DEFAULT_TEMPLATE.summaryChars),
        };
        for (const k of TEMPLATE_TEXT) out[k] = String(t[k] ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
        if (out.id === 'default') out.id = crypto.randomBytes(4).toString('hex');
        return out;
    }

    /** 当前整理用的模板 */
    get template() {
        return this.data.templates.find((t) => t.id === this.data.organize.template) || DEFAULT_TEMPLATE;
    }

    /** 整理设置 + 模板里的数字和开关，给生成提示词和校验结果用 */
    get rules() {
        return { ...this.data.organize, ...this.template };
    }

    save() {
        const tmp = `${this.path}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, this.path);
    }

    get active() {
        return this.data.profiles.find((p) => p.id === this.data.active) || this.data.profiles[0] || null;
    }

    get ready() {
        const p = this.active;
        return Boolean(p && p.baseUrl && p.model && (p.apiKey || p.noKey));
    }

    /** 给网页看的版本：密钥只显示末尾几位 */
    public() {
        return {
            profiles: this.data.profiles.map(({ apiKey, ...p }) => ({ ...p, hasKey: Boolean(apiKey), keyHint: apiKey ? `…${apiKey.slice(-4)}` : '' })),
            active: this.active?.id || '',
            organize: { ...this.data.organize, template: this.template.id },
            templates: this.data.templates,
            defaultTemplate: DEFAULT_TEMPLATE,
            formats: FORMATS,
            ready: this.ready,
        };
    }

    /** 网页提交的配置；没传新密钥时沿用原来的 */
    update(body) {
        if (Array.isArray(body.profiles)) {
            const old = new Map(this.data.profiles.map((p) => [p.id, p]));
            this.data.profiles = body.profiles.slice(0, 20).map((p) => this.sanitize(p, old.get(p.id)));
        }
        if (typeof body.active === 'string') this.data.active = body.active;
        if (Array.isArray(body.templates)) {
            const seen = new Set();
            this.data.templates = body.templates.slice(0, 20).map((t) => this.sanitizeTemplate(t)).filter((t) => !seen.has(t.id) && seen.add(t.id));
        }
        if (body.organize && typeof body.organize === 'object') {
            const o = { ...this.data.organize, ...body.organize };
            this.data.organize = {
                scope: ['brief', 'standard', 'full'].includes(o.scope) ? o.scope : 'standard',
                template: String(o.template || 'default'),
                fields: Array.isArray(o.fields) ? o.fields.map(String).slice(0, 30) : [],
                concurrency: clampNum(o.concurrency, 1, 4, 2),
                batch: clampNum(o.batch, 1, 10, 1),
                batchChars: clampNum(o.batchChars, 4000, 120000, 24000),
            };
        }
        if (!this.data.templates.some((t) => t.id === this.data.organize.template)) this.data.organize.template = 'default';
        this.save();
    }

    /** 合并一个配置（网页传来的密钥为空时用已保存的） */
    sanitize(p, old = {}) {
        const format = FORMATS[p.format] ? p.format : 'openai';
        const temp = p.temperature === '' || p.temperature == null ? null : clampNum(p.temperature, 0, 2, null);
        return {
            id: String(p.id || crypto.randomBytes(4).toString('hex')).replace(/[^\w-]/g, '').slice(0, 24) || crypto.randomBytes(4).toString('hex'),
            name: String(p.name || FORMATS[format].label).slice(0, 40),
            format,
            baseUrl: String(p.baseUrl || '').trim().slice(0, 300),
            apiKey: p.clearKey ? '' : (p.apiKey ? String(p.apiKey).trim() : old?.apiKey || ''),
            noKey: Boolean(p.noKey),
            model: String(p.model || '').trim().slice(0, 120),
            temperature: temp,
            maxTokens: clampNum(p.maxTokens, 256, 32000, 2048),
        };
    }

    /** 按 id 找配置；也可以传入未保存的配置（测试连接时） */
    resolve(input) {
        if (!input) return this.active;
        if (typeof input === 'string') return this.data.profiles.find((p) => p.id === input) || null;
        const old = this.data.profiles.find((p) => p.id === input.id);
        return this.sanitize(input, old);
    }
}

// ---------------- 请求 ----------------
export class AiError extends Error {
    constructor(message, { status = 0, raw = '', retryAfter = 0 } = {}) { super(message); this.status = status; this.raw = raw; this.retryAfter = retryAfter; }
}

/** 把用户填的地址整理成 API 根路径（.../v1） */
export function apiBase(p) {
    let u = String(p.baseUrl || FORMATS[p.format]?.base || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) throw new AiError('API 地址需要以 http:// 或 https:// 开头');
    u = u.replace(/\/(chat\/completions|completions|messages|models)$/i, '');
    if (!/\/v\d+[a-z]*(\/|$)/i.test(new URL(u).pathname)) u += '/v1';
    return u;
}

function headers(p) {
    if (p.format === 'anthropic') {
        return { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(p.apiKey ? { 'x-api-key': p.apiKey } : {}) };
    }
    return { 'content-type': 'application/json', ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}) };
}

const redact = (s, p) => String(s || '').split(p.apiKey || '\u0000').join('***').slice(0, 4000);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new AiError('已取消')); }, { once: true });
});

async function request(p, url, init, { signal, timeout = 120000 } = {}) {
    const signals = [AbortSignal.timeout(timeout), signal].filter(Boolean);
    let res;
    let text;
    try {
        res = await fetch(url, { ...init, headers: headers(p), signal: AbortSignal.any(signals) });
        text = await res.text();
    } catch (e) {
        if (signal?.aborted) throw new AiError('已取消');
        if (e.name === 'TimeoutError') throw new AiError(`请求超时（${Math.round(timeout / 1000)} 秒没有返回）`);
        throw new AiError(`无法连接 AI 服务：${e.cause?.code || e.cause?.message || e.message}`);
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
    if (!res.ok) {
        const msg = json?.error?.message || json?.error || json?.message || text.slice(0, 300);
        const hint = res.status === 401 || res.status === 403 ? '（密钥不对或没有权限）' : res.status === 404 ? '（地址或模型名不对）' : res.status === 429 ? '（请求太频繁或额度用完）' : '';
        throw new AiError(`AI 服务返回 ${res.status}${hint}：${redact(typeof msg === 'string' ? msg : JSON.stringify(msg), p).slice(0, 300)}`, { status: res.status, raw: redact(text, p), retryAfter: Number(res.headers.get('retry-after')) || 0 });
    }
    if (!json) throw new AiError('AI 服务返回的不是 JSON，地址可能填错了', { status: res.status, raw: redact(text, p) });
    return { json, raw: redact(text, p), status: res.status, retryAfter: Number(res.headers.get('retry-after')) || 0 };
}

/** 读 SSE 流：每个事件回调 (event, data)；data 是解析好的 JSON，解析不了的跳过 */
async function readSse(res, onEvent) {
    const dec = new TextDecoder();
    let buf = '';
    let event = '';
    const line = (l) => {
        if (l === '') { event = ''; return; }
        if (l.startsWith('event:')) { event = l.slice(6).trim(); return; }
        if (!l.startsWith('data:')) return;
        const d = l.slice(5).trim();
        if (d === '[DONE]') return;
        let j;
        try { j = JSON.parse(d); } catch { return; }
        onEvent(event || j.type || '', j);
    };
    for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            line(buf.slice(0, i).replace(/\r$/, ''));
            buf = buf.slice(i + 1);
        }
    }
    if (buf) line(buf.replace(/\r$/, ''));
}

/**
 * 流式请求：边收边回调 onDelta(到目前为止的全文)。服务端不支持流式、直接回了 JSON 时照常解析
 * @returns {{ json?, text, truncated, usage, model, raw }}
 */
async function requestStream(p, url, init, { signal, timeout = 120000, onDelta } = {}) {
    const signals = [AbortSignal.timeout(timeout), signal].filter(Boolean);
    let res;
    const fail = (e) => {
        if (signal?.aborted) return new AiError('已取消');
        if (e.name === 'TimeoutError') return new AiError(`请求超时（${Math.round(timeout / 1000)} 秒没有返回）`);
        if (e instanceof AiError) return e;
        return new AiError(`无法连接 AI 服务：${e.cause?.code || e.cause?.message || e.message}`);
    };
    try {
        res = await fetch(url, { ...init, headers: headers(p), signal: AbortSignal.any(signals) });
    } catch (e) { throw fail(e); }
    if (!res.ok || !/text\/event-stream/i.test(res.headers.get('content-type') || '')) {
        // 出错，或者没按流式返回：按普通请求处理
        let text;
        try { text = await res.text(); } catch (e) { throw fail(e); }
        let json = null;
        try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
        if (!res.ok) {
            const msg = json?.error?.message || json?.error || json?.message || text.slice(0, 300);
            const hint = res.status === 401 || res.status === 403 ? '（密钥不对或没有权限）' : res.status === 404 ? '（地址或模型名不对）' : res.status === 429 ? '（请求太频繁或额度用完）' : '';
            throw new AiError(`AI 服务返回 ${res.status}${hint}：${redact(typeof msg === 'string' ? msg : JSON.stringify(msg), p).slice(0, 300)}`, { status: res.status, raw: redact(text, p), retryAfter: Number(res.headers.get('retry-after')) || 0 });
        }
        if (!json) throw new AiError('AI 服务返回的不是 JSON，地址可能填错了', { status: res.status, raw: redact(text, p) });
        return { json, raw: redact(text, p) };
    }
    let text = '';
    let reasoning = false;
    let truncated = false;
    let model = '';
    let usage = null;
    let streamError = '';
    try {
        await readSse(res, (ev, j) => {
            let add = '';
            if (p.format === 'anthropic') {
                if (ev === 'message_start') { model = j.message?.model || model; usage = { ...(j.message?.usage || {}) }; }
                else if (ev === 'content_block_delta' && j.delta?.type === 'text_delta') add = j.delta.text || '';
                else if (ev === 'message_delta') { truncated = j.delta?.stop_reason === 'max_tokens'; usage = { ...(usage || {}), ...(j.usage || {}) }; }
                else if (ev === 'error') streamError = j.error?.message || 'AI 服务中途出错';
            } else {
                if (j.error) streamError = j.error.message || JSON.stringify(j.error);
                model = j.model || model;
                if (j.usage) usage = j.usage;
                const c = j.choices?.[0];
                if (c) {
                    add = typeof c.delta?.content === 'string' ? c.delta.content : Array.isArray(c.delta?.content) ? c.delta.content.map((x) => x.text || '').join('') : c.text || '';
                    if (c.delta?.reasoning_content) reasoning = true;
                    if (c.finish_reason) truncated = /length/.test(c.finish_reason);
                }
            }
            if (add) { text += add; onDelta?.(text); }
        });
    } catch (e) {
        const err = fail(e);
        err.partial = text;
        throw err;
    }
    if (streamError) throw Object.assign(new AiError(`AI 服务中途出错：${redact(streamError, p).slice(0, 300)}`), { partial: text });
    if (!text && reasoning) throw new AiError('模型只返回了思考过程，没有正文。可以调高「最大输出」或换一个模型');
    return { text, truncated, usage, model, raw: '' };
}

/**
 * 一次对话。传了 onDelta 就用流式请求，边生成边回调
 * @returns {{text, truncated, usage, model, raw}}
 */
export async function chat(p, { system, user, messages, maxTokens, temperature, signal, timeout, onDelta } = {}) {
    if (!p) throw new AiError('还没有配置 AI 服务');
    if (!p.model) throw new AiError('还没有填写模型');
    const base = apiBase(p);
    const max = maxTokens || p.maxTokens || 2048;
    const temp = temperature ?? p.temperature;
    // messages：多轮对话 [{ role: 'user' | 'assistant', content }]，没传就是单轮
    const turns = messages?.length ? messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') })) : [{ role: 'user', content: user }];
    let url;
    let body;
    if (p.format === 'anthropic') {
        url = `${base}/messages`;
        body = { model: p.model, max_tokens: max, system, messages: turns };
    } else {
        url = `${base}/chat/completions`;
        body = { model: p.model, max_tokens: max, messages: [{ role: 'system', content: system }, ...turns] };
    }
    if (temp != null) body.temperature = temp;
    if (onDelta) body.stream = true;
    const init = { method: 'POST', body: JSON.stringify(body) };
    let r;
    for (let attempt = 0; ; attempt++) {
        try {
            r = onDelta ? await requestStream(p, url, init, { signal, timeout, onDelta }) : await request(p, url, init, { signal, timeout });
            if (!r.json) {
                if (!r.text.trim()) throw new AiError(r.truncated ? '输出被截断且为空，请调高「最大输出」' : 'AI 返回了空内容');
                return { text: r.text, truncated: r.truncated, usage: r.usage, model: r.model || p.model, raw: '' };
            }
            break;
        } catch (e) {
            const retryable = [429, 500, 502, 503, 504, 529].includes(e.status);
            if (!retryable || attempt >= 1) throw e;
            await sleep(Math.min(20000, (e.retryAfter || 3) * 1000), signal);
        }
    }
    const j = r.json;
    let text = '';
    let truncated = false;
    if (p.format === 'anthropic') {
        text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        truncated = j.stop_reason === 'max_tokens';
    } else {
        const c = j.choices?.[0];
        const content = c?.message?.content;
        text = Array.isArray(content) ? content.map((x) => x.text || '').join('') : content || c?.text || '';
        truncated = /length/.test(c?.finish_reason || '');
        if (!text && c?.message?.reasoning_content) throw new AiError('模型只返回了思考过程，没有正文。可以调高「最大输出」或换一个模型', { raw: r.raw });
    }
    if (!text.trim()) throw new AiError(truncated ? '输出被截断且为空，请调高「最大输出」' : 'AI 返回了空内容', { raw: r.raw });
    return { text, truncated, usage: j.usage || null, model: j.model || p.model, raw: r.raw };
}

export async function listModels(p, { signal } = {}) {
    const base = apiBase(p);
    const r = await request(p, `${base}/models${p.format === 'anthropic' ? '?limit=200' : ''}`, { method: 'GET' }, { signal, timeout: 20000 });
    const list = r.json.data || r.json.models || [];
    return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).sort();
}

/** 从模型回复里取出 JSON 对象：去掉代码块、截取首尾括号、修补尾逗号 */
export function parseJsonReply(text) {
    let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new AiError('AI 没有返回 JSON 对象', { raw: text });
    s = s.slice(a, b + 1);
    try { return JSON.parse(s); } catch { /* 再试一次 */ }
    // 先只修尾逗号：文字里的中文引号“”要原样保留
    const s2 = s.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(s2); } catch { /* 再试一次 */ }
    // 最后才把中文引号当成 JSON 的引号（有的模型会用“”包键名）
    try { return JSON.parse(s2.replace(/[“”]/g, '"')); } catch (e) {
        throw new AiError(`AI 返回的 JSON 无法解析：${e.message}`, { raw: text });
    }
}

/** 粗略估算 token：中文约 1.5 字 / token，英文约 4 字符 / token */
export function estimateTokens(text) {
    const s = String(text || '');
    const cjk = (s.match(/[　-鿿＀-￯]/g) || []).length;
    return Math.ceil(cjk / 1.5 + (s.length - cjk) / 3.5);
}
