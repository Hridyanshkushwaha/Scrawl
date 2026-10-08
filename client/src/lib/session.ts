import type { Session } from '../types';

const SESSION_KEY = 'scrawl.session';
const PROFILE_KEY = 'scrawl.profile';

export interface Profile {
  name: string;
  avatar: number;
}

/** The reconnect token lives in sessionStorage: it survives a refresh but not a closed tab. */
export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return typeof parsed.roomId === 'string' && typeof parsed.playerId === 'string' && typeof parsed.token === 'string'
      ? (parsed as Session)
      : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable: reconnect after refresh simply won't work */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function loadProfile(): Profile {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') as Partial<Profile>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, 20) : '',
      avatar: typeof parsed.avatar === 'number' ? parsed.avatar : Math.floor(Math.random() * 16),
    };
  } catch {
    return { name: '', avatar: Math.floor(Math.random() * 16) };
  }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}
