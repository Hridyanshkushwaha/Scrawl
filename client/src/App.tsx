import { useGame } from './hooks/useGame';
import { GameRoom } from './pages/GameRoom';
import { Home } from './pages/Home';
import { Lobby } from './pages/Lobby';

export default function App() {
  const game = useGame();
  const { state } = game;

  let page: JSX.Element;
  if (game.restoring && !state) {
    page = (
      <main className="home">
        <p className="muted center">Reconnecting to your game…</p>
      </main>
    );
  } else if (!state) {
    page = <Home game={game} />;
  } else if (state.phase === 'lobby') {
    page = <Lobby game={game} state={state} />;
  } else {
    page = <GameRoom game={game} state={state} />;
  }

  return (
    <>
      {!game.connected && state && (
        <div className="banner" role="alert">
          Connection lost. Trying to get you back into the game…
        </div>
      )}
      {page}
      {game.toast && (
        <div className="toast" role="status" onClick={game.dismissToast}>
          {game.toast}
        </div>
      )}
    </>
  );
}
