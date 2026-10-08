import type { Server, Socket } from 'socket.io';
import { Player } from '../classes/Player';
import type { Room } from '../classes/Room';
import type { RoomManager } from '../services/RoomManager';
import {
  DEFAULT_SETTINGS,
  isRecord,
  parseAvatar,
  parseDrawStart,
  parsePoint,
  parseRoomCode,
  parseSettings,
  sanitizeChat,
  sanitizeName,
} from '../services/validate';

type Ack = (response: unknown) => void;

function clientIp(socket: Socket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || socket.handshake.address;
}

function uniqueName(room: Room, wanted: string): string {
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; n < 100; n++) {
    const candidate = `${wanted.slice(0, 16)} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return wanted;
}

/** Registers every Socket.IO event. All payloads are untrusted and validated here. */
export function registerSocketHandlers(io: Server, manager: RoomManager): void {
  io.on('connection', (socket) => {
    const ip = clientIp(socket);

    const reply = (ack: unknown, response: unknown): void => {
      if (typeof ack === 'function') (ack as Ack)(response);
    };
    const fail = (ack: unknown, error: string): void => reply(ack, { ok: false, error });
    const notify = (message: string): void => {
      socket.emit('server_error', { message });
    };

    /** The room and player this socket currently controls, if any. */
    const context = (): { room: Room; player: Player } | null => {
      const roomId = socket.data.roomId as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!roomId || !playerId) return null;
      const room = manager.get(roomId);
      const player = room?.players.get(playerId);
      if (!room || !player || player.socketId !== socket.id) return null;
      return { room, player };
    };

    const attach = (room: Room, player: Player): void => {
      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerId = player.id;
    };

    const leaveCurrentRoom = (): void => {
      const ctx = context();
      if (ctx) ctx.room.removePlayer(ctx.player, 'left');
    };

    const joinedPayload = (room: Room, player: Player) => ({
      ok: true,
      roomId: room.id,
      playerId: player.id,
      token: player.token,
      state: room.stateFor(player),
      strokes: room.game.strokes,
    });

    const joinRoom = (room: Room, rawName: unknown, rawAvatar: unknown, ack: unknown): void => {
      const name = sanitizeName(rawName);
      if (!name) return fail(ack, 'Please enter a name.');
      if (room.isBanned(ip)) return fail(ack, 'You are banned from this room.');
      if (room.isFull()) return fail(ack, 'That room is full.');

      leaveCurrentRoom();
      const player = new Player(socket.id, uniqueName(room, name), parseAvatar(rawAvatar), ip);
      room.addPlayer(player);
      attach(room, player);
      room.broadcast('player_joined', {
        player: player.toPublic(room.hostId, room.game.drawerId),
        players: [...room.players.values()].map((p) => p.toPublic(room.hostId, room.game.drawerId)),
      });
      room.system(`${player.name} joined.`);
      room.broadcastState();
      reply(ack, joinedPayload(room, player));
    };

    /** Wraps a handler so one bad payload can never crash the process. */
    const on = (event: string, handler: (payload: unknown, ack: unknown) => void): void => {
      socket.on(event, (payload: unknown, ack: unknown) => {
        try {
          handler(payload, ack);
        } catch (error) {
          console.error(`[socket ${socket.id}] ${event} failed`, error);
          fail(ack, 'Something went wrong on the server.');
        }
      });
    };

    // ------------------------------------------------------------ rooms & lobby

    on('create_room', (payload, ack) => {
      if (!isRecord(payload)) return fail(ack, 'Invalid request.');
      const name = sanitizeName(payload.hostName);
      if (!name) return fail(ack, 'Please enter a name.');
      const parsed = parseSettings(payload.settings, DEFAULT_SETTINGS);
      if (!parsed.ok) return fail(ack, parsed.error);

      leaveCurrentRoom();
      const room = manager.create(parsed.settings);
      if (!room) return fail(ack, 'The server is full. Please try again later.');
      const player = new Player(socket.id, name, parseAvatar(payload.avatar), ip);
      room.addPlayer(player);
      attach(room, player);
      room.system(`${player.name} created the room.`);
      reply(ack, joinedPayload(room, player));
    });

    on('join_room', (payload, ack) => {
      if (!isRecord(payload)) return fail(ack, 'Invalid request.');
      const code = parseRoomCode(payload.roomId);
      if (!code) return fail(ack, 'Enter a valid room code.');
      const room = manager.get(code);
      if (!room) return fail(ack, 'No room with that code exists.');
      joinRoom(room, payload.playerName, payload.avatar, ack);
    });

    on('join_random', (payload, ack) => {
      const data = isRecord(payload) ? payload : {};
      const room = manager.findRandomPublic();
      if (!room) return fail(ack, 'No public rooms are open. Create one!');
      joinRoom(room, data.playerName, data.avatar, ack);
    });

    on('rejoin_room', (payload, ack) => {
      if (!isRecord(payload)) return fail(ack, 'Invalid request.');
      const code = parseRoomCode(payload.roomId);
      const token = typeof payload.token === 'string' ? payload.token : '';
      const room = code ? manager.get(code) : undefined;
      const player = room?.findByToken(token);
      if (!room || !player) return fail(ack, 'Your session has expired.');

      if (player.socketId && player.socketId !== socket.id) {
        const old = io.sockets.sockets.get(player.socketId);
        if (old) {
          old.emit('session_replaced');
          old.leave(room.id);
          old.data.roomId = undefined;
          old.data.playerId = undefined;
        }
      }
      room.reconnect(player, socket.id);
      attach(room, player);
      room.broadcastState();
      reply(ack, joinedPayload(room, player));
    });

    on('list_rooms', (_payload, ack) => {
      reply(ack, { ok: true, rooms: manager.listPublic() });
    });

    on('leave_room', (_payload, ack) => {
      leaveCurrentRoom();
      reply(ack, { ok: true });
    });

    on('update_settings', (payload, ack) => {
      const ctx = context();
      if (!ctx) return fail(ack, 'You are not in a room.');
      const { room, player } = ctx;
      if (player.id !== room.hostId) return fail(ack, 'Only the host can change settings.');
      if (room.game.phase !== 'lobby') return fail(ack, 'Settings can only change in the lobby.');
      if (!isRecord(payload)) return fail(ack, 'Invalid settings.');
      const parsed = parseSettings(payload.settings, room.settings);
      if (!parsed.ok) return fail(ack, parsed.error);
      if (parsed.settings.maxPlayers < room.players.size) {
        return fail(ack, 'Max players cannot be lower than the number of players in the room.');
      }
      room.settings = parsed.settings;
      room.broadcastState();
      reply(ack, { ok: true });
    });

    on('toggle_ready', (_payload, ack) => {
      const ctx = context();
      if (!ctx) return fail(ack, 'You are not in a room.');
      const { room, player } = ctx;
      if (room.game.phase !== 'lobby' || player.id === room.hostId) return reply(ack, { ok: true });
      player.ready = !player.ready;
      room.broadcastState();
      reply(ack, { ok: true });
    });

    on('start_game', (_payload, ack) => {
      const ctx = context();
      if (!ctx) return fail(ack, 'You are not in a room.');
      if (ctx.player.id !== ctx.room.hostId) return fail(ack, 'Only the host can start the game.');
      const error = ctx.room.game.startGame();
      if (error) return fail(ack, error);
      reply(ack, { ok: true });
    });

    on('play_again', (_payload, ack) => {
      const ctx = context();
      if (!ctx) return fail(ack, 'You are not in a room.');
      if (ctx.player.id !== ctx.room.hostId) return fail(ack, 'Only the host can restart the game.');
      const error = ctx.room.game.playAgain();
      if (error) return fail(ack, error);
      reply(ack, { ok: true });
    });

    on('kick_player', (payload, ack) => {
      const ctx = context();
      if (!ctx) return fail(ack, 'You are not in a room.');
      const { room, player } = ctx;
      if (player.id !== room.hostId) return fail(ack, 'Only the host can remove players.');
      if (!isRecord(payload) || typeof payload.playerId !== 'string') return fail(ack, 'Invalid request.');
      const target = room.players.get(payload.playerId);
      if (!target || target.id === player.id) return fail(ack, 'You cannot remove that player.');
      room.kick(target, payload.ban === true);
      reply(ack, { ok: true });
    });

    // -------------------------------------------------------------- game flow

    on('word_chosen', (payload, ack) => {
      const ctx = context();
      if (!ctx) return fail(ack, 'You are not in a room.');
      const word = isRecord(payload) ? payload.word : undefined;
      const error = ctx.room.game.chooseWord(ctx.player, word);
      if (error) return fail(ack, error);
      reply(ack, { ok: true });
    });

    // ---------------------------------------------------------------- drawing
    // Events from anyone but the current drawer are silently ignored.

    on('draw_start', (payload) => {
      const ctx = context();
      const input = parseDrawStart(payload);
      if (!ctx || !input) return;
      if (ctx.room.game.drawStart(ctx.player, input)) {
        socket.to(ctx.room.id).emit('draw_data', { type: 'start', ...input });
      }
    });

    on('draw_move', (payload) => {
      const ctx = context();
      const point = parsePoint(payload);
      if (!ctx || !point) return;
      if (ctx.room.game.drawMove(ctx.player, point)) {
        socket.to(ctx.room.id).emit('draw_data', { type: 'move', ...point });
      }
    });

    on('draw_end', () => {
      const ctx = context();
      if (ctx && ctx.room.game.drawEnd(ctx.player)) {
        socket.to(ctx.room.id).emit('draw_data', { type: 'end' });
      }
    });

    on('canvas_clear', () => {
      const ctx = context();
      if (ctx && ctx.room.game.clearCanvas(ctx.player)) ctx.room.broadcast('canvas_clear', {});
    });

    on('draw_undo', () => {
      const ctx = context();
      if (ctx && ctx.room.game.undo(ctx.player)) {
        ctx.room.broadcast('canvas_state', { strokes: ctx.room.game.strokes });
      }
    });

    // ----------------------------------------------------------- chat & guesses

    on('guess', (payload) => {
      const ctx = context();
      if (!ctx) return;
      const text = sanitizeChat(isRecord(payload) ? payload.text : undefined);
      if (!text) return;
      if (!ctx.player.allowMessage()) return notify('Slow down a little.');
      const error = ctx.room.game.handleGuess(ctx.player, text);
      if (error) notify(error);
    });

    on('chat', (payload) => {
      const ctx = context();
      if (!ctx) return;
      const text = sanitizeChat(isRecord(payload) ? payload.text : undefined);
      if (!text) return;
      if (!ctx.player.allowMessage()) return notify('Slow down a little.');
      ctx.room.game.handleMessage(ctx.player, text);
    });

    socket.on('disconnect', () => {
      const ctx = context();
      if (ctx) ctx.room.markDisconnected(ctx.player);
    });
  });
}
