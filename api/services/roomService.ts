/**
 * Room management service with in-memory storage
 */

export interface Room {
  roomId: string;
  videoUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  lastSyncAt: number;
  hostNickname: string;
  hostRegistered: boolean;
  graceTimeout: ReturnType<typeof setTimeout> | null;
  screenSharing: boolean;
  hostSocketId: string | null;
  voiceUsers: Set<string>; // 语音通话中的 socketId 集合
  password: string | null;
  createdAt: number; // 房间创建时间戳
}

export interface User {
  socketId: string;
  nickname: string;
  roomId: string;
  isHost: boolean;
}

const rooms = new Map<string, Room>();
const users = new Map<string, User>();

const GRACE_PERIOD_MS = 15000; // 15秒宽限期

function generateRoomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (rooms.has(result)) {
    return generateRoomId();
  }
  return result;
}

export function createRoom(hostNickname: string, password?: string): Room {
  const roomId = generateRoomId();
  const room: Room = {
    roomId,
    videoUrl: null,
    isPlaying: false,
    currentTime: 0,
    lastSyncAt: Date.now(),
    hostNickname,
    hostRegistered: false,
    graceTimeout: null,
    screenSharing: false,
    hostSocketId: null,
    voiceUsers: new Set(),
    password: password || null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

export function joinRoom(roomId: string, socketId: string, nickname: string): { room: Room; user: User } | null {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }

  // 如果房间在宽限期内（host断线重连），取消定时删除
  if (room.graceTimeout) {
    clearTimeout(room.graceTimeout);
    room.graceTimeout = null;
  }

  // 如果昵称匹配房主，无论 hostRegistered 状态如何，都设为房主
  // 这处理了刷新页面时旧 socket 尚未断开的情况
  const isHost = nickname === room.hostNickname;
  if (isHost) {
    // 踢掉旧的房主 socket（如果存在）
    for (const [sid, u] of users) {
      if (u.roomId === roomId && u.isHost && sid !== socketId) {
        users.delete(sid);
      }
    }
    room.hostRegistered = true;
    room.hostSocketId = socketId;
  }

  const user: User = {
    socketId,
    nickname,
    roomId,
    isHost,
  };
  users.set(socketId, user);
  return { room, user };
}

export function leaveRoom(socketId: string): { room: Room | null; user: User | null } {
  const user = users.get(socketId);
  if (!user) {
    return { room: null, user: null };
  }
  users.delete(socketId);
  const room = rooms.get(user.roomId);
  if (!room) {
    return { room: null, user };
  }

  // 如果房主断开，启动宽限期定时器而不是立刻删除
  if (user.isHost) {
    room.hostRegistered = false;
    // 注意：不再删除房间内其他用户，让他们保持连接
    // 如果宽限期后房主没有重连，再清理房间和所有用户
    // 启动宽限期
    room.graceTimeout = setTimeout(() => {
      // 宽限期过后，如果房主没有重连，删除房间和所有用户
      if (rooms.has(room.roomId) && !room.hostRegistered) {
        for (const [sid, u] of users) {
          if (u.roomId === room.roomId) {
            users.delete(sid);
          }
        }
        rooms.delete(room.roomId);
      }
      room.graceTimeout = null;
    }, GRACE_PERIOD_MS);
    return { room, user };
  }

  // 非房主离开，检查房间是否为空
  const remaining = getRoomUsers(user.roomId);
  if (remaining.length === 0 && !room.hostRegistered) {
    // 没有用户且房主未注册，清理房间
    if (room.graceTimeout) {
      clearTimeout(room.graceTimeout);
      room.graceTimeout = null;
    }
    rooms.delete(user.roomId);
  }
  return { room, user };
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function getRoomUsers(roomId: string): User[] {
  const result: User[] = [];
  for (const user of users.values()) {
    if (user.roomId === roomId) {
      result.push(user);
    }
  }
  return result;
}

export function setVideoUrl(roomId: string, url: string): Room | null {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }
  room.videoUrl = url;
  return room;
}

export function updatePlayback(roomId: string, isPlaying: boolean, currentTime: number): Room | null {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }
  room.isPlaying = isPlaying;
  room.currentTime = currentTime;
  room.lastSyncAt = Date.now();
  return room;
}

export function getUserBySocketId(socketId: string): User | undefined {
  return users.get(socketId);
}

export function setScreenSharing(roomId: string, active: boolean, hostSocketId: string | null): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.screenSharing = active;
  room.hostSocketId = hostSocketId;
  return room;
}

export function setRoomPassword(roomId: string, password: string | null): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  room.password = password;
  return true;
}

export function deleteRoom(roomId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  // 清理房间内所有用户
  for (const [sid, u] of users) {
    if (u.roomId === roomId) {
      users.delete(sid);
    }
  }
  // 清理宽限期定时器
  if (room.graceTimeout) {
    clearTimeout(room.graceTimeout);
  }
  rooms.delete(roomId);
  return true;
}

// 语音通话：加入
export function joinVoice(roomId: string, socketId: string): string[] | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.voiceUsers.add(socketId);
  // 返回其他已在语音中的用户 socketId
  return Array.from(room.voiceUsers).filter((sid) => sid !== socketId);
}

// 语音通话：离开
export function leaveVoice(roomId: string, socketId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  room.voiceUsers.delete(socketId);
  return true;
}

// 获取所有房间列表（用于观影厅展示）
export function listRooms(): Array<{
  roomId: string;
  hostNickname: string;
  userCount: number;
  isPlaying: boolean;
  hasPassword: boolean;
  screenSharing: boolean;
  createdAt: number;
}> {
  const result: Array<{
    roomId: string;
    hostNickname: string;
    userCount: number;
    isPlaying: boolean;
    hasPassword: boolean;
    screenSharing: boolean;
    createdAt: number;
  }> = [];
  for (const room of rooms.values()) {
    // 跳过宽限期中的房间（房主未注册）
    if (!room.hostRegistered && room.graceTimeout) continue;
    const roomUsers = getRoomUsers(room.roomId);
    result.push({
      roomId: room.roomId,
      hostNickname: room.hostNickname,
      userCount: roomUsers.length,
      isPlaying: room.isPlaying,
      hasPassword: !!room.password,
      screenSharing: room.screenSharing,
      createdAt: room.createdAt,
    });
  }
  // 按创建时间倒序（最新的在前）
  result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}
