// 服务端 API 客户端
const params = new URLSearchParams(location.hash.includes('?') ? location.hash.split('?')[1] : location.search.slice(1));
const TOKEN_KEY = 'tv_token';

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* 私密模式 */ } }

let token = params.get('token') || lsGet(TOKEN_KEY) || '';
if (params.get('token')) lsSet(TOKEN_KEY, token);

export const api = {
    get token() { return token; },
    setToken(t) { token = t || ''; lsSet(TOKEN_KEY, token); },

    async req(method, path, body, { raw = false, headers = {}, blob = false } = {}) {
        const init = { method, headers: { ...headers } };
        if (token) init.headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) {
            if (raw) init.body = body;
            else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
        }
        const res = await fetch(path, init);
        if (res.status === 401 && path !== '/api/login') {
            window.dispatchEvent(new CustomEvent('tv:unauthorized'));
        }
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
            throw new Error(msg);
        }
        if (blob) return res.blob();
        const ct = res.headers.get('content-type') || '';
        return ct.includes('json') ? res.json() : res.text();
    },
    get: (p) => api.req('GET', p),
    post: (p, b) => api.req('POST', p, b),
    put: (p, b) => api.req('PUT', p, b),
    patch: (p, b) => api.req('PATCH', p, b),
    del: (p) => api.req('DELETE', p),

    /** 带上传进度的请求（大文件、压缩包、备份用） */
    send(method, path, body, { onProgress } = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, path);
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
            xhr.onload = () => {
                let data = null;
                try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
                if (xhr.status === 401) window.dispatchEvent(new CustomEvent('tv:unauthorized'));
                if (xhr.status >= 200 && xhr.status < 300) resolve(data);
                else reject(Object.assign(new Error(data?.error || `HTTP ${xhr.status}`), { status: xhr.status }));
            };
            xhr.onerror = () => reject(new Error('网络错误，上传中断'));
            xhr.send(body);
        });
    },

    /**
     * 上传文件（原始 body）
     * opts.match: 遇到同名条目 ask | version | new | skip；opts.target: 作为某条目的新版本
     * opts.zipCollection: 压缩包按包名建合集；opts.collectionName: 加入（或新建）该名字的合集
     */
    upload(file, opts = {}) {
        const q = new URLSearchParams({ filename: opts.filename || file.name || 'upload.bin' });
        for (const k of ['type', 'name', 'mode', 'source', 'origin', 'match', 'target', 'collectionName', 'label']) if (opts[k]) q.set(k, opts[k]);
        if (opts.zipCollection) q.set('zipCollection', '1');
        if (opts.unzip === false) q.set('unzip', '0');
        if (opts.tags?.length) q.set('tags', opts.tags.join(','));
        if (opts.collections?.length) q.set('collections', opts.collections.join(','));
        return api.send('POST', `/api/items?${q}`, file, { onProgress: opts.onProgress });
    },
    /** 处理导入冲突 */
    resolve(pending, action, opts = {}) {
        return api.post('/api/ingest/resolve', { sha: pending.sha, filename: pending.filename, action, target: opts.target || pending.candidates?.[0]?.id, ...opts });
    },
    diff(a, b) {
        return api.post('/api/diff', { a, b });
    },
    restore(file, mode, onProgress) {
        return api.send('POST', `/api/restore?mode=${mode}`, file, { onProgress });
    },
    uploadVersion(id, file, { filename, primary = true, label = '' } = {}) {
        const q = new URLSearchParams({ filename: filename || file.name || 'file.bin', primary: primary ? '1' : '0', label });
        return api.req('POST', `/api/items/${id}/files?${q}`, file, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
    },
    fileUrl(sha, name = '', dl = false) {
        const q = new URLSearchParams();
        if (name) q.set('name', name);
        if (dl) q.set('dl', '1');
        if (token) q.set('token', token);
        return `/api/files/${sha}?${q}`;
    },
    thumbUrl(sha) {
        return `/api/thumbs/${sha}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    },
    putThumb(sha, blob) {
        return api.req('PUT', `/api/thumbs/${sha}`, blob, { raw: true, headers: { 'Content-Type': blob.type } });
    },
    fetchFile(sha) {
        return api.req('GET', `/api/files/${sha}`, undefined, { blob: true });
    },

    /** 实时事件 */
    events(onEvent, onStatus) {
        let es;
        let retry = 1000;
        const connect = () => {
            es = new EventSource(`/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
            es.addEventListener('hello', () => { retry = 1000; onStatus?.(true); });
            es.addEventListener('change', (e) => onEvent('change', JSON.parse(e.data || '{}')));
            es.addEventListener('auth', () => onEvent('auth', {}));
            es.addEventListener('ai', (e) => onEvent('ai', JSON.parse(e.data || '{}')));
            es.onerror = () => {
                onStatus?.(false);
                es.close();
                setTimeout(connect, retry);
                retry = Math.min(retry * 2, 30000);
            };
        };
        connect();
        return () => es?.close();
    },
};
