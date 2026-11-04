const ACCENTS = /[\u0300-\u036f]/g;
const TERM = /[\p{L}\p{N}]+/gu;

export function ftsMatch(text: string): string {
  const terms = text.normalize("NFKD").replace(ACCENTS, "").match(TERM) ?? [];
  return terms.map((term) => `"${term}"`).join(" ");
}
