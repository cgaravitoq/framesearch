export const THUMB_WIDTH = 480;
export const DISPLAY_WIDTH = 960;
export const SIZED_WIDTHS = [THUMB_WIDTH, DISPLAY_WIDTH] as const;
export type SizedWidth = (typeof SIZED_WIDTHS)[number];

export function frameKey(film: string, idx: number): string {
  return `frames/${film}/${idx}.jpg`;
}

export function sizedFrameKey(
  film: string,
  idx: number,
  width: SizedWidth,
): string {
  return `frames/${film}/${idx}-${width}.jpg`;
}

export function vectorsKey(film: string, stamp?: string): string {
  return stamp === undefined
    ? `vectors/${film}.bin`
    : `vectors/${film}-${stamp}.bin`;
}
