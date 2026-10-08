import { useEffect, useRef } from 'react';
import { socket } from '../lib/socket';
import type { CanvasSnapshot, Point, Stroke, Tool } from '../types';

// Fixed logical resolution. Coordinates travel as 0..1 fractions, so every client
// renders the same picture no matter how large the canvas is on screen.
const WIDTH = 800;
const HEIGHT = 600;
const PAPER = '#ffffff';

interface Props {
  canDraw: boolean;
  tool: Tool;
  color: string;
  size: number;
  snapshot: CanvasSnapshot;
}

const inkFor = (tool: Tool, color: string): string => (tool === 'eraser' ? PAPER : color);

function paintDot(ctx: CanvasRenderingContext2D, x: number, y: number, ink: string, size: number): void {
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x * WIDTH, y * HEIGHT, size / 2, 0, Math.PI * 2);
  ctx.fill();
}

function paintLine(ctx: CanvasRenderingContext2D, from: Point, to: Point, ink: string, size: number): void {
  ctx.strokeStyle = ink;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x * WIDTH, from.y * HEIGHT);
  ctx.lineTo(to.x * WIDTH, to.y * HEIGHT);
  ctx.stroke();
}

function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const ink = inkFor(stroke.tool, stroke.color);
  const [first, ...rest] = stroke.points;
  if (!first) return;
  paintDot(ctx, first.x, first.y, ink, stroke.size);
  let prev = first;
  for (const point of rest) {
    paintLine(ctx, prev, point, ink, stroke.size);
    prev = point;
  }
}

function redraw(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const stroke of strokes) paintStroke(ctx, stroke);
}

export function DrawingCanvas({ canDraw, tool, color, size, snapshot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<Point | null>(null);
  const remote = useRef<{ last: Point; ink: string; size: number } | null>(null);

  const context = (): CanvasRenderingContext2D | null => canvasRef.current?.getContext('2d') ?? null;

  // Full repaint whenever the server hands us the whole picture (join, undo, clear).
  useEffect(() => {
    const ctx = context();
    if (ctx) redraw(ctx, snapshot.strokes);
    remote.current = null;
  }, [snapshot]);

  // Incremental strokes from the drawer.
  useEffect(() => {
    const onDraw = (data: { type: 'start' | 'move' | 'end'; x?: number; y?: number; color?: string; size?: number; tool?: Tool }) => {
      const ctx = context();
      if (!ctx) return;
      if (data.type === 'start' && data.x !== undefined && data.y !== undefined) {
        const ink = inkFor(data.tool ?? 'pen', data.color ?? '#000000');
        const brush = data.size ?? 4;
        paintDot(ctx, data.x, data.y, ink, brush);
        remote.current = { last: { x: data.x, y: data.y }, ink, size: brush };
      } else if (data.type === 'move' && remote.current && data.x !== undefined && data.y !== undefined) {
        const to = { x: data.x, y: data.y };
        paintLine(ctx, remote.current.last, to, remote.current.ink, remote.current.size);
        remote.current.last = to;
      } else if (data.type === 'end') {
        remote.current = null;
      }
    };
    socket.on('draw_data', onDraw);
    return () => {
      socket.off('draw_data', onDraw);
    };
  }, []);

  // If drawing is taken away mid-stroke (time ran out), finish the stroke cleanly.
  useEffect(() => {
    if (!canDraw && drawing.current) {
      drawing.current = false;
      last.current = null;
    }
  }, [canDraw]);

  const toPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!canDraw || !ctx || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPoint(event);
    drawing.current = true;
    last.current = point;
    paintDot(ctx, point.x, point.y, inkFor(tool, color), size);
    socket.emit('draw_start', { ...point, color, size, tool });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!drawing.current || !last.current || !ctx) return;
    const point = toPoint(event);
    // Skip sub-pixel moves: they cost bandwidth and add nothing visible.
    if (Math.hypot((point.x - last.current.x) * WIDTH, (point.y - last.current.y) * HEIGHT) < 1.5) return;
    paintLine(ctx, last.current, point, inkFor(tool, color), size);
    last.current = point;
    socket.emit('draw_move', point);
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    socket.emit('draw_end');
  };

  return (
    <canvas
      ref={canvasRef}
      className={canDraw ? 'canvas can-draw' : 'canvas'}
      width={WIDTH}
      height={HEIGHT}
      aria-label="Drawing canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  );
}
