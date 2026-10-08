import type { PublicPlayer, RoundEndPayload } from '../types';
import { Avatar } from './Avatar';

interface PickerProps {
  options: string[];
  timeLeft: number;
  onPick: (word: string) => void;
}

/** Shown to the drawer only. */
export function WordPicker({ options, timeLeft, onPick }: PickerProps) {
  return (
    <div className="overlay" role="dialog" aria-label="Choose a word">
      <div className="overlay-card">
        <h2>Pick a word to draw</h2>
        <div className="options">
          {options.map((word) => (
            <button type="button" key={word} className="word-option" onClick={() => onPick(word)}>
              {word}
            </button>
          ))}
        </div>
        <p className="muted">A random one is picked in {timeLeft}s.</p>
      </div>
    </div>
  );
}

export function WaitingForWord({ drawer, timeLeft }: { drawer?: PublicPlayer; timeLeft: number }) {
  return (
    <div className="overlay" role="status">
      <div className="overlay-card">
        <h2>{drawer ? `${drawer.name} is choosing a word` : 'Choosing a word'}</h2>
        <p className="muted">Starting in {timeLeft}s</p>
      </div>
    </div>
  );
}

const REASONS: Record<RoundEndPayload['reason'], string> = {
  all_guessed: 'Everyone got it!',
  time_up: 'Time is up!',
  drawer_left: 'The drawer left.',
};

export function RoundEndOverlay({ data, players }: { data: RoundEndPayload; players: PublicPlayer[] }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = [...data.scores].filter((s) => byId.has(s.playerId)).sort((a, b) => b.delta - a.delta);
  const next = data.nextDrawerId ? byId.get(data.nextDrawerId) : undefined;

  return (
    <div className="overlay" role="status">
      <div className="overlay-card">
        <p className="muted">{REASONS[data.reason]}</p>
        <h2>
          The word was <span className="reveal">{data.word}</span>
        </h2>
        <ul className="deltas">
          {rows.map((row) => {
            const player = byId.get(row.playerId);
            return (
              <li key={row.playerId}>
                {player && <Avatar index={player.avatar} size={28} />}
                <span>{row.name}</span>
                <b className={row.delta > 0 ? 'plus' : 'zero'}>{row.delta > 0 ? `+${row.delta}` : '0'}</b>
              </li>
            );
          })}
        </ul>
        <p className="muted">{next ? `Next up: ${next.name}` : 'Final scores are coming up'}</p>
      </div>
    </div>
  );
}
