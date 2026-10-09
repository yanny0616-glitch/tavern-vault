// 文本逐行差异（网页和服务端共用，不依赖 DOM）

/** 把长文本切成可比较的片段：多行按行，长段落按句 */
export function tokens(text) {
    const lines = text.split('\n');
    if (lines.length >= 6 || text.length < 160) return lines;
    return text.split(/(?<=[。！？!?.…\n])/).map((s) => s.replace(/\n$/, '')).filter((s, i, a) => s || i < a.length - 1);
}

/** 最长公共子序列，得到 same / del / add 序列；太大时返回 null */
export function lineDiff(a, b) {
    const A = tokens(a);
    const B = tokens(b);
    const n = A.length;
    const m = B.length;
    if (n * m > 4_000_000) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (A[i] === B[j]) { out.push(['same', A[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['del', A[i++]]); else out.push(['add', B[j++]]);
    }
    while (i < n) out.push(['del', A[i++]]);
    while (j < m) out.push(['add', B[j++]]);
    return out;
}

/** 紧凑的统一差异文本：改动行前加 - / +，保留少量上下文，未变化的长段落折叠 */
export function unifiedText(a, b, { context = 1, max = 4000 } = {}) {
    const ops = lineDiff(a || '', b || '');
    if (!ops) return `[旧]\n${(a || '').slice(0, max / 2)}\n[新]\n${(b || '').slice(0, max / 2)}`;
    const keep = new Uint8Array(ops.length);
    ops.forEach(([t], k) => { if (t !== 'same') for (let x = Math.max(0, k - context); x <= Math.min(ops.length - 1, k + context); x++) keep[x] = 1; });
    const out = [];
    let skipped = 0;
    for (let k = 0; k < ops.length; k++) {
        if (!keep[k]) { skipped++; continue; }
        if (skipped) { out.push(`  …（${skipped} 段未变）`); skipped = 0; }
        const [t, s] = ops[k];
        out.push(`${t === 'add' ? '+ ' : t === 'del' ? '- ' : '  '}${s}`);
    }
    if (skipped) out.push(`  …（${skipped} 段未变）`);
    const text = out.join('\n');
    return text.length > max ? `${text.slice(0, max)}\n…（差异过长，已截断）` : text;
}
