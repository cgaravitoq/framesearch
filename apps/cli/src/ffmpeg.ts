import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const SCENE_THRESHOLD = 0.3;
const FRAME_CONCURRENCY = 6;
const PTS_PATTERN = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
const TIME_PRECISION = 1000;
const MAX_SAMPLE_GAP = 10;

export interface Shot {
  start: number;
  end: number;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(cmd: readonly string[]): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: [...cmd],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

interface ProbeOutput {
  format?: { duration?: string };
}

export async function probeDuration(video: string): Promise<number> {
  const { code, stdout, stderr } = await run([
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    video,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe could not read ${video}: ${tail(stderr)}`);
  }
  const duration = Number(
    (JSON.parse(stdout) as ProbeOutput).format?.duration ?? Number.NaN,
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe reported no duration for ${video}`);
  }
  return duration;
}

export async function detectCuts(video: string): Promise<number[]> {
  const { code, stderr } = await run([
    "ffmpeg",
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "info",
    "-i",
    video,
    "-an",
    "-vf",
    `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
    "-f",
    "null",
    "-",
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg scene detection failed (${code}): ${tail(stderr)}`);
  }
  return parseCutTimes(stderr);
}

function parseCutTimes(log: string): number[] {
  const times: number[] = [];
  for (const match of log.matchAll(PTS_PATTERN)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) times.push(value);
  }
  return times.sort((left, right) => left - right);
}

export function shotBounds(cuts: readonly number[], duration: number): Shot[] {
  const starts: number[] = [0];
  for (const cut of cuts) {
    if (!(cut > 0) || cut >= duration) continue;
    const last = starts[starts.length - 1] ?? 0;
    if (cut - last < 1 / TIME_PRECISION) continue;
    starts.push(cut);
  }
  const shots: Shot[] = [];
  for (let at = 0; at < starts.length; at += 1) {
    const start = starts[at] ?? 0;
    const end = starts[at + 1] ?? duration;
    if (end > start) shots.push({ start, end });
  }
  return shots;
}

export function sampleTimes(shots: readonly Shot[]): number[] {
  const times = new Set<number>();
  for (const shot of shots) {
    const length = shot.end - shot.start;
    const count = Math.max(1, Math.ceil(length / MAX_SAMPLE_GAP));
    for (let at = 0; at < count; at += 1) {
      const time = shot.start + (length * (at + 0.5)) / count;
      times.add(Math.round(time * TIME_PRECISION) / TIME_PRECISION);
    }
  }
  return [...times].sort((left, right) => left - right);
}

export function shotAt(shots: readonly Shot[], time: number): Shot {
  const found = shots.find((shot) => time >= shot.start && time < shot.end);
  if (found === undefined) {
    throw new Error(`none of ${shots.length} shots holds ${time}s`);
  }
  return found;
}

export async function extractFrames(
  video: string,
  times: readonly number[],
  outDir: string,
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const paths = times.map((_, idx) =>
    join(outDir, `${String(idx).padStart(5, "0")}.jpg`),
  );
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const time = times[index];
      const out = paths[index];
      if (time === undefined || out === undefined) return;
      const { code, stderr } = await run([
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-ss",
        time.toFixed(3),
        "-i",
        video,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-y",
        out,
      ]);
      if (code !== 0) {
        throw new Error(
          `ffmpeg frame extraction at ${time.toFixed(3)}s failed (${code}): ${tail(stderr)}`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FRAME_CONCURRENCY, times.length) }, worker),
  );
  return paths;
}

function tail(text: string): string {
  return text.trim().split("\n").slice(-2).join(" ").slice(-400);
}
