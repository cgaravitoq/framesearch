export function frameKey(film: string, idx: number): string {
  return `frames/${film}/${idx}.jpg`;
}

export function vectorsKey(film: string): string {
  return `vectors/${film}.bin`;
}
