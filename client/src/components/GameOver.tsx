import type { GameOverPayload } from '../types';
import { Avatar } from './Avatar';

interface Props {
  data: GameOverPayload;
  youId: string;
  isHost: boolean;
  onPlayAgain: () => void;
  onLeave: () => void;
}

export function GameOver({ data, youId, isHost, onPlayAgain, onLeave }: Props) {
  const names = data.winners.map((w) => w.name);
  const headline =
    names.length === 0
      ? 'Nobody scored this time'
      : names.length === 1
        ? `${names[0]} wins!`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} tie for the win`;

  return (
    <div className="gameover">
      <h1 className="display">{headline}</h1>
      <ol className="board">
        {data.leaderboard.map((entry) => (
          <li key={entry.playerId} className={entry.rank === 1 && entry.score > 0 ? 'board-row first' : 'board-row'}>
            <span className="rank">{entry.rank}</span>
            <Avatar index={entry.avatar} size={44} />
            <span className="board-name">
              {entry.name}
              {entry.playerId === youId && <em> (you)</em>}
            </span>
            <b>{entry.score}</b>
          </li>
        ))}
      </ol>
      <div className="actions">
        {isHost ? (
          <button type="button" className="primary" onClick={onPlayAgain}>
            Play again
          </button>
        ) : (
          <p className="muted">Waiting for the host to start another game.</p>
        )}
        <button type="button" className="ghost" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </div>
  );
}
