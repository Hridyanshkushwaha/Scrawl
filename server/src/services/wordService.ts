import wordsData from '../data/words.json';
import type { RoomSettings } from '../types';

const BUILT_IN: string[] = Object.values(wordsData as Record<string, string[]>).flat();

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Returns `settings.wordCount` words the drawer can choose from, never repeating a word
 * within one game (the `used` set is owned by the Game). In "combination" mode every
 * option is two single words joined together, e.g. "robot pizza".
 */
export function pickWordOptions(settings: RoomSettings, used: Set<string>): string[] {
  const combination = settings.wordMode === 'combination';
  const pool = (): string[] => {
    const all = [...new Set([...BUILT_IN, ...settings.customWords])];
    const free = all.filter((w) => !used.has(w));
    return combination ? free.filter((w) => !w.includes(' ')) : free;
  };

  let candidates = pool();
  const needed = combination ? settings.wordCount * 2 : settings.wordCount;
  if (candidates.length < needed) {
    used.clear();
    candidates = pool();
  }

  const shuffled = shuffle(candidates);
  const options: string[] = [];
  if (combination) {
    for (let i = 0; i < settings.wordCount; i++) {
      const option = `${shuffled[i * 2]} ${shuffled[i * 2 + 1]}`;
      options.push(option);
      used.add(option);
    }
  } else {
    for (const word of shuffled.slice(0, settings.wordCount)) {
      options.push(word);
      used.add(word);
    }
  }
  return options;
}
