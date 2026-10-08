export type WordMode = 'normal' | 'hidden' | 'combination';
export type Phase = 'lobby' | 'choosing' | 'drawing' | 'round_end' | 'game_over';
export type Tool = 'pen' | 'eraser';

export interface RoomSettings {
  maxPlayers: number;
  rounds: number;
  drawTime: number;
  wordCount: number;
  hints: number;
  wordMode: WordMode;
  isPrivate: boolean;
  customWords: string[];
}

/** Coordinates are normalised to 0..1 so clients with different canvas sizes agree. */
export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: number;
  tool: Tool;
  color: string;
  size: number;
  points: Point[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: number;
  score: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isDrawer: boolean;
  hasGuessed: boolean;
}

/** What one specific player is allowed to know about the room. */
export interface RoomState {
  roomId: string;
  you: string;
  settings: RoomSettings;
  phase: Phase;
  round: number;
  totalRounds: number;
  hostId: string;
  drawerId: string | null;
  players: PublicPlayer[];
  timeLeft: number;
  /** Hint mask such as "_ a _ _" (empty in hidden mode). Safe to show everyone. */
  mask: string;
  wordLength: number | null;
  /** Only set for the drawer, players who already guessed, and at round end. */
  word: string | null;
  /** Only set for the drawer while choosing. */
  wordOptions: string[] | null;
}

export type ChatKind = 'chat' | 'guess' | 'system' | 'correct' | 'close';

export interface ChatMessage {
  id: number;
  kind: ChatKind;
  playerId: string | null;
  playerName: string | null;
  text: string;
}

export interface PublicRoomInfo {
  roomId: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  phase: Phase;
  rounds: number;
  drawTime: number;
}

export type EndReason = 'all_guessed' | 'time_up' | 'drawer_left';

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
