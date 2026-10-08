import { randomBytes } from 'crypto';
import type { PublicPlayer } from '../types';

const CHAT_WINDOW_MS = 3000;
const CHAT_MAX_IN_WINDOW = 6;

export class Player {
  /** Public identifier, visible to everyone in the room. */
  readonly id = randomBytes(4).toString('hex');
  /** Secret reconnect token, only ever sent to the player it belongs to. */
  readonly token = randomBytes(16).toString('hex');

  socketId: string | null;
  name: string;
  avatar: number;
  score = 0;
  ready = false;
  connected = true;
  hasGuessed = false;
  graceTimer: NodeJS.Timeout | null = null;

  private chatStamps: number[] = [];

  constructor(socketId: string, name: string, avatar: number, readonly ip: string) {
    this.socketId = socketId;
    this.name = name;
    this.avatar = avatar;
  }

  /** Sliding-window rate limit for chat and guesses. */
  allowMessage(now = Date.now()): boolean {
    this.chatStamps = this.chatStamps.filter((t) => now - t < CHAT_WINDOW_MS);
    if (this.chatStamps.length >= CHAT_MAX_IN_WINDOW) return false;
    this.chatStamps.push(now);
    return true;
  }

  toPublic(hostId: string, drawerId: string | null): PublicPlayer {
    return {
      id: this.id,
      name: this.name,
      avatar: this.avatar,
      score: this.score,
      ready: this.ready,
      connected: this.connected,
      isHost: this.id === hostId,
      isDrawer: this.id === drawerId,
      hasGuessed: this.hasGuessed,
    };
  }
}
