import type { Server } from 'socket.io';
import { Game } from './Game';
import type { Player } from './Player';
import type { ChatKind, ChatMessage, RoomSettings, RoomState } from '../types';

const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 20000;

export type RemoveReason = 'left' | 'timeout' | 'kicked' | 'banned';

/** A room owns its players, its settings and one Game, and knows how to talk to its sockets. */
export class Room {
  readonly players = new Map<string, Player>();
  readonly game: Game;
  hostId = '';

  private readonly bannedTokens = new Set<string>();
  private readonly bannedIps = new Set<string>();
  private messageSeq = 0;
  private destroyed = false;

  constructor(
    readonly id: string,
    public settings: RoomSettings,
    private readonly io: Server,
    private readonly onDestroy: (roomId: string) => void,
  ) {
    this.game = new Game(this);
  }

  get connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  get host(): Player | undefined {
    return this.players.get(this.hostId);
  }

  /** Players in their reconnect grace period still hold a slot. */
  isFull(): boolean {
    return this.players.size >= this.settings.maxPlayers;
  }

  isBanned(ip: string, token?: string): boolean {
    return this.bannedIps.has(ip) || (token !== undefined && this.bannedTokens.has(token));
  }

  findByToken(token: string): Player | undefined {
    return [...this.players.values()].find((p) => p.token === token);
  }

  // ------------------------------------------------------------------ messaging

  broadcast(event: string, payload: unknown): void {
    this.io.to(this.id).emit(event, payload);
  }

  emitTo(player: Player, event: string, payload: unknown): void {
    if (player.socketId) this.io.to(player.socketId).emit(event, payload);
  }

  /** Each player gets their own view of the state, so the secret word never leaks. */
  broadcastState(): void {
    for (const player of this.connectedPlayers) {
      this.emitTo(player, 'game_state', this.game.stateFor(player));
    }
  }

  stateFor(player: Player): RoomState {
    return this.game.stateFor(player);
  }

  chat(kind: ChatKind, from: Player | null, text: string, recipients?: Player[]): void {
    const message: ChatMessage = {
      id: ++this.messageSeq,
      kind,
      playerId: from?.id ?? null,
      playerName: from?.name ?? null,
      text,
    };
    if (!recipients) {
      this.broadcast('chat_message', message);
      return;
    }
    for (const player of recipients) this.emitTo(player, 'chat_message', message);
  }

  system(text: string): void {
    this.chat('system', null, text);
  }

  // -------------------------------------------------------------------- members

  addPlayer(player: Player): void {
    if (this.players.size === 0) {
      this.hostId = player.id;
      player.ready = true;
    }
    this.players.set(player.id, player);
  }

  markDisconnected(player: Player): void {
    if (!player.connected) return;
    player.connected = false;
    player.socketId = null;
    player.graceTimer = setTimeout(() => this.removePlayer(player, 'timeout'), RECONNECT_GRACE_MS);
    this.broadcastState();
  }

  reconnect(player: Player, socketId: string): void {
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = null;
    player.connected = true;
    player.socketId = socketId;
  }

  kick(target: Player, ban: boolean): void {
    if (ban) {
      this.bannedTokens.add(target.token);
      this.bannedIps.add(target.ip);
    }
    this.emitTo(target, 'kicked', { banned: ban });
    this.removePlayer(target, ban ? 'banned' : 'kicked');
  }

  removePlayer(player: Player, reason: RemoveReason): void {
    if (!this.players.delete(player.id)) return;
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = null;

    if (player.socketId) {
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.leave(this.id);
        socket.data.roomId = undefined;
        socket.data.playerId = undefined;
      }
    }
    player.connected = false;
    player.socketId = null;

    if (this.players.size === 0) {
      this.destroy();
      return;
    }

    if (this.hostId === player.id) {
      const next = this.connectedPlayers[0] ?? [...this.players.values()][0];
      this.hostId = next.id;
      next.ready = true;
      this.system(`${next.name} is the new host.`);
    }

    const verb = { left: 'left', timeout: 'disconnected', kicked: 'was kicked', banned: 'was banned' }[reason];
    this.system(`${player.name} ${verb}.`);
    this.game.onPlayerRemoved(player);
    this.broadcast('player_left', {
      playerId: player.id,
      players: [...this.players.values()].map((p) => p.toPublic(this.hostId, this.game.drawerId)),
      reason,
    });
    this.broadcastState();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.game.dispose();
    for (const player of this.players.values()) {
      if (player.graceTimer) clearTimeout(player.graceTimer);
    }
    this.onDestroy(this.id);
  }
}
