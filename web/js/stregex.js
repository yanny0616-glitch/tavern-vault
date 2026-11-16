// 按酒馆的方式套用正则（不依赖 DOM，网页和限时试跑的 Worker 共用）

/** 试跑时超时的正则（按 findRegex 记）：之后直接跳过，不再在页面上运行 */
export const slowRegex = new Set();

/** 酒馆的正则写法：「/pattern/flags」或直接写 pattern */
export function parseRegex(src) {
    const s = String(src || '');
    if (!s) return null;
    const m = s.match(/^\/([\s\S]+)\/([a-z]*)$/i);
    try {
        if (m) return new RegExp(m[1], [...new Set(m[2].replace(/[^dgimsuvy]/g, ''))].join(''));
        return new RegExp(s);
    } catch {
        return null;
    }
}

const macros = (s, names) => String(s ?? '')
    .replace(/\{\{char\}\}/gi, names.char)
    .replace(/\{\{user\}\}/gi, names.user);

// 正则的作用位置（酒馆里的 placement）
export const PLACEMENT = { 1: '用户输入', 2: 'AI 输出', 3: '快捷命令', 5: '世界书', 6: '推理' };

/** 套用一条正则；返回替换后的文本和命中次数 */
export function runRegex(text, r, names) {
    if (slowRegex.has(String(r.findRegex))) return { out: text, hits: 0, error: '这条正则运行太慢，已跳过' };
    const re = parseRegex(r.findRegex);
    if (!re) return { out: text, hits: 0, error: r.findRegex ? '正则写法有误' : '' };
    let hits = 0;
    const rep = String(r.replaceString ?? '').replace(/\{\{match\}\}/gi, '$&');
    const trims = (r.trimStrings || []).filter(Boolean);
    const out = String(text).replace(re, (...args) => {
        hits++;
        const groups = typeof args[args.length - 1] === 'object' ? args[args.length - 1] : null;
        const caps = args.slice(0, groups ? -3 : -2);
        const strip = (v) => trims.reduce((acc, t) => acc.split(t).join(''), v ?? '');
        // 和 String.replace 一样展开 $&、$1、$<name>，被引用的内容先去掉 trimStrings
        return macros(rep, names).replace(/\$(&|\d{1,2}|<[^>]+>)/g, (m, k) => {
            if (k === '&') return strip(caps[0]);
            if (k[0] === '<') return strip(groups?.[k.slice(1, -1)]);
            const i = Number(k);
            return i < caps.length ? strip(caps[i]) : m;
        });
    });
    return { out, hits };
}

/** 酒馆显示消息时会生效的正则：作用于 AI 输出、没被禁用、不是「只改发送内容」 */
export function displayScripts(list) {
    return (list || []).filter((r) => r && !r.disabled && !r.promptOnly && (!r.placement?.length || r.placement.includes(2)));
}

export function applyScripts(text, list, names) {
    let out = String(text ?? '');
    let hits = 0;
    for (const r of displayScripts(list)) {
        const x = runRegex(out, r, names);
        out = x.out;
        hits += x.hits;
    }
    return { out, hits };
}

