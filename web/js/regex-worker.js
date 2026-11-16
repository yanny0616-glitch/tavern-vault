// 在 Worker 里试跑一条正则；页面那边等不到结果就会把这个 Worker 停掉（见 stview.js vetScripts）
import { runRegex } from './stregex.js';

self.onmessage = (e) => {
    const { text, r, names } = e.data;
    let res;
    try { res = runRegex(text, r, names); } catch { res = { out: text, hits: 0 }; }
    self.postMessage({ out: res.out, hits: res.hits });
};
self.postMessage('ready');
