/**
 * Room HTTP API routes
 */
import { Router, type Request, type Response } from 'express'
import {
  createRoom,
  joinRoom,
  getRoom,
  getRoomUsers,
  deleteRoom,
  listRooms,
} from '../services/roomService.js'

const router = Router()

/**
 * List all rooms (for cinema hall)
 * GET /api/rooms/list
 */
router.get('/list', async (_req: Request, res: Response): Promise<void> => {
  const rooms = listRooms()
  res.status(200).json({ success: true, rooms })
})

/**
 * Create room
 * POST /api/rooms
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { nickname, password } = req.body
  if (!nickname || typeof nickname !== 'string') {
    res.status(400).json({ success: false, error: 'nickname is required' })
    return
  }
  const room = createRoom(nickname, password || undefined)
  res.status(201).json({ success: true, roomId: room.roomId, nickname })
})

/**
 * Join room
 * POST /api/rooms/:roomId/join
 */
router.post('/:roomId/join', async (req: Request, res: Response): Promise<void> => {
  const { roomId } = req.params
  const { nickname, password } = req.body
  if (!nickname || typeof nickname !== 'string') {
    res.status(400).json({ success: false, error: 'nickname is required' })
    return
  }
  const room = getRoom(roomId)
  if (!room) {
    res.status(404).json({ success: false, error: 'Room not found' })
    return
  }
  // 非房主加入时需要验证密码
  const isHost = nickname === room.hostNickname
  if (!isHost && room.password && room.password !== password) {
    res.status(403).json({ success: false, error: 'Invalid password' })
    return
  }
  res.status(200).json({
    success: true,
    roomId: room.roomId,
    nickname,
    videoUrl: room.videoUrl,
  })
})

/**
 * Get room info
 * GET /api/rooms/:roomId
 */
router.get('/:roomId', async (req: Request, res: Response): Promise<void> => {
  const { roomId } = req.params
  const room = getRoom(roomId)
  if (!room) {
    res.status(404).json({ success: false, error: 'Room not found' })
    return
  }
  const roomUsers = getRoomUsers(roomId)
  res.status(200).json({
    success: true,
    roomId: room.roomId,
    users: roomUsers.map((u) => ({ nickname: u.nickname, isHost: u.isHost })),
    videoUrl: room.videoUrl,
  })
})

/**
 * Delete room
 * DELETE /api/rooms/:roomId
 */
router.delete('/:roomId', async (req: Request, res: Response): Promise<void> => {
  const { roomId } = req.params
  deleteRoom(roomId)
  res.status(200).json({ success: true })
})

export default router
