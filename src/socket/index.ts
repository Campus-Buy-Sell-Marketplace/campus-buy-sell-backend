// ============================================================
// Campus Marketplace — Socket.IO Server Configuration
// Real-time communication for Order Chat (Buyer <-> Seller)
// ============================================================

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';

let io: SocketIOServer | null = null;

export function initSocketIO(server: HttpServer): SocketIOServer {
  const allowedOrigins = [
    process.env.CLIENT_URL,
    'https://campus-buy-sell-web.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
  ].filter(Boolean) as string[];

  io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.some((o) => origin.startsWith(o))) {
          callback(null, true);
        } else {
          callback(null, true); // Dev-friendly fallback
        }
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join order-scoped chat room
    socket.on('join_order', (data: { orderId: string }) => {
      if (data?.orderId) {
        const room = `order_${data.orderId}`;
        socket.join(room);
        console.log(`[Socket.io] Socket ${socket.id} joined room ${room}`);
      }
    });

    // Leave order chat room
    socket.on('leave_order', (data: { orderId: string }) => {
      if (data?.orderId) {
        const room = `order_${data.orderId}`;
        socket.leave(room);
        console.log(`[Socket.io] Socket ${socket.id} left room ${room}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * Broadcasts a new chat message to all sockets connected to this order room
 */
export function broadcastMessage(orderId: string, message: any): void {
  if (io) {
    const room = `order_${orderId}`;
    io.to(room).emit('new_message', message);
  }
}
