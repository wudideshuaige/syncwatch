import { useEffect, useRef, useState, useMemo, useCallback, Component, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Copy, LogOut, Users, Play, Pause, Volume2, VolumeX, Send, Link as LinkIcon, RefreshCw, Info, Monitor, MonitorOff, Maximize, Minimize, MessageSquare, Mic, MicOff, Headphones, Phone, PhoneOff, Smile, Shield, Wifi, WifiOff } from 'lucide-react';
import { useRoomStore, type ChatMessage, hashNickname } from '@/stores/roomStore';
import { QUALITY_PRESETS, type QualityPreset } from '@/stores/roomStore';
import { parseVideoUrl, isPlatformVideo } from '@/utils/videoUrl';

// Error Boundary 防止 React DOM 协调错误导致白屏
class RoomErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    console.error('[SyncWatch ErrorBoundary]', error);
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: 'white', background: '#1a1a2e', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>页面出错了</h2>
          <p style={{ color: '#8b8b9e', marginBottom: 8 }}>{this.state.error}</p>
          <p style={{ color: '#8b8b9e', marginBottom: 24, fontSize: 14 }}>可能是浏览器扩展干扰了页面，请尝试禁用翻译/广告拦截等扩展</p>
          <button onClick={() => window.location.reload()} style={{ background: '#00d4ff', color: '#0a0a0f', border: 'none', padding: '12px 32px', borderRadius: 8, fontSize: 16, cursor: 'pointer', fontWeight: 'bold' }}>
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ====== 消息提示音 ======
let audioCtx: AudioContext | null = null;
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.25);
  } catch {}
}

// ====== Emoji 选项 ======
const EMOJI_OPTIONS = ['😂', '❤️', '🔥', '👍', '😮', '😢', '🎉', '💀'];

export { RoomErrorBoundary };

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const voiceAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const prevMsgCountRef = useRef(0);
  const [chatInput, setChatInput] = useState('');
  const [videoInput, setVideoInput] = useState('');
  const [videoVolume, setVideoVolume] = useState(() => {
    const saved = localStorage.getItem('syncwatch_videoVolume');
    return saved ? Number(saved) : 1;
  });
  const [voiceVolume, setVoiceVolume] = useState(() => {
    const saved = localStorage.getItem('syncwatch_voiceVolume');
    return saved ? Number(saved) : 1;
  });
  const [copied, setCopied] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [connectionStats, setConnectionStats] = useState<{ bitrate: string; fps: string; latency: string } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [floatingEmoji, setFloatingEmoji] = useState<{ emoji: string; nickname: string; id: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isSyncingRef = useRef(false);

  const {
    nickname, isHost, videoUrl, isPlaying, currentTime,
    users, messages, connected, syncRefreshTrigger,
    screenSharing, screenQuality, localStream, remoteStream,
    voiceChatEnabled, micMuted, speakerMuted, micStream, voiceStreams, voiceUsers,
    userColors, emojiReaction, connectionQuality, isReconnecting, roomPassword,
    connect, disconnect, setVideoUrl, play, pause, seek, sendMessage, syncRefresh,
    startScreenShare, stopScreenShare, setScreenQuality,
    joinVoiceChat, leaveVoiceChat, toggleMic, toggleSpeaker,
    sendEmojiReaction, setConnectionQuality, setIsReconnecting, setRoomPassword,
  } = useRoomStore();

  const videoInfo = useMemo(() => {
    if (!videoUrl) return null;
    return parseVideoUrl(videoUrl);
  }, [videoUrl]);

  const isPlatform = videoInfo ? isPlatformVideo(videoInfo.type) : false;

  // 连接 socket
  const connectRef = useRef(false);
  useEffect(() => {
    if (!roomId || connectRef.current) return;
    connectRef.current = true;
    const name = localStorage.getItem('syncwatch_nickname') || '匿名用户';
    connect(roomId, name);
    // 恢复画质设置
    const savedQuality = localStorage.getItem('syncwatch_screenQuality') as QualityPreset | null;
    if (savedQuality && QUALITY_PRESETS[savedQuality]) {
      setScreenQuality(savedQuality);
    }
    return () => {
      disconnect();
      connectRef.current = false;
    };
  }, [roomId]);

  // 保存设置到 localStorage（房间状态记忆）
  useEffect(() => {
    localStorage.setItem('syncwatch_videoVolume', String(videoVolume));
  }, [videoVolume]);
  useEffect(() => {
    localStorage.setItem('syncwatch_voiceVolume', String(voiceVolume));
  }, [voiceVolume]);
  useEffect(() => {
    localStorage.setItem('syncwatch_screenQuality', screenQuality);
  }, [screenQuality]);

  // ====== 消息提示音 ======
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current && prevMsgCountRef.current > 0) {
      const lastMsg = messages[messages.length - 1];
      // 只有非自己发的非系统消息才提示
      if (!lastMsg.isSystem && lastMsg.nickname !== nickname) {
        playNotificationSound();
      }
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, nickname]);

  // ====== Emoji reaction 浮动动画 ======
  useEffect(() => {
    if (!emojiReaction) return;
    setFloatingEmoji({ emoji: emojiReaction.emoji, nickname: emojiReaction.nickname, id: emojiReaction.id });
    const timer = setTimeout(() => setFloatingEmoji(null), 3000);
    return () => clearTimeout(timer);
  }, [emojiReaction]);

  // ====== 全屏状态监听 ======
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // ====== 竖屏/横屏自适应 ======
  useEffect(() => {
    const handleOrientationChange = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      if (isLandscape && screenSharing) {
        // 横屏时自动全屏
        const el = screenVideoRef.current?.parentElement?.parentElement;
        if (el && !document.fullscreenElement) {
          el.requestFullscreen?.().catch(() => {});
        }
      }
    };
    screen.orientation?.addEventListener('change', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      screen.orientation?.removeEventListener('change', handleOrientationChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [screenSharing]);

  // ====== ICE 连接质量监控 ======
  const hasConnectedRef = useRef(false);
  useEffect(() => {
    if (!screenSharing) {
      setConnectionQuality(null);
      setIsReconnecting(false);
      hasConnectedRef.current = false;
      return;
    }
    const interval = setInterval(async () => {
      try {
        let pc: RTCPeerConnection | undefined;
        if (isHost) {
          const hostPCs = (window as any).__hostPeerConnections as Map<string, RTCPeerConnection> | undefined;
          pc = hostPCs?.values().next().value;
        } else {
          pc = (window as any).__participantPc as RTCPeerConnection | undefined;
        }
        if (!pc) return;

        const iceState = pc.iceConnectionState;

        // 记录是否曾经连接成功过
        if (iceState === 'connected' || iceState === 'completed') {
          hasConnectedRef.current = true;
        }

        // 只在曾经连接成功后又断开的情况下才提示重连
        if ((iceState === 'failed' || iceState === 'disconnected') && hasConnectedRef.current) {
          setConnectionQuality('poor');
          setIsReconnecting(true);
          try {
            await pc.restartIce();
          } catch {}
        } else if (iceState === 'connected' || iceState === 'completed') {
          setIsReconnecting(false);
          // 通过 stats 判断质量
          const stats = await pc.getStats();
          let totalBytes = 0, totalFrames = 0;
          stats.forEach((report: any) => {
            const isTarget = isHost
              ? (report.type === 'outbound-rtp' && report.kind === 'video')
              : (report.type === 'inbound-rtp' && report.kind === 'video');
            if (isTarget) {
              totalBytes += (isHost ? report.bytesSent : report.bytesReceived) || 0;
              totalFrames += (isHost ? report.framesEncoded : report.framesDecoded) || 0;
            }
          });
          const prevBytes = (window as any).__prevBytes || 0;
          const prevFrames = (window as any).__prevFrames || 0;
          const deltaBytes = totalBytes - prevBytes;
          const deltaFrames = totalFrames - prevFrames;
          (window as any).__prevBytes = totalBytes;
          (window as any).__prevFrames = totalFrames;
          const kbps = Math.round(deltaBytes * 8 / 1000);
          const fps = Math.round(deltaFrames / 2);

          if (fps < 5 || kbps < 100) {
            setConnectionQuality('poor');
          } else if (fps < 15 || kbps < 500) {
            setConnectionQuality('fair');
          } else {
            setConnectionQuality('good');
          }

          setConnectionStats({
            bitrate: kbps > 1000 ? `${(kbps / 1000).toFixed(1)}Mbps` : `${kbps}kbps`,
            fps: `${fps}fps`,
            latency: '-',
          });
        }
        // new / checking 状态：连接正在建立中，不显示任何提示
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [isHost, screenSharing]);

  // 房主：将本地屏幕共享流绑定到 video 元素
  useEffect(() => {
    if (isHost && screenSharing && localStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = localStream;
    }
  }, [isHost, screenSharing, localStream]);

  // 参与者：将远程流绑定到 video 元素
  useEffect(() => {
    if (!isHost && remoteStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = remoteStream;
    }
  }, [isHost, remoteStream]);

  // 补帧渲染：用 Canvas 平滑绘制视频帧（参与者端）
  useEffect(() => {
    if (isHost || !screenSharing || !remoteStream) return;
    const video = screenVideoRef.current;
    const canvas = frameCanvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;

    const renderFrame = () => {
      rafId = requestAnimationFrame(renderFrame);
      if (video.readyState < 2) return;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [isHost, screenSharing, remoteStream]);

  // ====== 语音通话：将远程语音流绑定到 <audio> 元素 ======
  useEffect(() => {
    voiceStreams.forEach((stream, socketId) => {
      let audio = voiceAudioRefs.current.get(socketId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.setAttribute('playsinline', '');
        document.body.appendChild(audio);
        audio.style.display = 'none';
        voiceAudioRefs.current.set(socketId, audio);
      }
      if (audio.srcObject !== stream) {
        audio.srcObject = stream;
      }
      audio.volume = voiceVolume;
      audio.muted = speakerMuted;
      if (!speakerMuted && audio.paused) {
        audio.play().catch(() => {});
      }
    });

    voiceAudioRefs.current.forEach((audio, socketId) => {
      if (!voiceStreams.has(socketId)) {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
        voiceAudioRefs.current.delete(socketId);
      }
    });
  }, [voiceStreams, voiceVolume, speakerMuted]);

  // ====== 直链视频同步逻辑 ======

  useEffect(() => {
    if (isPlatform || isHost || screenSharing) return;
    const video = videoRef.current;
    if (!video) return;

    isSyncingRef.current = true;

    if (Math.abs(video.currentTime - currentTime) > 0.5) {
      video.currentTime = currentTime;
    }
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }

    const timer = setTimeout(() => {
      isSyncingRef.current = false;
    }, 300);

    return () => clearTimeout(timer);
  }, [isPlaying, currentTime, isPlatform, isHost, screenSharing]);

  const handleCanPlay = useCallback(() => {
    if (isHost || isPlatform || screenSharing) return;
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying && video.paused) {
      video.play().catch(() => {});
    }
    if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isHost, isPlatform, isPlaying, screenSharing]);

  useEffect(() => {
    if (isPlatform || isHost || screenSharing) return;
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      if (isPlaying && video.paused) {
        video.play().catch(() => {});
      } else if (!isPlaying && !video.paused) {
        video.pause();
      }
      if (Math.abs(video.currentTime - currentTime) > 2) {
        video.currentTime = currentTime;
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isPlatform, isHost, isPlaying, currentTime, screenSharing]);

  useEffect(() => {
    if (isPlatform || !isHost || screenSharing) return;
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      if (!video.paused) {
        seek(video.currentTime);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isPlatform, isHost, seek, screenSharing]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setLocalTime(video.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
      if (!isHost && currentTime > 0) {
        video.currentTime = currentTime;
      }
    }
  }, [isHost, currentTime]);

  // 自动滚动聊天
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLeave = () => {
    if (isHost && roomId) {
      fetch(`/api/rooms/${roomId}`, { method: 'DELETE' }).catch(() => {});
    }
    disconnect();
    localStorage.removeItem('syncwatch_nickname');
    navigate('/');
  };

  const handleLoadVideo = () => {
    if (videoInput.trim()) {
      setVideoUrl(videoInput.trim());
      setVideoInput('');
      setIframeKey((k) => k + 1);
    }
  };

  const handlePlayPause = () => {
    if (!isHost) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      play(video.currentTime);
      video.play().catch(() => {});
    } else {
      pause(video.currentTime);
      video.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    const time = Number(e.target.value);
    seek(time);
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
    }
  };

  // 视频音量调节
  const handleVideoVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVideoVolume(v);
    if (videoRef.current) {
      videoRef.current.volume = v;
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.volume = v;
    }
  };

  // 语音音量调节
  const handleVoiceVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVoiceVolume(v);
    voiceAudioRefs.current.forEach((audio) => {
      audio.volume = v;
    });
  };

  // 切换扬声器时，显式调用 play()
  const handleToggleSpeaker = useCallback(() => {
    toggleSpeaker();
    if (speakerMuted) {
      voiceAudioRefs.current.forEach((audio) => {
        audio.muted = false;
        audio.play().catch(() => {});
      });
    }
  }, [speakerMuted, toggleSpeaker]);

  const handleSend = () => {
    if (!chatInput.trim()) return;
    sendMessage(chatInput.trim());
    setChatInput('');
  };

  const handleSyncRefresh = () => {
    syncRefresh();
  };

  const handleFullscreen = useCallback(() => {
    const el = screenVideoRef.current?.parentElement?.parentElement;
    if (!el) return;
    setShowMobileChat(false);
    if (el.requestFullscreen) {
      el.requestFullscreen();
    } else if ((el as any).webkitRequestFullscreen) {
      (el as any).webkitRequestFullscreen();
    } else if ((el as any).mozRequestFullScreen) {
      (el as any).mozRequestFullScreen();
    }
  }, []);

  const handleExitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // 视频静音切换
  const toggleVideoMute = useCallback(() => {
    const video = screenVideoRef.current;
    if (video) {
      video.muted = !video.muted;
      setVideoVolume(video.muted ? 0 : video.volume);
    }
  }, []);

  // Emoji 反应
  const handleEmojiReaction = useCallback((emoji: string) => {
    sendEmojiReaction(emoji);
    setShowEmojiPicker(false);
  }, [sendEmojiReaction]);

  useEffect(() => {
    if (syncRefreshTrigger > 0) {
      setIframeKey((k) => k + 1);
    }
  }, [syncRefreshTrigger]);

  const displayTime = isHost ? localTime : currentTime;
  const voiceUserCount = voiceUsers.size + (voiceChatEnabled ? 1 : 0);

  // 连接质量提示条内容
  const qualityBar = connectionQuality === 'poor' ? { text: '网络较差，正在尝试恢复...', color: 'bg-red-500/80', icon: <WifiOff className="w-3.5 h-3.5" /> }
    : connectionQuality === 'fair' ? { text: '网络不稳定，画质可能降低', color: 'bg-yellow-500/80', icon: <Wifi className="w-3.5 h-3.5" /> }
    : isReconnecting ? { text: '正在重新连接...', color: 'bg-blue-500/80', icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" /> }
    : null;

  return (
    <div className="h-screen flex flex-col bg-cinema-bg text-white">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-cinema-surface/50 border-b border-white/10">
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <span className="text-cinema-accent font-outfit font-bold text-base md:text-lg">SyncWatch</span>
          <div className="flex items-center gap-2 glass rounded-lg px-2 md:px-3 py-1.5">
            <span className="text-xs md:text-sm text-cinema-muted">房间:</span>
            <span className="text-xs md:text-sm font-mono font-bold text-white">{roomId}</span>
            <button onClick={handleCopy} className="text-cinema-muted hover:text-cinema-accent transition-colors">
              <Copy className="w-3.5 h-3.5" />
            </button>
            {copied && <span className="text-xs text-cinema-accent">已复制</span>}
          </div>
          {roomPassword && (
            <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full flex items-center gap-1 hidden md:inline">
              <Shield className="w-3 h-3" />
              已加密
            </span>
          )}
          {videoInfo && !screenSharing && (
            <span className="text-xs bg-cinema-accent/20 text-cinema-accent px-2 py-0.5 rounded-full hidden md:inline">
              {videoInfo.label}
            </span>
          )}
          {screenSharing && (
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Monitor className="w-3 h-3" />
              <span className="hidden md:inline">屏幕共享中</span>
            </span>
          )}
          {voiceChatEnabled && (
            <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Headphones className="w-3 h-3" />
              <span className="hidden md:inline">语音 {voiceUserCount}人</span>
            </span>
          )}
          {isHost && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full hidden md:inline">
              房主
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="flex items-center gap-1.5 text-cinema-muted">
            <Users className="w-4 h-4" />
            <span className="text-sm">{users.length} 在线</span>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          </div>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="text-cinema-muted hover:text-cinema-accent transition-colors"
            title="使用说明"
          >
            <Info className="w-4 h-4" />
          </button>
          <button
            onClick={handleLeave}
            className="flex items-center gap-1.5 text-cinema-muted hover:text-red-400 transition-colors text-sm"
          >
            <LogOut className="w-4 h-4" />
            离开
          </button>
        </div>
      </div>

      {/* 使用说明 */}
      {showHelp && (
        <div className="px-4 py-3 bg-cinema-surface/70 border-b border-white/10 text-sm text-white/80">
          <div className="space-y-1">
            <p className="font-semibold text-cinema-accent">功能说明</p>
            <p>• <span className="text-green-400">屏幕共享</span>: 房主分享整个屏幕，参与者实时观看</p>
            <p>• <span className="text-cinema-accent">视频同步</span>: 粘贴视频链接，房主控制播放，参与者自动同步</p>
            <p>• <span className="text-blue-400">语音通话</span>: 加入语音后，默认麦克风静音，手动开启麦克风和扬声器</p>
            <p>• 视频音量和语音音量分开调节，互不影响</p>
            <p>• <span className="text-yellow-400">Emoji 反应</span>: 点击笑脸按钮发送表情，全房间可见</p>
            <p>• <span className="text-orange-400">房间密码</span>: 创建房间时可设密码，私密观影</p>
          </div>
        </div>
      )}

      {/* 主区域 */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* 视频区域 */}
        <div className="flex-1 md:w-[70%] flex flex-col bg-black relative">
          {/* Emoji 浮动动画 */}
          {floatingEmoji && (
            <div
              key={floatingEmoji.id}
              className="absolute top-1/2 left-1/2 z-50 pointer-events-none animate-emoji-float"
              style={{ fontSize: '48px', transform: 'translateX(-50%)' }}
            >
              <div className="text-center">
                <div>{floatingEmoji.emoji}</div>
                <div className="text-xs text-white/60 mt-1">{floatingEmoji.nickname}</div>
              </div>
            </div>
          )}

          {/* 连接质量浮动指示器 */}
          {connectionQuality && connectionQuality !== 'good' && (
            <div className={`absolute bottom-16 left-4 z-40 pointer-events-none animate-quality-pulse`}>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl backdrop-blur-md border shadow-lg ${
                connectionQuality === 'poor'
                  ? 'bg-red-500/20 border-red-500/30'
                  : 'bg-yellow-500/20 border-yellow-500/30'
              }`}>
                <div className="flex items-center gap-1.5">
                  {isReconnecting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  ) : connectionQuality === 'poor' ? (
                    <WifiOff className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5 text-yellow-400" />
                  )}
                  <span className={`text-xs font-medium ${
                    connectionQuality === 'poor' ? 'text-red-300' : 'text-yellow-300'
                  }`}>
                    {isReconnecting ? '正在重连...' : connectionQuality === 'poor' ? '网络较差' : '网络不稳定'}
                  </span>
                </div>
                {/* 信号强度动画条 */}
                <div className="flex items-end gap-0.5 h-3">
                  <div className={`w-1 rounded-full animate-signal-1 ${
                    connectionQuality === 'poor' ? 'bg-red-400' : 'bg-yellow-400'
                  }`} style={{ height: '4px' }} />
                  <div className={`w-1 rounded-full animate-signal-2 ${
                    connectionQuality === 'poor' ? 'bg-red-400' : 'bg-yellow-400'
                  }`} style={{ height: '8px' }} />
                  <div className={`w-1 rounded-full animate-signal-3 ${
                    connectionQuality === 'poor' ? 'bg-red-400' : 'bg-yellow-400'
                  }`} style={{ height: '12px' }} />
                </div>
              </div>
            </div>
          )}

          {/* 屏幕共享视图 */}
          {screenSharing && (isHost ? localStream : remoteStream) ? (
            <div key="screen-share">
              <div className="flex-1 flex items-center justify-center relative">
                <video
                  ref={screenVideoRef}
                  autoPlay
                  playsInline
                  muted={isHost}
                  className={`max-w-full max-h-full ${isHost ? '' : 'hidden'}`}
                />
                {!isHost && (
                  <canvas
                    ref={frameCanvasRef}
                    className="max-w-full max-h-full"
                    style={{ imageRendering: 'auto' }}
                  />
                )}
                {/* 全屏模式下的退出全屏悬浮按钮 */}
                {isFullscreen && (
                  <button
                    onClick={handleExitFullscreen}
                    className="absolute bottom-4 right-4 z-50 bg-black/50 hover:bg-black/80 text-white p-3 rounded-full transition-all duration-300 backdrop-blur-sm"
                    title="退出全屏"
                  >
                    <Minimize className="w-5 h-5" />
                  </button>
                )}
              </div>
              <div className="bg-cinema-surface/80 px-4 py-2 flex items-center gap-2 md:gap-4 flex-wrap">
                <Monitor className="w-4 h-4 text-green-400" />
                <span className="text-xs text-green-400 font-semibold">屏幕共享中</span>
                <span className="text-xs text-cinema-muted hidden md:inline">
                  {isHost ? '你的屏幕正在分享给房间内的其他人' : '正在观看房主的屏幕'}
                </span>
                {connectionStats && (
                  <span className="text-xs text-cinema-muted/70 font-mono">
                    {connectionStats.bitrate} | {connectionStats.fps}
                  </span>
                )}
                <div className="flex-1" />

                {/* Emoji 反应按钮 */}
                <div className="relative">
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="flex items-center gap-1 text-cinema-muted hover:text-yellow-400 px-2 py-1.5 rounded transition-colors"
                    title="发送表情"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute bottom-10 right-0 bg-cinema-surface/95 backdrop-blur-lg rounded-xl p-2 flex gap-1 z-50 border border-white/10 shadow-xl">
                      {EMOJI_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => handleEmojiReaction(emoji)}
                          className="text-2xl hover:scale-125 transition-transform p-1"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 语音通话控制栏 */}
                <VoiceControls
                  voiceChatEnabled={voiceChatEnabled}
                  micMuted={micMuted}
                  speakerMuted={speakerMuted}
                  voiceUserCount={voiceUserCount}
                  onJoinVoice={joinVoiceChat}
                  onLeaveVoice={leaveVoiceChat}
                  onToggleMic={toggleMic}
                  onToggleSpeaker={handleToggleSpeaker}
                />

                <div className="w-px h-5 bg-white/10" />

                {/* 视频音量 */}
                <div className="flex items-center gap-1">
                  <Volume2 className="w-4 h-4 text-cinema-muted" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={videoVolume}
                    onChange={handleVideoVolumeChange}
                    className="w-16 h-1 accent-cinema-accent"
                    title="视频音量"
                  />
                </div>
                <button
                  onClick={toggleVideoMute}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded transition-colors ${screenVideoRef.current?.muted ? 'text-red-400' : 'text-cinema-muted hover:text-white'}`}
                  title={screenVideoRef.current?.muted ? '取消静音' : '视频静音'}
                >
                  {screenVideoRef.current?.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleFullscreen}
                  className="flex items-center gap-1 text-cinema-muted hover:text-white px-2 py-1.5 rounded transition-colors"
                  title="全屏"
                >
                  <Maximize className="w-4 h-4" />
                </button>
                {isHost && (
                  <button
                    onClick={stopScreenShare}
                    className="flex items-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 px-3 py-1.5 rounded-lg transition-colors text-sm"
                  >
                    <MonitorOff className="w-3.5 h-3.5" />
                    停止共享
                  </button>
                )}
              </div>
            </div>
          ) : videoUrl && videoInfo ? (
            /* 视频同步视图 */
            <div key="video-sync">
              <div className="flex-1 flex items-center justify-center relative">
                {isPlatform ? (
                  <iframe
                    key={iframeKey}
                    src={videoInfo.embedUrl}
                    className="w-full h-full"
                    allowFullScreen
                    allow="autoplay; fullscreen; encrypted-media"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                  />
                ) : (
                  <video
                    ref={videoRef}
                    src={videoInfo.embedUrl}
                    className="max-w-full max-h-full"
                    onClick={handlePlayPause}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onCanPlay={handleCanPlay}
                  />
                )}
              </div>

              {/* 控制条 */}
              <div className="bg-cinema-surface/80 px-4 py-2 flex items-center gap-4">
                {isPlatform ? (
                  <>
                    <span className="text-xs text-cinema-accent font-semibold">{videoInfo.label}</span>
                    <span className="text-xs text-cinema-muted">手动同步模式</span>
                    <div className="flex-1" />
                    {/* Emoji 反应按钮 */}
                    <div className="relative">
                      <button
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className="flex items-center gap-1 text-cinema-muted hover:text-yellow-400 px-2 py-1.5 rounded transition-colors"
                        title="发送表情"
                      >
                        <Smile className="w-4 h-4" />
                      </button>
                      {showEmojiPicker && (
                        <div className="absolute bottom-10 right-0 bg-cinema-surface/95 backdrop-blur-lg rounded-xl p-2 flex gap-1 z-50 border border-white/10 shadow-xl">
                          {EMOJI_OPTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => handleEmojiReaction(emoji)} className="text-2xl hover:scale-125 transition-transform p-1">
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <VoiceControls
                      voiceChatEnabled={voiceChatEnabled}
                      micMuted={micMuted}
                      speakerMuted={speakerMuted}
                      voiceUserCount={voiceUserCount}
                      onJoinVoice={joinVoiceChat}
                      onLeaveVoice={leaveVoiceChat}
                      onToggleMic={toggleMic}
                      onToggleSpeaker={handleToggleSpeaker}
                    />
                    <div className="w-px h-5 bg-white/10" />
                    {isHost && (
                      <button
                        onClick={handleSyncRefresh}
                        className="flex items-center gap-1.5 bg-cinema-accent/20 hover:bg-cinema-accent/30 text-cinema-accent px-3 py-1.5 rounded-lg transition-colors text-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        同步刷新
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={handlePlayPause}
                      disabled={!isHost}
                      className={`text-white ${isHost ? 'hover:text-cinema-accent' : 'opacity-50 cursor-not-allowed'} transition-colors`}
                      title={isHost ? '播放/暂停' : '只有房主可以操作'}
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={duration || 0}
                      value={displayTime}
                      onChange={handleSeek}
                      disabled={!isHost}
                      className="flex-1 h-1 accent-cinema-accent disabled:opacity-50"
                    />
                    <span className="text-xs text-cinema-muted min-w-[100px] text-right">
                      {formatTime(displayTime)} / {formatTime(duration)}
                    </span>
                    <div className="flex items-center gap-1">
                      <Volume2 className="w-4 h-4 text-cinema-muted" />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={videoVolume}
                        onChange={handleVideoVolumeChange}
                        className="w-16 h-1 accent-cinema-accent"
                        title="视频音量"
                      />
                    </div>
                    <div className="w-px h-5 bg-white/10" />
                    {/* Emoji 反应按钮 */}
                    <div className="relative">
                      <button
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className="flex items-center gap-1 text-cinema-muted hover:text-yellow-400 px-2 py-1.5 rounded transition-colors"
                        title="发送表情"
                      >
                        <Smile className="w-4 h-4" />
                      </button>
                      {showEmojiPicker && (
                        <div className="absolute bottom-10 right-0 bg-cinema-surface/95 backdrop-blur-lg rounded-xl p-2 flex gap-1 z-50 border border-white/10 shadow-xl">
                          {EMOJI_OPTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => handleEmojiReaction(emoji)} className="text-2xl hover:scale-125 transition-transform p-1">
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <VoiceControls
                      voiceChatEnabled={voiceChatEnabled}
                      micMuted={micMuted}
                      speakerMuted={speakerMuted}
                      voiceUserCount={voiceUserCount}
                      onJoinVoice={joinVoiceChat}
                      onLeaveVoice={leaveVoiceChat}
                      onToggleMic={toggleMic}
                      onToggleSpeaker={handleToggleSpeaker}
                    />
                  </>
                )}
              </div>
            </div>
          ) : (
            /* 无视频时的占位界面 */
            <div key="placeholder" className="flex-1 flex items-center justify-center p-4">
              <div className="bg-cinema-surface rounded-2xl p-8 text-center max-w-lg w-full border border-white/10">
                <LinkIcon className="w-10 h-10 text-cinema-accent mx-auto mb-4" />
                <h3 className="text-xl font-outfit font-semibold mb-2">
                  选择同步模式开始播放
                </h3>
                <p className="text-sm text-cinema-muted mb-4">
                  屏幕共享（完美同步）或 粘贴视频链接（画质优先）
                </p>

                {/* 屏幕共享按钮 */}
                {isHost && (
                  <>
                    <div className="mb-3">
                      <label className="text-xs text-cinema-muted block mb-1.5">画质设置</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((key) => (
                          <button
                            key={key}
                            onClick={() => setScreenQuality(key)}
                            className={`text-xs py-2 px-1.5 rounded-lg transition-all font-outfit ${
                              screenQuality === key
                                ? 'bg-cinema-accent text-cinema-bg font-bold'
                                : 'bg-white/10 text-cinema-muted hover:bg-white/20'
                            }`}
                          >
                            {QUALITY_PRESETS[key].label.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-cinema-muted/60 mt-1">{QUALITY_PRESETS[screenQuality].label}</p>
                    </div>
                    <button
                      onClick={startScreenShare}
                      className="w-full bg-green-500/20 hover:bg-green-500/30 text-green-400 font-outfit font-semibold py-3 rounded-lg transition-all mb-3 flex items-center justify-center gap-2"
                    >
                      <Monitor className="w-5 h-5" />
                      开始屏幕共享
                    </button>
                  </>
                )}

                {!isHost && (
                  <p className="text-xs text-yellow-400/80 mb-3">
                    等待房主开始共享...
                  </p>
                )}

                {/* 语音通话入口 */}
                <div className="mb-3">
                  {!voiceChatEnabled ? (
                    <button
                      onClick={joinVoiceChat}
                      className="w-full bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-outfit font-semibold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      <Phone className="w-4 h-4" />
                      加入语音通话
                    </button>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={toggleMic}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors text-sm ${
                          micMuted ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                        }`}
                        title={micMuted ? '开启麦克风' : '静音麦克风'}
                      >
                        {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        {micMuted ? '已静音' : '麦克风中'}
                      </button>
                      <button
                        onClick={handleToggleSpeaker}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors text-sm ${
                          speakerMuted ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                        }`}
                        title={speakerMuted ? '开启扬声器' : '静音扬声器'}
                      >
                        {speakerMuted ? <VolumeX className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
                        {speakerMuted ? '扬声器关' : '扬声器开'}
                      </button>
                      <button
                        onClick={leaveVoiceChat}
                        className="flex items-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 px-3 py-2 rounded-lg transition-colors text-sm"
                      >
                        <PhoneOff className="w-4 h-4" />
                        退出语音
                      </button>
                    </div>
                  )}
                  {voiceChatEnabled && voiceUserCount > 0 && (
                    <p className="text-xs text-blue-400/70 mt-1.5">语音通话中 {voiceUserCount} 人</p>
                  )}
                </div>

                {/* 视频链接输入 */}
                <div className="border-t border-white/10 pt-4">
                  <input
                    type="text"
                    placeholder="或粘贴视频链接: B站 / YouTube / .mp4"
                    value={videoInput}
                    onChange={(e) => setVideoInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
                    disabled={!isHost}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-cinema-muted focus:outline-none focus:border-cinema-accent transition-colors mb-3 disabled:opacity-40"
                  />
                  <button
                    onClick={handleLoadVideo}
                    disabled={!isHost || !videoInput.trim()}
                    className="w-full bg-cinema-accent text-cinema-bg font-outfit font-semibold py-3 rounded-lg hover:shadow-[0_0_20px_rgba(0,212,255,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    加载视频
                  </button>
                </div>

                <div className="mt-3 pt-3 border-t border-white/10 text-xs text-cinema-muted">
                  身份: {isHost ? '房主' : '参与者'} | 连接: {connected ? '已连接' : '未连接'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 聊天面板 - 移动端底部弹出式 */}
        <div className={`${showMobileChat ? 'fixed inset-0 z-40' : 'hidden'} md:relative md:flex md:w-[30%] md:min-w-[280px] flex flex-col bg-cinema-surface/95 md:bg-cinema-surface/30 backdrop-blur-lg md:backdrop-blur-none border-t md:border-t-0 md:border-l border-white/10`}>
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <span className="font-outfit font-semibold text-sm">聊天</span>
            <div className="flex items-center gap-2">
              {/* 画质快捷切换（房主） */}
              {isHost && (
                <select
                  value={screenQuality}
                  onChange={(e) => setScreenQuality(e.target.value as QualityPreset)}
                  className="text-xs bg-white/10 border border-white/10 rounded px-2 py-1 text-cinema-muted focus:outline-none"
                >
                  {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((key) => (
                    <option key={key} value={key}>{QUALITY_PRESETS[key].label}</option>
                  ))}
                </select>
              )}
              {isHost && !screenSharing && videoUrl && (
                <button
                  onClick={startScreenShare}
                  className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                  title="切换到屏幕共享模式"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  屏幕共享
                </button>
              )}
              <button
                onClick={() => setShowMobileChat(false)}
                className="md:hidden text-cinema-muted hover:text-white text-xs"
              >
                关闭
              </button>
            </div>
          </div>

          {/* 语音通话面板（聊天面板顶部） */}
          {voiceChatEnabled && (
            <div className="px-4 py-2.5 bg-blue-500/10 border-b border-white/10">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Headphones className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs text-blue-400 font-semibold">语音通话 {voiceUserCount}人</span>
                </div>
                <div className="flex-1" />
                <button
                  onClick={toggleMic}
                  className={`flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs ${
                    micMuted ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                  }`}
                  title={micMuted ? '开启麦克风' : '静音麦克风'}
                >
                  {micMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  <span className="hidden md:inline">{micMuted ? '麦克风关' : '麦克风开'}</span>
                </button>
                <button
                  onClick={handleToggleSpeaker}
                  className={`flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs ${
                    speakerMuted ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                  }`}
                  title={speakerMuted ? '开启扬声器' : '静音扬声器'}
                >
                  {speakerMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Headphones className="w-3.5 h-3.5" />}
                  <span className="hidden md:inline">{speakerMuted ? '扬声器关' : '扬声器开'}</span>
                </button>
                <div className="flex items-center gap-1">
                  <Volume2 className="w-3 h-3 text-cinema-muted" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={voiceVolume}
                    onChange={handleVoiceVolumeChange}
                    className="w-12 h-1 accent-blue-400"
                    title="语音音量"
                  />
                </div>
                <button
                  onClick={leaveVoiceChat}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors text-xs"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">退出</span>
                </button>
              </div>
              {voiceUsers.size > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {Array.from(voiceUsers.entries()).map(([socketId, name]) => (
                    <span key={socketId} className="text-xs bg-blue-500/15 text-blue-300 px-2 py-0.5 rounded-full">
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 语音通话入口（未加入时） */}
          {!voiceChatEnabled && (
            <div className="px-4 py-2 border-b border-white/5">
              <button
                onClick={joinVoiceChat}
                className="w-full flex items-center justify-center gap-2 text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 py-2 rounded-lg transition-colors"
              >
                <Phone className="w-3.5 h-3.5" />
                加入语音通话
              </button>
            </div>
          )}

          {/* 房主密码管理 */}
          {isHost && (
            <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-orange-400" />
              {roomPassword ? (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-orange-400">密码已设置</span>
                  <button
                    onClick={() => setRoomPassword(null)}
                    className="text-xs text-cinema-muted hover:text-red-400 transition-colors ml-auto"
                  >
                    移除密码
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    placeholder="设置房间密码"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) setRoomPassword(val);
                      }
                    }}
                    className="flex-1 text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-white placeholder-cinema-muted focus:outline-none focus:border-orange-400/50"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {messages.map((msg: ChatMessage, i: number) => (
              <div key={i} className={msg.isSystem ? 'text-center' : ''}>
                {msg.isSystem ? (
                  <span className="text-xs text-cinema-muted">{msg.message}</span>
                ) : (
                  <div>
                    <span
                      className="text-xs font-semibold mr-2"
                      style={{ color: userColors.get(msg.nickname) || '#00d4ff' }}
                    >
                      {msg.nickname}
                    </span>
                    <span className="text-xs text-cinema-muted">
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <p className="text-sm text-white/90 mt-0.5">{msg.message}</p>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-3 border-t border-white/10 flex gap-2">
            <input
              type="text"
              placeholder="输入消息..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-cinema-muted focus:outline-none focus:border-cinema-accent transition-colors"
            />
            <button
              onClick={handleSend}
              disabled={!chatInput.trim()}
              className="bg-cinema-accent text-cinema-bg p-2 rounded-lg hover:shadow-[0_0_15px_rgba(0,212,255,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 移动端聊天浮动按钮 */}
      <button
        onClick={() => setShowMobileChat(true)}
        className="md:hidden fixed bottom-6 right-6 z-30 bg-cinema-accent text-cinema-bg w-14 h-14 rounded-full flex items-center justify-center shadow-lg shadow-cinema-accent/30 hover:shadow-cinema-accent/50 transition-all"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    </div>
  );
}

// ====== 语音通话控制组件 ======
function VoiceControls({
  voiceChatEnabled,
  micMuted,
  speakerMuted,
  voiceUserCount,
  onJoinVoice,
  onLeaveVoice,
  onToggleMic,
  onToggleSpeaker,
}: {
  voiceChatEnabled: boolean;
  micMuted: boolean;
  speakerMuted: boolean;
  voiceUserCount: number;
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
}) {
  if (!voiceChatEnabled) {
    return (
      <button
        onClick={onJoinVoice}
        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 px-2 py-1.5 rounded transition-colors"
        title="加入语音通话"
      >
        <Phone className="w-4 h-4" />
        <span className="hidden md:inline">语音通话</span>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={onToggleMic}
        className={`flex items-center gap-1 px-2 py-1.5 rounded transition-colors ${
          micMuted ? 'text-red-400' : 'text-green-400'
        }`}
        title={micMuted ? '开启麦克风' : '静音麦克风'}
      >
        {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>
      <button
        onClick={onToggleSpeaker}
        className={`flex items-center gap-1 px-2 py-1.5 rounded transition-colors ${
          speakerMuted ? 'text-red-400' : 'text-blue-400'
        }`}
        title={speakerMuted ? '开启扬声器' : '静音扬声器'}
      >
        {speakerMuted ? <VolumeX className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
      </button>
      <span className="text-xs text-blue-400 font-mono">{voiceUserCount}人</span>
      <button
        onClick={onLeaveVoice}
        className="flex items-center gap-1 text-red-400 hover:text-red-300 px-2 py-1.5 rounded transition-colors"
        title="退出语音通话"
      >
        <PhoneOff className="w-4 h-4" />
      </button>
    </>
  );
}
