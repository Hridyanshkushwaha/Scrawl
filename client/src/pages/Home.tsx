import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { SettingsPanel } from '../components/SettingsPanel';
import type { GameApi } from '../hooks/useGame';
import { AVATARS } from '../lib/avatars';
import { loadProfile, saveProfile } from '../lib/session';
import { DEFAULT_SETTINGS, type PublicRoomInfo, type RoomSettings } from '../types';

type Tab = 'play' | 'create';

export function Home({ game }: { game: GameApi }) {
  const invited = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
  const [profile, setProfile] = useState(loadProfile);
  const [tab, setTab] = useState<Tab>('play');
  const [code, setCode] = useState(invited);
  const [rooms, setRooms] = useState<PublicRoomInfo[]>([]);
  const [settings, setSettings] = useState<RoomSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { listRooms, connected } = game;
  const refresh = useCallback(async () => setRooms(await listRooms()), [listRooms]);

  useEffect(() => {
    if (!connected || tab !== 'play') return;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [connected, tab, refresh]);

  const update = (next: Partial<typeof profile>) => {
    const merged = { ...profile, ...next };
    setProfile(merged);
    saveProfile(merged);
  };

  const run = async (action: () => Promise<string | null>) => {
    if (!profile.name.trim()) {
      setError('Pick a name first.');
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await action();
    if (failure) setError(failure);
    else window.history.replaceState(null, '', window.location.pathname);
    setBusy(false);
  };

  const name = profile.name.trim();

  return (
    <main className="home">
      <header className="hero">
        <h1 className="display logo">Scrawl</h1>
        <p>Draw it. Guess it. Out-sketch your friends.</p>
      </header>

      <section className="panel" aria-label="Your player">
        <label className="field">
          <span>Your name</span>
          <input
            type="text"
            value={profile.name}
            maxLength={20}
            placeholder="What should we call you?"
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>
        <div className="field">
          <span>Your animal</span>
          <div className="avatar-grid" role="radiogroup" aria-label="Choose an avatar">
            {AVATARS.map((_, i) => (
              <button
                type="button"
                key={i}
                role="radio"
                aria-checked={profile.avatar === i}
                aria-label={`Avatar ${i + 1}`}
                className={profile.avatar === i ? 'avatar-pick on' : 'avatar-pick'}
                onClick={() => update({ avatar: i })}
              >
                <Avatar index={i} size={40} />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel" aria-label="Play">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'play'} className={tab === 'play' ? 'tab on' : 'tab'} onClick={() => setTab('play')}>
            Join a game
          </button>
          <button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'tab on' : 'tab'} onClick={() => setTab('create')}>
            Create a room
          </button>
        </div>

        {tab === 'play' ? (
          <div className="tab-body">
            {invited && <p className="invite">You were invited to room <b>{invited}</b>. Enter your name and join.</p>}
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => game.joinRoom(code, name, profile.avatar));
              }}
            >
              <input
                type="text"
                value={code}
                maxLength={8}
                placeholder="Room code"
                aria-label="Room code"
                className="code-input"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button type="submit" className="primary" disabled={busy || !connected || code.trim().length < 4}>
                Join room
              </button>
            </form>

            <div className="list-head">
              <h2>Public rooms</h2>
              <button type="button" className="ghost small" onClick={() => void refresh()}>
                Refresh
              </button>
            </div>
            {rooms.length === 0 ? (
              <p className="muted empty">No public rooms are open. Create one and list it publicly.</p>
            ) : (
              <ul className="room-list">
                {rooms.map((r) => (
                  <li key={r.roomId}>
                    <span className="room-info">
                      <b>{r.hostName}&rsquo;s room</b>
                      <small className="muted">
                        {r.players}/{r.maxPlayers} players, {r.rounds} rounds, {r.drawTime}s,{' '}
                        {r.phase === 'lobby' ? 'waiting to start' : 'in progress'}
                      </small>
                    </span>
                    <button type="button" className="ghost small" disabled={busy} onClick={() => void run(() => game.joinRoom(r.roomId, name, profile.avatar))}>
                      Join
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="secondary wide" disabled={busy || !connected || rooms.length === 0} onClick={() => void run(() => game.joinRandom(name, profile.avatar))}>
              Quick play: join a random public room
            </button>
          </div>
        ) : (
          <div className="tab-body">
            <SettingsPanel value={settings} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} />
            <button type="button" className="primary wide" disabled={busy || !connected} onClick={() => void run(() => game.createRoom(name, profile.avatar, settings))}>
              Create room
            </button>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!connected && <p className="muted">Connecting to the game server…</p>}
      </section>
    </main>
  );
}
