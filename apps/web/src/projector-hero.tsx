import { type RefObject, useEffect, useRef } from "react";
import { hash, inkColor, smooth } from "./lib/halftone";
import { useReducedMotion } from "./lib/motion";

type Box = { x0: number; y0: number; x1: number; y1: number };

const LENS = { x: 302, y: 45, r: 22 };
const BOUNDS = { x0: -14, y0: -196, x1: 306, y1: 142 };
const REELS = [
  { x: 40, y: -110, R: 80, pack: 0.64, speed: 0.42, depth: 1 },
  { x: 206, y: -112, R: 72, pack: 0.4, speed: 0.58, depth: 0.82 },
] as const;

function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

function segment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const k = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(x - ax - dx * k, y - ay - dy * k);
}

function reelTone(x: number, y: number, t: number) {
  for (const r of REELS) {
    const dx = x - r.x;
    const dy = y - r.y;
    const d = Math.hypot(dx, dy);
    if (d > r.R) continue;
    if (d < r.R * 0.05) return 0;
    if (d < r.R * 0.15) return 1 * r.depth;
    if (d > r.R - 5) return (0.95 - 0.25 * ((d - (r.R - 5)) / 5)) * r.depth;
    if (d < r.R * r.pack) {
      const grain = 0.04 * Math.sin(d * 1.7);
      return (0.86 + grain + 0.06 * (dy / r.R)) * r.depth;
    }
    const a = Math.atan2(dy, dx) - t * r.speed;
    const hole = Math.abs(mod(a, (Math.PI * 2) / 3) - Math.PI / 3);
    const inBand = d > r.R * 0.3 && d < r.R * 0.84;
    if (inBand && hole < 0.62 - 4 / d) return 0;
    return (0.62 + 0.18 * (d / r.R) - 0.12 * (dy / r.R)) * r.depth;
  }
  return -1;
}

function projectorTone(x: number, y: number, t: number) {
  const reel = reelTone(x, y, t);
  if (reel >= 0) return reel;

  const [f1, f2] = REELS;
  const p1 = f1.R * f1.pack;
  const p2 = f2.R * f2.pack;
  if (segment(x, y, f1.x - p1 + 1, f1.y + 6, 14, -6) < 2.2) return 0.92;
  if (segment(x, y, f2.x + p2 - 1, f2.y + 6, 226, -14) < 2.2) return 0.92;
  if (segment(x, y, 52, -14, f1.x, f1.y) < 4) return 0.8;
  if (segment(x, y, 196, -16, f2.x, f2.y) < 4) return 0.7;

  if (x >= 0 && x <= 200 && y >= 0 && y <= 110) {
    if (y < 3) return 1;
    if (x > 118 && x < 186 && y > 26 && y < 64 && mod(y - 26, 10) < 4)
      return 0.22;
    if (x > 16 && x < 72 && y > 30 && y < 74) {
      const dx = (x - 44) / 26;
      const dy = (y - 52) / 20;
      if (dx * dx + dy * dy < 1) return 0.35 + 0.3 * dy;
    }
    return 0.66 + 0.24 * (y / 110) + 0.06 * (x / 200);
  }
  const depthK = 20 / 34;
  if (y < 0 && y >= -20) {
    const shift = -y / depthK;
    if (x >= shift && x <= 200 + shift) return 0.26 + 0.1 * (x / 234);
  }
  if (x > 200 && x <= 234) {
    const top = -(x - 200) * depthK;
    if (y >= top && y <= 110 + top) return 0.9 + 0.06 * (y / 110);
  }
  if (x > 216 && x <= LENS.x) {
    const dy = y - LENS.y;
    const hood = x > 284;
    const r = hood ? LENS.r + 3 : LENS.r - 4;
    if (Math.abs(dy) <= r) {
      const n = dy / r;
      if (!hood && (Math.abs(x - 244) < 2 || Math.abs(x - 266) < 2))
        return 0.96;
      if (Math.abs(n + 0.42) < 0.16) return 0.2;
      return (hood ? 0.8 : 0.5) + 0.42 * n * n;
    }
  }
  if (x >= 8 && x <= 222 && y > 110 && y <= 122) return 0.95;
  const sx = (x - 116) / 150;
  const sy = (y - 132) / 9;
  const shadow = sx * sx + sy * sy;
  if (shadow < 1) return 0.26 * (1 - shadow);
  return 0;
}

export function ProjectorHero({
  keepOut,
}: {
  keepOut: RefObject<HTMLElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let raf = 0;
    let visible = true;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const t0 = performance.now();

    const resize = () => {
      const r = el.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    };

    const frame = (now: number) => {
      const t = reduced ? 3.2 : (now - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const box = el.getBoundingClientRect();
      const k0 = keepOut.current?.getBoundingClientRect();
      const keep: Box = k0
        ? {
            x0: k0.left - box.left,
            y0: k0.top - box.top,
            x1: k0.right - box.left,
            y1: k0.bottom - box.top,
          }
        : { x0: w * 0.3, y0: h * 0.2, x1: w * 0.7, y1: h * 0.55 };
      const narrow = w < 720;
      const s = narrow ? 0.7 : Math.max(0.7, w / 1600);
      const pad = 64 * s;
      const fade = (x: number, y: number) => {
        const nx =
          (x - (keep.x0 + keep.x1) / 2) / ((keep.x1 - keep.x0) / 2 + pad);
        const ny =
          (y - (keep.y0 + keep.y1) / 2) / ((keep.y1 - keep.y0) / 2 + pad);
        return smooth(0.8, 1.06, (nx ** 4 + ny ** 4) ** 0.25);
      };

      const k = narrow
        ? Math.min(0.56, (w * 0.5) / 320)
        : Math.min(1.12, s * 1.08);
      const left = -(REELS[0].x - BOUNDS.x0) * k;
      const lensY = narrow
        ? Math.min(h - 96 * k, keep.y1 + 56 + 241 * k)
        : Math.min(h - 110 * k, keep.y1 + 210 * s);
      const px = (u: number) => left + (u - BOUNDS.x0) * k;
      const py = (v: number) => lensY + (v - LENS.y) * k;

      ctx.fillStyle = inkColor();
      ctx.beginPath();
      const put = (x: number, y: number, r: number) => {
        if (r < 0.4) return;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      };
      const faint = new Path2D();
      const half_ = new Path2D();
      const dot = (x: number, y: number, r: number) => {
        const f = fade(x, y);
        if (f > 0.66) return put(x, y, r);
        const into = f > 0.33 ? half_ : faint;
        const rr = r * 0.8;
        if (rr < 0.4) return;
        into.moveTo(x + rr, y);
        into.arc(x, y, rr, 0, Math.PI * 2);
      };

      const ox = px(LENS.x);
      const oy = py(LENS.y);
      const lower = narrow ? -0.1 : 0.07;
      const upper = Math.atan2(-oy, w - ox);
      const dir = (upper + lower) / 2;
      const half = (lower - upper) / 2;
      const apex = (LENS.r * k) / Math.tan(half);
      const ax = ox - Math.cos(dir) * apex;
      const ay = oy - Math.sin(dir) * apex;
      const p = Math.max(5, 7 * s);
      const rmax = p * 0.55;
      const len = Math.hypot(w - ox, h);
      const flick =
        0.93 +
        0.05 * Math.sin(t * 1.3) +
        0.03 * (hash(Math.floor(t * 24), 3) - 0.5);
      const beam = (x: number, y: number) => {
        const dx = x - ax;
        const dy = y - ay;
        const along = Math.hypot(dx, dy) - apex;
        if (along < 0 || x < ox) return 0;
        const ang = Math.atan2(dy, dx) - dir;
        const cone = Math.exp(-((ang / half) ** 4) * 1.2);
        if (cone < 0.04) return 0;
        const rays = 0.6 + 0.4 * noise(ang * 30 + t * 0.06, t * 0.05);
        return (
          cone *
          rays *
          flick *
          (1 - 0.6 * Math.min(1, along / len)) *
          (0.55 + 0.45 * smooth(0, 80 * s, along))
        );
      };
      for (let y = p / 2; y < h; y += p) {
        for (let x = Math.floor(ox / p) * p + p / 2; x < w; x += p) {
          const I = beam(x, y);
          if (I > 0.06) dot(x, y, rmax * I);
        }
      }
      for (let m = 0; m < 38; m++) {
        const along = mod(
          hash(m, 11) * len + t * (6 + hash(m, 5) * 8) * s,
          len * 0.92,
        );
        const off =
          (hash(m, 23) - 0.5) * 1.6 * half + Math.sin(t * 0.35 + m) * 0.015;
        const x = ox + Math.cos(dir + off) * along;
        const y =
          oy +
          Math.sin(dir + off) * along +
          Math.sin(t * 0.5 + m * 1.7) * 5 * s;
        const I = beam(x, y);
        if (along > 40 * s && I > 0.2)
          dot(x, y, rmax * (0.8 + 0.7 * hash(m, 31)) * Math.min(1, I * 1.8));
      }

      const q = Math.max(2.6, 4.2 * k);
      const step = q / k;
      for (let v = BOUNDS.y0; v <= BOUNDS.y1; v += step) {
        for (let u = BOUNDS.x0; u <= BOUNDS.x1; u += step) {
          const tone = projectorTone(u, v, t);
          if (tone > 0.03) put(px(u), py(v), q * 0.6 * Math.sqrt(tone));
        }
      }
      ctx.fill();
      ctx.globalAlpha = 0.42;
      ctx.fill(half_);
      ctx.globalAlpha = 0.16;
      ctx.fill(faint);
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      if (visible) frame(now);
      raf = requestAnimationFrame(loop);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) frame(performance.now());
    });
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      if (e) visible = e.isIntersecting;
    });
    io.observe(el);
    if (reduced) frame(performance.now());
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [keepOut, reduced]);

  return (
    <canvas
      ref={canvas}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
