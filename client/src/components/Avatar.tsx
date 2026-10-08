import { AVATARS, AVATAR_COLORS } from '../lib/avatars';

interface Props {
  index: number;
  size?: number;
  dim?: boolean;
}

export function Avatar({ index, size = 40, dim = false }: Props) {
  const safe = ((index % AVATARS.length) + AVATARS.length) % AVATARS.length;
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.58,
        background: AVATAR_COLORS[safe],
        opacity: dim ? 0.45 : 1,
      }}
    >
      {AVATARS[safe]}
    </span>
  );
}
