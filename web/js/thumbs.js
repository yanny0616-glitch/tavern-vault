// 封面缩略图：列表、详情头图只加载 480 宽的小图。
// 还没有缩略图的封面，第一次显示原图时在浏览器里缩小一张传回服务器，以后就都用小图。
import { api } from './api.js';
import { h } from './ui.js';

const WIDTH = 480;
const queue = [];
const pending = new Set();
let busy = 0;

export function coverSrc(it) {
    return it.thumb ? api.thumbUrl(it.cover) : api.fileUrl(it.cover);
}

export function coverImg(it, props = {}) {
    let original = !it.thumb;
    const img = h('img', {
        src: coverSrc(it), loading: 'lazy', decoding: 'async', alt: '', ...props,
        onload: () => { if (original) makeThumb(img, it); },
        onerror: () => {
            if (original) return;
            original = true;
            it.thumb = false;
            img.src = api.fileUrl(it.cover);
        },
    });
    return img;
}

function makeThumb(img, it) {
    const sha = it.cover;
    if (it.thumb || pending.has(sha) || !img.naturalWidth) return;
    pending.add(sha);
    queue.push({ img, it });
    pump();
}

const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 30)));
const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

async function pump() {
    if (busy >= 2 || !queue.length) return;
    busy++;
    const { img, it } = queue.shift();
    try {
        await idle();
        const scale = Math.min(1, WIDTH / img.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        let blob = await toBlob(c, 'image/webp', 0.82);
        if (!blob || blob.type !== 'image/webp') {
            // iOS Safari 不支持导出 WebP，改用 JPEG（透明部分垫白底）
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            blob = await toBlob(c, 'image/jpeg', 0.85);
        }
        if (blob) {
            await api.putThumb(it.cover, blob);
            it.thumb = true;
        }
    } catch { /* 生成失败下次再试 */ } finally {
        pending.delete(it.cover);
        busy--;
        pump();
    }
}
