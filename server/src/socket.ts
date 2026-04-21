import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';

let io: Server | null = null;

export function initializeSocket(server: HttpServer, corsOrigin: string | string[]) {
  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    let currentRoom: string | null = null;

    socket.on('game:join', (code: string) => {
      // Leave previous room if exists
      if (currentRoom) {
        socket.leave(currentRoom);
      }
      // Join new room
      currentRoom = code;
      socket.join(code);
    });

    socket.on('game:leave', () => {
      if (currentRoom) {
        socket.leave(currentRoom);
        currentRoom = null;
      }
    });

    socket.on('disconnect', () => {
      if (currentRoom) {
        socket.leave(currentRoom);
        currentRoom = null;
      }
    });
  });

  return io;
}

export function emitGameUpdate(code: string, payload: unknown) {
  io?.to(code).emit('game:update', payload);
}
