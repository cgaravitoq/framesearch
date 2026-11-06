import type { Film, Hit, SearchReply } from "@framesearch/schema";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Copy, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compare } from "./bencho/image-compare/Compare";
import "./bencho/image-compare/Compare.css";
import { Scrub } from "./bencho/time-scrubber/Scrub";
import "./bencho/time-scrubber/Scrub.css";
import { type Toast, ToastStack } from "./bencho/toast-stack/ToastStack";
import "./bencho/toast-stack/ToastStack.css";
import { LegalFooter, Logo, TwoTone } from "./chrome";
import {
  ApiError,
  type Found,
  getFlags,
  logClick,
  logSearch,
  searchShots,
  similarShots,
} from "./lib/api";
import { useFilms } from "./lib/films";
import { EASE, useReducedMotion, useWidth } from "./lib/motion";
import { timecode } from "./lib/time";
import { SearchPill } from "./search-pill";

const DEBOUNCE_MS = 320;
const MIN_QUERY_LENGTH = 3;
const LOG_SETTLE_MS = 1200;
const SIMILAR_K = 8;
export const SIZES = [12, 24, 48];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

const STARTERS = [
  { q: "a farmhouse at night", still: "farmhouse-night" },
  { q: "a car on a country road", still: "car-road-wide" },
  { q: "a cemetery with gravestones", still: "cemetery-fog" },
  { q: "a woman looking out of a window", still: "window-rain" },
  { q: "headlights on a dark road", still: "car-road-night" },
  { q: "una mujer bajando una escalera", still: "staircase-descent" },
];

type Results =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; busy: boolean }
  | { status: "done"; shots: Hit[]; serverMs: number | null };

type Related =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; shots: Hit[] };

export interface SearchStart {
  q: string;
  k: number;
  shot: number | null;
  held: Hit | null;
}

let toastId = 1;

function captionOf(shot: Hit): string {
  return shot.caption ?? `${shot.title} at ${timecode(shot.time)}`;
}

export function SearchPage({ start }: { start: SearchStart }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(start.q);
  const [term, setTerm] = useState("");
  const k = start.k;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const films = useFilms();
  const settledLog = useRef<{
    reply: SearchReply;
    id: Promise<number | null>;
  } | null>(null);

  const toast = useCallback((next: Omit<Toast, "id">) => {
    const id = toastId++;
    setToasts((list) =>
      [
        { ...next, id },
        ...list.filter((entry) => entry.title !== next.title),
      ].slice(0, 3),
    );
    if (next.kind === "success" || next.kind === "info") {
      window.setTimeout(
        () => setToasts((list) => list.filter((entry) => entry.id !== id)),
        4200,
      );
    }
  }, []);

  useEffect(() => {
    const next = searchable(q);
    if (next === "") {
      setTerm("");
      return;
    }
    const timer = window.setTimeout(() => setTerm(next), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q]);

  const flags = useQuery({
    queryKey: ["flags"],
    queryFn: ({ signal }) => getFlags(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const searchLog = flags.data?.searchLog ?? true;

  const search = useQuery({
    queryKey: ["search", term, k],
    queryFn: ({ signal }) => searchShots(term, k, signal),
    enabled: term !== "",
    staleTime: Number.POSITIVE_INFINITY,
  });

  const selected = selectedOf(start, search.data);

  const related = useQuery({
    queryKey: ["similar", selected?.shotId ?? 0],
    queryFn: ({ signal }) =>
      selected === null
        ? Promise.resolve([])
        : similarShots(selected, SIMILAR_K, signal),
    enabled: selected !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const found: Found | undefined = search.data;

  useEffect(() => {
    const error = search.error;
    if (error === null) return;
    const busy = error instanceof ApiError && error.busy;
    toast({
      kind: busy ? "warning" : "error",
      title: busy ? "Search is busy" : "Search failed",
      body: error.message,
      action: "Retry",
    });
  }, [search.error, toast]);

  useEffect(() => {
    if (related.error === null) return;
    toast({
      kind: "error",
      title: "Similar shots failed",
      body: related.error.message,
    });
  }, [related.error, toast]);

  const settleSearchLog = useCallback(
    (reply: SearchReply) => {
      if (!searchLog) return Promise.resolve(null);
      const previous = settledLog.current;
      if (previous !== null && previous.reply === reply) return previous.id;
      const id = logSearch(reply);
      settledLog.current = { reply, id };
      return id;
    },
    [searchLog],
  );

  useEffect(() => {
    if (found === undefined || search.isFetching) return;
    const timer = window.setTimeout(() => {
      void settleSearchLog(found.reply);
    }, LOG_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [found, search.isFetching, settleSearchLog]);

  const writeUrl = (
    query: string,
    size: number,
    shot: Hit | null,
    push = false,
  ) => {
    void navigate({
      to: "/search",
      search: {
        ...(query === "" ? {} : { q: query }),
        ...(size === SIZES[0] ? {} : { k: size }),
        ...(shot === null ? {} : { shot: shot.shotId }),
      },
      state: (previous) => {
        const next = { ...previous, shot };
        return next;
      },
      replace: !push,
      resetScroll: push,
    });
  };

  const updateQuery = (value: string) => {
    setQ(value);
    writeUrl(value.trim(), k, null);
  };

  const select = (shot: Hit | null) => {
    writeUrl(q.trim(), k, shot, true);
    if (shot === null || found === undefined) return;
    const at = found.reply.results.findIndex(
      (entry) => entry.shotId === shot.shotId,
    );
    if (at < 0) return;
    void settleSearchLog(found.reply).then((id) => {
      if (id !== null) void logClick(id, shot.shotId, at + 1);
    });
  };

  const retry = () => void search.refetch();

  const results = resultsOf(q, term, search, found);
  const hasQuery = results.status !== "idle";
  const film = films?.find((entry) => entry.slug === selected?.film);

  return (
    <div className="min-h-screen">
      <a
        href="#results"
        className="skip-link button-sm rounded-full bg-ink px-4 py-2 text-paper"
      >
        Skip to results
      </a>
      <header className="sticky top-0 z-40 bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto grid max-w-[1440px] grid-cols-[1fr_minmax(0,672px)_1fr] items-center gap-6 px-6 py-4 max-md:grid-cols-[1fr_auto] max-md:gap-3 max-md:px-4">
          <Logo className="justify-self-start" />
          <div className="max-md:order-3 max-md:col-span-2">
            <SearchPill
              id="search-field"
              value={q}
              onChange={updateQuery}
              onSubmit={updateQuery}
              autoFocus
              wide
              placeholder="Describe a shot"
            />
          </div>
          <Link
            to="/"
            className="body-6 inline-flex items-center gap-2 justify-self-end rounded-full text-body hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Home
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-6 max-md:px-4">
        <main id="results">
          {!hasQuery ? (
            <Starters onPick={updateQuery} />
          ) : (
            <div
              className={`grid gap-12 pt-8 pb-24 ${selected ? "lg:grid-cols-[minmax(0,1fr)_440px]" : ""}`}
            >
              <div
                className="min-w-0"
                aria-live="polite"
                aria-busy={results.status === "loading"}
              >
                <ResultsView
                  q={q}
                  results={results}
                  selected={selected}
                  wide={selected === null}
                  onSelect={select}
                  onExample={updateQuery}
                  onRetry={retry}
                  k={k}
                  onK={(size) => writeUrl(q.trim(), size, selected)}
                />
              </div>
              <AnimatePresence mode="wait">
                {selected !== null && (
                  <Detail
                    key={selected.shotId}
                    shot={selected}
                    film={film}
                    related={relatedOf(related)}
                    results={results.status === "done" ? results.shots : []}
                    onSelect={select}
                    onClose={() => select(null)}
                    onCopy={() => {
                      const code = timecode(selected.time);
                      navigator.clipboard
                        ?.writeText(`${selected.title} ${code}`)
                        .catch(() => undefined);
                      toast({
                        kind: "success",
                        title: `Timecode ${code} copied`,
                        body: selected.title,
                      });
                    }}
                  />
                )}
              </AnimatePresence>
            </div>
          )}
        </main>
        <LegalFooter
          note={
            searchLog
              ? "Searches are logged anonymously: the query and the shots you open, never your IP."
              : null
          }
        />
      </div>

      <div className="fixed right-6 bottom-6 z-50 max-sm:right-4 max-sm:bottom-4 max-sm:left-4 max-sm:[&>.tst]:w-full!">
        {toasts.length > 0 && (
          <ToastStack
            corner={16}
            toasts={toasts}
            onDismiss={(id) =>
              setToasts((list) => list.filter((entry) => entry.id !== id))
            }
            onAction={(id) => {
              setToasts((list) => list.filter((entry) => entry.id !== id));
              retry();
            }}
          />
        )}
      </div>
    </div>
  );
}

function selectedOf(start: SearchStart, found: Found | undefined): Hit | null {
  if (start.shot === null) return null;
  if (start.held?.shotId === start.shot) return start.held;
  return (
    found?.reply.results.find((shot) => shot.shotId === start.shot) ?? null
  );
}

function searchable(q: string): string {
  const trimmed = q.trim();
  return trimmed.length < MIN_QUERY_LENGTH ? "" : trimmed;
}

function resultsOf(
  q: string,
  term: string,
  search: { isFetching: boolean; error: Error | null },
  found: Found | undefined,
): Results {
  const wanted = searchable(q);
  if (wanted === "") return { status: "idle" };
  if (wanted !== term || search.isFetching) return { status: "loading" };
  if (search.error !== null) {
    return {
      status: "error",
      message: search.error.message,
      busy: search.error instanceof ApiError && search.error.busy,
    };
  }
  if (found === undefined) return { status: "loading" };
  return {
    status: "done",
    shots: found.reply.results,
    serverMs: found.serverMs,
  };
}

function relatedOf(query: {
  isFetching: boolean;
  error: Error | null;
  data: Hit[] | undefined;
}): Related {
  if (query.isFetching) return { status: "loading" };
  if (query.error !== null) {
    return { status: "error", message: query.error.message };
  }
  if (query.data === undefined) return { status: "idle" };
  return { status: "done", shots: query.data };
}

function Starters({ onPick }: { onPick: (q: string) => void }) {
  return (
    <section className="pt-12 pb-24" aria-labelledby="start-title">
      <h1 id="start-title" className="text-center">
        <TwoTone
          grey="Describe the shot you remember,"
          black="or start from one of these."
        />
      </h1>
      <ul className="mx-auto mt-16 grid max-w-6xl grid-cols-3 gap-x-6 gap-y-12 max-md:grid-cols-2 max-sm:grid-cols-1">
        {STARTERS.map((starter) => (
          <li key={starter.q}>
            <button
              type="button"
              onClick={() => onPick(starter.q)}
              className="group block w-full rounded-[var(--radius-sm)] text-left"
            >
              <img
                src={`/examples/${starter.still}.webp`}
                alt=""
                className="block aspect-[3/2] w-full rounded-[var(--radius-sm)] object-cover opacity-95 group-hover:opacity-100"
                loading="lazy"
              />
              <span className="title-2 mt-4 block text-ink group-hover:underline group-hover:underline-offset-4">
                “{starter.q}”
              </span>
              <span className="caption-2 mt-1 block text-body">
                Search the index for it
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({
  shot,
  on,
  onSelect,
  i,
}: {
  shot: Hit;
  on: boolean;
  onSelect: () => void;
  i: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay: Math.min(i * 0.03, 0.3) }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={on}
        className="group block w-full rounded-[var(--radius-sm)] text-left"
      >
        <img
          src={shot.frameUrl}
          alt={captionOf(shot)}
          loading="lazy"
          className={`block aspect-[4/3] w-full rounded-[var(--radius-sm)] bg-tint object-cover ${
            on
              ? "outline-2 outline-offset-2 outline-ink"
              : "group-hover:opacity-90"
          }`}
        />
        <span className="flex items-baseline justify-between gap-2 pt-3">
          <span className="caption-4 truncate text-body">{shot.title}</span>
          <span className="numeric caption-4 shrink-0 text-ink">
            {timecode(shot.time)}
          </span>
        </span>
        <span className="caption-2 line-clamp-2 pt-1 text-ink-2">
          {shot.caption}
        </span>
      </button>
    </motion.li>
  );
}

function ResultsView({
  q,
  results,
  selected,
  wide,
  onSelect,
  onExample,
  onRetry,
  k,
  onK,
}: {
  q: string;
  results: Results;
  selected: Hit | null;
  wide: boolean;
  onSelect: (shot: Hit) => void;
  onExample: (q: string) => void;
  onRetry: () => void;
  k: number;
  onK: (size: number) => void;
}) {
  const show = (
    <div
      role="radiogroup"
      aria-label="Shots per search"
      className="flex shrink-0 items-center gap-1"
    >
      <span className="caption-2 mr-2 text-body max-sm:sr-only">Show</span>
      {SIZES.map((size) => (
        <label
          key={size}
          className={`numeric caption-1 cursor-pointer rounded-full px-3 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-accent ${k === size ? "bg-ink text-paper" : "text-body hover:bg-tint"}`}
        >
          <input
            type="radio"
            name="shots-per-search"
            value={size}
            checked={k === size}
            onChange={() => onK(size)}
            className="sr-only"
          />
          {size}
        </label>
      ))}
    </div>
  );
  const grid = `grid gap-x-6 gap-y-10 ${wide ? "grid-cols-4 max-xl:grid-cols-3" : "grid-cols-3 max-xl:grid-cols-2"} max-md:grid-cols-2 max-sm:grid-cols-1`;
  if (results.status === "loading" || results.status === "idle") {
    return (
      <div>
        <div className="flex items-start justify-between gap-4 pb-6">
          <p className="title-4 min-w-0 text-body">
            Searching for “{q.trim()}”
          </p>
          {show}
        </div>
        <ul className={grid} aria-label="Loading results">
          {SLOTS.map((slot) => (
            <li key={slot}>
              <div className="shimmer aspect-[4/3] rounded-[var(--radius-sm)]" />
              <div className="shimmer mt-3 h-3 w-1/2 rounded-full" />
              <div className="shimmer mt-2 h-3 w-4/5 rounded-full" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (results.status === "error") {
    return (
      <div role="alert" className="mx-auto max-w-xl py-16 text-center">
        <h1>
          <TwoTone
            grey={
              results.busy
                ? "The search is busy."
                : "The search did not finish."
            }
            black="Try it again."
            className="heading-3"
          />
        </h1>
        <p className="body-3 mt-6 text-body">{results.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="button-sm mt-8 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2 text-paper"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Retry search
        </button>
      </div>
    );
  }
  if (results.shots.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1>
          <TwoTone
            grey={`No shots match “${q.trim()}”.`}
            black="Describe what is visible."
            className="heading-3"
          />
        </h1>
        <p className="body-3 mt-6 text-body">
          Try fewer words, or the light, the place and the people rather than
          the plot.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {STARTERS.slice(0, 3).map((starter) => (
            <button
              key={starter.q}
              type="button"
              onClick={() => onExample(starter.q)}
              className="body-5 rounded-full bg-tint px-4 py-2 hover:bg-tint-2"
            >
              {starter.q}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-start justify-between gap-4 pb-6">
        <h1 className="title-4 min-w-0 text-body">
          <span className="text-ink">{results.shots.length} shots</span> for “
          {q.trim()}”
          {results.serverMs !== null && (
            <span>
              {" "}
              in <span className="numeric">{results.serverMs}</span> ms on the
              server
            </span>
          )}
        </h1>
        {show}
      </div>
      <ul className={grid}>
        {results.shots.map((shot, i) => (
          <Card
            key={shot.shotId}
            shot={shot}
            i={i}
            on={selected?.shotId === shot.shotId}
            onSelect={() => onSelect(shot)}
          />
        ))}
      </ul>
    </div>
  );
}

function Detail({
  shot,
  film,
  related,
  results,
  onSelect,
  onClose,
  onCopy,
}: {
  shot: Hit;
  film: Film | undefined;
  related: Related;
  results: Hit[];
  onSelect: (shot: Hit) => void;
  onClose: () => void;
  onCopy: () => void;
}) {
  const reduced = useReducedMotion();
  const [boxRef, boxW] = useWidth<HTMLDivElement>();
  const near = related.status === "done" ? related.shots : [];
  const pool = useMemo(() => {
    const byId = new Map<number, Hit>();
    for (const entry of [...results, ...near, shot]) {
      if (entry.film === shot.film) byId.set(entry.shotId, entry);
    }
    return [...byId.values()];
  }, [results, near, shot]);
  const closest = near[0];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.aside
      aria-label={`Shot at ${timecode(shot.time)}`}
      className="flex flex-col gap-8 max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:overflow-y-auto max-lg:bg-paper max-lg:p-4 lg:sticky lg:top-28 lg:max-h-[calc(100svh-8rem)] lg:self-start lg:overflow-y-auto"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="caption-1 text-body">{shot.title}</p>
          <p className="numeric heading-5 mt-1 font-medium">
            {timecode(shot.time)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="button-sm inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-paper"
          >
            <Copy className="size-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Copy timecode</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shot"
            className="inline-flex size-9 items-center justify-center rounded-full bg-tint hover:bg-tint-2"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={boxRef} className="w-full">
        {closest !== undefined && boxW > 0 ? (
          <Compare
            key={`${shot.shotId}-${closest.shotId}`}
            before={shot.frameUrl}
            after={closest.frameUrl}
            names={["This shot", `Closest, ${timecode(closest.time)}`]}
            width={boxW}
            height={Math.round(boxW * 0.75)}
            corner={8}
            label="Drag to compare this shot with its closest match"
          />
        ) : (
          <img
            src={shot.frameUrl}
            alt={captionOf(shot)}
            className="block aspect-[4/3] w-full rounded-[var(--radius-sm)] object-cover"
          />
        )}
      </div>

      <div>
        <p className="body-3">{shot.caption}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {shot.tags.map((tag) => (
            <li
              key={tag}
              className="caption-4 rounded-full bg-tint px-3 py-1 text-body"
            >
              {tag}
            </li>
          ))}
        </ul>
      </div>

      {film !== undefined && (
        <div className="flex flex-col items-center gap-3">
          <p className="caption-1 self-start text-body">
            Where it sits in the film. Drag to step through the shots you found.
          </p>
          <Scrub
            duration={film.duration}
            value={shot.time}
            marks={pool.map((entry) => entry.time)}
            corner={16}
            onSettle={(time) => {
              const hit = pool.find(
                (entry) => Math.abs(entry.time - time) < 0.01,
              );
              if (hit !== undefined && hit.shotId !== shot.shotId)
                onSelect(hit);
            }}
          />
        </div>
      )}

      <div className="pb-2">
        <h2 className="title-3">Shots that look like this</h2>
        {related.status === "loading" && (
          <ul
            className="mt-4 grid grid-cols-4 gap-3 max-sm:grid-cols-2"
            aria-label="Loading similar shots"
          >
            {SLOTS.map((slot) => (
              <li
                key={slot}
                className="shimmer aspect-[4/3] rounded-[var(--radius-sm)]"
              />
            ))}
          </ul>
        )}
        {related.status === "error" && (
          <p className="body-6 mt-3 text-body">{related.message}</p>
        )}
        {related.status === "done" && related.shots.length === 0 && (
          <p className="body-6 mt-3 text-body">
            No other shot looks close to this one.
          </p>
        )}
        {related.status === "done" && related.shots.length > 0 && (
          <ul className="mt-4 grid grid-cols-4 gap-3 max-sm:grid-cols-2">
            {related.shots.map((entry) => (
              <li key={entry.shotId}>
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  className="group block w-full rounded-[var(--radius-sm)] text-left"
                  aria-label={`Open similar shot at ${timecode(entry.time)}: ${captionOf(entry)}`}
                >
                  <img
                    src={entry.frameUrl}
                    alt=""
                    loading="lazy"
                    className="block aspect-[4/3] w-full rounded-[var(--radius-sm)] object-cover group-hover:opacity-90"
                  />
                  <span className="numeric caption-5 mt-1 block text-body">
                    {timecode(entry.time)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.aside>
  );
}
