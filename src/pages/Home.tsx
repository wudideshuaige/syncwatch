import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MonitorPlay, Settings, Server, Wifi, Globe, Copy, Check,
  Lock, Users, Play, Clock, RefreshCw, QrCode, ScanLine, X
} from 'lucide-react';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { getApiBaseUrl, isNativeApp, isElectron, isCapacitor, hasCloudServer, discoverServer, setStoredServerUrl } from '../lib/config';

const SERVER_URL_KEY = 'syncwatch_server_url';
const NICKNAME_KEY = 'syncwatch_nickname';

interface RoomInfo {
  roomId: string;
  hostNickname: string;
  userCount: number;
  isPlaying: boolean;
  hasPassword: boolean;
  screenSharing: boolean;
  createdAt: number;
}

function getStoredServerUrl(): string {
  return localStorage.getItem(SERVER_URL_KEY) || '';
}

function getStoredNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) || '';
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

export default function Home() {
  const navigate = useNavigate();

  // 创建房间
  const [createNickname, setCreateNickname] = useState(getStoredNickname);
  const [createPassword, setCreatePassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 房间列表
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [serverConnected, setServerConnected] = useState<boolean | null>(null); // null=未检测

  // 加入房间（密码弹窗）
  const [passwordModal, setPasswordModal] = useState<{ roomId: string; nickname: string } | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState('');

  // 原生应用服务器设置
  const [serverUrl, setServerUrl] = useState(getStoredServerUrl);
  const [showSettings, setShowSettings] = useState(isNativeApp() && !isElectron());

  // 连接信息（Electron）
  const [localIPs, setLocalIPs] = useState<string[]>([]);
  const [serverPort, setServerPort] = useState(3001);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [copied, setCopied] = useState('');

  // 二维码（桌面端生成）
  const [qrDataUrl, setQrDataUrl] = useState('');

  // 扫码（手机端）
  const [showScanner, setShowScanner] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // 自动发现（手机端）
  const [discovering, setDiscovering] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState('');
  const discoveryAttempted = useRef(false);

  // ---- 获取房间列表 ----
  const fetchRooms = useCallback(async () => {
    try {
      const baseUrl = getApiBaseUrl();
      if (!baseUrl) {
        setServerConnected(false);
        return;
      }
      const res = await fetch(`${baseUrl}/api/rooms/list`);
      const data = await res.json();
      if (data.success) {
        setRooms(data.rooms || []);
        setServerConnected(true);
      }
    } catch {
      setServerConnected(false);
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  // ---- 保存服务器地址 ----
  useEffect(() => {
    if (isNativeApp() && serverUrl) {
      localStorage.setItem(SERVER_URL_KEY, serverUrl);
      // 服务器地址变更后立即刷新房间列表
      fetchRooms();
    }
  }, [serverUrl, fetchRooms]);

  // ---- 手机端：自动发现局域网服务器 ----
  useEffect(() => {
    if (!isCapacitor() || isElectron() || hasCloudServer()) return;
    // 已有配置时不自动发现
    if (getStoredServerUrl()) return;
    // 防止重复执行
    if (discoveryAttempted.current) return;
    discoveryAttempted.current = true;

    setDiscovering(true);
    setDiscoverStatus('正在搜索附近的服务器...');

    discoverServer(3001, (status) => setDiscoverStatus(status))
      .then((url) => {
        if (url) {
          setServerUrl(url);
          setStoredServerUrl(url);
          setDiscoverStatus('');
        } else {
          setDiscoverStatus('未找到附近的服务器');
        }
      })
      .catch(() => {
        setDiscoverStatus('搜索失败');
      })
      .finally(() => {
        setDiscovering(false);
      });
  }, []);

  // ---- Electron: 获取连接信息 ----
  useEffect(() => {
    if (!isElectron()) return;
    const fetchInfo = async () => {
      try {
        const info = await window.electronAPI?.getServerInfo();
        if (info) {
          setLocalIPs(info.lanIPs || []);
          setServerPort(info.serverPort || 3001);
          if (info.tunnelUrl) setTunnelUrl(info.tunnelUrl);
        }
      } catch {}
    };
    fetchInfo();
    const interval = setInterval(fetchInfo, 5000);
    window.electronAPI?.onTunnelReady?.((data) => {
      setTunnelUrl(data.url);
    });
    return () => clearInterval(interval);
  }, []);

  // ---- Electron: 生成二维码 ----
  useEffect(() => {
    if (!isElectron()) return;
    const qrContent = tunnelUrl || (localIPs.length > 0 ? `http://${localIPs[0]}:${serverPort}` : '');
    if (!qrContent) return;
    QRCode.toDataURL(qrContent, {
      width: 180, margin: 2,
      color: { dark: '#ffffff', light: '#00000000' },
    }).then(setQrDataUrl).catch(() => {});
  }, [localIPs, serverPort, tunnelUrl]);

  // ---- 手机端：扫码逻辑 ----
  useEffect(() => {
    if (!showScanner) return;
    const html5QrCode = new Html5Qrcode('qr-reader');
    scannerRef.current = html5QrCode;

    html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        // 扫码成功：解析服务器地址并保存
        let url = decodedText.trim();
        // 如果扫码内容是完整 URL，提取之
        const urlMatch = url.match(/https?:\/\/[^\s"']+/);
        if (urlMatch) url = urlMatch[0];
        if (url.startsWith('http')) {
          setServerUrl(url);
          localStorage.setItem(SERVER_URL_KEY, url);
          setShowScanner(false);
        }
      },
      () => {} // 忽略扫描失败
    ).catch(() => {});

    return () => {
      html5QrCode.stop().catch(() => {});
    };
  }, [showScanner]);

  // ---- Capacitor: 获取局域网 IP ----
  useEffect(() => {
    if (isElectron() || !isNativeApp()) return;
    const fetchServerInfo = async () => {
      try {
        const baseUrl = getApiBaseUrl();
        const res = await fetch(`${baseUrl}/api/server-info`);
        const data = await res.json();
        if (data.success) {
          setLocalIPs(data.localIPs || []);
          setServerPort(data.port || 3001);
        }
      } catch {}
    };
    fetchServerInfo();
    const interval = setInterval(fetchServerInfo, 10000);
    return () => clearInterval(interval);
  }, [serverUrl]);

  // ---- 复制到剪贴板 ----
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  // ---- 创建房间 ----
  const handleCreate = async () => {
    if (!createNickname.trim()) return;
    setLoading(true);
    setError('');
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: createNickname.trim(),
          password: createPassword.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.roomId) {
        localStorage.setItem(NICKNAME_KEY, createNickname.trim());
        navigate(`/room/${data.roomId}`);
      } else {
        setError(data.error || '创建房间失败');
      }
    } catch {
      setError('无法连接服务器，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  // ---- 点击房间卡片加入 ----
  const handleJoinRoom = (room: RoomInfo) => {
    const nickname = getStoredNickname();
    if (!nickname) {
      setError('请先在左侧填写昵称');
      return;
    }
    if (room.hasPassword) {
      setPasswordModal({ roomId: room.roomId, nickname });
      setJoinPassword('');
      setJoinError('');
    } else {
      doJoinRoom(room.roomId, nickname);
    }
  };

  const doJoinRoom = async (roomId: string, nickname: string, password?: string) => {
    setJoinLoading(true);
    setJoinError('');
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname,
          password: password || undefined,
        }),
      });
      const data = await res.json();
      if (res.status === 403) {
        setJoinError('密码错误，请重新输入');
      } else if (data.roomId || res.ok) {
        localStorage.setItem(NICKNAME_KEY, nickname);
        setPasswordModal(null);
        navigate(`/room/${roomId}`);
      } else {
        setJoinError(data.error || '房间不存在或已关闭');
      }
    } catch {
      setJoinError('无法连接服务器，请检查网络连接');
    } finally {
      setJoinLoading(false);
    }
  };

  // ---- 连接信息面板 ----
  const renderConnectionInfo = () => {
    if (!isElectron()) return null;
    // 有云服务器时，简化显示
    if (hasCloudServer()) {
      return (
        <div className="glass rounded-xl p-4 w-full">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cinema-accent" />
            <h3 className="text-sm font-outfit font-semibold text-white">云服务器</h3>
            <span className="flex items-center gap-1.5 text-xs ml-auto">
              {serverConnected ? (
                <span className="text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  已连接
                </span>
              ) : (
                <span className="text-red-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  未连接
                </span>
              )}
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="glass rounded-xl p-4 w-full">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-cinema-accent" />
          <h3 className="text-sm font-outfit font-semibold text-white">连接信息</h3>
          <span className="text-xs text-cinema-muted ml-auto">手机端扫码即可加入</span>
        </div>

        <div className="flex gap-4">
          {/* 左侧：二维码 */}
          {qrDataUrl && (
            <div className="shrink-0 flex flex-col items-center">
              <img src={qrDataUrl} alt="服务器二维码" className="w-[140px] h-[140px] rounded-lg" />
              <span className="text-cinema-muted text-xs mt-1.5">手机扫码连接</span>
            </div>
          )}

          {/* 右侧：地址列表 */}
          <div className="flex-1 min-w-0">
            {localIPs.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 text-cinema-accent text-xs font-semibold mb-1.5">
                  <Wifi className="w-3.5 h-3.5" />
                  局域网地址
                </div>
                {localIPs.map(ip => {
                  const addr = `http://${ip}:${serverPort}`;
                  return (
                    <div key={ip} className="flex items-center gap-2 text-white text-sm font-mono bg-black/30 rounded px-2 py-1.5 mb-1 last:mb-0">
                      <span className="flex-1 truncate">{addr}</span>
                      <button
                        onClick={() => copyToClipboard(addr, `lan-${ip}`)}
                        className="text-cinema-muted hover:text-cinema-accent transition-colors shrink-0"
                      >
                        {copied === `lan-${ip}` ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {tunnelUrl && (
              <div>
                <div className="flex items-center gap-1.5 text-cinema-accent text-xs font-semibold mb-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  公网隧道地址
                </div>
                <div className="flex items-center gap-2 text-white text-sm font-mono bg-black/30 rounded px-2 py-1.5">
                  <span className="flex-1 truncate">{tunnelUrl}</span>
                  <button
                    onClick={() => copyToClipboard(tunnelUrl, 'tunnel')}
                    className="text-cinema-muted hover:text-cinema-accent transition-colors shrink-0"
                  >
                    {copied === 'tunnel' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {!qrDataUrl && localIPs.length === 0 && (
          <p className="text-cinema-muted text-xs">正在获取连接信息...</p>
        )}
      </div>
    );
  };

  // ---- Capacitor 服务器设置 ----
  const renderServerSettings = () => {
    if (!isNativeApp() || isElectron()) return null;
    // 有云服务器时，不需要用户配置
    if (hasCloudServer()) return null;
    if (showSettings) {
      return (
        <div className="glass rounded-xl p-4 w-full">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-cinema-accent" />
            <h3 className="text-sm font-outfit font-semibold text-white">服务器设置</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="ml-auto text-cinema-muted hover:text-white text-xs"
            >
              收起
            </button>
          </div>

          {/* 扫码按钮（醒目） */}
          <button
            onClick={() => setShowScanner(true)}
            className="w-full flex items-center justify-center gap-2 bg-cinema-accent text-cinema-bg font-semibold py-2.5 rounded-lg mb-3 hover:shadow-[0_0_20px_rgba(0,212,255,0.4)] transition-all text-sm"
          >
            <ScanLine className="w-5 h-5" />
            扫描电脑端二维码
          </button>

          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-cinema-muted text-xs">或手动输入</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="例如: http://192.168.1.100:3001"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-cinema-muted focus:outline-none focus:border-cinema-accent transition-colors"
            />
            <button
              onClick={() => localStorage.setItem(SERVER_URL_KEY, serverUrl)}
              className="bg-cinema-accent/20 text-cinema-accent text-sm px-4 py-2 rounded-lg hover:bg-cinema-accent/30 transition-colors"
            >
              保存
            </button>
          </div>

          {serverUrl && (
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-green-400">已配置: {serverUrl}</span>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowScanner(true)}
          className="flex items-center gap-1.5 bg-cinema-accent/20 text-cinema-accent px-3 py-1.5 rounded-lg hover:bg-cinema-accent/30 transition-colors text-sm font-medium"
        >
          <ScanLine className="w-4 h-4" />
          扫码连接
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="text-cinema-muted hover:text-cinema-accent transition-colors flex items-center gap-1 text-sm"
        >
          <Settings className="w-4 h-4" />
          手动设置
        </button>
      </div>
    );
  };

  // ---- 扫码弹窗 ----
  const renderScannerModal = () => {
    if (!showScanner) return null;
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="relative w-full max-w-sm mx-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-outfit font-semibold text-white flex items-center gap-2">
              <QrCode className="w-5 h-5 text-cinema-accent" />
              扫描二维码
            </h3>
            <button
              onClick={() => setShowScanner(false)}
              className="text-cinema-muted hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="glass rounded-xl overflow-hidden">
            <div id="qr-reader" className="w-full" style={{ minHeight: 300 }} />
          </div>
          <p className="text-cinema-muted text-xs text-center mt-3">
            将手机对准电脑端 SyncWatch 上显示的二维码
          </p>
        </div>
      </div>
    );
  };

  // ---- 密码弹窗 ----
  const renderPasswordModal = () => {
    if (!passwordModal) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => { if (!joinLoading) setPasswordModal(null); }}
      >
        <div className="glass rounded-2xl p-6 w-full max-w-sm mx-4 neon-glow"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-cinema-accent" />
            <h3 className="text-lg font-outfit font-semibold text-white">该房间需要密码</h3>
          </div>
          {joinError && (
            <div className="bg-red-500/20 text-red-300 text-sm px-3 py-2 rounded-lg mb-3">
              {joinError}
            </div>
          )}
          <input
            type="password"
            placeholder="输入房间密码"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doJoinRoom(passwordModal.roomId, passwordModal.nickname, joinPassword.trim());
            }}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-cinema-muted focus:outline-none focus:border-cinema-accent transition-colors mb-4"
            autoFocus
          />
          <div className="flex gap-3">
            <button
              onClick={() => setPasswordModal(null)}
              disabled={joinLoading}
              className="flex-1 bg-white/5 text-white py-2.5 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={() => doJoinRoom(passwordModal.roomId, passwordModal.nickname, joinPassword.trim())}
              disabled={joinLoading || !joinPassword.trim()}
              className="flex-1 bg-cinema-accent text-cinema-bg font-outfit font-semibold py-2.5 rounded-lg hover:shadow-[0_0_20px_rgba(0,212,255,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {joinLoading ? '加入中...' : '确认加入'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-cinema-bg">
      {/* 背景光球 */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-cinema-accent/20 rounded-full blur-[120px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[150px] animate-pulse pointer-events-none" style={{ animationDelay: '1s' }} />

      {/* Electron 连接信息顶部面板 */}
      {isElectron() && (
        <div className="relative z-10 px-4 pt-4">
          {renderConnectionInfo()}
        </div>
      )}

      {/* 主内容：左右分栏 */}
      <div className="relative z-10 flex flex-col lg:flex-row min-h-[calc(100vh-8rem)] lg:min-h-screen">
        {/* 左侧：创建房间（紧凑） */}
        <div className="w-full lg:w-80 xl:w-96 shrink-0 p-4 lg:p-6 flex flex-col gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-2">
            <MonitorPlay className="w-10 h-10 text-cinema-accent" />
            <h1 className="text-3xl lg:text-4xl font-outfit font-bold neon-text text-white">
              SyncWatch
            </h1>
          </div>
          <p className="text-cinema-muted text-sm -mt-2 mb-2">和朋友一起，实时同步观影</p>

          {/* Capacitor 服务器设置 */}
          {renderServerSettings()}

          {/* 创建房间表单 */}
          <div className="glass rounded-xl p-5 neon-glow">
            <h2 className="text-lg font-outfit font-semibold text-white mb-4">创建房间</h2>
            {error && (
              <div className="bg-red-500/20 text-red-300 text-sm px-3 py-2 rounded-lg mb-3">
                {error}
              </div>
            )}
            <input
              type="text"
              placeholder="你的昵称"
              value={createNickname}
              onChange={(e) => setCreateNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-cinema-muted focus:outline-none focus:border-cinema-accent transition-colors mb-3 text-sm"
            />
            <input
              type="password"
              placeholder="房间密码（可选）"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-cinema-muted focus:outline-none focus:border-cinema-accent transition-colors mb-4 text-sm"
            />
            <button
              onClick={handleCreate}
              disabled={loading || !createNickname.trim()}
              className="w-full bg-cinema-accent text-cinema-bg font-outfit font-semibold py-2.5 rounded-lg hover:shadow-[0_0_20px_rgba(0,212,255,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {loading ? '创建中...' : '创建房间'}
            </button>
          </div>
        </div>

        {/* 右侧：观影厅列表（主要空间） */}
        <div className="flex-1 p-4 lg:p-6 lg:pl-2 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-outfit font-semibold text-white flex items-center gap-2">
              <MonitorPlay className="w-5 h-5 text-cinema-accent" />
              观影厅
            </h2>
            <div className="flex items-center gap-3">
              {/* 服务器连接状态 */}
              <div className="flex items-center gap-1.5 text-xs">
                {serverConnected === true ? (
                  <span className="flex items-center gap-1 text-green-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    已连接
                  </span>
                ) : serverConnected === false ? (
                  <span className="flex items-center gap-1 text-red-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    未连接
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-cinema-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-cinema-muted animate-pulse" />
                    检测中
                  </span>
                )}
                <span className="text-cinema-muted font-mono">({getApiBaseUrl() || '未配置'})</span>
              </div>
              <button
                onClick={fetchRooms}
                className="text-cinema-muted hover:text-cinema-accent transition-colors flex items-center gap-1 text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${roomsLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
          </div>

          {roomsLoading && rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-cinema-muted">
              <RefreshCw className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm">正在加载房间列表...</p>
            </div>
          ) : !getApiBaseUrl() ? (
            <div className="flex flex-col items-center justify-center py-20 text-cinema-muted">
              <Server className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg font-outfit mb-1">未连接服务器</p>
              <p className="text-sm mb-4">请先扫码或手动输入服务器地址</p>
              {isNativeApp() && !isElectron() && (
                <button
                  onClick={() => setShowScanner(true)}
                  className="flex items-center gap-2 bg-cinema-accent text-cinema-bg font-semibold px-6 py-2.5 rounded-lg hover:shadow-[0_0_20px_rgba(0,212,255,0.4)] transition-all text-sm"
                >
                  <ScanLine className="w-5 h-5" />
                  扫码连接
                </button>
              )}
            </div>
          ) : serverConnected === false ? (
            <div className="flex flex-col items-center justify-center py-20 text-cinema-muted">
              <Server className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg font-outfit mb-1">无法连接服务器</p>
              <p className="text-sm mb-2">服务器地址: <span className="font-mono text-white">{getApiBaseUrl()}</span></p>
              <p className="text-sm mb-4">请检查网络连接和服务器地址是否正确</p>
              {isNativeApp() && !isElectron() && (
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-2 bg-cinema-accent/20 text-cinema-accent px-4 py-2 rounded-lg hover:bg-cinema-accent/30 transition-colors text-sm"
                >
                  <Settings className="w-4 h-4" />
                  修改服务器地址
                </button>
              )}
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-cinema-muted">
              <MonitorPlay className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg font-outfit mb-1">还没有人创建房间</p>
              <p className="text-sm">在左侧创建一个房间，邀请朋友一起观影吧</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {rooms.map((room, idx) => (
                <div
                  key={room.roomId}
                  onClick={() => handleJoinRoom(room)}
                  className="glass rounded-xl p-4 neon-glow cursor-pointer group
                    transition-all duration-300 hover:scale-[1.02] hover:border-cinema-accent/30"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  {/* 顶部：房主 + 状态 */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-cinema-accent/20 flex items-center justify-center shrink-0">
                        <span className="text-cinema-accent text-sm font-semibold">
                          {room.hostNickname.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{room.hostNickname}的房间</p>
                        <div className="flex items-center gap-2 text-xs text-cinema-muted">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {room.userCount}
                          </span>
                          {room.hasPassword && (
                            <Lock className="w-3 h-3 text-amber-400" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 状态标签 */}
                    <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full shrink-0 ${
                      room.isPlaying
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {room.isPlaying ? (
                        <><Play className="w-3 h-3" />播放中</>
                      ) : (
                        <><Clock className="w-3 h-3" />等待中</>
                      )}
                    </span>
                  </div>

                  {/* 底部：创建时间 + 屏幕共享 */}
                  <div className="flex items-center justify-between text-xs text-cinema-muted">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(room.createdAt)}
                    </span>
                    {room.screenSharing && (
                      <span className="flex items-center gap-1 text-cinema-accent">
                        <MonitorPlay className="w-3 h-3" />
                        投屏中
                      </span>
                    )}
                  </div>

                  {/* 点击加入提示 */}
                  <div className="mt-3 pt-3 border-t border-white/5 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <span className="text-cinema-accent text-xs font-medium">
                      {room.hasPassword ? '点击输入密码加入' : '点击加入房间'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 密码弹窗 */}
      {renderPasswordModal()}

      {/* 扫码弹窗 */}
      {renderScannerModal()}
    </div>
  );
}
