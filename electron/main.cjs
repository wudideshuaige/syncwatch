const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, session, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

// 开发模式下将 userData 指向项目目录内，避免沙箱权限问题
const isDev = !app.isPackaged;
if (isDev) {
  const devDataDir = path.join(__dirname, '../.electron-dev');
  if (!fs.existsSync(devDataDir)) fs.mkdirSync(devDataDir, { recursive: true });
  app.setPath('userData', devDataDir);
}

// 注册自定义协议 app://，用于生产模式加载本地文件
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

// ============ 内嵌后端服务器 ============
let serverProcess = null;
let tunnelProcess = null;
let tunnelUrl = '';
let serverPort = 3001;
let lanIPs = [];

// 是否使用云服务器（设为此环境变量后跳过本地服务器和隧道）
const cloudUrl = process.env.SYNCWATCH_CLOUD_URL || '';
const useCloudServer = !!cloudUrl;

// 获取局域网 IP
function getLanIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// 启动内嵌后端服务器
function startEmbeddedServer() {
  return new Promise((resolve, reject) => {
    // 检查端口是否已被占用（外部后端已在运行）
    const net = require('net');
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log('[Server] Port 3001 already in use, using existing server');
        resolve(true);
      } else {
        reject(err);
      }
    });
    tester.once('listening', () => {
      tester.close();
      // 端口空闲，启动内嵌服务器
      const projectRoot = path.join(__dirname, '..');
      const tsxPath = path.join(projectRoot, 'node_modules', '.bin', 'tsx');

      console.log('[Server] Starting embedded server...');
      serverProcess = spawn(tsxPath, [path.join(projectRoot, 'api', 'server.ts')], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(serverPort) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      serverProcess.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        console.log('[Server]', msg);
        if (msg.includes('Server ready') || msg.includes('listening')) {
          resolve(true);
        }
      });

      serverProcess.stderr.on('data', (data) => {
        console.error('[Server]', data.toString().trim());
      });

      serverProcess.on('error', (err) => {
        console.error('[Server] Failed to start:', err);
        reject(err);
      });

      // 超时保护
      setTimeout(() => resolve(true), 10000);
    });
    tester.listen(serverPort, '0.0.0.0');
  });
}

// 启动 Cloudflare 隧道
function startTunnel() {
  return new Promise((resolve) => {
    // 检查 cloudflared 是否存在
    let cfPath = 'cloudflared';
    try {
      // Windows 上检查常见安装路径
      const possiblePaths = [
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
        path.join(process.env.ProgramFiles || '', 'cloudflared', 'cloudflared.exe'),
        'cloudflared',
      ];
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) { cfPath = p; break; }
      }
    } catch {}

    console.log('[Tunnel] Starting Cloudflare tunnel...');
    tunnelProcess = spawn(cfPath, ['tunnel', '--url', `http://localhost:${serverPort}`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let resolved = false;
    tunnelProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      const match = msg.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        tunnelUrl = match[0];
        resolved = true;
        console.log('[Tunnel] Public URL:', tunnelUrl);
        // 通知渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tunnel:ready', { url: tunnelUrl });
        }
        resolve(tunnelUrl);
      }
    });

    tunnelProcess.on('error', (err) => {
      console.warn('[Tunnel] Failed to start (cloudflared may not be installed):', err.message);
      resolve('');
    });

    // 超时保护
    setTimeout(() => {
      if (!resolved) resolve('');
    }, 30000);
  });
}

// ============ 窗口管理 ============
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'SyncWatch - 同步观影',
    icon: path.join(__dirname, '../public/favicon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  // 隐藏默认菜单栏
  Menu.setApplicationMenu(null);

  // 屏幕共享需要授予完整媒体权限
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'clipboard-read', 'clipboard-write'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL('app://./index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============ IPC 通信 ============

// 处理屏幕共享源枚举请求
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.toDataURL() || null,
    }));
  } catch (err) {
    console.error('[Electron] Failed to get desktop sources:', err);
    return [];
  }
});

// 获取服务器连接信息（前端调用）
ipcMain.handle('get-server-info', () => {
  return {
    serverPort,
    lanIPs: getLanIPs(),
    tunnelUrl,
    isServerEmbedded: !!serverProcess,
  };
});

// 启动隧道（前端可手动触发）
ipcMain.handle('start-tunnel', async () => {
  if (tunnelUrl) return tunnelUrl;
  const url = await startTunnel();
  return url;
});

// ============ 应用生命周期 ============

app.whenReady().then(async () => {
  if (!isDev) {
    const distPath = path.join(__dirname, '../dist');
    protocol.handle('app', (request) => {
      const urlPath = new URL(request.url).pathname;
      const decodedPath = decodeURIComponent(urlPath);
      const filePath = path.join(distPath, decodedPath);
      return net.fetch('file://' + filePath);
    });
  }

  if (useCloudServer) {
    // 云服务器模式：跳过本地服务器和隧道
    console.log('[Main] Cloud server mode:', cloudUrl);
    tunnelUrl = cloudUrl;
  } else {
    // 本地模式：启动内嵌后端 + 隧道
    try {
      await startEmbeddedServer();
      console.log('[Main] Embedded server ready');
    } catch (err) {
      console.error('[Main] Failed to start embedded server:', err);
    }

    lanIPs = getLanIPs();

    // 异步启动隧道（不阻塞窗口显示）
    startTunnel().then((url) => {
      if (url) {
        console.log('[Main] Tunnel ready:', url);
      } else {
        console.log('[Main] Tunnel not available (cloudflared not installed or timed out)');
      }
    });
  }

  createWindow();
});

app.on('window-all-closed', () => {
  // 清理子进程
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
});
