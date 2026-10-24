'use client';

import { useEffect, useRef } from 'react';

const STEP = 10; // px between field samples
const LEVELS = 12; // contour lines per unit of height
const SCALE = 180; // px per noise unit
const PERIOD_MS = 14000; // one noise unit of drift

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function field(x: number, y: number, t: number) {
  return noise(x * 0.9 + t, y * 0.9) * 0.65 + noise(x * 2.1 - t * 0.6, y * 2.1 + 3.3) * 0.35;
}

/**
 * Drifting terrain contours (marching squares over value noise) — the
 * hero's backdrop. Light enough for a phone: ~20 fps, paused off-screen,
 * a single still frame under reduced motion.
 */
export function ContourCanvas({ className, color = '67,198,213' }: { className?: string; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let values = new Float32Array(0);
    let raf = 0;
    let last = 0;
    let visible = true;
    const start = performance.now();

    const draw = (t: number) => {
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) values[j * cols + i] = field((i * STEP) / SCALE, (j * STEP) / SCALE, t);
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      for (let k = 1; k < LEVELS; k++) {
        const level = k / LEVELS;
        ctx.strokeStyle = `rgba(${color},${k % 4 === 0 ? 0.42 : 0.2})`;
        ctx.beginPath();
        for (let y = 0; y < rows - 1; y++) {
          for (let x = 0; x < cols - 1; x++) {
            const a = values[y * cols + x];
            const b = values[y * cols + x + 1];
            const c = values[(y + 1) * cols + x + 1];
            const d = values[(y + 1) * cols + x];
            const index = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
            if (index === 0 || index === 15) continue;
            const px = x * STEP;
            const py = y * STEP;
            const top: [number, number] = [px + (STEP * (level - a)) / (b - a), py];
            const right: [number, number] = [px + STEP, py + (STEP * (level - b)) / (c - b)];
            const bottom: [number, number] = [px + (STEP * (level - d)) / (c - d), py + STEP];
            const left: [number, number] = [px, py + (STEP * (level - a)) / (d - a)];
            const segments: Record<number, [number, number][]> = {
              1: [left, bottom], 2: [bottom, right], 3: [left, right], 4: [top, right],
              5: [left, top, bottom, right], 6: [top, bottom], 7: [left, top], 8: [left, top],
              9: [top, bottom], 10: [left, bottom, top, right], 11: [top, right], 12: [left, right],
              13: [bottom, right], 14: [left, bottom],
            };
            const points = segments[index];
            for (let s = 0; s < points.length; s += 2) {
              ctx.moveTo(points[s][0], points[s][1]);
              ctx.lineTo(points[s + 1][0], points[s + 1][1]);
            }
          }
        }
        ctx.stroke();
      }
    };

    const now = () => (performance.now() - start) / PERIOD_MS;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.ceil(width / STEP) + 1;
      rows = Math.ceil(height / STEP) + 1;
      values = new Float32Array(cols * rows);
      draw(reduce ? 0 : now());
    };

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden || time - last < 50) return;
      last = time;
      draw(now());
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
    });
    intersection.observe(canvas);
    resize();
    if (!reduce) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
    };
  }, [color]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
