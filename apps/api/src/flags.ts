export const FLAG_VARS = {
  searchLog: "SEARCH_LOG",
} as const;

export type Flags = Readonly<Record<keyof typeof FLAG_VARS, boolean>>;

export function readFlags(vars: Readonly<Record<string, unknown>>): Flags {
  return { searchLog: vars[FLAG_VARS.searchLog] === true };
}
