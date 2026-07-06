/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import os from 'os'
import { fileURLToPath } from 'url'
import roomRoutes from './routes/rooms.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/**
 * API Routes
 */
app.use('/api/rooms', roomRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * 获取服务器局域网 IP，方便手机端连接
 */
app.use(
  '/api/server-info',
  (req: Request, res: Response, next: NextFunction): void => {
    const interfaces = os.networkInterfaces()
    const localIPs: string[] = []
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        // 仅取 IPv4、非内部（非 localhost）的地址
        if (iface.family === 'IPv4' && !iface.internal) {
          localIPs.push(iface.address)
        }
      }
    }
    res.status(200).json({
      success: true,
      port: process.env.PORT || 3001,
      localIPs,
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
