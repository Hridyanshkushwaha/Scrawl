# Scrawl: a skribbl.io clone

A real-time multiplayer drawing and guessing game. One player draws a secret word, everyone else races to guess it. React + TypeScript + Vite on the front, Node + Express + Socket.IO on the back, with the server holding all game state.

**Live URL:** https://scrawl-nea9.onrender.com

---

## Features

| Area | What is implemented |
|---|---|
| Rooms | Create rooms with settings, join by code or invite link, private (code only) and public (listed, plus quick play) rooms |
| Lobby | Player list, ready-up, host-only start, host-only settings, chat, kick and ban |
| Game | Turn-based rounds (everyone draws once per round), word choice (1 to 5 words), timers, hints, early finish when everyone has guessed |
| Drawing | Pen, 16 colours, 4 brush sizes, eraser, undo, clear; strokes stream live to every player |
| Scoring | Time-weighted points, bonuses for the first three guessers, drawer points, live scoreboard, final leaderboard with ties |
| Settings | Max players 2 to 20, rounds 2 to 10, draw time 15 to 240 s, word count 1 to 5, hints 0 to 5, word mode (normal, hidden, combination), custom words |
| Resilience | Refresh or lose connection and you rejoin your seat; disconnects never corrupt the game; the game ends cleanly if too few players remain |

---

## Quick start

Requires Node.js 18 or newer.

```bash
# 1. install both projects
npm run install:all

# 2. start the game server (terminal 1)  ->  http://localhost:3001
npm run dev:server

# 3. start the client (terminal 2)       ->  http://localhost:5173
npm run dev:client
```

Open <http://localhost:5173>. The Vite dev server proxies `/socket.io` and `/api` to port 3001, so no environment variables or CORS setup are needed locally.

### Run it the way production does

```bash
npm run build     # builds client/dist and server/dist
npm start         # one process serves the API, WebSockets and the built client on port 3001
```

Then open <http://localhost:3001>.

### Environment variables

| Variable | Where | Purpose | Default |
|---|---|---|---|
| `PORT` | server | Listening port (hosting platforms set it for you) | `3001` |
| `CLIENT_ORIGIN` | server | Comma-separated allowed browser origins. Only needed when the client lives on a different domain | empty |
| `VITE_SERVER_URL` | client (build time) | URL of the game server. Only needed for a split deployment | empty (same origin) |
| `CHOOSE_SECONDS`, `ROUND_END_SECONDS`, `RECONNECT_GRACE_MS` | server | Timing tweaks, mostly for tests | `15`, `6`, `20000` |

Copy `server/.env.example` or `client/.env.example` if you need them.

---

## Testing locally with several players

1. Start the server and client (see above).
2. Open <http://localhost:5173> in **tab 1**, enter a name, choose **Create a room**, leave the defaults and create it. Note the room code, or use **Copy invite link**.
3. Open **tab 2** and **tab 3**. Use a normal window for one and a private window for another, or open the page on your phone using your laptop's LAN address (for example `http://192.168.1.20:5173`; start the client with `npm run dev:client -- --host`). Paste the invite link or type the code, then join.
4. In tabs 2 and 3 click **I'm ready**. In tab 1 click **Start game**.
5. The drawer picks a word and draws. In the other tabs type guesses. Try a wrong guess, a near miss (you get a private "really close" nudge), then the right word in any case, for example `  CAT `.
6. Check the edge cases:
   - Refresh a tab mid-game: you rejoin your seat with your score.
   - Close a tab for more than 20 seconds: that player is removed and the game carries on.
   - Use **Undo** and **Clear** as the drawer: every player's canvas follows.
   - As the host, kick or ban a player from the lobby or the scoreboard.

### Automated end-to-end check

`server/scripts/smoke.ts` drives real Socket.IO clients through a complete game against a running server (lobby rules, permissions, a six-turn game, word secrecy, scoring, hints, reconnection, moderation, word modes).

```bash
# terminal 1: fast timers so the test finishes quickly
cd server && CHOOSE_SECONDS=3 ROUND_END_SECONDS=1 RECONNECT_GRACE_MS=1500 npm run dev

# terminal 2
npm run test:smoke
```

---

## Architecture

```
Browser (React)                           Node server
┌───────────────────────────┐             ┌──────────────────────────────────────────┐
│ pages: Home, Lobby, Game  │             │ index.ts           Express + Socket.IO    │
│ useGame hook   ◄──────────┼─ WebSocket ─┼─► handlers/        validate, authorise    │
│ DrawingCanvas  (pointer   │  (Socket.IO)│   socketHandlers      every event         │
│  events -> 0..1 points)   │             │ classes/Room       players, host, bans,   │
└───────────────────────────┘             │                    broadcast helpers      │
                                          │ classes/Game       phases, turns, timer,  │
                                          │                    word, strokes, scores  │
                                          │ classes/Player     identity, rate limit   │
                                          │ services/          RoomManager, words,    │
                                          │                    validation, guess match│
                                          └──────────────────────────────────────────┘
```

Clients send **intents** ("I draw here", "I guess this", "start the game"). The server decides whether each intent is legal, updates its own state, and tells everyone the result. Nothing the client says about scores, turns, permissions or the word is trusted.

### Project layout

```
skribbl-clone/
├── client/
│   ├── src/
│   │   ├── components/   Avatar, DrawingCanvas, Toolbar, ChatBox, PlayerList,
│   │   │                 SettingsPanel, Overlays, GameOver
│   │   ├── pages/        Home, Lobby, GameRoom
│   │   ├── hooks/        useGame (all socket state and actions)
│   │   ├── lib/          socket, session storage, palette/avatars
│   │   ├── types/        shared payload types
│   │   ├── App.tsx, main.tsx, styles.css
│   └── vite.config.ts    dev proxy to the server
├── server/
│   ├── src/
│   │   ├── classes/      Room.ts, Game.ts, Player.ts
│   │   ├── handlers/     socketHandlers.ts
│   │   ├── services/     RoomManager, wordService, validate, guess
│   │   ├── data/         words.json (categorised)
│   │   ├── types/, index.ts
│   └── scripts/smoke.ts  end-to-end test
├── render.yaml           one-click Render blueprint
└── README.md
```

Two small deviations from the suggested structure: `services/` also holds the input validation and guess-matching helpers (so they are unit-testable without sockets), and `handlers/` is a single file because every event shares the same small set of helpers (`context`, `attach`, `fail`).

---

## WebSocket event flow

Events marked "ack" reply through the Socket.IO acknowledgement callback with `{ ok: true, ... }` or `{ ok: false, error }`.

### Rooms and lobby

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `create_room` | client → server (ack) | `{ hostName, avatar, settings }` | Ack returns `roomId`, `playerId`, `token`, `state`, `strokes` |
| `join_room` | client → server (ack) | `{ roomId, playerName, avatar }` | Fails if the code is wrong, room is full, or you are banned |
| `join_random` | client → server (ack) | `{ playerName, avatar }` | Joins a random public room |
| `rejoin_room` | client → server (ack) | `{ roomId, token }` | Restores a seat after refresh or reconnect |
| `list_rooms` | client → server (ack) | none | Public rooms only |
| `leave_room` | client → server (ack) | none | |
| `update_settings` | client → server (ack) | `{ settings }` | Host only, lobby only |
| `toggle_ready` | client → server (ack) | none | Non-host, lobby only |
| `start_game` | client → server (ack) | none | Host only; needs 2+ players and everyone ready |
| `play_again` | client → server (ack) | none | Host only, after game over |
| `kick_player` | client → server (ack) | `{ playerId, ban }` | Host only |
| `player_joined` / `player_left` | server → room | `{ player, players }` / `{ playerId, players, reason }` | |

### Game state

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `game_state` | server → each player | `{ phase, round, drawerId, mask, word, wordOptions, players, timeLeft, ... }` | **Per player**: `word` is null unless you are the drawer, have guessed, or the round has ended |
| `round_start` | server → each player | `{ drawerId, round, drawTime, chooseTime, wordOptions? }` | Only the drawer's copy contains `wordOptions` |
| `word_chosen` | client → server (ack) | `{ word }` | Must be one of the offered words |
| `timer` | server → room | `{ timeLeft }` | Once per second |
| `round_end` | server → room | `{ word, reason, scores, nextDrawerId }` | `scores` carry the per-player delta for the turn |
| `game_over` | server → room | `{ winner, winners, leaderboard }` | Ties produce several winners |

### Drawing

| Event | Direction | Payload |
|---|---|---|
| `draw_start` | client → server | `{ x, y, color, size, tool }` |
| `draw_move` | client → server | `{ x, y }` |
| `draw_end` | client → server | none |
| `draw_data` | server → everyone except the drawer | `{ type: 'start' \| 'move' \| 'end', ... }` |
| `draw_undo` | client → server | none (server replies with `canvas_state` `{ strokes }` to the room) |
| `canvas_clear` | client → server, then server → room | none |

The suggested spec says `draw_data` also goes to the drawer. Here the drawer paints locally the instant the pointer moves (no round-trip lag) and is not sent their own strokes again; undo and clear are broadcast to everyone including the drawer, and the drawer's canvas is repainted from the server's stroke list.

### Chat and guessing

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `guess` | client → server | `{ text }` | Rejected for the drawer and for players who already guessed |
| `chat` | client → server | `{ text }` | During a round, text from someone who has not guessed is treated as a guess |
| `chat_message` | server → room (or only the people who know the word) | `{ id, kind, playerId, playerName, text }` | |
| `guess_result` | server → room (correct) or guesser only (close) | `{ correct, close?, playerId, playerName, points }` | Never contains the guess text |
| `server_error` | server → one client | `{ message }` | Rate limit and rule violations |

---

## How it works

### Game state management

Each room owns one `Game` with the phases `lobby → choosing → drawing → round_end → (next turn or) game_over`. A single 1-second `setInterval` per game drives everything time-based: the word-choice countdown, the drawing countdown, hint reveals, and the pause on the round summary. Timers are cleared when a game ends, resets or the room is destroyed, so nothing leaks.

**Turn order.** At the start of each round the queue is filled with the players who are connected at that moment, in join order. Each turn takes the next player off the queue (skipping anyone who has left). When the queue is empty and the last round is finished, the game ends. A player who joins mid-game is added from the next round.

**Disconnects.** When a socket drops, the player is marked disconnected and keeps their seat for 20 seconds. Reconnecting with their token (kept in `sessionStorage`) restores it, including the canvas. After the grace period they are removed: if they were the drawer the turn ends, otherwise the "everyone guessed" check is re-run, the host role moves if needed, and if fewer than two players remain the game ends with the current scores.

### Drawing synchronisation

1. The drawer's `pointerdown/move/up` events become `draw_start`, `draw_move` and `draw_end`. Coordinates are sent as fractions of the canvas (0 to 1), so any screen size renders the same picture on a fixed 800×600 logical canvas.
2. The server checks that the sender is the current drawer during the `drawing` phase, validates the numbers and colour, appends to its stroke list (capped at 1000 strokes and 5000 points per stroke), and relays the event to everyone else.
3. Other clients paint incrementally: a dot on `start`, a line segment from the previous point on each `move`.
4. Because the server keeps the full stroke list, a player who joins or reconnects mid-round gets the whole picture in their join acknowledgement. Undo pops the last stroke on the server and sends `canvas_state` so all canvases repaint identically.

### Scoring and word validation

| Who | Points |
|---|---|
| Guesser | `50 + round(350 × timeLeft / drawTime)`, plus a bonus of 100 / 60 / 30 for the first / second / third correct guess (max 500) |
| Drawer | 25% of each correct guesser's points; 0 if nobody guesses |

A turn ends early when every connected guesser has it right. Ties at the end produce several winners.

**Matching.** Both the guess and the answer are normalised: lower-cased, accents stripped, whitespace trimmed and collapsed. Only an exact normalised match scores, so `  CAT ` matches `cat` but a sentence containing the word does not. A guess exactly one edit away from the answer (for words of 4+ letters) triggers a private "that is really close!" message to the guesser and never scores. That is the project's partial-match handling.

**Secrecy.** The word lives only in `Game`. `game_state` is built per player, so guessers never receive it. Correct guesses are broadcast without the text. Chat from the drawer and from people who already guessed is delivered only to the people who already know the word, so it cannot leak the answer.

### Security and validation

- The server checks every event: drawing events only from the current drawer in the drawing phase, guesses never from the drawer, start/settings/kick/restart only from the host, word choice only from the drawer and only from the offered list.
- Settings are validated against strict ranges; names and chat are stripped of control and invisible characters and `<` `>`, trimmed and length-limited. React also escapes everything it renders.
- Full rooms reject joins, banned players (by reconnect token and IP) cannot return, private rooms are never listed and need the 6-character code.
- Chat and guesses are rate-limited per player; Socket.IO payloads are capped at 100 KB.

---

## Deployment

### Render (recommended: one service for everything)

Render supports WebSockets natively, and this app serves its own built client, so one web service covers it.

1. Push this repository to GitHub.
2. In Render choose **New → Blueprint**, select the repository; it picks up `render.yaml`. (Or create a **Web Service** by hand: build command `npm run install:all && npm run build`, start command `npm start`, health check path `/health`.)
3. When the deploy finishes, open the service URL, create a room in one browser and join from another to confirm **create → draw → guess → score** works.
4. Put the URL at the top of this file.

The free plan sleeps after inactivity, so the first request can take about 30 seconds.

### Railway

Create a service from the repo and set the build command to `npm run install:all && npm run build` and the start command to `npm start`. Railway sets `PORT` and supports WebSockets with no extra settings.

### Vercel or Netlify (client only) plus Render or Railway (server)

Vercel and Netlify serve the static client well, but their serverless functions cannot hold a long-lived WebSocket connection, so the game server must run somewhere else. To split them:

1. Deploy the server (Render or Railway) and set `CLIENT_ORIGIN=https://your-client-domain`.
2. Deploy `client/` to Vercel/Netlify with build command `npm run build`, output directory `dist`, and the environment variable `VITE_SERVER_URL=https://your-server-domain`.
3. Add a rewrite of all routes to `/index.html` so invite links like `/?room=ABC123` always load the app.

### Platform constraints worth knowing

- Game state is kept in memory in a single Node process. Run **one instance**; a second instance would not know about rooms on the first. Scaling out would need sticky sessions plus a shared store (for example the Socket.IO Redis adapter and Redis for room state).
- A restart or redeploy ends all running games.

---

## Requirements checklist

| Requirement | Status |
|---|---|
| Create room with configurable settings | Done (players, rounds, draw time, word count, hints, word mode, visibility, custom words) |
| Join via link or code | Done (`/?room=CODE` prefills the code) |
| Lobby with player list, ready-up, host starts | Done |
| Private and public rooms | Done (public list plus quick play) |
| Turn-based rounds, one drawer, others guess | Done |
| Real-time drawing sync via WebSockets | Done |
| Word selection (1 to 5 choices) | Done (auto-picks on timeout; one choice starts immediately) |
| Guessing, points, leaderboard, winner | Done (ties handled) |
| Brush, colours, brush size, undo, clear | Done, plus eraser |
| Hints (revealed letters over time) | Done (0 to 5, evenly spaced) |
| Chat, correct-guess notices, countdown | Done |
| Word categories | Done (`words.json` is grouped by category) |
| Kick / ban | Done (host) |
| Votekick, multiple languages | Not implemented |
| Server-authoritative state, input validation, disconnect handling | Done |
| OOP server (`Room`, `Game`, `Player`, handlers) | Done |
| Bonus: word modes, custom words, avatars | Done (normal / hidden / combination, host custom words, 16 animal avatars) |
| Bonus: spectator mode, replay, report | Not implemented |
| Deployed with a live URL | **Needs your hosting account**: follow [Deployment](#deployment) and paste the URL at the top |

## Known limitations

- In-memory state and a single instance (see above).
- Undo resends the full stroke list; very long drawings make that message large.
- IP bans rely on the `X-Forwarded-For` header the hosting proxy sets, so they are a deterrent, not a guarantee.
