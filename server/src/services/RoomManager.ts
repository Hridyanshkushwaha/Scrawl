import { randomInt } from 'crypto';
import type { Server } from 'socket.io';
import { Room } from '../classes/Room';
import type { PublicRoomInfo, RoomSettings } from '../types';

// No 0/O or 1/I so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_ROOMS = 1000;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly io: Server) {}

  create(settings: RoomSettings): Room | null {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const id = this.generateId();
    const room = new Room(id, settings, this.io, (roomId) => this.rooms.delete(roomId));
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Public rooms only. Private rooms are reachable solely through their code. */
  listPublic(): PublicRoomInfo[] {
    return [...this.rooms.values()]
      .filter((room) => !room.settings.isPrivate && !room.isFull() && room.players.size > 0)
      .map((room) => ({
        roomId: room.id,
        hostName: room.host?.name ?? 'Unknown',
        players: room.players.size,
        maxPlayers: room.settings.maxPlayers,
        phase: room.game.phase,
        rounds: room.settings.rounds,
        drawTime: room.settings.drawTime,
      }))
      .sort((a, b) => Number(b.phase === 'lobby') - Number(a.phase === 'lobby') || b.players - a.players);
  }

  /** Picks a random open public room, preferring ones that haven't started. */
  findRandomPublic(): Room | undefined {
    const open = [...this.rooms.values()].filter(
      (room) => !room.settings.isPrivate && !room.isFull() && room.players.size > 0,
    );
    const lobbies = open.filter((room) => room.game.phase === 'lobby');
    const pool = lobbies.length > 0 ? lobbies : open;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private generateId(): string {
    for (;;) {
      let id = '';
      for (let i = 0; i < CODE_LENGTH; i++) id += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(id)) return id;
    }
  }
}
