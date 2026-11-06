export const FRAME_WIDTH = 960;
export const THUMB_WIDTH = 480;

export function frameKey(film: string, idx: number): string {
  return `frames/${film}/${idx}.jpg`;
}

export function thumbKey(film: string, idx: number): string {
  return `frames/${film}/${idx}-${THUMB_WIDTH}.jpg`;
}

export function vectorsKey(film: string, stamp?: string): string {
  return stamp === undefined
    ? `vectors/${film}.bin`
    : `vectors/${film}-${stamp}.bin`;
}
