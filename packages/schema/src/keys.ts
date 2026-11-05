export function frameKey(film: string, idx: number): string {
  return `frames/${film}/${idx}.jpg`;
}

export function vectorsKey(film: string, stamp?: string): string {
  return stamp === undefined
    ? `vectors/${film}.bin`
    : `vectors/${film}-${stamp}.bin`;
}
