import { useState } from 'react';
import { ChatBox } from '../components/ChatBox';
import { PlayerList } from '../components/PlayerList';
import { SettingsPanel } from '../components/SettingsPanel';
import type { GameApi } from '../hooks/useGame';
import type { RoomState } from '../types';

export function Lobby({ game, state }: { game: GameApi; state: RoomState }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const me = state.players.find((p) => p.id === state.you);
  const isHost = state.hostId === state.you;
  const link = `${window.location.origin}/?room=${state.roomId}`;
  const others = state.players.filter((p) => p.id !== state.hostId && p.connected);
  const waitingOn = others.filter((p) => !p.ready).length;
  const connectedCount = state.players.filter((p) => p.connected).length;

  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? state.roomId : link);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      game.showToast('Copy failed. Select the text and copy it by hand.');
    }
  };

  let startHint = '';
  if (connectedCount < 2) startHint = 'Waiting for at least one more player.';
  else if (waitingOn > 0) startHint = `Waiting for ${waitingOn} player${waitingOn > 1 ? 's' : ''} to get ready.`;

  return (
    <main className="lobby">
      <header className="lobby-head">
        <div>
          <h1 className="display">Lobby</h1>
          <p className="muted">{state.settings.isPrivate ? 'Private room: only people with the code can join.' : 'Public room: listed for anyone to join.'}</p>
        </div>
        <div className="invite-box">
          <span className="muted">Room code</span>
          <b className="room-code">{state.roomId}</b>
          <div className="actions">
            <button type="button" className="ghost small" onClick={() => void copy('code')}>
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </button>
            <button type="button" className="ghost small" onClick={() => void copy('link')}>
              {copied === 'link' ? 'Copied' : 'Copy invite link'}
            </button>
          </div>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="panel" aria-label="Players in the room">
          <h2>
            Players <span className="muted">{state.players.length}/{state.settings.maxPlayers}</span>
          </h2>
          <PlayerList players={state.players} youId={state.you} phase="lobby" canModerate={isHost} onKick={game.kick} />
        </section>

        <section className="panel" aria-label="Room settings">
          <h2>{isHost ? 'Room settings' : 'Room settings (set by the host)'}</h2>
          <SettingsPanel value={state.settings} disabled={!isHost} onChange={(patch) => void game.updateSettings(patch)} />
        </section>

        <section className="panel lobby-chat" aria-label="Lobby chat">
          <h2>Chat</h2>
          <ChatBox messages={game.messages} onSend={game.sendMessage} placeholder="Say hello…" />
        </section>
      </div>

      <footer className="lobby-actions">
        {isHost ? (
          <>
            <button type="button" className="primary" disabled={connectedCount < 2 || waitingOn > 0} onClick={() => void game.startGame()}>
              Start game
            </button>
            {startHint && <span className="muted">{startHint}</span>}
          </>
        ) : (
          <button type="button" className={me?.ready ? 'secondary' : 'primary'} onClick={() => void game.toggleReady()}>
            {me?.ready ? 'Not ready' : "I'm ready"}
          </button>
        )}
        <button type="button" className="ghost" onClick={() => void game.leaveRoom()}>
          Leave room
        </button>
      </footer>
    </main>
  );
}
