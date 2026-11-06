export type Tone = { w: number; h: number; d: Float32Array };

const TONE_W = 160;
const TONE_H = 120;

export function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function inkColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-ink")
      .trim() || "#f2f1ee"
  );
}

const tones = new Map<string, Promise<Tone | null>>();

async function readTone(url: string): Promise<Tone | null> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = TONE_W;
  canvas.height = TONE_H;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(image, 0, 0, TONE_W, TONE_H);
  const pixels = context.getImageData(0, 0, TONE_W, TONE_H).data;
  const d = new Float32Array(TONE_W * TONE_H);
  const sample: number[] = [];
  for (let i = 0; i < d.length; i++) {
    const r = pixels[i * 4] ?? 0;
    const g = pixels[i * 4 + 1] ?? 0;
    const b = pixels[i * 4 + 2] ?? 0;
    const dark = 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    d[i] = dark;
    if (i % 7 === 0) sample.push(dark);
  }
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.04)] ?? 0;
  const hi = sample[Math.floor(sample.length * 0.96)] ?? 1;
  for (let i = 0; i < d.length; i++) {
    const value = ((d[i] ?? 0) - lo) / Math.max(0.05, hi - lo);
    d[i] = Math.min(1, Math.max(0, value)) ** 1.2;
  }
  return { w: TONE_W, h: TONE_H, d };
}

export function loadTone(url: string): Promise<Tone | null> {
  let tone = tones.get(url);
  if (tone === undefined) {
    tone = readTone(url);
    tones.set(url, tone);
  }
  return tone;
}

export function toneAt(tone: Tone, u: number, v: number): number {
  const x = Math.min(tone.w - 1, Math.max(0, Math.floor(u * tone.w)));
  const y = Math.min(tone.h - 1, Math.max(0, Math.floor(v * tone.h)));
  return tone.d[y * tone.w + x] ?? 0;
}
