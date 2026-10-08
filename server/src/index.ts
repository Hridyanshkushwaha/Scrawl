import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './handlers/socketHandlers';
import { RoomManager } from './services/RoomManager';

const PORT = Number(process.env.PORT) || 3001;
// Only needed when the client is hosted on a different origin (e.g. Vercel + Render).
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  ...(allowedOrigins.length > 0 ? { cors: { origin: allowedOrigins } } : {}),
  maxHttpBufferSize: 1e5,
});
const manager = new RoomManager(io);
registerSocketHandlers(io, manager);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: manager.listPublic() });
});

// In production the built React client is served by this same process,
// so one deployment (and one origin) covers HTTP and WebSockets.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`Scrawl server listening on port ${PORT}`);
});

function shutdown(): void {
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
