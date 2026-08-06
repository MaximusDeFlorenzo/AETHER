import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000';

const sockets = new Map<string, Socket>();

// One connection per namespace (/ws/hazard-events, /ws/dashboard,
// /ws/notifications per docs/MIGRATION_FROM_ORION.md's websocket-gateway row)
// — cached so repeated calls reuse the same socket instead of opening
// duplicates.
export function getNamespaceSocket(namespace: string): Socket {
  let socket = sockets.get(namespace);
  if (!socket) {
    socket = io(`${WS_URL}${namespace}`, {
      autoConnect: false,
      auth: () => ({ token: useAuthStore.getState().accessToken }),
    });
    sockets.set(namespace, socket);
  }
  return socket;
}
