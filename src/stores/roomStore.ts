import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';

export interface ChatMessage {
  nickname: string;
  message: string;
  timestamp: number;
  isSystem?: boolean;
}

// 基础 ICE 配置（仅 STUN，用于局域网直连）
const BASE_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 4,
};

// Open Relay Project 免费 TURN 服务器（无需 API Key，支持跨网络连接）
const OPEN_RELAY_TURN: RTCIceServer[] = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:standard.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:standard.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// 缓存 ICE 配置（含 TURN）
let cachedIceConfig: RTCConfiguration | null = null;

async function getIceConfig(): Promise<RTCConfiguration> {
  if (cachedIceConfig) return cachedIceConfig;
  cachedIceConfig = {
    iceServers: [...BASE_ICE_SERVERS.iceServers!, ...OPEN_RELAY_TURN],
    iceCandidatePoolSize: 4,
    iceTransportPolicy: 'all',
  };
  return cachedIceConfig;
}

// 画质预设
export type QualityPreset = 'smooth' | 'hd' | 'fhd' | '2k';
export interface QualityConfig {
  label: string;
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
}
export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  smooth: { label: '流畅 720p@30fps', width: 1280, height: 720, frameRate: 30, maxBitrate: 2_500_000 },
  hd:     { label: '高清 1080p@30fps', width: 1920, height: 1080, frameRate: 30, maxBitrate: 6_000_000 },
  fhd:    { label: '超清 1080p@60fps', width: 1920, height: 1080, frameRate: 60, maxBitrate: 12_000_000 },
  '2k':   { label: '极清 2K@60fps', width: 2560, height: 1440, frameRate: 60, maxBitrate: 20_000_000 },
};

// 语音用户信息
export interface VoiceUser {
  socketId: string;
  nickname: string;
}

// 为用户生成固定颜色
export const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
];

export function hashNickname(nickname: string): string {
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = ((hash << 5) - hash) + nickname.charCodeAt(i);
    hash |= 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

interface RoomState {
  roomId: string | null;
  nickname: string | null;
  isHost: boolean;
  videoUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  users: string[];
  messages: ChatMessage[];
  socket: Socket | null;
  connected: boolean;
  syncRefreshTrigger: number;
  // 屏幕共享
  screenSharing: boolean;
  screenQuality: QualityPreset;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  // 语音通话
  voiceChatEnabled: boolean;
  micMuted: boolean;
  speakerMuted: boolean;
  micStream: MediaStream | null;
  voiceStreams: Map<string, MediaStream>; // socketId → 远程语音流
  voiceUsers: Map<string, string>; // socketId → nickname
  // 用户颜色
  userColors: Map<string, string>; // nickname → color hex
  // Emoji reaction
  emojiReaction: { socketId: string; nickname: string; emoji: string; id: number } | null;
  // 连接质量提示
  connectionQuality: 'good' | 'fair' | 'poor' | null;
  // ICE 重连状态
  isReconnecting: boolean;
  // 房间密码
  roomPassword: string | null;
  // Actions
  connect: (roomId: string, nickname: string) => void;
  disconnect: () => void;
  setVideoUrl: (url: string) => void;
  play: (currentTime: number) => void;
  pause: (currentTime: number) => void;
  seek: (currentTime: number) => void;
  sendMessage: (message: string) => void;
  syncRefresh: () => void;
  setSocket: (socket: Socket) => void;
  setScreenQuality: (quality: QualityPreset) => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  // 语音通话 Actions
  joinVoiceChat: () => Promise<void>;
  leaveVoiceChat: () => void;
  toggleMic: () => void;
  toggleSpeaker: () => void;
  // 新增 Actions
  sendEmojiReaction: (emoji: string) => void;
  setConnectionQuality: (quality: 'good' | 'fair' | 'poor' | null) => void;
  setIsReconnecting: (reconnecting: boolean) => void;
  setRoomPassword: (password: string | null) => void;
}

// 房主的屏幕共享 PeerConnection 管理
const hostPeerConnections = new Map<string, RTCPeerConnection>();
(window as any).__hostPeerConnections = hostPeerConnections;
// 参与者的屏幕共享 PeerConnection
let participantPeerConnection: RTCPeerConnection | null = null;

// 语音通话 PeerConnection 管理（Mesh：每个用户一个连接）
const voicePeerConnections = new Map<string, RTCPeerConnection>();

export const useRoomStore = create<RoomState>((set, get) => ({
  roomId: null,
  nickname: null,
  isHost: false,
  videoUrl: null,
  isPlaying: false,
  currentTime: 0,
  users: [],
  messages: [],
  socket: null,
  connected: false,
  syncRefreshTrigger: 0,
  screenSharing: false,
  screenQuality: 'smooth',
  localStream: null,
  remoteStream: null,
  // 语音通话
  voiceChatEnabled: false,
  micMuted: false,
  speakerMuted: false,
  micStream: null,
  voiceStreams: new Map(),
  voiceUsers: new Map(),
  // 新增状态
  userColors: new Map(),
  emojiReaction: null,
  connectionQuality: null,
  isReconnecting: false,
  roomPassword: null,

  connect: async (roomId: string, nickname: string) => {
    // 防止重复连接
    const existingSocket = get().socket;
    if (existingSocket?.connected) {
      return;
    }

    // 如果有旧 socket（断开但未清理），先彻底关闭
    if (existingSocket) {
      existingSocket.removeAllListeners();
      existingSocket.disconnect();
    }

    // 使用统一的配置获取 Socket.IO 连接地址
    const { getSocketUrl } = await import('../lib/config');
    const serverUrl = getSocketUrl();
    const socket = io(serverUrl || window.location.origin, {
      transports: ['polling', 'websocket'],
    });

    socket.on('connect', () => {
      console.log('[socket] connected, joining room', roomId);
      socket.emit('room:join', { roomId, nickname });
      set({ connected: true, roomId, nickname, socket });
    });

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected, reason:', reason);
      if (reason === 'io server disconnect') {
        set({ connected: false });
      }
    });

    socket.on('room:userJoined', (data: { nickname: string; users: string[]; socketId: string }) => {
      set((state) => {
        const newColors = new Map(state.userColors);
        newColors.set(data.nickname, hashNickname(data.nickname));
        return {
          users: data.users,
          userColors: newColors,
          messages: [
            ...state.messages,
            {
              nickname: '',
              message: `${data.nickname} 加入了房间`,
              timestamp: Date.now(),
              isSystem: true,
            },
          ],
        };
      });

      // 如果房主正在屏幕共享，新参与者加入时需要为其创建新的 PeerConnection
      const { isHost, screenSharing, localStream } = get();
      if (isHost && screenSharing && localStream) {
        createHostPeerConnection(socket, data.socketId, localStream);
      }
    });

    socket.on('room:userLeft', (data: { nickname: string; users: string[] }) => {
      set((state) => ({
        users: data.users,
        messages: [
          ...state.messages,
          {
            nickname: '',
            message: `${data.nickname} 离开了房间`,
            timestamp: Date.now(),
            isSystem: true,
          },
        ],
      }));
    });

    // 房主离开房间通知
    socket.on('room:hostLeft', (data: { message: string }) => {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            nickname: '',
            message: data.message,
            timestamp: Date.now(),
            isSystem: true,
          },
        ],
      }));
    });

    socket.on('room:sync', (data: { isHost: boolean; videoUrl: string | null; isPlaying: boolean; currentTime: number; users: string[]; screenSharing: boolean; hostSocketId: string | null }) => {
      // 计算所有用户的颜色
      const newColors = new Map<string, string>();
      data.users.forEach((u) => {
        newColors.set(u, hashNickname(u));
      });
      set({
        isHost: data.isHost,
        videoUrl: data.videoUrl,
        isPlaying: data.isPlaying,
        currentTime: data.currentTime,
        users: data.users,
        screenSharing: data.screenSharing,
        userColors: newColors,
      });
    });

    socket.on('video:play', (data: { currentTime: number }) => {
      set({ isPlaying: true, currentTime: data.currentTime });
    });

    socket.on('video:pause', (data: { currentTime: number }) => {
      set({ isPlaying: false, currentTime: data.currentTime });
    });

    socket.on('video:seek', (data: { currentTime: number }) => {
      set({ currentTime: data.currentTime });
    });

    socket.on('video:url', (data: { url: string }) => {
      set({ videoUrl: data.url });
    });

    socket.on('chat:message', (data: ChatMessage) => {
      set((state) => ({
        messages: [...state.messages, data],
      }));
    });

    socket.on('video:syncRefresh', () => {
      set((state) => ({ syncRefreshTrigger: state.syncRefreshTrigger + 1 }));
    });

    // ====== 屏幕共享信令 ======

    socket.on('screen:started', async (data: { hostSocketId: string }) => {
      console.log('[screen] Host started sharing, hostSocketId=', data.hostSocketId);
      set({ screenSharing: true });
    });

    socket.on('screen:stopped', () => {
      console.log('[screen] Host stopped sharing');
      if (participantPeerConnection) {
        participantPeerConnection.close();
        participantPeerConnection = null;
      }
      set({ screenSharing: false, remoteStream: null });
    });

    socket.on('screen:offer', async (data: { fromSocketId: string; sdp: string }) => {
      console.log('[screen] Received offer from host');
      if (participantPeerConnection) {
        participantPeerConnection.close();
      }
      const iceConfig = await getIceConfig();
      const pc = new RTCPeerConnection(iceConfig);
      participantPeerConnection = pc;
      (window as any).__participantPc = pc;

      const remoteStream = new MediaStream();
      pc.ontrack = (event) => {
        console.log('[screen] Received remote track, kind:', event.track.kind);
        event.streams[0].getTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
        set({ remoteStream });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('[screen] Participant ICE candidate:', event.candidate.type, event.candidate.protocol);
          socket.emit('screen:ice-candidate', {
            targetSocketId: data.fromSocketId,
            candidate: event.candidate.toJSON(),
          });
        } else {
          console.log('[screen] Participant ICE gathering complete');
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('[screen] Participant iceState:', pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        console.log('[screen] Participant connectionState:', pc.connectionState);
      };

      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('screen:answer', {
        targetSocketId: data.fromSocketId,
        sdp: answer.sdp,
      });
    });

    socket.on('screen:answer', async (data: { fromSocketId: string; sdp: string }) => {
      console.log('[screen] Received answer from participant');
      const pc = hostPeerConnections.get(data.fromSocketId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
      }
    });

    socket.on('screen:ice-candidate', async (data: { fromSocketId: string; candidate: any }) => {
      const hostPc = hostPeerConnections.get(data.fromSocketId);
      if (hostPc) {
        await hostPc.addIceCandidate(new RTCIceCandidate(data.candidate));
        return;
      }
      if (participantPeerConnection) {
        await participantPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    // ====== 语音通话信令 ======

    // 其他用户加入语音
    socket.on('voice:userJoined', async (data: { socketId: string; nickname: string }) => {
      console.log('[voice] User joined voice:', data.nickname, data.socketId);
      const { voiceChatEnabled, micStream } = get();
      // 更新语音用户列表
      const newVoiceUsers = new Map(get().voiceUsers);
      newVoiceUsers.set(data.socketId, data.nickname);
      set({ voiceUsers: newVoiceUsers });

      // 如果自己也在语音中，主动向新加入者发起连接
      if (voiceChatEnabled && micStream) {
        createVoicePeerConnection(socket, data.socketId, micStream);
      }
    });

    // 收到已在语音中的用户列表（自己刚加入时）
    socket.on('voice:existingUsers', async (data: { users: VoiceUser[] }) => {
      console.log('[voice] Existing voice users:', data.users);
      const { micStream } = get();
      // 更新语音用户列表
      const newVoiceUsers = new Map(get().voiceUsers);
      data.users.forEach((u) => {
        newVoiceUsers.set(u.socketId, u.nickname);
      });
      set({ voiceUsers: newVoiceUsers });

      // 向已在语音中的用户发起连接（作为 offer 方）
      if (micStream) {
        data.users.forEach((u) => {
          createVoicePeerConnection(socket, u.socketId, micStream);
        });
      }
    });

    // 其他用户离开语音
    socket.on('voice:userLeft', (data: { socketId: string; nickname: string }) => {
      console.log('[voice] User left voice:', data.nickname);
      // 关闭对应的语音 PeerConnection
      const pc = voicePeerConnections.get(data.socketId);
      if (pc) {
        pc.close();
        voicePeerConnections.delete(data.socketId);
      }
      // 移除远程流
      const newStreams = new Map(get().voiceStreams);
      newStreams.delete(data.socketId);
      // 移除用户
      const newVoiceUsers = new Map(get().voiceUsers);
      newVoiceUsers.delete(data.socketId);
      set({ voiceStreams: newStreams, voiceUsers: newVoiceUsers });
    });

    // 收到语音 Offer（其他用户向自己发起连接）
    socket.on('voice:offer', async (data: { fromSocketId: string; sdp: string }) => {
      console.log('[voice] Received offer from', data.fromSocketId);
      // 关闭旧连接
      const existingPc = voicePeerConnections.get(data.fromSocketId);
      if (existingPc) {
        existingPc.close();
      }

      const iceConfig = await getIceConfig();
      const pc = new RTCPeerConnection(iceConfig);
      voicePeerConnections.set(data.fromSocketId, pc);

      // 添加本地麦克风流
      const { micStream } = get();
      if (micStream) {
        micStream.getTracks().forEach((track) => {
          pc.addTrack(track, micStream);
        });
      }

      // 接收远程音频
      const remoteStream = new MediaStream();
      pc.ontrack = (event) => {
        console.log('[voice] Received remote audio track from', data.fromSocketId);
        event.streams[0].getTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
        const newStreams = new Map(get().voiceStreams);
        newStreams.set(data.fromSocketId, remoteStream);
        set({ voiceStreams: newStreams });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('voice:ice-candidate', {
            targetSocketId: data.fromSocketId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[voice] PeerConnection(${data.fromSocketId}) state:`, pc.connectionState);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          voicePeerConnections.delete(data.fromSocketId);
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
      const answer = await pc.createAnswer();
      const optimizedAnswerSdp = injectVoiceCodecHint(answer.sdp!);
      await pc.setLocalDescription({ type: 'answer', sdp: optimizedAnswerSdp });
      socket.emit('voice:answer', {
        targetSocketId: data.fromSocketId,
        sdp: optimizedAnswerSdp,
      });
    });

    // 收到语音 Answer
    socket.on('voice:answer', async (data: { fromSocketId: string; sdp: string }) => {
      console.log('[voice] Received answer from', data.fromSocketId);
      const pc = voicePeerConnections.get(data.fromSocketId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
      }
    });

    // 语音 ICE Candidate
    socket.on('voice:ice-candidate', async (data: { fromSocketId: string; candidate: any }) => {
      const pc = voicePeerConnections.get(data.fromSocketId);
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    // Emoji reaction
    socket.on('emoji:react', (data: { socketId: string; nickname: string; emoji: string }) => {
      set({ emojiReaction: { ...data, id: Date.now() } });
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket, isHost, screenSharing, voiceChatEnabled } = get();
    // 离开语音通话
    if (voiceChatEnabled) {
      cleanupVoiceConnections();
      if (socket) {
        socket.emit('voice:leave');
      }
    }
    if (socket) {
      if (isHost && screenSharing) {
        socket.emit('screen:stop');
      }
      socket.disconnect();
    }
    cleanupAllConnections();
    set({
      isHost: false,
      videoUrl: null,
      isPlaying: false,
      currentTime: 0,
      users: [],
      messages: [],
      socket: null,
      connected: false,
      syncRefreshTrigger: 0,
      screenSharing: false,
      localStream: null,
      remoteStream: null,
      voiceChatEnabled: false,
      micMuted: false,
      speakerMuted: false,
      micStream: null,
      voiceStreams: new Map(),
      voiceUsers: new Map(),
      userColors: new Map(),
      emojiReaction: null,
      connectionQuality: null,
      isReconnecting: false,
      roomPassword: null,
    });
  },

  setVideoUrl: (url: string) => {
    const { socket } = get();
    if (socket) {
      socket.emit('video:url', { url });
    }
    set({ videoUrl: url });
  },

  play: (currentTime: number) => {
    const { socket } = get();
    if (socket) {
      socket.emit('video:play', { currentTime });
    }
    set({ isPlaying: true, currentTime });
  },

  pause: (currentTime: number) => {
    const { socket } = get();
    if (socket) {
      socket.emit('video:pause', { currentTime });
    }
    set({ isPlaying: false, currentTime });
  },

  seek: (currentTime: number) => {
    const { socket } = get();
    if (socket) {
      socket.emit('video:seek', { currentTime });
    }
    set({ currentTime });
  },

  sendMessage: (message: string) => {
    const { socket } = get();
    if (socket) {
      socket.emit('chat:message', { message });
    }
  },

  syncRefresh: () => {
    const { socket } = get();
    if (socket) {
      socket.emit('video:syncRefresh');
    }
  },

  setSocket: (socket: Socket) => {
    set({ socket });
  },

  setScreenQuality: (quality: QualityPreset) => {
    set({ screenQuality: quality });
  },

  startScreenShare: async () => {
    try {
      const quality = QUALITY_PRESETS[get().screenQuality];

      let stream: MediaStream;

      // Electron 环境：使用 desktopCapturer 获取桌面源
      if (window.electronAPI?.isElectron) {
        const sources = await window.electronAPI.getDesktopSources();
        if (sources.length === 0) {
          throw new Error('没有可共享的屏幕源');
        }
        // 使用第一个屏幕源（主显示器）
        const primaryScreen = sources.find(s => s.name === 'Entire Screen' || s.name === 'Screen 1' || s.id.startsWith('screen:')) || sources[0];
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: primaryScreen.id,
              maxWidth: quality.width,
              maxHeight: quality.height,
              maxFrameRate: quality.frameRate,
            },
          } as any,
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: primaryScreen.id,
            },
          } as any,
        });
      } else {
        // 浏览器环境：使用标准 getDisplayMedia
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: quality.width,
            height: quality.height,
            frameRate: quality.frameRate,
          },
          audio: true,
        });
      }

      // contentHint: 告诉浏览器这是屏幕内容，优先保清晰度
      stream.getVideoTracks().forEach((track) => {
        (track as any).contentHint = 'detail';
      });

      stream.getVideoTracks()[0].onended = () => {
        get().stopScreenShare();
      };

      set({ screenSharing: true, localStream: stream });

      const { socket } = get();
      if (socket) {
        socket.emit('screen:start');
        const onParticipants = (data: { participantSocketIds: string[] }) => {
          console.log('[screen] Got participant socket IDs:', data.participantSocketIds);
          data.participantSocketIds.forEach((socketId) => {
            createHostPeerConnection(socket, socketId, stream);
          });
          socket.off('screen:participants', onParticipants);
        };
        socket.on('screen:participants', onParticipants);
      }
    } catch (err) {
      console.error('[screen] Failed to start screen share:', err);
      set({ screenSharing: false, localStream: null });
    }
  },

  stopScreenShare: () => {
    const { socket, localStream } = get();
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (socket) {
      socket.emit('screen:stop');
    }
    cleanupAllConnections();
    set({ screenSharing: false, localStream: null });
  },

  // ====== 语音通话 Actions ======

  joinVoiceChat: async () => {
    try {
      // Capacitor (Android/iOS) 需要运行时权限请求
      const capacitor = (window as any).Capacitor;
      if (capacitor?.isNativePlatform?.()) {
        try {
          const { Permissions } = capacitor.Plugins || {};
          if (Permissions) {
            const result = await Permissions.query({ name: 'microphone' });
            if (result.state === 'denied') {
              console.warn('[voice] Microphone permission denied');
              return;
            }
          }
        } catch {
          // 权限查询失败，继续尝试 getUserMedia（浏览器会自动请求）
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 降噪 + 回声消除 + 自动增益
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // 高质量语音采集
          sampleRate: 48000,
          channelCount: 1,
          sampleSize: 16,
          // 尽可能消除系统回声
          echoCancellationType: 'browser',
          // 语音优化：抑制远处噪音
          noiseSuppressionType: 'browser',
        } as any,
      });

      // 默认静音麦克风，用户需要手动开启
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });

      set({ voiceChatEnabled: true, micStream: stream, micMuted: true });

      const { socket } = get();
      if (socket) {
        socket.emit('voice:join');
      }
    } catch (err) {
      console.error('[voice] Failed to get microphone:', err);
      set({ voiceChatEnabled: false, micStream: null });
    }
  },

  leaveVoiceChat: () => {
    const { socket, micStream } = get();

    // 停止本地麦克风流
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
    }

    // 通知服务器
    if (socket) {
      socket.emit('voice:leave');
    }

    // 清理语音连接
    cleanupVoiceConnections();

    set({
      voiceChatEnabled: false,
      micMuted: false,
      speakerMuted: false,
      micStream: null,
      voiceStreams: new Map(),
      voiceUsers: new Map(),
    });
  },

  toggleMic: () => {
    const { micStream, micMuted } = get();
    if (micStream) {
      const newMuted = !micMuted;
      micStream.getAudioTracks().forEach((track) => {
        track.enabled = !newMuted;
      });
      set({ micMuted: newMuted });
    }
  },

  toggleSpeaker: () => {
    const { speakerMuted } = get();
    set({ speakerMuted: !speakerMuted });
  },

  // ====== 新增 Actions ======

  sendEmojiReaction: (emoji: string) => {
    const { socket } = get();
    if (socket) {
      socket.emit('emoji:react', { emoji });
    }
  },

  setConnectionQuality: (quality) => {
    set({ connectionQuality: quality });
  },

  setIsReconnecting: (reconnecting: boolean) => {
    set({ isReconnecting: reconnecting });
  },

  setRoomPassword: (password: string | null) => {
    const { socket } = get();
    if (socket) {
      socket.emit('room:setPassword', { password });
    }
    set({ roomPassword: password });
  },
}));

// ====== 辅助函数 ======

// 房主为某个参与者创建屏幕共享 PeerConnection
async function createHostPeerConnection(socket: Socket, targetSocketId: string, localStream: MediaStream) {
  const quality = QUALITY_PRESETS[useRoomStore.getState().screenQuality];
  const existingPc = hostPeerConnections.get(targetSocketId);
  if (existingPc) {
    existingPc.close();
  }

  const iceConfig = await getIceConfig();
  const pc = new RTCPeerConnection(iceConfig);
  hostPeerConnections.set(targetSocketId, pc);

  localStream.getTracks().forEach((track) => {
    const sender = pc.addTrack(track, localStream);

    if (track.kind === 'video') {
      const params = sender.getParameters();
      params.encodings = [
        {
          rid: 'low',
          maxBitrate: Math.round(quality.maxBitrate * 0.35),
          maxFramerate: Math.min(quality.frameRate, 30),
          scaleResolutionDownBy: 1.5,
          networkPriority: 'low',
        },
        {
          rid: 'mid',
          maxBitrate: Math.round(quality.maxBitrate * 0.65),
          maxFramerate: quality.frameRate,
          scaleResolutionDownBy: 1.25,
          networkPriority: 'medium',
        },
        {
          rid: 'high',
          maxBitrate: quality.maxBitrate,
          maxFramerate: quality.frameRate,
          scaleResolutionDownBy: 1,
          networkPriority: 'high',
        },
      ] as any;
      // 带宽不足时优先降帧率而不是降分辨率
      (params as any).degradationPreference = 'maintain-resolution';
      sender.setParameters(params).catch((err) => {
        console.warn('[screen] Failed to set simulcast parameters:', err);
      });
    }

    if (track.kind === 'audio') {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate: 256_000,
      };
      sender.setParameters(params).catch((err) => {
        console.warn('[screen] Failed to set audio sender parameters:', err);
      });
    }
  });

  pc.onconnectionstatechange = () => {
    console.log(`[screen] PeerConnection(${targetSocketId}) connectionState:`, pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      hostPeerConnections.delete(targetSocketId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[screen] PeerConnection(${targetSocketId}) iceState:`, pc.iceConnectionState);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[screen] Host ICE candidate type:`, event.candidate.type, event.candidate.protocol);
      socket.emit('screen:ice-candidate', {
        targetSocketId,
        candidate: event.candidate.toJSON(),
      });
    } else {
      console.log(`[screen] Host ICE gathering complete`);
    }
  };

  const offer = await pc.createOffer();
  const modifiedSdp = injectBandwidthHint(offer.sdp!, quality.maxBitrate);
  await pc.setLocalDescription({ type: 'offer', sdp: modifiedSdp });
  socket.emit('screen:offer', {
    targetSocketId,
    sdp: modifiedSdp,
  });
}

// 创建语音 PeerConnection（向目标用户发起 offer）
async function createVoicePeerConnection(socket: Socket, targetSocketId: string, micStream: MediaStream) {
  // 关闭旧连接
  const existingPc = voicePeerConnections.get(targetSocketId);
  if (existingPc) {
    existingPc.close();
  }

  const iceConfig = await getIceConfig();
  const pc = new RTCPeerConnection(iceConfig);
  voicePeerConnections.set(targetSocketId, pc);

  // 添加本地麦克风流，优化音频发送参数
  micStream.getTracks().forEach((track) => {
    const sender = pc.addTrack(track, micStream);
    if (track.kind === 'audio') {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate: 128_000, // 128kbps 语音码率
        networkPriority: 'high',
      };
      sender.setParameters(params).catch(() => {});
    }
  });

  // 接收远程音频
  const remoteStream = new MediaStream();
  pc.ontrack = (event) => {
    console.log('[voice] Received remote audio track from', targetSocketId);
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
    const newStreams = new Map(useRoomStore.getState().voiceStreams);
    newStreams.set(targetSocketId, remoteStream);
    useRoomStore.setState({ voiceStreams: newStreams });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('voice:ice-candidate', {
        targetSocketId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[voice] PeerConnection(${targetSocketId}) state:`, pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      voicePeerConnections.delete(targetSocketId);
    }
  };

  const offer = await pc.createOffer();
  const optimizedSdp = injectVoiceCodecHint(offer.sdp!);
  await pc.setLocalDescription({ type: 'offer', sdp: optimizedSdp });
  socket.emit('voice:offer', {
    targetSocketId,
    sdp: optimizedSdp,
  });
}

// SDP 带宽注入 + 编码器优选
function injectBandwidthHint(sdp: string, maxBitrate: number): string {
  const lines = sdp.split('\r\n');
  const result: string[] = [];
  let inVideoSection = false;
  let videoPayloadLines: string[] = [];
  let h264Lines: string[] = [];
  let otherLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('m=video')) {
      inVideoSection = true;
      result.push(line);
      result.push(`b=AS:${Math.round(maxBitrate / 1000)}`);
    } else if (line.startsWith('m=')) {
      if (inVideoSection && (h264Lines.length > 0 || otherLines.length > 0)) {
        result.push(...h264Lines, ...otherLines);
        h264Lines = [];
        otherLines = [];
      }
      inVideoSection = false;
      result.push(line);
    } else if (inVideoSection) {
      if (line.toLowerCase().includes('h264') || line.toLowerCase().includes('42e0')) {
        h264Lines.push(line);
      } else {
        otherLines.push(line);
      }
    } else {
      result.push(line);
    }
  }
  if (h264Lines.length > 0 || otherLines.length > 0) {
    result.push(...h264Lines, ...otherLines);
  }
  return result.join('\r\n');
}

// OPUS 语音编码器 SDP 优化：高码率 + 语音模式 + DTX + FEC
function injectVoiceCodecHint(sdp: string): string {
  const lines = sdp.split('\r\n');
  const result: string[] = [];
  let opusPayloadType = '';

  for (const line of lines) {
    // 找到 OPUS 编码器的 payload type
    if (line.includes('opus/48000') && line.startsWith('a=rtpmap:')) {
      opusPayloadType = line.split(':')[1].split(' ')[0];
    }
    result.push(line);

    // 在 OPUS fmtp 行后插入优化参数
    if (opusPayloadType && line.startsWith(`a=fmtp:${opusPayloadType}`)) {
      // 替换/追加 OPUS 参数
      const existing = line;
      const optimized = existing + ';stereo=0;maxaveragebitrate=128000;usedtx=1;useinbandfec=1;cbr=0;maxplaybackrate=48000';
      result[result.length - 1] = optimized;
      opusPayloadType = ''; // 防止重复处理
    }
  }

  // 如果没找到 fmtp 行，手动添加
  if (opusPayloadType) {
    result.push(`a=fmtp:${opusPayloadType} stereo=0;maxaveragebitrate=128000;usedtx=1;useinbandfec=1;cbr=0;maxplaybackrate=48000`);
  }

  return result.join('\r\n');
}

function cleanupAllConnections() {
  hostPeerConnections.forEach((pc) => pc.close());
  hostPeerConnections.clear();
  if (participantPeerConnection) {
    participantPeerConnection.close();
    participantPeerConnection = null;
  }
  cleanupVoiceConnections();
}

function cleanupVoiceConnections() {
  voicePeerConnections.forEach((pc) => pc.close());
  voicePeerConnections.clear();
}
