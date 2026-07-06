/**
 * Socket.IO event handler for SyncWatch
 */
import type { Server, Socket } from 'socket.io'
import {
  joinRoom,
  leaveRoom,
  getRoom,
  setVideoUrl,
  updatePlayback,
  getUserBySocketId,
  getRoomUsers,
  setScreenSharing,
  joinVoice,
  leaveVoice,
  setRoomPassword,
} from './services/roomService.js'

export function setupSocket(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`)

    // Join a room's socket channel
    socket.on('room:join', (data: { roomId: string; nickname: string }) => {
      const { roomId, nickname } = data
      const result = joinRoom(roomId, socket.id, nickname)
      if (!result) {
        console.log(`[room:join] FAILED - room not found: roomId=${roomId} nickname=${nickname}`)
        socket.emit('room:error', { message: 'Room not found' })
        return
      }
      console.log(`[room:join] socket=${socket.id} roomId=${roomId} nickname=${nickname} isHost=${result.user.isHost}`)
      socket.join(roomId)
      const roomUsers = getRoomUsers(roomId)
      const userNicknames = roomUsers.map((u) => u.nickname)
      // Emit sync state to the joiner (include isHost for this user)
      socket.emit('room:sync', {
        isHost: result.user.isHost,
        videoUrl: result.room.videoUrl,
        isPlaying: result.room.isPlaying,
        currentTime: result.room.currentTime,
        users: userNicknames,
        screenSharing: result.room.screenSharing,
        hostSocketId: result.room.hostSocketId,
        password: result.user.isHost ? result.room.password : null,
      })
      // Notify others in the room
      socket.to(roomId).emit('room:userJoined', {
        nickname: result.user.nickname,
        users: userNicknames,
        socketId: socket.id,
      })
    })

    // Leave room
    socket.on('room:leave', () => {
      const { room, user } = leaveRoom(socket.id)
      if (user && room) {
        socket.leave(user.roomId)
        const roomUsers = getRoomUsers(user.roomId)
        socket.to(user.roomId).emit('room:userLeft', {
          nickname: user.nickname,
          users: roomUsers.map((u) => u.nickname),
        })
      }
    })

    // Video play
    socket.on('video:play', (data: { currentTime: number }) => {
      const user = getUserBySocketId(socket.id)
      console.log(`[video:play] socket=${socket.id} user=${user?.nickname} isHost=${user?.isHost} currentTime=${data.currentTime}`)
      if (!user || !user.isHost) return
      const room = updatePlayback(user.roomId, true, data.currentTime)
      if (room) {
        console.log(`[video:play] Broadcasting to room ${user.roomId}`)
        socket.to(user.roomId).emit('video:play', { currentTime: data.currentTime })
      }
    })

    // Video pause
    socket.on('video:pause', (data: { currentTime: number }) => {
      const user = getUserBySocketId(socket.id)
      console.log(`[video:pause] socket=${socket.id} user=${user?.nickname} isHost=${user?.isHost} currentTime=${data.currentTime}`)
      if (!user || !user.isHost) return
      const room = updatePlayback(user.roomId, false, data.currentTime)
      if (room) {
        console.log(`[video:pause] Broadcasting to room ${user.roomId}`)
        socket.to(user.roomId).emit('video:pause', { currentTime: data.currentTime })
      }
    })

    // Video seek
    socket.on('video:seek', (data: { currentTime: number }) => {
      const user = getUserBySocketId(socket.id)
      if (!user || !user.isHost) return
      const currentRoom = getRoom(user.roomId)
      const isPlaying = currentRoom ? currentRoom.isPlaying : false
      const room = updatePlayback(user.roomId, isPlaying, data.currentTime)
      if (room) {
        socket.to(user.roomId).emit('video:seek', { currentTime: data.currentTime })
      }
    })

    // Video URL change
    socket.on('video:url', (data: { url: string }) => {
      const user = getUserBySocketId(socket.id)
      if (!user || !user.isHost) return
      const room = setVideoUrl(user.roomId, data.url)
      if (room) {
        socket.to(user.roomId).emit('video:url', { url: data.url })
      }
    })

    // Chat message
    socket.on('chat:message', (data: { message: string }) => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      io.to(user.roomId).emit('chat:message', {
        nickname: user.nickname,
        message: data.message,
        timestamp: Date.now(),
      })
    })

    // Platform video sync refresh (host triggers iframe reload for all)
    socket.on('video:syncRefresh', () => {
      const user = getUserBySocketId(socket.id)
      if (!user || !user.isHost) return
      io.to(user.roomId).emit('video:syncRefresh')
    })

    // ====== WebRTC 屏幕共享信令 ======

    // 房主开始屏幕共享
    socket.on('screen:start', () => {
      const user = getUserBySocketId(socket.id)
      if (!user || !user.isHost) return
      setScreenSharing(user.roomId, true, socket.id)
      // 获取房间内其他参与者的 socket ID，返回给房主用于建立 WebRTC 连接
      const roomUsers = getRoomUsers(user.roomId)
      const participantSocketIds = roomUsers
        .filter((u) => !u.isHost)
        .map((u) => u.socketId)
      socket.emit('screen:participants', { participantSocketIds })
      // 通知参与者屏幕共享已开始
      socket.to(user.roomId).emit('screen:started', { hostSocketId: socket.id })
    })

    // 房主停止屏幕共享
    socket.on('screen:stop', () => {
      const user = getUserBySocketId(socket.id)
      if (!user || !user.isHost) return
      setScreenSharing(user.roomId, false, null)
      socket.to(user.roomId).emit('screen:stopped')
    })

    // WebRTC SDP Offer（房主→参与者）
    socket.on('screen:offer', (data: { targetSocketId: string; sdp: string }) => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      io.to(data.targetSocketId).emit('screen:offer', {
        fromSocketId: socket.id,
        sdp: data.sdp,
      })
    })

    // WebRTC SDP Answer（参与者→房主）
    socket.on('screen:answer', (data: { targetSocketId: string; sdp: string }) => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      io.to(data.targetSocketId).emit('screen:answer', {
        fromSocketId: socket.id,
        sdp: data.sdp,
      })
    })

    // ICE Candidate 交换
    socket.on('screen:ice-candidate', (data: { targetSocketId: string; candidate: any }) => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      io.to(data.targetSocketId).emit('screen:ice-candidate', {
        fromSocketId: socket.id,
        candidate: data.candidate,
      })
    })

    // ====== 语音通话信令 ======

    // 加入语音通话
    socket.on('voice:join', () => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      const existingVoiceUsers = joinVoice(user.roomId, socket.id)
      if (existingVoiceUsers === null) return
      // 通知房间内其他人
      const roomUsers = getRoomUsers(user.roomId)
      const voiceUserList = roomUsers.filter((u) => {
        const room = getRoom(user.roomId)
        return room?.voiceUsers.has(u.socketId)
      })
      socket.to(user.roomId).emit('voice:userJoined', {
        socketId: socket.id,
        nickname: user.nickname,
      })
      // 返回已在语音中的用户列表给加入者
      socket.emit('voice:existingUsers', {
        users: existingVoiceUsers.map((sid) => {
          const u = getUserBySocketId(sid)
          return { socketId: sid, nickname: u?.nickname || '未知' }
        }),
      })
    })

    // 离开语音通话
    socket.on('voice:leave', () => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      leaveVoice(user.roomId, socket.id)
      socket.to(user.roomId).emit('voice:userLeft', {
        socketId: socket.id,
        nickname: user.nickname,
      })
    })

    // 语音 WebRTC 信令转发
    socket.on('voice:offer', (data: { targetSocketId: string; sdp: string }) => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      io.to(data.targetSocketId).emit('voice:offer', {
        fromSocketId: socket.id,
        sdp: data.sdp,
      })
    })

    socket.on('voice:answer', (data: { targetSocketId: string; sdp: string }) => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      io.to(data.targetSocketId).emit('voice:answer', {
        fromSocketId: socket.id,
        sdp: data.sdp,
      })
    })

    socket.on('voice:ice-candidate', (data: { targetSocketId: string; candidate: any }) => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      io.to(data.targetSocketId).emit('voice:ice-candidate', {
        fromSocketId: socket.id,
        candidate: data.candidate,
      })
    })

    // Emoji reaction
    socket.on('emoji:react', (data: { emoji: string }) => {
      const user = getUserBySocketId(socket.id)
      if (!user) return
      io.to(user.roomId).emit('emoji:react', {
        socketId: socket.id,
        nickname: user.nickname,
        emoji: data.emoji,
      })
    })

    // Room password
    socket.on('room:setPassword', (data: { password: string | null }) => {
      const user = getUserBySocketId(socket.id)
      if (!user || !user.isHost) return
      setRoomPassword(user.roomId, data.password)
    })

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`)
      const { room, user } = leaveRoom(socket.id)
      if (user && room) {
        // 房主断开时重置屏幕共享状态
        if (user.isHost && room.screenSharing) {
          setScreenSharing(room.roomId, false, null)
          socket.to(room.roomId).emit('screen:stopped')
        }
        // 清理语音通话状态
        if (room.voiceUsers.has(socket.id)) {
          leaveVoice(room.roomId, socket.id)
          socket.to(room.roomId).emit('voice:userLeft', {
            socketId: socket.id,
            nickname: user.nickname,
          })
        }
        const roomUsers = getRoomUsers(room.roomId)
        socket.to(room.roomId).emit('room:userLeft', {
          nickname: user.nickname,
          users: roomUsers.map((u) => u.nickname),
        })
        // 房主离开时通知参与者
        if (user.isHost) {
          socket.to(room.roomId).emit('room:hostLeft', {
            message: '房主已离开房间，房间将在15秒后关闭',
          })
        }
      }
    })
  })
}
