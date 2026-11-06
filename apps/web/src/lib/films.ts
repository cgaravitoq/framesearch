import type { Film } from "@framesearch/schema";
import { useQuery } from "@tanstack/react-query";
import { getFilms } from "./api";

export function useFilms(): Film[] | null {
  const films = useQuery({
    queryKey: ["films"],
    queryFn: ({ signal }) => getFilms(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (films.isError) return [];
  return films.data ?? null;
}
