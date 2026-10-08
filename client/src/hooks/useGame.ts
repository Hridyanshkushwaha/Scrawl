import { useCallback, useEffect, useRef, useState } from 'react';
import { emitAck, socket } from '../lib/socket';
import { clearSession, loadSession, saveSession } from '../lib/session';
import type {
  Ack,
  CanvasSnapshot,
  ChatMessage,
  GameOverPayload,
  JoinResponse,
  PublicRoomInfo,
  RoomSettings,
  RoomState,
  RoundEndPayload,
  Session,
  Stroke,
} from '../types';

const MAX_MESSAGES = 200;

/**
 * All realtime state lives here. The server is authoritative: this hook only mirrors
 * what it is told (`game_state`, `timer`, chat, ...) and sends intents back.
 */
export function useGame() {
  const [connected, setConnected] = useState(socket.connected);
  const [restoring, setRestoring] = useState(() => loadSession() !== null);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [state, setState] = useState<RoomState | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roundEnd, setRoundEnd] = useState<RoundEndPayload | null>(null);
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [canvas, setCanvas] = useState<CanvasSnapshot>({ version: 0, strokes: [] });
  const [toast, setToast] = useState<string | null>(null);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const localId = useRef(0);

  const pushMessage = useCallback((message: Omit<ChatMessage, 'id'> & { id?: number }) => {
    localId.current += 1;
    const entry: ChatMessage = { ...message, id: message.id ?? -localId.current };
    setMessages((prev) => [...prev, entry].slice(-MAX_MESSAGES));
  }, []);

  const setStrokes = useCallback((strokes: Stroke[]) => {
    setCanvas((prev) => ({ version: prev.version + 1, strokes }));
  }, []);

  const applyJoin = useCallback(
    (res: JoinResponse, fresh: boolean) => {
      const next: Session = { roomId: res.roomId, playerId: res.playerId, token: res.token };
      saveSession(next);
      setSession(next);
      setState(res.state);
      setTimeLeft(res.state.timeLeft);
      setStrokes(res.strokes);
      if (fresh) {
        setMessages([]);
        setRoundEnd(null);
        setGameOver(null);
      }
    },
    [setStrokes],
  );

  const resetToHome = useCallback(
    (message?: string) => {
      clearSession();
      setSession(null);
      setState(null);
      setRoundEnd(null);
      setGameOver(null);
      setStrokes([]);
      if (message) setToast(message);
    },
    [setStrokes],
  );

  // Rejoin after a refresh or a dropped connection, using the stored token.
  const tryRejoin = useCallback(async () => {
    const stored = sessionRef.current ?? loadSession();
    if (!stored) {
      setRestoring(false);
      return;
    }
    const res = await emitAck<JoinResponse>('rejoin_room', { roomId: stored.roomId, token: stored.token });
    if (res.ok) {
      applyJoin(res, false);
    } else {
      resetToHome();
    }
    setRestoring(false);
  }, [applyJoin, resetToHome]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      void tryRejoin();
    };
    const onDisconnect = () => setConnected(false);
    const onState = (next: RoomState) => {
      setState(next);
      setTimeLeft(next.timeLeft);
      if (next.phase === 'lobby') {
        setGameOver(null);
        setRoundEnd(null);
      } else if (next.phase === 'choosing' || next.phase === 'drawing') {
        setRoundEnd(null);
      }
    };
    const onCanvasState = (payload: { strokes: Stroke[] }) => setStrokes(payload.strokes);
    const onCanvasClear = () => setStrokes([]);
    const onChat = (message: ChatMessage) => pushMessage(message);
    const onGuessResult = (r: { correct: boolean; close?: boolean; playerId: string; playerName: string; points: number }) => {
      if (r.correct) {
        pushMessage({ kind: 'correct', playerId: r.playerId, playerName: r.playerName, text: `${r.playerName} guessed the word! (+${r.points})` });
      } else if (r.close) {
        pushMessage({ kind: 'close', playerId: null, playerName: null, text: 'That is really close!' });
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('game_state', onState);
    socket.on('timer', (p: { timeLeft: number }) => setTimeLeft(p.timeLeft));
    socket.on('round_end', (p: RoundEndPayload) => setRoundEnd(p));
    socket.on('game_over', (p: GameOverPayload) => setGameOver(p));
    socket.on('canvas_state', onCanvasState);
    socket.on('canvas_clear', onCanvasClear);
    socket.on('chat_message', onChat);
    socket.on('guess_result', onGuessResult);
    socket.on('server_error', (p: { message: string }) => setToast(p.message));
    socket.on('kicked', (p: { banned?: boolean }) =>
      resetToHome(p.banned ? 'The host banned you from this room.' : 'The host removed you from this room.'),
    );
    socket.on('session_replaced', () => resetToHome('This game was opened in another tab.'));

    if (socket.connected) void tryRejoin();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('game_state', onState);
      socket.off('timer');
      socket.off('round_end');
      socket.off('game_over');
      socket.off('canvas_state', onCanvasState);
      socket.off('canvas_clear', onCanvasClear);
      socket.off('chat_message', onChat);
      socket.off('guess_result', onGuessResult);
      socket.off('server_error');
      socket.off('kicked');
      socket.off('session_replaced');
    };
  }, [pushMessage, resetToHome, setStrokes, tryRejoin]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // ------------------------------------------------------------------ actions

  const joinFlow = useCallback(
    async (event: string, payload: unknown): Promise<string | null> => {
      const res = await emitAck<JoinResponse>(event, payload);
      if (!res.ok) return res.error;
      applyJoin(res, true);
      return null;
    },
    [applyJoin],
  );

  const createRoom = useCallback(
    (name: string, avatar: number, settings: RoomSettings) =>
      joinFlow('create_room', { hostName: name, avatar, settings }),
    [joinFlow],
  );
  const joinRoom = useCallback(
    (roomId: string, name: string, avatar: number) => joinFlow('join_room', { roomId, playerName: name, avatar }),
    [joinFlow],
  );
  const joinRandom = useCallback(
    (name: string, avatar: number) => joinFlow('join_random', { playerName: name, avatar }),
    [joinFlow],
  );

  const listRooms = useCallback(async (): Promise<PublicRoomInfo[]> => {
    const res = await emitAck<{ rooms: PublicRoomInfo[] }>('list_rooms');
    return res.ok ? res.rooms : [];
  }, []);

  /** Fire an intent and surface a failure as a toast. */
  const command = useCallback(async (event: string, payload?: unknown): Promise<boolean> => {
    const res: Ack = await emitAck(event, payload);
    if (!res.ok) setToast(res.error);
    return res.ok;
  }, []);

  const leaveRoom = useCallback(async () => {
    await emitAck('leave_room');
    resetToHome();
  }, [resetToHome]);

  const sendMessage = useCallback((text: string) => {
    const me = state?.players.find((p) => p.id === state.you);
    const guessing = state?.phase === 'drawing' && !!me && !me.isDrawer && !me.hasGuessed;
    socket.emit(guessing ? 'guess' : 'chat', { text });
  }, [state]);

  return {
    connected,
    restoring,
    session,
    state,
    timeLeft,
    messages,
    roundEnd,
    gameOver,
    canvas,
    toast,
    dismissToast: () => setToast(null),
    showToast: setToast,
    createRoom,
    joinRoom,
    joinRandom,
    listRooms,
    leaveRoom,
    sendMessage,
    updateSettings: (settings: Partial<RoomSettings>) => command('update_settings', { settings }),
    toggleReady: () => command('toggle_ready'),
    startGame: () => command('start_game'),
    playAgain: () => command('play_again'),
    chooseWord: (word: string) => command('word_chosen', { word }),
    kick: (playerId: string, ban: boolean) => command('kick_player', { playerId, ban }),
  };
}

export type GameApi = ReturnType<typeof useGame>;
