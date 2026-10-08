import type { Phase, PublicPlayer } from '../types';
import { Avatar } from './Avatar';

interface Props {
  players: PublicPlayer[];
  youId: string;
  phase: Phase;
  /** Set when the viewer is the host and moderation controls should show. */
  canModerate?: boolean;
  onKick?: (playerId: string, ban: boolean) => void;
  showReady?: boolean;
}

export function PlayerList({ players, youId, phase, canModerate = false, onKick, showReady = false }: Props) {
  const ordered = phase === 'lobby' ? players : [...players].sort((a, b) => b.score - a.score);
  const inRound = phase === 'drawing' || phase === 'choosing';

  return (
    <ul className="players" aria-label="Players">
      {ordered.map((p, i) => {
        const status = p.isDrawer && inRound ? 'Drawing' : p.hasGuessed && phase === 'drawing' ? 'Guessed' : '';
        return (
          <li
            key={p.id}
            className={['player', p.hasGuessed && phase === 'drawing' ? 'guessed' : '', p.isDrawer && inRound ? 'drawing' : ''].join(' ')}
          >
            {phase !== 'lobby' && <span className="rank">{i + 1}</span>}
            <Avatar index={p.avatar} size={38} dim={!p.connected} />
            <span className="player-main">
              <span className="player-name">
                {p.name}
                {p.id === youId && <em> (you)</em>}
              </span>
              <span className="player-meta">
                {!p.connected
                  ? 'Reconnecting…'
                  : phase === 'lobby'
                    ? p.isHost
                      ? 'Host'
                      : p.ready
                        ? 'Ready'
                        : 'Not ready'
                    : status || (p.isHost ? 'Host' : '')}
              </span>
            </span>
            {phase !== 'lobby' && <span className="score">{p.score}</span>}
            {showReady && p.ready && !p.isHost && <span className="tick" aria-label="Ready">✓</span>}
            {canModerate && p.id !== youId && onKick && (
              <span className="mod">
                <button type="button" className="mini" onClick={() => onKick(p.id, false)} title={`Remove ${p.name}`}>
                  Kick
                </button>
                <button type="button" className="mini danger" onClick={() => onKick(p.id, true)} title={`Ban ${p.name}`}>
                  Ban
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
