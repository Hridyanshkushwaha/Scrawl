import type { Point, RoomSettings, Tool, WordMode } from '../types';

export const LIMITS = {
  maxPlayers: { min: 2, max: 20 },
  rounds: { min: 2, max: 10 },
  drawTime: { min: 15, max: 240 },
  wordCount: { min: 1, max: 5 },
  hints: { min: 0, max: 5 },
  nameLength: 20,
  chatLength: 120,
  customWords: 200,
  avatars: 16,
  brushSize: { min: 1, max: 64 },
} as const;

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

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Control characters plus zero-width and bidi-override characters (used for spoofing).
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

function cleanText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(INVISIBLE, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export const sanitizeName = (raw: unknown): string | null => cleanText(raw, LIMITS.nameLength);
export const sanitizeChat = (raw: unknown): string | null => cleanText(raw, LIMITS.chatLength);

export function parseRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(code) ? code : null;
}

export function parseAvatar(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < LIMITS.avatars
    ? raw
    : Math.floor(Math.random() * LIMITS.avatars);
}

function intInRange(value: unknown, range: { min: number; max: number }): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
    ? value
    : null;
}

const WORD_MODES: readonly WordMode[] = ['normal', 'hidden', 'combination'];
const CUSTOM_WORD = /^[\p{L}][\p{L} '-]{0,28}$/u;

export type SettingsResult = { ok: true; settings: RoomSettings } | { ok: false; error: string };

/** Validates a (possibly partial) settings object and merges it over `current`. */
export function parseSettings(input: unknown, current: RoomSettings): SettingsResult {
  if (input === undefined || input === null) return { ok: true, settings: { ...current } };
  if (!isRecord(input)) return { ok: false, error: 'Invalid settings.' };

  const next: RoomSettings = { ...current, customWords: [...current.customWords] };
  const numeric = ['maxPlayers', 'rounds', 'drawTime', 'wordCount', 'hints'] as const;
  for (const key of numeric) {
    if (input[key] === undefined) continue;
    const value = intInRange(input[key], LIMITS[key]);
    if (value === null) {
      return { ok: false, error: `${key} must be a whole number from ${LIMITS[key].min} to ${LIMITS[key].max}.` };
    }
    next[key] = value;
  }

  if (input.wordMode !== undefined) {
    if (typeof input.wordMode !== 'string' || !WORD_MODES.includes(input.wordMode as WordMode)) {
      return { ok: false, error: 'Unknown word mode.' };
    }
    next.wordMode = input.wordMode as WordMode;
  }

  if (input.isPrivate !== undefined) {
    if (typeof input.isPrivate !== 'boolean') return { ok: false, error: 'isPrivate must be true or false.' };
    next.isPrivate = input.isPrivate;
  }

  if (input.customWords !== undefined) {
    if (!Array.isArray(input.customWords)) return { ok: false, error: 'customWords must be a list.' };
    const words = new Set<string>();
    for (const item of input.customWords.slice(0, LIMITS.customWords)) {
      const word = cleanText(item, 30)?.toLowerCase();
      if (word && CUSTOM_WORD.test(word)) words.add(word);
    }
    next.customWords = [...words];
  }

  return { ok: true, settings: next };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const unit = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;

export function parsePoint(raw: unknown): Point | null {
  if (!isRecord(raw)) return null;
  const x = unit(raw.x);
  const y = unit(raw.y);
  return x === null || y === null ? null : { x, y };
}

export interface DrawStartInput extends Point {
  color: string;
  size: number;
  tool: Tool;
}

export function parseDrawStart(raw: unknown): DrawStartInput | null {
  const point = parsePoint(raw);
  if (!point || !isRecord(raw)) return null;
  if (typeof raw.color !== 'string' || !COLOR.test(raw.color)) return null;
  const size = intInRange(raw.size, LIMITS.brushSize);
  if (size === null) return null;
  const tool: Tool = raw.tool === 'eraser' ? 'eraser' : 'pen';
  return { ...point, color: raw.color.toLowerCase(), size, tool };
}
