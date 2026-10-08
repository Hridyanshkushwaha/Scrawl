import type { Room } from './Room';
import type { Player } from './Player';
import type { EndReason, Phase, Point, RoomState, Stroke, Tool } from '../types';
import { pickWordOptions } from '../services/wordService';
import { isCloseGuess, normalizeGuess } from '../services/guess';

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

const CHOOSE_SECONDS = envInt('CHOOSE_SECONDS', 15, 3, 60);
const ROUND_END_SECONDS = envInt('ROUND_END_SECONDS', 6, 1, 30);
const MAX_STROKES = 1000;
const MAX_POINTS_PER_STROKE = 5000;

const isMaskable = (c: string): boolean => c !== ' ' && c !== '-' && c !== "'";

/**
 * One game inside a room. It is the single source of truth for the phase, the turn
 * order, the secret word, the timer, the drawing and the scores. Clients only send
 * intents; every intent is validated here.
 */
export class Game {
  phase: Phase = 'lobby';
  round = 0;
  drawerId: string | null = null;
  timeLeft = 0;
  strokes: Stroke[] = [];

  private queue: string[] = [];
  private word: string | null = null;
  private wordOptions: string[] = [];
  private maskChars: string[] = [];
  private revealed = new Set<number>();
  private hintTimes: number[] = [];
  private hintIndex = 0;
  private usedWords = new Set<string>();
  private guessedOrder: string[] = [];
  private turnDeltas = new Map<string, number>();
  private currentStroke: Stroke | null = null;
  private nextStrokeId = 1;
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly room: Room) {}

  // ---------------------------------------------------------------- state views

  private get settings() {
    return this.room.settings;
  }

  /** Builds the view of the room one player is allowed to see. The word is filtered here. */
  stateFor(viewer: Player): RoomState {
    const isDrawer = viewer.id === this.drawerId;
    const knowsWord = isDrawer || viewer.hasGuessed;
    const showWord =
      this.word !== null && (knowsWord || this.phase === 'round_end') && this.phase !== 'lobby';
    return {
      roomId: this.room.id,
      you: viewer.id,
      settings: this.settings,
      phase: this.phase,
      round: this.round,
      totalRounds: this.settings.rounds,
      hostId: this.room.hostId,
      drawerId: this.drawerId,
      players: [...this.room.players.values()].map((p) => p.toPublic(this.room.hostId, this.drawerId)),
      timeLeft: this.timeLeft,
      mask: this.currentMask(),
      wordLength: this.phase === 'drawing' && this.settings.wordMode !== 'hidden' ? this.maskChars.length : null,
      word: showWord ? this.word : null,
      wordOptions: this.phase === 'choosing' && isDrawer ? this.wordOptions : null,
    };
  }

  private currentMask(): string {
    if (this.phase !== 'drawing' || this.word === null || this.settings.wordMode === 'hidden') return '';
    return this.maskChars
      .map((c, i) => (!isMaskable(c) || this.revealed.has(i) ? c : '_'))
      .join('');
  }

  // ------------------------------------------------------------------ lifecycle

  /** Host action. Returns an error message, or null on success. */
  startGame(): string | null {
    if (this.phase !== 'lobby') return 'The game has already started.';
    const connected = this.room.connectedPlayers;
    if (connected.length < 2) return 'You need at least 2 players to start.';
    if (connected.some((p) => p.id !== this.room.hostId && !p.ready)) {
      return 'Everyone needs to be ready first.';
    }
    this.resetForNewGame();
    this.room.system('The game has started. Good luck!');
    this.nextTurn();
    return null;
  }

  /** Host action after game over. Returns to the lobby with scores cleared. */
  playAgain(): string | null {
    if (this.phase !== 'game_over') return 'The game is not over yet.';
    this.resetForNewGame();
    this.phase = 'lobby';
    for (const p of this.room.players.values()) p.ready = p.id === this.room.hostId;
    this.room.broadcast('canvas_clear', {});
    this.room.broadcastState();
    return null;
  }

  private resetForNewGame(): void {
    this.stopTicking();
    this.resetTurnState();
    this.round = 0;
    this.queue = [];
    this.drawerId = null;
    this.timeLeft = 0;
    this.usedWords.clear();
    for (const p of this.room.players.values()) {
      p.score = 0;
      p.hasGuessed = false;
    }
  }

  private resetTurnState(): void {
    this.word = null;
    this.wordOptions = [];
    this.maskChars = [];
    this.revealed.clear();
    this.hintTimes = [];
    this.hintIndex = 0;
    this.guessedOrder = [];
    this.turnDeltas.clear();
    this.strokes = [];
    this.currentStroke = null;
  }

  dispose(): void {
    this.stopTicking();
  }

  // ---------------------------------------------------------------------- timer

  private ensureTicking(): void {
    if (!this.interval) this.interval = setInterval(() => this.tick(), 1000);
  }

  private stopTicking(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private tick(): void {
    try {
      if (this.phase === 'lobby' || this.phase === 'game_over') return;
      this.timeLeft = Math.max(0, this.timeLeft - 1);
      this.room.broadcast('timer', { timeLeft: this.timeLeft });
      if (this.phase === 'drawing') this.maybeRevealHint();
      if (this.timeLeft > 0) return;
      if (this.phase === 'choosing') this.autoChoose();
      else if (this.phase === 'drawing') this.endTurn('time_up');
      else if (this.phase === 'round_end') this.nextTurn();
    } catch (error) {
      console.error(`[room ${this.room.id}] tick failed`, error);
    }
  }

  // ----------------------------------------------------------------- turn flow

  private nextTurn(): void {
    this.resetTurnState();
    let drawer: Player | undefined;
    while (!drawer) {
      if (this.queue.length === 0) {
        if (this.round >= this.settings.rounds) {
          this.endGame();
          return;
        }
        const eligible = this.room.connectedPlayers;
        if (eligible.length < 2) {
          this.endGame();
          return;
        }
        this.round += 1;
        this.queue = eligible.map((p) => p.id);
        this.room.system(`Round ${this.round} of ${this.settings.rounds}`);
      }
      const candidate = this.room.players.get(this.queue.shift() as string);
      if (candidate && candidate.connected) drawer = candidate;
    }

    this.drawerId = drawer.id;
    this.phase = 'choosing';
    this.timeLeft = CHOOSE_SECONDS;
    this.wordOptions = pickWordOptions(this.settings, this.usedWords);
    for (const p of this.room.players.values()) p.hasGuessed = false;

    this.room.broadcast('canvas_clear', {});
    for (const p of this.room.connectedPlayers) {
      this.room.emitTo(p, 'round_start', {
        drawerId: drawer.id,
        round: this.round,
        totalRounds: this.settings.rounds,
        drawTime: this.settings.drawTime,
        chooseTime: CHOOSE_SECONDS,
        wordOptions: p.id === drawer.id ? this.wordOptions : undefined,
      });
    }
    this.room.broadcastState();
    this.ensureTicking();

    // With a single option there is nothing to choose.
    if (this.settings.wordCount === 1) this.beginDrawing(this.wordOptions[0]);
  }

  /** Drawer picks one of the offered words. Returns an error message or null. */
  chooseWord(player: Player, word: unknown): string | null {
    if (this.phase !== 'choosing') return 'No word is being chosen right now.';
    if (player.id !== this.drawerId) return 'Only the drawer can choose the word.';
    if (typeof word !== 'string' || !this.wordOptions.includes(word)) return 'That word was not offered.';
    this.beginDrawing(word);
    return null;
  }

  private autoChoose(): void {
    const options = this.wordOptions;
    this.beginDrawing(options[Math.floor(Math.random() * options.length)]);
  }

  private beginDrawing(word: string): void {
    this.word = word;
    this.maskChars = [...word];
    this.revealed.clear();
    this.phase = 'drawing';
    this.timeLeft = this.settings.drawTime;

    const letters = this.maskChars.filter(isMaskable).length;
    const hints =
      this.settings.wordMode === 'hidden' ? 0 : Math.min(this.settings.hints, Math.max(0, letters - 1));
    this.hintTimes = Array.from({ length: hints }, (_, i) =>
      Math.max(1, Math.round((this.settings.drawTime * (i + 1)) / (hints + 1))),
    );
    this.hintIndex = 0;

    const drawer = this.room.players.get(this.drawerId ?? '');
    if (drawer) this.room.system(`${drawer.name} is drawing!`);
    this.room.broadcastState();
  }

  private maybeRevealHint(): void {
    const elapsed = this.settings.drawTime - this.timeLeft;
    let changed = false;
    while (this.hintIndex < this.hintTimes.length && elapsed >= this.hintTimes[this.hintIndex]) {
      this.hintIndex += 1;
      const hidden = this.maskChars
        .map((c, i) => ({ c, i }))
        .filter(({ c, i }) => isMaskable(c) && !this.revealed.has(i));
      if (hidden.length <= 1) break;
      this.revealed.add(hidden[Math.floor(Math.random() * hidden.length)].i);
      changed = true;
    }
    if (changed) this.room.broadcastState();
  }

  private endTurn(reason: EndReason): void {
    if (this.phase !== 'drawing') return;
    this.phase = 'round_end';
    this.timeLeft = ROUND_END_SECONDS;
    this.currentStroke = null;

    const scores = [...this.room.players.values()].map((p) => ({
      playerId: p.id,
      name: p.name,
      delta: this.turnDeltas.get(p.id) ?? 0,
      total: p.score,
    }));
    this.room.broadcast('round_end', {
      word: this.word,
      reason,
      scores,
      nextDrawerId: this.peekNextDrawer(),
    });
    this.room.broadcastState();
  }

  private peekNextDrawer(): string | null {
    for (const id of this.queue) {
      if (this.room.players.get(id)?.connected) return id;
    }
    if (this.round < this.settings.rounds) return this.room.connectedPlayers[0]?.id ?? null;
    return null;
  }

  private endGame(): void {
    this.stopTicking();
    this.resetTurnState();
    this.drawerId = null;
    this.phase = 'game_over';
    this.timeLeft = 0;

    const sorted = [...this.room.players.values()].sort((a, b) => b.score - a.score);
    const leaderboard = sorted.map((p) => ({
      playerId: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      rank: sorted.findIndex((q) => q.score === p.score) + 1,
    }));
    const topScore = sorted[0]?.score ?? 0;
    const winners = topScore > 0 ? leaderboard.filter((e) => e.score === topScore) : [];
    this.room.broadcast('game_over', { winner: winners[0] ?? null, winners, leaderboard });
    this.room.broadcastState();
  }

  // ------------------------------------------------------------ chat & guessing

  /** `guess` event. Returns an error message, or null when the text was accepted. */
  handleGuess(player: Player, text: string): string | null {
    if (this.phase !== 'drawing') return 'You can only guess while someone is drawing.';
    if (player.id === this.drawerId) return 'You cannot guess your own word.';
    if (player.hasGuessed) return 'You already guessed the word.';
    this.handleMessage(player, text);
    return null;
  }

  /**
   * Routes any chat or guess text. While a round is running, text from people who
   * don't know the word yet is treated as a guess; text from the drawer or from
   * players who already guessed is only shown to the other people who know the word,
   * so nobody can leak the answer.
   */
  handleMessage(player: Player, text: string): void {
    if (this.phase !== 'drawing' || this.word === null) {
      this.room.chat('chat', player, text);
      return;
    }
    if (player.id === this.drawerId || player.hasGuessed) {
      this.room.chat('chat', player, text, this.knowers());
      return;
    }

    const guess = normalizeGuess(text);
    if (!guess) return;
    const answer = normalizeGuess(this.word);
    if (guess === answer) {
      this.awardCorrectGuess(player);
      return;
    }
    this.room.chat('guess', player, text);
    if (isCloseGuess(guess, answer)) {
      this.room.emitTo(player, 'guess_result', {
        correct: false,
        close: true,
        playerId: player.id,
        playerName: player.name,
        points: 0,
      });
    }
  }

  private knowers(): Player[] {
    return this.room.connectedPlayers.filter((p) => p.id === this.drawerId || p.hasGuessed);
  }

  /**
   * Guesser: 50-400 points depending on time left, plus a bonus of 100/60/30 for the
   * first/second/third correct guess. Drawer: 25% of each guesser's points.
   */
  private awardCorrectGuess(player: Player): void {
    const timeRatio = this.timeLeft / this.settings.drawTime;
    const bonus = [100, 60, 30][this.guessedOrder.length] ?? 0;
    const points = 50 + Math.round(350 * timeRatio) + bonus;

    player.hasGuessed = true;
    player.score += points;
    this.addDelta(player.id, points);
    this.guessedOrder.push(player.id);

    const drawer = this.room.players.get(this.drawerId ?? '');
    if (drawer) {
      const share = Math.round(points * 0.25);
      drawer.score += share;
      this.addDelta(drawer.id, share);
    }

    this.room.broadcast('guess_result', {
      correct: true,
      playerId: player.id,
      playerName: player.name,
      points,
    });
    this.room.broadcastState();
    this.checkAllGuessed();
  }

  private addDelta(playerId: string, points: number): void {
    this.turnDeltas.set(playerId, (this.turnDeltas.get(playerId) ?? 0) + points);
  }

  private checkAllGuessed(): void {
    if (this.phase !== 'drawing') return;
    const guessers = this.room.connectedPlayers.filter((p) => p.id !== this.drawerId);
    if (guessers.length > 0 && guessers.every((p) => p.hasGuessed)) this.endTurn('all_guessed');
  }

  // -------------------------------------------------------------------- drawing

  private canDraw(player: Player): boolean {
    return this.phase === 'drawing' && player.id === this.drawerId;
  }

  drawStart(player: Player, input: Point & { color: string; size: number; tool: Tool }): boolean {
    if (!this.canDraw(player) || this.strokes.length >= MAX_STROKES) return false;
    const stroke: Stroke = {
      id: this.nextStrokeId++,
      tool: input.tool,
      color: input.color,
      size: input.size,
      points: [{ x: input.x, y: input.y }],
    };
    this.strokes.push(stroke);
    this.currentStroke = stroke;
    return true;
  }

  drawMove(player: Player, point: Point): boolean {
    if (!this.canDraw(player) || !this.currentStroke) return false;
    if (this.currentStroke.points.length >= MAX_POINTS_PER_STROKE) return false;
    this.currentStroke.points.push(point);
    return true;
  }

  drawEnd(player: Player): boolean {
    if (!this.canDraw(player) || !this.currentStroke) return false;
    this.currentStroke = null;
    return true;
  }

  undo(player: Player): boolean {
    if (!this.canDraw(player)) return false;
    this.currentStroke = null;
    this.strokes.pop();
    return true;
  }

  clearCanvas(player: Player): boolean {
    if (!this.canDraw(player)) return false;
    this.currentStroke = null;
    this.strokes = [];
    return true;
  }

  // ------------------------------------------------------------ player changes

  /** Called by the room after a player has been removed for good (left, kicked, timed out). */
  onPlayerRemoved(player: Player): void {
    this.queue = this.queue.filter((id) => id !== player.id);
    if (this.phase === 'lobby' || this.phase === 'game_over') return;

    if (this.room.connectedPlayers.length < 2) {
      this.room.system('Not enough players to continue.');
      this.endGame();
      return;
    }
    if (player.id === this.drawerId) {
      if (this.phase === 'choosing') {
        this.room.system(`${player.name} left, so their turn is skipped.`);
        this.nextTurn();
      } else if (this.phase === 'drawing') {
        this.endTurn('drawer_left');
      }
      return;
    }
    this.checkAllGuessed();
  }
}
