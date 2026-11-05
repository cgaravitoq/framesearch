import type { Hit, SearchReply, SimilarReply } from "@framesearch/schema";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Hero } from "./hero";
import {
  getFilms,
  logClick,
  logSearch,
  searchShots,
  similarShots,
} from "./lib/api";
import { clock } from "./lib/time";
import { ShotGrid } from "./shot-grid";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;
const LOG_SETTLE_MS = 1200;

const EXAMPLES = [
  "a helicopter over a field",
  "niña llorando en un carrito",
  "a woman screaming in close-up",
  "un cementerio bajo la niebla",
];

export function SearchPage() {
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [film, setFilm] = useState("");
  const [submits, setSubmits] = useState(0);
  const [hero, setHero] = useState<Hit | null>(null);
  const [similarFrom, setSimilarFrom] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const queryClient = useQueryClient();
  const settledLog = useRef<{
    reply: SearchReply;
    id: Promise<number | null>;
  } | null>(null);

  const films = useQuery({
    queryKey: ["films"],
    queryFn: ({ signal }) => getFilms(signal),
  });

  const search = useQuery({
    queryKey: ["search", term, film, submits],
    queryFn: ({ signal }) => searchShots(term, film, signal),
    enabled: term !== "",
    placeholderData: keepPreviousData,
  });

  const similar = useQuery({
    queryKey: ["similar", similarFrom],
    queryFn: ({ signal }) => similarShots(similarFrom, signal),
    enabled: similarFrom > 0,
  });

  const settleSearchLog = useCallback((reply: SearchReply) => {
    const previous = settledLog.current;
    if (previous !== null && previous.reply === reply) return previous.id;
    const id = logSearch(reply);
    settledLog.current = { reply, id };
    return id;
  }, []);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.length < MIN_QUERY_LENGTH || trimmed === term) return;
    const timer = setTimeout(() => setTerm(trimmed), DEBOUNCE_MS);
    debounceTimer.current = timer;
    return () => clearTimeout(timer);
  }, [input, term]);

  useEffect(() => {
    if (search.data === undefined) return;
    setHero(search.data.results[0] ?? null);
    setSimilarFrom(0);
  }, [search.data]);

  useEffect(() => {
    if (search.data === undefined || search.isFetching) return;
    const reply = search.data;
    const timer = setTimeout(() => {
      void settleSearchLog(reply);
    }, LOG_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [search.data, search.isFetching, settleSearchLog]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (trimmed === "") {
      inputRef.current?.focus();
      return;
    }
    setTerm(trimmed);
    setSubmits((count) => count + 1);
  };

  const pickExample = (example: string) => {
    setInput(example);
    setTerm(example);
  };

  const findSimilar = (shot: Hit) => {
    clearTimeout(debounceTimer.current);
    void queryClient.cancelQueries({ queryKey: ["search"] });
    setSimilarFrom(shot.shotId);
  };

  const pickShot = (shot: Hit) => {
    setHero(shot);
    if (similarFrom > 0 || search.data === undefined) return;
    const at = search.data.results.findIndex(
      (entry) => entry.shotId === shot.shotId,
    );
    void settleSearchLog(search.data).then((id) => {
      if (id !== null) void logClick(id, shot.shotId, at < 0 ? null : at + 1);
    });
  };

  const similarReply = similarFrom > 0 ? similar.data : undefined;
  const shots = similarReply?.results ?? search.data?.results ?? [];
  const failure = search.error ?? similar.error;
  const busy = search.isFetching || similar.isFetching;

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 pt-7 pb-10 sm:px-6">
      <search>
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
          <span className="mr-3 font-mono text-[15px] font-medium text-accent">
            framesearch
          </span>
          <label htmlFor="query" className="sr-only">
            Describe a shot
          </label>
          <input
            id="query"
            ref={inputRef}
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="a woman screaming in close-up"
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-[1_1_280px] rounded-full border border-edge bg-field px-4.5 text-base text-ink placeholder:text-muted hover:border-edge-soft"
          />
          <label htmlFor="film" className="sr-only">
            Film
          </label>
          <select
            id="film"
            value={film}
            onChange={(event) => setFilm(event.target.value)}
            className="h-12 rounded-full border border-edge bg-field px-3.5 text-sm text-ink hover:border-edge-soft"
          >
            <option value="">All films</option>
            {films.data?.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-12 rounded-full border border-edge-soft bg-field px-4.5 text-sm font-medium text-ink hover:border-muted"
          >
            Search
          </button>
        </form>
      </search>

      {hero !== null && (
        <Hero
          shot={hero}
          similarPending={similar.isFetching}
          onSimilar={() => findSimilar(hero)}
        />
      )}

      {hero === null && (
        <section className="flex flex-col gap-3">
          <p className="m-0 text-sm text-muted">
            Describe the shot you remember. Results appear as you type.
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => pickExample(example)}
                className="rounded-full border border-edge px-3 py-1.5 text-sm text-body hover:border-edge-soft"
              >
                {example}
              </button>
            ))}
          </div>
        </section>
      )}

      {(search.data !== undefined || failure !== null) && (
        <section aria-busy={busy} className="flex flex-col gap-2.5">
          <p aria-live="polite" className="m-0 font-mono text-xs text-muted">
            {labelFor(shots.length, search.data, similarReply, hero)}
          </p>
          {failure !== null && (
            <p className="m-0 font-mono text-xs text-danger">
              {`Search failed: ${failure.message}`}
            </p>
          )}
          {shots.length > 0 && (
            <ShotGrid
              shots={shots}
              selectedId={hero?.shotId ?? null}
              onPick={pickShot}
            />
          )}
        </section>
      )}

      <p className="m-0 text-xs text-muted">
        Searches are logged anonymously: the query and the shots you open, never
        your IP.
      </p>
    </main>
  );
}

function labelFor(
  count: number,
  reply: SearchReply | undefined,
  similar: SimilarReply | undefined,
  hero: Hit | null,
): string {
  if (similar !== undefined && hero !== null) {
    return `${count} similar shots to ${hero.title} at ${clock(hero.time)}`;
  }
  if (reply === undefined) return "";
  if (count === 0) return `No results for "${reply.query}"`;
  return `${count} results for "${reply.query}"`;
}
