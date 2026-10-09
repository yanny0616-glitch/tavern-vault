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
    tagLimit: 6,
    allowNewTags: true,
    summaryChars: 60,
    fields: ['nsfw', 'language'],
    extra: '',
    concurrency: 2,
};

const clampNum = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** ai.json：服务配置与整理规则。不进 db.json，不进备份，不下发密钥 */
export class AiConfig {
    constructor(dir) {
        this.path = path.join(dir, 'ai.json');
        this.data = { profiles: [], active: '', organize: { ...DEFAULT_ORGANIZE } };
        try {
            const raw = JSON.parse(fs.readFileSync(this.path, 'utf8'));
            this.data = { ...this.data, ...raw, organize: { ...DEFAULT_ORGANIZE, ...(raw.organize || {}) } };
        } catch { /* 首次使用 */ }
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
            organize: this.data.organize,
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
        if (body.organize && typeof body.organize === 'object') {
            const o = { ...this.data.organize, ...body.organize };
            this.data.organize = {
                scope: ['brief', 'standard', 'full'].includes(o.scope) ? o.scope : 'standard',
                tagLimit: clampNum(o.tagLimit, 1, 20, 6),
                allowNewTags: o.allowNewTags !== false,
                summaryChars: clampNum(o.summaryChars, 10, 300, 60),
                fields: Array.isArray(o.fields) ? o.fields.map(String).slice(0, 30) : [],
                extra: String(o.extra || '').slice(0, 2000),
                concurrency: clampNum(o.concurrency, 1, 4, 2),
            };
        }
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
    constructor(message, { status = 0, raw = '' } = {}) { super(message); this.status = status; this.raw = raw; }
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
        throw new AiError(`AI 服务返回 ${res.status}${hint}：${redact(typeof msg === 'string' ? msg : JSON.stringify(msg), p).slice(0, 300)}`, { status: res.status, raw: redact(text, p) });
    }
    if (!json) throw new AiError('AI 服务返回的不是 JSON，地址可能填错了', { status: res.status, raw: redact(text, p) });
    return { json, raw: redact(text, p), status: res.status, retryAfter: Number(res.headers.get('retry-after')) || 0 };
}

/**
 * 一次对话
 * @returns {{text, truncated, usage, model, raw}}
 */
export async function chat(p, { system, user, maxTokens, temperature, signal, timeout } = {}) {
    if (!p) throw new AiError('还没有配置 AI 服务');
    if (!p.model) throw new AiError('还没有填写模型');
    const base = apiBase(p);
    const max = maxTokens || p.maxTokens || 2048;
    const temp = temperature ?? p.temperature;
    let url;
    let body;
    if (p.format === 'anthropic') {
        url = `${base}/messages`;
        body = { model: p.model, max_tokens: max, system, messages: [{ role: 'user', content: user }] };
    } else {
        url = `${base}/chat/completions`;
        body = { model: p.model, max_tokens: max, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    }
    if (temp != null) body.temperature = temp;
    const init = { method: 'POST', body: JSON.stringify(body) };
    let r;
    for (let attempt = 0; ; attempt++) {
        try {
            r = await request(p, url, init, { signal, timeout });
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
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')); } catch (e) {
        throw new AiError(`AI 返回的 JSON 无法解析：${e.message}`, { raw: text });
    }
}

/** 粗略估算 token：中文约 1.5 字 / token，英文约 4 字符 / token */
export function estimateTokens(text) {
    const s = String(text || '');
    const cjk = (s.match(/[　-鿿＀-￯]/g) || []).length;
    return Math.ceil(cjk / 1.5 + (s.length - cjk) / 3.5);
}
