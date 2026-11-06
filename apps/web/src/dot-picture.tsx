import { useEffect, useRef } from "react";
import { hash, inkColor, loadTone, smooth, toneAt } from "./lib/halftone";
import { useInView, useReducedMotion } from "./lib/motion";

type Shape = (u: number, v: number) => number;

export function DotPicture({
  src,
  shape,
  ratio = 4 / 3,
  pitch = 6,
  label,
}: {
  src?: string;
  shape?: Shape;
  ratio?: number;
  pitch?: number;
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [box, seen] = useInView<HTMLDivElement>("0px 0px -12% 0px");
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !seen) return;
    let alive = true;
    let raf = 0;
    let tone: Shape | null = shape ?? null;
    let done = false;
    const draw = (p: number) => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.round(r.width * dpr);
      el.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      if (!tone) return;
      ctx.fillStyle = inkColor();
      ctx.beginPath();
      const rmax = pitch * 0.58;
      let i = 0;
      for (let y = pitch / 2; y < r.height; y += pitch, i++) {
        let j = 0;
        for (let x = pitch / 2; x < r.width; x += pitch, j++) {
          const grow = smooth(hash(i, j) * 0.5, hash(i, j) * 0.5 + 0.5, p);
          const rr = rmax * Math.sqrt(tone(x / r.width, y / r.height)) * grow;
          if (rr < 0.35) continue;
          ctx.moveTo(x + rr, y);
          ctx.arc(x, y, rr, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    };
    const run = () => {
      if (reduced) {
        done = true;
        draw(1);
        return;
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / 1600);
        draw(1 - (1 - k) ** 3);
        if (k >= 1) done = true;
        else if (alive) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (src) {
      loadTone(src).then((t) => {
        if (!alive || !t) return;
        tone = (u, v) => toneAt(t, u, v);
        run();
      });
    } else run();
    const ro = new ResizeObserver(() => {
      if (tone && done) draw(1);
    });
    ro.observe(el);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [src, shape, pitch, seen, reduced]);

  return (
    <div ref={box} className="w-full" style={{ aspectRatio: String(ratio) }}>
      <canvas
        ref={canvas}
        className="block h-full w-full"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      />
    </div>
  );
}
