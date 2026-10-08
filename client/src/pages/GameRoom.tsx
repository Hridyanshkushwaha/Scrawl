import { useState } from 'react';
import { ChatBox } from '../components/ChatBox';
import { DrawingCanvas } from '../components/DrawingCanvas';
import { GameOver } from '../components/GameOver';
import { RoundEndOverlay, WaitingForWord, WordPicker } from '../components/Overlays';
import { PlayerList } from '../components/PlayerList';
import { Toolbar } from '../components/Toolbar';
import type { GameApi } from '../hooks/useGame';
import type { GameOverPayload, RoomState, Tool } from '../types';

/** What the word line shows depends on what this particular player is allowed to know. */
function WordLine({ state }: { state: RoomState }) {
  if (state.phase === 'choosing') return <span className="word-note">Choosing a word…</span>;
  if (state.word) {
    return (
      <span className="word-known">
        {state.phase === 'drawing' && state.drawerId === state.you ? 'Draw: ' : ''}
        <b>{state.word}</b>
      </span>
    );
  }
  if (state.settings.wordMode === 'hidden') return <span className="word-note">Hidden word. No hints this round.</span>;
  if (!state.mask) return null;
  return (
    <span className="slots" aria-label={`Word with ${state.wordLength ?? 0} characters`}>
      {[...state.mask].map((ch, i) =>
        ch === ' ' ? <span key={i} className="slot-gap" /> : <span key={i} className={ch === '_' ? 'slot' : 'slot shown'}>{ch === '_' ? '' : ch}</span>,
      )}
    </span>
  );
}

function fallbackGameOver(state: RoomState): GameOverPayload {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const leaderboard = sorted.map((p) => ({
    playerId: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    rank: sorted.findIndex((q) => q.score === p.score) + 1,
  }));
  const top = leaderboard[0]?.score ?? 0;
  const winners = top > 0 ? leaderboard.filter((e) => e.score === top) : [];
  return { winner: winners[0] ?? null, winners, leaderboard };
}

export function GameRoom({ game, state }: { game: GameApi; state: RoomState }) {
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1b2a41');
  const [size, setSize] = useState(8);

  const me = state.players.find((p) => p.id === state.you);
  const drawer = state.players.find((p) => p.id === state.drawerId);
  const isDrawer = state.drawerId === state.you;
  const isHost = state.hostId === state.you;
  const canDraw = state.phase === 'drawing' && isDrawer;

  if (state.phase === 'game_over') {
    return (
      <main className="game">
        <GameOver
          data={game.gameOver ?? fallbackGameOver(state)}
          youId={state.you}
          isHost={isHost}
          onPlayAgain={() => void game.playAgain()}
          onLeave={() => void game.leaveRoom()}
        />
      </main>
    );
  }

  let placeholder = 'Say something…';
  if (state.phase === 'drawing') {
    if (isDrawer) placeholder = 'Chat with people who guessed';
    else if (me?.hasGuessed) placeholder = 'You got it! Chat with the other guessers';
    else placeholder = 'Type your guess…';
  }

  return (
    <main className="game">
      <header className="game-head">
        <div className="round-info">
          <span>
            Round {state.round} of {state.totalRounds}
          </span>
          {drawer && state.phase !== 'choosing' && <span className="muted">{isDrawer ? 'You are drawing' : `${drawer.name} is drawing`}</span>}
        </div>
        <div className="word-line">
          <WordLine state={state} />
        </div>
        <div className={state.phase === 'drawing' && game.timeLeft <= 10 ? 'clock urgent' : 'clock'} role="timer" aria-label={`${game.timeLeft} seconds left`}>
          {game.timeLeft}
        </div>
      </header>

      <div className="game-grid">
        <aside className="panel side" aria-label="Scoreboard">
          <PlayerList players={state.players} youId={state.you} phase={state.phase} canModerate={isHost} onKick={game.kick} />
          <button type="button" className="ghost small" onClick={() => void game.leaveRoom()}>
            Leave room
          </button>
        </aside>

        <section className="stage-wrap" aria-label="Drawing area">
          <div className="stage">
            <DrawingCanvas canDraw={canDraw} tool={tool} color={color} size={size} snapshot={game.canvas} />
            {state.phase === 'choosing' &&
              (isDrawer && state.wordOptions ? (
                <WordPicker options={state.wordOptions} timeLeft={game.timeLeft} onPick={(w) => void game.chooseWord(w)} />
              ) : (
                <WaitingForWord drawer={drawer} timeLeft={game.timeLeft} />
              ))}
            {state.phase === 'round_end' &&
              (game.roundEnd ? (
                <RoundEndOverlay data={game.roundEnd} players={state.players} />
              ) : (
                <div className="overlay" role="status">
                  <div className="overlay-card">
                    <h2>
                      The word was <span className="reveal">{state.word}</span>
                    </h2>
                  </div>
                </div>
              ))}
          </div>
          {canDraw && <Toolbar tool={tool} color={color} size={size} onTool={setTool} onColor={setColor} onSize={setSize} />}
        </section>

        <aside className="panel chat-panel" aria-label="Chat">
          <ChatBox messages={game.messages} onSend={game.sendMessage} placeholder={placeholder} />
        </aside>
      </div>
    </main>
  );
}
