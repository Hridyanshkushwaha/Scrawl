import { io, type Socket } from 'socket.io-client';
import type { Ack } from '../types';

// Empty in development and single-service deployments (same origin). Set VITE_SERVER_URL
// when the client is hosted somewhere else than the game server.
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();

export const socket: Socket = SERVER_URL ? io(SERVER_URL) : io();

/** Sends an event and resolves with the server's acknowledgement (or a timeout error). */
export function emitAck<T extends object = object>(event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (error: unknown, response: Ack<T>) => {
      resolve(error ? { ok: false, error: 'The server did not respond. Check your connection.' } : response);
    });
  });
}
