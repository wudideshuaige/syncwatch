const { contextBridge, ipcRenderer } = require('electron');

// 向渲染进程暴露安全的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 判断是否在 Electron 环境中运行
  isElectron: true,

  // 获取可共享的桌面源列表（用于屏幕共享选择）
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  // 获取服务器连接信息（端口、局域网IP、公网隧道地址）
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),

  // 手动启动隧道
  startTunnel: () => ipcRenderer.invoke('start-tunnel'),

  // 监听隧道就绪事件
  onTunnelReady: (callback) => {
    ipcRenderer.on('tunnel:ready', (_event, data) => callback(data));
  },

  // 平台信息
  platform: process.platform,
});
