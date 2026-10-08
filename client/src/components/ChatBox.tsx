import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  placeholder: string;
  disabled?: boolean;
}

export function ChatBox({ messages, onSend, placeholder, disabled = false }: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <section className="chat" aria-label="Chat and guesses">
      <ol className="chat-log" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`msg ${m.kind}`}>
            {m.kind === 'chat' || m.kind === 'guess' ? (
              <>
                <b>{m.playerName}</b> {m.text}
              </>
            ) : (
              m.text
            )}
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" />
      </ol>
      <form className="chat-form" onSubmit={submit}>
        <input
          type="text"
          value={text}
          maxLength={120}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={disabled || !text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
