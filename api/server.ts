/**
 * local server entry file, for local development
 */
import { createServer } from 'http'
import app from './app.js'
import { Server } from 'socket.io'
import { setupSocket } from './socket.js'

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: { origin: '*' },
})

setupSocket(io)

httpServer.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server ready on http://0.0.0.0:${PORT}`)
})

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received')
  httpServer.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received')
  httpServer.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

export default app
