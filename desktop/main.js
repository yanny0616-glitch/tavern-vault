// 酒馆藏馆 Windows 桌面版：一个很薄的外壳。
// 窗口里打开的就是你的藏馆服务器上的网页，所以服务端更新后这里马上是新界面，不用重新下载。
// 第一次打开先到 launcher.html 填服务器地址；只有这个地址在窗口里打开，别的链接交给系统浏览器。
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = path.join(__dirname, 'launcher.html');
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
let cfg = {};
const loadCfg = () => { try { cfg = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) || {}; } catch { cfg = {}; } };
const saveCfg = () => { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(cfg)); } catch { /* 存不了就下次再填 */ } };

/** 只认 http(s) 地址，统一成「协议 + 主机 + 端口」 */
const originOf = (url) => { try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; } };
const isLauncher = (url) => { try { const u = new URL(String(url)); return u.protocol === 'file:' && path.resolve(decodeURIComponent(u.pathname).replace(/^\/([a-zA-Z]:)/, '$1')) === path.resolve(LAUNCHER); } catch { return false; } };
const isServer = (url) => Boolean(cfg.server) && originOf(url) === cfg.server;
const openOutside = (url) => { if (originOf(url)) shell.openExternal(url); };

let win = null;
const showLauncher = (change = false) => win?.loadFile(LAUNCHER, change ? { query: { change: '1' } } : {});

function createWindow() {
    const b = cfg.bounds || {};
    win = new BrowserWindow({
        width: b.width || 1240, height: b.height || 860, x: b.x, y: b.y,
        minWidth: 380, minHeight: 560,
        title: '酒馆藏馆', backgroundColor: '#14111c', autoHideMenuBar: true,
        icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    if (cfg.maximized) win.maximize();
    const wc = win.webContents;

    // 窗口里只能去两个地方：自带的连接页、保存的藏馆服务器
    const guard = (e, url) => { if (!isLauncher(url) && !isServer(url)) { e.preventDefault(); openOutside(url); } };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url }) => {
        if (isServer(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
        openOutside(url);
        return { action: 'deny' };
    });
    // 服务器连不上（断网、服务停了）：回到连接页，那里会显示原因和「重试」
    wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => { if (isMainFrame && code !== -3 && !isLauncher(url)) showLauncher(); });
    wc.on('page-title-updated', (e) => e.preventDefault());

    const remember = () => {
        if (!win || win.isDestroyed()) return;
        cfg.maximized = win.isMaximized();
        if (!cfg.maximized && !win.isMinimized()) cfg.bounds = win.getBounds();
    };
    win.on('close', () => { remember(); saveCfg(); });
    win.on('closed', () => { win = null; });
    showLauncher();
}

// 连接页和藏馆网页能调用的三件事（见 preload.js）
ipcMain.handle('tv:get-server', () => cfg.server || '');
ipcMain.handle('tv:set-server', (e, url) => {
    // 只有自带的连接页可以改服务器地址；藏馆网页（或它里面的内容）不行
    if (!isLauncher(e.senderFrame?.url)) throw new Error('只能在连接页里更换服务器');
    const origin = originOf(url);
    if (!origin) throw new Error('地址不正确');
    cfg.server = origin;
    saveCfg();
});
ipcMain.handle('tv:change-server', (e) => { if (isLauncher(e.senderFrame?.url) || isServer(e.senderFrame?.url)) showLauncher(true); });

function buildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: '藏馆', submenu: [
            { label: '刷新', accelerator: 'F5', click: () => win?.webContents.reload() },
            { label: '更换服务器…', click: () => showLauncher(true) },
            { type: 'separator' },
            { label: '退出', role: 'quit' },
        ] },
        { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
        { label: '视图', submenu: [
            { label: '放大', role: 'zoomIn', accelerator: 'CmdOrCtrl+=' }, { label: '缩小', role: 'zoomOut' }, { label: '实际大小', role: 'resetZoom' },
            { type: 'separator' },
            { label: '全屏', role: 'togglefullscreen' },
            { label: '开发者工具', role: 'toggleDevTools' },
        ] },
    ]));
}

// 只开一个窗口：再点一次图标就把已有的窗口拿到前面
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
    app.whenReady().then(() => { loadCfg(); buildMenu(); createWindow(); });
    app.on('window-all-closed', () => app.quit());
}
