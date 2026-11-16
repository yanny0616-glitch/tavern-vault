// 给窗口里的页面三个方法；改服务器地址只有自带的连接页能用（main.js 里按来源检查）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvDesktop', {
    getServer: () => ipcRenderer.invoke('tv:get-server'),
    setServer: (url) => ipcRenderer.invoke('tv:set-server', url),
    changeServer: () => ipcRenderer.invoke('tv:change-server'),
});
