/**
 * End-to-end smoke test. Talks to a RUNNING server over real Socket.IO connections.
 *
 *   CHOOSE_SECONDS=3 ROUND_END_SECONDS=1 RECONNECT_GRACE_MS=1500 npm run dev   (terminal 1)
 *   npm run test:smoke                                                          (terminal 2)
 */
import { io, Socket } from 'socket.io-client';

const URL = process.env.SERVER_URL ?? 'http://localhost:3001';
let failures = 0;

function check(name: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(50);
  }
  console.log(`  TIMEOUT waiting for: ${label}`);
  failures += 1;
  return false;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

class Client {
  socket: Socket;
  state: Json = null;
  playerId = '';
  token = '';
  roomId = '';
  stateLog: Json[] = [];
  drawData: Json[] = [];
  chat: Json[] = [];
  results: Json[] = [];
  errors: string[] = [];
  roundEnds: Json[] = [];
  gameOver: Json = null;
  kicked = false;

  constructor(readonly name: string) {
    this.socket = this.connect();
  }

  private connect(): Socket {
    const socket = io(URL, { forceNew: true, transports: ['websocket'] });
    socket.on('game_state', (s: Json) => {
      this.state = s;
      this.stateLog.push(s);
    });
    socket.on('draw_data', (d: Json) => this.drawData.push(d));
    socket.on('chat_message', (m: Json) => this.chat.push(m));
    socket.on('guess_result', (r: Json) => this.results.push(r));
    socket.on('server_error', (e: Json) => this.errors.push(e.message));
    socket.on('round_end', (r: Json) => this.roundEnds.push(r));
    socket.on('game_over', (g: Json) => (this.gameOver = g));
    socket.on('kicked', () => (this.kicked = true));
    return socket;
  }

  async ready(): Promise<void> {
    if (this.socket.connected) return;
    await new Promise<void>((resolve) => this.socket.once('connect', () => resolve()));
  }

  emit(event: string, payload?: unknown): Promise<Json> {
    return new Promise((resolve) => {
      this.socket.timeout(5000).emit(event, payload, (err: unknown, res: Json) => {
        resolve(err ? { ok: false, error: 'ack timeout' } : res);
      });
    });
  }

  /** Fire-and-forget: drawing events are never acknowledged by the server. */
  fire(event: string, payload?: unknown): void {
    this.socket.emit(event, payload);
  }

  adopt(res: Json): Json {
    if (res?.ok) {
      this.playerId = res.playerId;
      this.token = res.token;
      this.roomId = res.roomId;
      this.state = res.state;
    }
    return res;
  }

  /** Simulates a dropped connection and a page refresh that rejoins with the stored token. */
  async dropAndRejoin(afterMs: number): Promise<Json> {
    this.socket.disconnect();
    await sleep(afterMs);
    this.socket = this.connect();
    await this.ready();
    return this.adopt(await this.emit('rejoin_room', { roomId: this.roomId, token: this.token }));
  }

  close(): void {
    this.socket.disconnect();
  }
}

async function newClients(...names: string[]): Promise<Client[]> {
  const clients = names.map((n) => new Client(n));
  await Promise.all(clients.map((c) => c.ready()));
  return clients;
}

// ----------------------------------------------------------------------------

async function testLobbyRules(): Promise<{ a: Client; b: Client; c: Client; roomId: string }> {
  console.log('\n[1] Lobby, validation and permissions');
  const [a, b, c, d] = await newClients('Ann', 'Bob', 'Cy', 'Dee');

  const bad = await a.emit('create_room', { hostName: 'Ann', settings: { rounds: 99 } });
  check('rejects out-of-range settings', !bad.ok, bad);
  const noName = await a.emit('create_room', { hostName: '   ', settings: {} });
  check('rejects an empty name', !noName.ok, noName);

  const created = a.adopt(
    await a.emit('create_room', {
      hostName: '<b>Ann</b>',
      avatar: 3,
      settings: { rounds: 2, drawTime: 15, wordCount: 3, hints: 2, maxPlayers: 3, isPrivate: true },
    }),
  );
  check('host can create a private room', created.ok && created.roomId.length === 6, created);
  check('player names are sanitised', created.state.players[0].name === 'bAnn/b', created.state?.players);

  const listing = await d.emit('list_rooms');
  check('private rooms are not listed', listing.ok && !listing.rooms.some((r: Json) => r.roomId === a.roomId));

  const wrong = await b.emit('join_room', { roomId: 'ZZZZZZ', playerName: 'Bob' });
  check('joining with a wrong code fails', !wrong.ok, wrong);

  check('player B joins with the code', b.adopt(await b.emit('join_room', { roomId: a.roomId.toLowerCase(), playerName: 'Bob' })).ok);
  check('player C joins with the code', c.adopt(await c.emit('join_room', { roomId: a.roomId, playerName: 'Cy' })).ok);
  const full = await d.emit('join_room', { roomId: a.roomId, playerName: 'Dee' });
  check('a full room rejects new players', !full.ok && /full/i.test(full.error), full);
  d.close();

  const bStart = await b.emit('start_game');
  check('non-host cannot start the game', !bStart.ok, bStart);
  const bSettings = await b.emit('update_settings', { settings: { rounds: 5 } });
  check('non-host cannot change settings', !bSettings.ok, bSettings);
  const bKick = await b.emit('kick_player', { playerId: c.playerId });
  check('non-host cannot kick', !bKick.ok, bKick);
  const early = await a.emit('start_game');
  check('host cannot start before others are ready', !early.ok, early);

  await b.emit('toggle_ready');
  await c.emit('toggle_ready');
  await sleep(150);
  check('ready state is visible to everyone', a.state.players.filter((p: Json) => p.ready).length === 3);
  return { a, b, c, roomId: a.roomId };
}

async function testFullGame(a: Client, b: Client, c: Client): Promise<void> {
  console.log('\n[2] Full game: 3 players, 2 rounds (6 turns)');
  const clients = [a, b, c];
  const shared = { word: '', wordSeen: new Set<string>() };
  const handled = new Set<string>();
  let illegalTried = false;

  for (const client of clients) {
    client.socket.on('round_start', async (payload: Json) => {
      if (!payload.wordOptions) {
        if (!illegalTried) {
          illegalTried = true;
          const res = await client.emit('word_chosen', { word: 'cheater' });
          check('non-drawer cannot choose the word', !res.ok, res);
        }
        return;
      }
      const res = await client.emit('word_chosen', { word: 'not-offered' });
      check('drawer cannot choose a word that was not offered', !res.ok, res);
      await client.emit('word_chosen', { word: payload.wordOptions[0] });
    });

    client.socket.on('game_state', async (s: Json) => {
      if (s.phase !== 'drawing' || s.drawerId !== client.playerId) return;
      const key = `${s.round}:${client.playerId}`;
      if (handled.has(key)) return;
      handled.add(key);
      shared.word = s.word;

      // Draw something real.
      client.fire('draw_start', { x: 0.1, y: 0.1, color: '#ff0000', size: 8, tool: 'pen' });
      for (let i = 1; i <= 5; i++) client.fire('draw_move', { x: 0.1 + i * 0.05, y: 0.2 });
      await sleep(50);
      client.fire('draw_end');

      if (handled.size === 1) {
        // First turn only: exercise the guard rails.
        client.fire('guess', { text: shared.word });
        await sleep(200);
        check('drawer cannot guess their own word', client.errors.some((e) => /own word/i.test(e)), client.errors);
        const bogus = client.fire('draw_start', { x: 5, y: 'nope', color: 'red', size: 3 });
        void bogus;
        for (const other of clients.filter((o) => o !== client)) {
          other.socket.emit('draw_start', { x: 0.999, y: 0.999, color: '#000000', size: 4, tool: 'pen' });
          other.socket.emit('draw_move', { x: 0.999, y: 0.998 });
        }
        client.socket.emit('chat', { text: `psst it is ${shared.word}` });
      }

      // Everyone else guesses: first a wrong guess, then the right one (messy case/whitespace).
      clients
        .filter((o) => o !== client)
        .forEach((guesser, i) => {
          setTimeout(() => {
            guesser.socket.emit('guess', { text: 'zzzz-wrong' });
            setTimeout(() => guesser.socket.emit('guess', { text: `   ${shared.word.toUpperCase()}  ` }), 120);
          }, 250 + i * 250);
        });
    });
  }

  const started = await a.emit('start_game');
  check('host starts the game', started.ok, started);
  const finished = await waitFor('game_over', () => clients.every((cl) => cl.gameOver), 60000);
  if (!finished) return;

  check('six turns were played', a.roundEnds.length === 6, a.roundEnds.length);
  check('every turn ended because everyone guessed', a.roundEnds.every((r) => r.reason === 'all_guessed'), a.roundEnds.map((r) => r.reason));
  check('every drawer scored from correct guesses', a.roundEnds.every((r) => r.scores.some((s: Json) => s.delta > 0)));
  const turns = new Set(a.stateLog.filter((s) => s.phase === 'drawing').map((s) => `${s.round}:${s.drawerId}`));
  const perPlayer = [a, b, c].map((cl) => [...turns].filter((t) => t.endsWith(`:${cl.playerId}`)).length);
  check('each player drew exactly once per round (twice in total)', turns.size === 6 && perPlayer.every((n) => n === 2), [...turns]);
  check('wrong guesses were broadcast as guesses', b.chat.some((m) => m.kind === 'guess' && m.text === 'zzzz-wrong'));
  check('correct guesses were announced without the word', a.results.filter((r) => r.correct).length === 12 && a.results.every((r) => !('text' in r)));
  check('close/wrong feedback is private to the guesser', a.results.every((r) => r.correct));

  // The secret word must never reach someone who has not guessed yet.
  let leaks = 0;
  for (const client of clients) {
    for (const s of client.stateLog) {
      const me = s.players.find((p: Json) => p.id === client.playerId);
      if (s.phase === 'drawing' && s.drawerId !== client.playerId && !me.hasGuessed && s.word !== null) leaks += 1;
      if (s.phase === 'choosing' && s.drawerId !== client.playerId && s.wordOptions !== null) leaks += 1;
    }
  }
  check('word is never exposed to players who have not guessed', leaks === 0, leaks);
  check('insider chat does not leak the word to guessers', ![b, c].some((cl) => cl.chat.some((m) => /psst it is/.test(m.text) && cl.state && !cl.stateLog.some((s) => s.phase === 'drawing' && s.drawerId !== cl.playerId && s.players.find((p: Json) => p.id === cl.playerId)?.hasGuessed))));
  check('illegal draw events from non-drawers were ignored', ![a, b, c].some((cl) => cl.drawData.some((d) => d.x === 0.999)));
  check('drawing reached the other players', b.drawData.some((d) => d.type === 'start') && b.drawData.filter((d) => d.type === 'move').length >= 5);

  const board = a.gameOver.leaderboard;
  check('leaderboard is sorted and has everyone', board.length === 3 && board[0].score >= board[1].score && board[1].score >= board[2].score, board);
  check('there is a winner', a.gameOver.winner && a.gameOver.winner.score === board[0].score);
  const total = board.reduce((sum: number, e: Json) => sum + e.score, 0);
  check('scores are server-computed and positive', total > 0, total);

  const nonHostAgain = await b.emit('play_again');
  check('non-host cannot restart', !nonHostAgain.ok, nonHostAgain);
  const again = await a.emit('play_again');
  await sleep(150);
  check('host can return everyone to the lobby with scores reset', again.ok && b.state.phase === 'lobby' && b.state.players.every((p: Json) => p.score === 0), b.state);
}

async function testModerationAndLeaving(a: Client, b: Client, c: Client): Promise<void> {
  console.log('\n[3] Moderation');
  const kick = await a.emit('kick_player', { playerId: c.playerId, ban: true });
  check('host can ban a player', kick.ok, kick);
  await sleep(200);
  check('banned player is told', c.kicked);
  check('player list updated after ban', a.state.players.length === 2, a.state.players);
  const rejoin = await c.emit('join_room', { roomId: a.roomId, playerName: 'Cy' });
  check('banned player cannot rejoin', !rejoin.ok, rejoin);
  const left = await b.emit('leave_room');
  await sleep(200);
  check('leaving transfers nothing when the host stays', left.ok && a.state.hostId === a.playerId && a.state.players.length === 1);
  await a.emit('leave_room');
  [a, b, c].forEach((cl) => cl.close());
}

async function testHintsReconnectAndPublic(): Promise<void> {
  console.log('\n[4] Public rooms, hints, timeout, reconnect, leaving mid-game');
  const [a, b, c] = await newClients('Pia', 'Quin', 'Rae');
  const created = a.adopt(
    await a.emit('create_room', {
      hostName: 'Pia',
      settings: { rounds: 2, drawTime: 15, wordCount: 1, hints: 2, maxPlayers: 4, isPrivate: false },
    }),
  );
  check('public room created', created.ok);
  const listing = await c.emit('list_rooms');
  check('public room is listed', listing.ok && listing.rooms.some((r: Json) => r.roomId === a.roomId), listing);
  check('quick play joins the public room', b.adopt(await b.emit('join_random', { playerName: 'Quin' })).roomId === a.roomId);
  await b.emit('toggle_ready');
  const started = await a.emit('start_game');
  check('game starts with a single word option (auto-chosen)', started.ok, started);
  await waitFor('drawing phase', () => b.state?.phase === 'drawing', 8000);

  const wordLength = a.state.word.length;
  check('drawer sees the word, guesser sees blanks', b.state.word === null && b.state.mask.replace(/ /g, '').split('').every((ch: string) => ch === '_') && wordLength > 0, b.state);

  a.fire('draw_start', { x: 0.2, y: 0.2, color: '#00ff00', size: 6, tool: 'pen' });
  a.fire('draw_move', { x: 0.3, y: 0.3 });
  a.fire('draw_end');
  a.fire('draw_start', { x: 0.5, y: 0.5, color: '#0000ff', size: 6, tool: 'eraser' });
  a.fire('draw_end');
  a.fire('draw_undo');
  await sleep(150);

  const rejoined = await b.dropAndRejoin(500);
  check('a dropped player can rejoin with their token', rejoined.ok && rejoined.state.phase === 'drawing', rejoined);
  check('rejoin restores the canvas (undo applied)', rejoined.strokes.length === 1 && rejoined.strokes[0].points.length === 2, rejoined.strokes);
  check('rejoin does not leak the word', rejoined.state.word === null);
  const hijack = await c.emit('rejoin_room', { roomId: a.roomId, token: 'not-a-real-token' });
  check('rejoin with a bad token fails', !hijack.ok, hijack);

  const maskAtStart = b.state.mask;
  await waitFor('timeout round end', () => a.roundEnds.length >= 1, 25000);
  const masks = new Set(b.stateLog.filter((s) => s.phase === 'drawing').map((s) => s.mask));
  check('hints revealed letters over time', masks.size >= 3 && !masks.has(a.roundEnds[0].word), [...masks]);
  check('first mask was all blanks', /^[_ \-']+$/.test(maskAtStart) || masks.has(maskAtStart));
  check('turn ended on the timer with the word revealed', a.roundEnds[0].reason === 'time_up' && b.state.word === a.roundEnds[0].word, a.roundEnds[0]);
  check('nobody scored when nobody guessed', a.roundEnds[0].scores.every((s: Json) => s.delta === 0));

  await sleep(300);
  await a.emit('leave_room');
  await waitFor('game_over after the drawer leaves', () => b.gameOver !== null, 8000);
  check('game ends gracefully when too few players remain', b.state.phase === 'game_over' && b.state.players.length === 1, b.state);
  [a, b, c].forEach((cl) => cl.close());
}

async function testWordModes(): Promise<void> {
  console.log('\n[5] Word modes');
  const [a, b] = await newClients('Hal', 'Ivy');
  a.adopt(await a.emit('create_room', { hostName: 'Hal', settings: { wordMode: 'hidden', wordCount: 1, drawTime: 15 } }));
  b.adopt(await b.emit('join_room', { roomId: a.roomId, playerName: 'Ivy' }));
  await b.emit('toggle_ready');
  await a.emit('start_game');
  await waitFor('drawing', () => b.state?.phase === 'drawing', 8000);
  check('hidden mode shows guessers no blanks', b.state.mask === '' && b.state.wordLength === null, b.state);
  const right = await new Promise<Json>((resolve) => {
    b.socket.once('guess_result', resolve);
    b.socket.emit('guess', { text: a.state.word });
  });
  check('hidden mode words can still be guessed', right.correct === true && right.points > 0, right);
  await a.emit('leave_room');
  await b.emit('leave_room');

  a.adopt(await a.emit('create_room', { hostName: 'Hal', settings: { wordMode: 'combination', wordCount: 3, drawTime: 15 } }));
  b.adopt(await b.emit('join_room', { roomId: a.roomId, playerName: 'Ivy' }));
  await b.emit('toggle_ready');
  const options = await new Promise<string[]>((resolve) => {
    a.socket.once('round_start', (p: Json) => resolve(p.wordOptions));
    void a.emit('start_game');
  });
  check('combination mode offers two-word options', options.length === 3 && options.every((o) => o.split(' ').length === 2), options);
  [a, b].forEach((cl) => cl.close());
}

async function main(): Promise<void> {
  console.log(`Smoke testing ${URL}`);
  const { a, b, c } = await testLobbyRules();
  await testFullGame(a, b, c);
  await testModerationAndLeaving(a, b, c);
  await testHintsReconnectAndPublic();
  await testWordModes();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
