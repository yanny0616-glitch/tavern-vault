// 在 iOS App（Capacitor 外壳）里打开时的原生能力：
// 保存文件走系统分享面板、别的 App 分享过来的文件直接导入、状态栏文字颜色跟随明暗。
// 浏览器和酒馆插件里没有 window.Capacitor，这里什么都不做
const cap = window.Capacitor;
export const native = Boolean(cap?.isNativePlatform?.());

// App 自带的连接页：更换服务器时回到这里
export const LAUNCHER_URL = 'capacitor://localhost/?change=1';

const call = (plugin, method, opts) => cap.nativePromise(plugin, method, opts);

// 3 的倍数：每段单独转 base64 也不会在中间多出补位
const CHUNK = 3 * 1024 * 1024;

function base64Of(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

const safeName = (name) => String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'file';

/** 写进 App 的缓存目录，再弹出系统分享面板（存储到「文件」、存储图像、发给别的 App） */
export async function saveBlob(blob, name) {
    const path = `exports/${safeName(name)}`;
    let uri = '';
    // 大文件分段写，避免一次把几百 MB 的 base64 塞过桥
    for (let at = 0; at === 0 || at < blob.size; at += CHUNK) {
        const data = await base64Of(blob.slice(at, at + CHUNK));
        const r = await call('Filesystem', at ? 'appendFile' : 'writeFile', { path, data, directory: 'CACHE', recursive: true });
        if (!at) uri = r.uri;
    }
    try {
        await call('Share', 'share', { files: [uri] });
    } catch (e) {
        if (!/cancel/i.test(e?.message || '')) throw e;
    }
}

export async function saveUrl(url, name) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await saveBlob(await res.blob(), name);
}

let started = false;

/**
 * onFiles(files)：收到别的 App 分享过来的文件
 * notify(msg, kind)：提示
 */
export function initNative({ onFiles, notify }) {
    if (!native || started) return;
    started = true;

    // 上次分享留下的临时文件
    call('Filesystem', 'rmdir', { path: 'exports', directory: 'CACHE', recursive: true }).catch(() => {});

    // App 里的网页不能直接下载：<a download> 一律改成取回文件再弹分享面板
    document.addEventListener('click', (e) => {
        const a = e.target.closest?.('a[download]');
        if (!a || !/^https?:/i.test(a.href)) return;
        e.preventDefault();
        notify('正在准备文件…');
        saveUrl(a.href, a.getAttribute('download') || a.href.split('?')[0].split('/').pop())
            .catch((err) => notify(`保存失败：${err.message}`, 'err'));
    }, true);

    const syncStatusBar = () => call('StatusBar', 'setStyle', { style: document.documentElement.dataset.mode === 'dark' ? 'DARK' : 'LIGHT' }).catch(() => {});
    new MutationObserver(syncStatusBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    syncStatusBar();

    // 「用藏馆打开」/「拷贝到藏馆」：系统把文件复制进 App 的 Inbox，再通知这里
    // App 冷启动时这条通知会一直留着，直到这里开始监听
    const seen = new Set();
    cap.addListener('App', 'appUrlOpen', async (ev) => {
        const url = ev?.url || '';
        if (!/^file:/i.test(url) || seen.has(url)) return;
        seen.add(url);
        try {
            const { data } = await call('Filesystem', 'readFile', { path: url });
            const blob = await (await fetch(`data:application/octet-stream;base64,${data}`)).blob();
            const name = decodeURIComponent(url.split('/').pop() || 'file');
            call('Filesystem', 'deleteFile', { path: url }).catch(() => {});
            onFiles([new File([blob], name)]);
        } catch (e) {
            notify(`读取分享的文件失败：${e.message}`, 'err');
        }
    });
}
