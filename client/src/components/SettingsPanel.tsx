import { useEffect, useState } from 'react';
import type { RoomSettings, WordMode } from '../types';

interface Props {
  value: RoomSettings;
  onChange: (patch: Partial<RoomSettings>) => void;
  disabled?: boolean;
}

const WORD_MODES: { value: WordMode; label: string; hint: string }[] = [
  { value: 'normal', label: 'Normal', hint: 'Guessers see blanks for each letter.' },
  { value: 'hidden', label: 'Hidden', hint: 'Guessers get no blanks and no hints.' },
  { value: 'combination', label: 'Combination', hint: 'Two words are mashed together.' },
];

export function SettingsPanel({ value, onChange, disabled = false }: Props) {
  // Custom words are committed on blur so we don't send an update for every keystroke.
  const [wordsText, setWordsText] = useState(value.customWords.join(', '));
  useEffect(() => setWordsText(value.customWords.join(', ')), [value.customWords]);

  const slider = (
    key: 'maxPlayers' | 'rounds' | 'drawTime' | 'wordCount' | 'hints',
    label: string,
    min: number,
    max: number,
    step = 1,
    format: (n: number) => string = String,
  ) => (
    <label className="field" key={key}>
      <span className="field-head">
        <span>{label}</span>
        <output>{format(value[key])}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[key]}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: Number(e.target.value) })}
      />
    </label>
  );

  const mode = WORD_MODES.find((m) => m.value === value.wordMode);

  return (
    <div className="settings">
      {slider('maxPlayers', 'Players', 2, 20)}
      {slider('rounds', 'Rounds', 2, 10)}
      {slider('drawTime', 'Draw time', 15, 240, 5, (n) => `${n}s`)}
      {slider('wordCount', 'Words to choose from', 1, 5)}
      {slider('hints', 'Hints', 0, 5, 1, (n) => (n === 0 ? 'Off' : String(n)))}

      <fieldset className="field" disabled={disabled}>
        <legend>Word mode</legend>
        <div className="segmented" role="radiogroup" aria-label="Word mode">
          {WORD_MODES.map((m) => (
            <button
              type="button"
              key={m.value}
              role="radio"
              aria-checked={value.wordMode === m.value}
              className={value.wordMode === m.value ? 'seg on' : 'seg'}
              onClick={() => onChange({ wordMode: m.value })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <small className="muted">{mode?.hint}</small>
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={!value.isPrivate}
          disabled={disabled}
          onChange={(e) => onChange({ isPrivate: !e.target.checked })}
        />
        <span>
          List this room publicly
          <small className="muted"> Anyone can find and join it. Private rooms need the code.</small>
        </span>
      </label>

      <label className="field">
        <span className="field-head">
          <span>Your own words</span>
          <output>{value.customWords.length}</output>
        </span>
        <textarea
          rows={2}
          value={wordsText}
          disabled={disabled}
          placeholder="Separate words with commas: guacamole, moon landing"
          onChange={(e) => setWordsText(e.target.value)}
          onBlur={() =>
            onChange({
              customWords: wordsText
                .split(/[,\n]/)
                .map((w) => w.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
    </div>
  );
}
