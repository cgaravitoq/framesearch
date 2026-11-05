const QUERY_PREFIX = "task: search result | query: ";

export function embedText(query: string): string {
  return `${QUERY_PREFIX}${query}`;
}
