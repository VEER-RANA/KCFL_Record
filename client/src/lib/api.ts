import type { GameSettings, GameSnapshot } from './types';

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function resolveApiBase(): string {
  const configuredUrl = import.meta.env.VITE_API_URL;

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
    return 'http://localhost:4000/api';
  }

  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000/api`;
}

const API_BASE = resolveApiBase();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function createGame(payload: {
  name: string;
  superPlayerName: string;
  settings: GameSettings;
}) {
  return request<{ game: GameSnapshot }>('/games', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function addPlayerToGame(code: string, payload: { playerName: string; color?: string }) {
  return request<{ game: GameSnapshot }>(`/games/${code}/add-player`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function joinGame(code: string, payload: { playerName: string; color: string }) {
  return request<{ game: GameSnapshot }>(`/games/${code}/join`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchGame(code: string) {
  return request<{ game: GameSnapshot }>(`/games/${code}`);
}

export function submitBid(code: string, payload: { round: number; playerId: string; bid: number; completed: boolean }) {
  return request<{ game: GameSnapshot }>(`/games/${code}/bids`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function extendDistribution(code: string, payload: { rowsToAdd: number }) {
  return request<{ game: GameSnapshot }>(`/games/${code}/distribution/extend`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function endGameRequest(code: string) {
  return request<{ game: GameSnapshot }>(`/games/${code}/end-game`, {
    method: 'POST'
  });
}
