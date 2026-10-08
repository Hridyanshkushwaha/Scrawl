/**
 * Word-matching helpers.
 *
 * Matching is exact after normalisation: case-insensitive, whitespace trimmed and
 * collapsed, accents stripped ("Café" == "cafe"). A guess that is exactly one edit
 * away from the answer is flagged as "close" so the guesser gets private feedback,
 * but it never scores. That is how "partial" matches are handled: nobody can win
 * points by typing a sentence that merely contains the word.
 */
export function normalizeGuess(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Both arguments must already be normalised. */
export function isCloseGuess(guess: string, answer: string): boolean {
  if (answer.length < 4) return false;
  if (Math.abs(guess.length - answer.length) > 1) return false;
  return levenshtein(guess, answer) === 1;
}
