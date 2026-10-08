import { socket } from '../lib/socket';
import { BRUSH_SIZES, PALETTE } from '../lib/avatars';
import type { Tool } from '../types';

interface Props {
  tool: Tool;
  color: string;
  size: number;
  onTool: (tool: Tool) => void;
  onColor: (color: string) => void;
  onSize: (size: number) => void;
}

export function Toolbar({ tool, color, size, onTool, onColor, onSize }: Props) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="swatches" role="radiogroup" aria-label="Colour">
        {PALETTE.map((c) => (
          <button
            type="button"
            key={c}
            role="radio"
            aria-checked={tool === 'pen' && color === c}
            aria-label={`Colour ${c}`}
            className={tool === 'pen' && color === c ? 'swatch on' : 'swatch'}
            style={{ background: c }}
            onClick={() => {
              onColor(c);
              onTool('pen');
            }}
          />
        ))}
      </div>

      <div className="tool-group" role="radiogroup" aria-label="Brush size">
        {BRUSH_SIZES.map((s) => (
          <button
            type="button"
            key={s}
            role="radio"
            aria-checked={size === s}
            aria-label={`Brush size ${s}`}
            className={size === s ? 'size on' : 'size'}
            onClick={() => onSize(s)}
          >
            <span style={{ width: Math.max(4, s * 0.7), height: Math.max(4, s * 0.7) }} />
          </button>
        ))}
      </div>

      <div className="tool-group">
        <button type="button" className={tool === 'pen' ? 'tool on' : 'tool'} onClick={() => onTool('pen')}>
          Pen
        </button>
        <button type="button" className={tool === 'eraser' ? 'tool on' : 'tool'} onClick={() => onTool('eraser')}>
          Eraser
        </button>
        <button type="button" className="tool" onClick={() => socket.emit('draw_undo')}>
          Undo
        </button>
        <button type="button" className="tool danger" onClick={() => socket.emit('canvas_clear')}>
          Clear
        </button>
      </div>
    </div>
  );
}
