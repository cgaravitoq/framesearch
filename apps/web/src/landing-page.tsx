import type { Film } from "@framesearch/schema";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Footer, LEGAL, Nav, TwoTone } from "./chrome";
import { DotPicture } from "./dot-picture";
import { useFilms } from "./lib/films";
import { EASE, useInView, useReducedMotion } from "./lib/motion";
import { ProjectorHero } from "./projector-hero";
import { HeroSearch } from "./search-pill";

const ex = (name: string) => `/examples/${name}.webp`;

function Hero() {
  const copy = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const enter = (delay: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.8, ease: EASE, delay },
  });
  return (
    <section
      className="relative flex min-h-[max(100svh,720px)] flex-col overflow-hidden"
      aria-labelledby="hero-title"
    >
      <ProjectorHero keepOut={copy} />
      <div className="relative z-10 flex flex-1 flex-col items-center px-4 pt-[22svh] text-center max-md:pt-40">
        <div
          ref={copy}
          className="flex w-full max-w-[680px] flex-col items-center"
        >
          <motion.h1
            id="hero-title"
            className="heading-1 font-medium tracking-[var(--tracking-display)]"
            {...enter(0.05)}
          >
            <span className="block text-mute">Describe any shot.</span>
            <span className="block text-ink">Get the exact frame.</span>
          </motion.h1>
          <motion.p
            className="body-3 mt-6 max-w-[340px] text-body"
            {...enter(0.15)}
          >
            Type what you remember from a film and get the frame back, with its
            timecode.
          </motion.p>
          <motion.div className="mt-12 w-full" {...enter(0.25)}>
            <HeroSearch />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

const EXAMPLE_QUERY = "a car on a country road";

const STEPS = [
  {
    title: "Describe the shot",
    body: "Write what you remember in plain words, in English or Spanish. No title or timecode needed.",
  },
  {
    title: "Every shot is ranked",
    body: "Your words are compared with every frame and its caption across the index, best match first.",
  },
  {
    title: "Follow the look",
    body: "Open a shot and the ones that share its light and framing line up, from any film.",
  },
];

const RANKED = [
  { name: "car-road-wide", note: "Wide, wheat field" },
  { name: "car-road-interior", note: "From the back seat" },
  { name: "car-road-aerial", note: "From above" },
  { name: "car-road-night", note: "Headlights at night" },
] as const;

const ALIKE = [
  { name: "farmhouse-night", note: "Moonlit farmhouse" },
  { name: "neon-alley", note: "Rain and neon" },
  { name: "diner-night", note: "Diner after hours" },
];

function Still({
  name,
  note,
  rank,
  big = false,
}: {
  name: string;
  note: string;
  rank?: number;
  big?: boolean;
}) {
  return (
    <figure className="min-w-0">
      <img
        src={ex(name)}
        alt={note}
        className={`block w-full rounded-[var(--radius-sm)] object-cover ${big ? "aspect-[3/2]" : "aspect-[3/2]"}`}
        loading="lazy"
      />
      <figcaption className="caption-2 mt-2 flex items-baseline gap-2 text-body">
        {rank !== undefined && <span className="numeric text-ink">{rank}</span>}
        <span className="truncate">{note}</span>
      </figcaption>
    </figure>
  );
}

function StepStage({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex h-11 w-full max-w-md items-center gap-3 rounded-full bg-ink px-4 text-paper">
          <Search
            className="size-4 shrink-0 opacity-60"
            strokeWidth={2.2}
            aria-hidden="true"
          />
          <span className="body-5">{EXAMPLE_QUERY}</span>
        </div>
        <div className="w-full max-w-xl">
          <DotPicture
            src={ex("car-road-wide")}
            ratio={3 / 2}
            pitch={6}
            label="The shot as you remember it, drawn in dots"
          />
          <p className="caption-2 mt-2 text-body">
            The shot as you remember it: blurry, but the words are enough.
          </p>
        </div>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="flex flex-col gap-6">
        <p className="title-4 text-body">
          Results for <span className="text-ink">“{EXAMPLE_QUERY}”</span>
        </p>
        <div className="grid grid-cols-[2fr_1fr_1fr] items-end gap-4 max-sm:grid-cols-2">
          <div className="max-sm:col-span-2">
            <Still name={RANKED[0].name} note={RANKED[0].note} rank={1} big />
          </div>
          <Still name={RANKED[1].name} note={RANKED[1].note} rank={2} />
          <Still name={RANKED[2].name} note={RANKED[2].note} rank={3} />
        </div>
        <div className="grid grid-cols-4 gap-4 max-sm:grid-cols-2">
          <Still name={RANKED[3].name} note={RANKED[3].note} rank={4} />
          <Still name="cemetery-fog" note="Fog, no car" rank={5} />
          <Still name="lake-boat" note="Water, no road" rank={6} />
          <Still name="window-rain" note="A street seen indoors" rank={7} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 items-end gap-4 max-sm:grid-cols-1">
        <Still name="car-road-night" note="The shot you opened" big />
        <p className="title-4 max-w-56 pb-8 text-body max-sm:pb-0">
          Shots that share its light,{" "}
          <span className="text-ink">from three other films.</span>
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-2">
        {ALIKE.map((a) => (
          <Still key={a.name} name={a.name} note={a.note} />
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  const [ref, inView] = useInView<HTMLElement>("0px 0px -25% 0px");
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const [touched, setTouched] = useState(false);
  const reduced = useReducedMotion();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const playing = inView && !held && !touched && !reduced;
  const PACE = 5200;

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(
      () => setStep((step + 1) % STEPS.length),
      PACE,
    );
    return () => window.clearTimeout(id);
  }, [playing, step]);

  const pick = (i: number) => {
    setTouched(true);
    setStep(i);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    const to =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? STEPS.length - 1
          : delta
            ? (step + delta + STEPS.length) % STEPS.length
            : -1;
    if (to < 0) return;
    e.preventDefault();
    pick(to);
    tabs.current[to]?.focus();
  };

  return (
    <section
      ref={ref}
      id="how"
      className="scroll-mt-24 px-6 py-24"
      aria-labelledby="how-title"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      <div className="mx-auto max-w-6xl">
        <h2 id="how-title">
          <TwoTone grey="Three steps," black="one search box." />
        </h2>
        <div className="mt-16 grid gap-16 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <div
            role="tablist"
            aria-label="How it works"
            aria-orientation="vertical"
            className="flex flex-col gap-2"
            onKeyDown={onKey}
          >
            {STEPS.map((s, i) => {
              const on = i === step;
              return (
                <button
                  key={s.title}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`how-tab-${i}`}
                  aria-selected={on}
                  aria-controls="how-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => pick(i)}
                  className="group relative rounded-[var(--radius-md)] py-4 pr-4 pl-12 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span
                    className={`numeric caption-1 absolute top-5 left-4 ${on ? "text-ink" : "text-body"}`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`title-1 block ${on ? "text-ink" : "text-body group-hover:text-ink-2"}`}
                  >
                    {s.title}
                  </span>
                  <span
                    className={`body-6 mt-2 block max-w-sm ${on ? "text-body" : "hidden"}`}
                  >
                    {s.body}
                  </span>
                  <span
                    className="absolute right-4 bottom-0 left-12 h-px overflow-hidden bg-rule"
                    aria-hidden="true"
                  >
                    {on && (
                      <span
                        key={`${step}-${playing}`}
                        className="block h-full origin-left bg-ink"
                        style={{
                          transform: playing ? undefined : "scaleX(1)",
                          animation: playing
                            ? `fill ${PACE}ms linear forwards`
                            : undefined,
                        }}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div
            id="how-panel"
            role="tabpanel"
            aria-labelledby={`how-tab-${step}`}
            className="min-h-[520px] max-md:min-h-0"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0.2 : 0.35, ease: EASE }}
              >
                <StepStage step={step} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

const FIGURES = [
  {
    value: "28 ms",
    label: "a search, end to end",
    note: "From your words to ranked shots, on a server of your own.",
  },
  {
    value: "11.1 ms",
    label: "to read your words",
    note: "Median time to embed a query with EmbeddingGemma.",
  },
  {
    value: "5.4 ms",
    label: "to rank every shot",
    note: "Median time to score the whole index against it.",
  },
  {
    value: "178 ms",
    label: "for 300,000 shots",
    note: "Ranking grows in step with the index: 58.8 ms at 100,000.",
  },
  {
    value: "58 of 59",
    label: "found in the top five",
    note: "Queries across 3 films that land the right shot in the first five.",
  },
  {
    value: "0.958",
    label: "mean reciprocal rank",
    note: "The right shot is almost always the first one you see.",
  },
];

function Numbers() {
  return (
    <section
      id="numbers"
      className="scroll-mt-24 px-6 py-24"
      aria-labelledby="numbers-title"
    >
      <div className="mx-auto max-w-6xl">
        <h2 id="numbers-title">
          <TwoTone
            grey="Run it on your own machine,"
            black="and a search takes 28 ms."
          />
        </h2>
        <p className="body-3 mt-6 max-w-xl text-body">
          Self host framesearch on a laptop or a server and every step stays
          local: the embedding, the ranking and the frames.
        </p>
        <dl className="mt-16 grid gap-x-16 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          {FIGURES.map((m) => (
            <div key={m.label}>
              <dt className="sr-only">{m.label}</dt>
              <dd>
                <span className="heading-2 block font-medium tracking-[var(--tracking-display)] text-ink">
                  {m.value}
                </span>
                <span className="title-3 mt-4 block text-ink">{m.label}</span>
                <span className="body-6 mt-1 block max-w-xs text-body">
                  {m.note}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function faqItems(films: Film[] | null) {
  const list = films?.map((f) => f.title).join(", ");
  return [
    {
      q: "What can I search?",
      a: "Every shot of the indexed films. Describe what is on screen: people, places, light, movement. Each result gives the film and the timecode.",
    },
    {
      q: "Which films are indexed?",
      a: list
        ? `Right now: ${list}. New films appear as they are published.`
        : "The list loads from the live index.",
    },
    {
      q: "Do I need the exact words from the film?",
      a: "No. Your description is compared by meaning with each frame and with a caption written for it, and keyword matches are added on top.",
    },
    {
      q: "Can I search in Spanish?",
      a: "Yes. Write in Spanish or English; the embedding model reads both languages.",
    },
    {
      q: "How fast is a search?",
      a: "On your own machine a search takes about 28 ms from query to ranked shots. On the public site the first search after a quiet hour waits a few seconds while the model wakes up.",
    },
    {
      q: "What are similar shots?",
      a: "Open any result and every other shot is ranked by how close its frame looks, across all indexed films.",
    },
    {
      q: "Does it cost anything?",
      a: "No. Searching is free and needs no account.",
    },
    {
      q: "Who owns the frames?",
      a: `${LEGAL} Rights holders can ask for removal from the about page.`,
    },
    {
      q: "Can I run it on my own films?",
      a: "Yes. framesearch is MIT licensed, and the README explains how to index a film on your machine and publish it to your own Cloudflare account.",
    },
  ];
}

function PlainFaq({ films }: { films: Film[] | null }) {
  return (
    <section
      id="faq"
      className="scroll-mt-24 px-6 py-24"
      aria-labelledby="faq-title"
    >
      <div className="mx-auto max-w-6xl">
        <h2 id="faq-title">
          <TwoTone grey="Questions," black="answered plainly." />
        </h2>
        <dl className="mt-16 grid gap-x-16 gap-y-12 md:grid-cols-2">
          {faqItems(films).map((it) => (
            <div key={it.q}>
              <dt className="title-2">{it.q}</dt>
              <dd className="body-3 mt-2 max-w-xl text-body">{it.a}</dd>
            </div>
          ))}
        </dl>
        <p className="body-6 mt-12 text-body">
          Something else? Read the{" "}
          <Link
            className="text-ink underline underline-offset-4 hover:text-accent"
            to="/about"
          >
            about page
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="px-6 pt-24 pb-32" aria-labelledby="cta-title">
      <div className="mx-auto flex max-w-[680px] flex-col items-center text-center">
        <h2 id="cta-title">
          <TwoTone
            grey="Still thinking of that shot?"
            black="Describe it now."
          />
        </h2>
        <div className="mt-12 w-full">
          <HeroSearch id="cta-search" />
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  const films = useFilms();
  return (
    <>
      <a
        href="#main"
        className="skip-link button-sm rounded-full bg-ink px-4 py-2 text-paper"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Numbers />
        <PlainFaq films={films} />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
