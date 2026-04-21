import { io } from 'socket.io-client';

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function resolveSocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_SOCKET_URL;

  if (configuredUrl) {
    try {
      const url = new URL(configuredUrl);

      if (typeof window !== 'undefined' && isLoopbackHost(url.hostname) && !isLoopbackHost(window.location.hostname)) {
        url.hostname = window.location.hostname;
      }

      return url.toString().replace(/\/$/, '');
    } catch {
      return configuredUrl.replace(/\/$/, '');
    }
  }

  if (typeof window === 'undefined') {
    return 'http://localhost:4000';
  }

  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000`;
}

const SOCKET_URL = resolveSocketUrl();

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  withCredentials: true
});
