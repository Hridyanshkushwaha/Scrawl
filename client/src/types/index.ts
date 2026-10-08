// Mirrors server/src/types. Kept as a separate copy so client and server stay independently deployable.

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
  mask: string;
  wordLength: number | null;
  word: string | null;
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

export interface RoundEndPayload {
  word: string | null;
  reason: 'all_guessed' | 'time_up' | 'drawer_left';
  scores: { playerId: string; name: string; delta: number; total: number }[];
  nextDrawerId: string | null;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  avatar: number;
  score: number;
  rank: number;
}

export interface GameOverPayload {
  winner: LeaderboardEntry | null;
  winners: LeaderboardEntry[];
  leaderboard: LeaderboardEntry[];
}

export interface Session {
  roomId: string;
  playerId: string;
  token: string;
}

export interface JoinResponse {
  ok: true;
  roomId: string;
  playerId: string;
  token: string;
  state: RoomState;
  strokes: Stroke[];
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface CanvasSnapshot {
  version: number;
  strokes: Stroke[];
}

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 80,
  wordCount: 3,
  hints: 2,
  wordMode: 'normal',
  isPrivate: true,
  customWords: [],
};
