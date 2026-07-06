/**
 * SyncWatch 运行环境配置
 *
 * - 云服务器模式: VITE_API_BASE_URL 设置公网地址，所有设备零配置即用
 * - Web 开发模式: Vite 代理 /api → localhost:3001
 * - Electron: 内嵌后端自动启动，自动使用 localhost:3001
 * - Capacitor (Android/iOS): 自动发现局域网服务器 / 扫码 / 手动输入
 */

// 优先使用环境变量配置的后端地址（云部署时设置此值）
const ENV_API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

// localStorage 中用户配置的服务器地址（手机端使用）
const SERVER_URL_KEY = 'syncwatch_server_url';
function getStoredServerUrl(): string {
  try {
    return localStorage.getItem(SERVER_URL_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * 保存服务器地址到 localStorage
 */
export function setStoredServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_URL_KEY, url);
  } catch {}
}

/**
 * 判断是否已配置公网云服务器
 */
export function hasCloudServer(): boolean {
  return !!ENV_API_BASE;
}

/**
 * 使用 WebRTC 获取本机局域网 IP
 */
async function getLocalIP(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));

      const timeout = setTimeout(() => {
        pc.close();
        resolve(null);
      }, 3000);

      pc.onicecandidate = (event) => {
        if (!event?.candidate?.candidate) return;
        const match = event.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (match && !match[1].startsWith('0.')) {
          clearTimeout(timeout);
          pc.close();
          resolve(match[1]);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * 自动发现局域网内的 SyncWatch 服务器
 * 扫描常见子网段的指定端口，寻找响应 /api/server-info 的服务器
 */
export async function discoverServer(
  port = 3001,
  onProgress?: (status: string) => void
): Promise<string | null> {
  onProgress?.('正在获取网络信息...');

  const localIP = await getLocalIP();
  const subnets = new Set<string>();

  // 优先扫描本机所在子网
  if (localIP && /^\d+\.\d+\.\d+\.\d+$/.test(localIP)) {
    const parts = localIP.split('.');
    subnets.add(parts.slice(0, 3).join('.'));
  }

  // 常见子网作为备选
  const commonSubnets = [
    '192.168.1', '192.168.0', '192.168.31', '192.168.2',
    '192.168.3', '192.168.4', '10.0.0', '172.16.0',
  ];
  for (const s of commonSubnets) {
    if (!subnets.has(s)) subnets.add(s);
  }

  const subnetList = Array.from(subnets);

  for (const subnet of subnetList) {
    onProgress?.(`正在搜索 ${subnet}.x ...`);

    // 并行扫描整个子网，每批30个
    const batchSize = 30;
    for (let start = 1; start <= 254; start += batchSize) {
      const promises: Promise<string | null>[] = [];
      for (let i = start; i < Math.min(start + batchSize, 255); i++) {
        const url = `http://${subnet}.${i}:${port}`;
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 2000);

        promises.push(
          fetch(`${url}/api/server-info`, { signal: controller.signal })
            .then(async (res) => {
              clearTimeout(tid);
              try {
                const data = await res.json();
                if (data.success) return url;
              } catch {}
              return null;
            })
            .catch(() => {
              clearTimeout(tid);
              return null;
            })
        );
      }

      const results = await Promise.all(promises);
      const found = results.find((r) => r !== null);
      if (found) return found;
    }
  }

  return null;
}

/**
 * 获取实际使用的后端地址（综合环境变量 + localStorage + 自动检测）
 */
function resolveApiBase(): string {
  // 1. 环境变量优先级最高（云服务器地址）
  if (ENV_API_BASE) return ENV_API_BASE;
  // 2. Electron 环境下，内嵌后端自动运行在 localhost:3001
  if (isElectron()) return 'http://localhost:3001';
  // 3. Capacitor 环境下，使用 localStorage 存储的用户配置
  const stored = getStoredServerUrl();
  if (stored) return stored;
  // 4. 自动检测
  return '';
}

/** 判断是否在 Capacitor 原生应用中运行 */
export function isCapacitor(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

/** 判断是否在 Electron 环境中运行 */
export function isElectron(): boolean {
  return !!window.electronAPI?.isElectron;
}

/** 判断是否在原生应用中运行（Electron 或 Capacitor） */
export function isNativeApp(): boolean {
  return isElectron() || isCapacitor();
}

/**
 * 获取 API 基础 URL
 */
export function getApiBaseUrl(): string {
  const resolved = resolveApiBase();
  if (resolved) return resolved;
  // 注意：Capacitor 环境下 localhost 指向手机自身，不能作为回退地址
  return '';
}

/**
 * 获取 Socket.IO 连接 URL
 */
export function getSocketUrl(): string | undefined {
  const resolved = resolveApiBase();
  if (resolved) return resolved;
  // Web 开发模式：局域网直连后端
  if (import.meta.env.DEV && window.location.port === '5173') {
    return `http://${window.location.hostname}:3001`;
  }
  // Web 生产模式 / Capacitor：同源
  return undefined;
}
