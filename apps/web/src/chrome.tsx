import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { EASE, useInView, useReducedMotion } from "./lib/motion";

export const LEGAL =
  "Frames are copyrighted and belong to their owners, shown at reduced resolution for research, education and commentary.";
export const REPO = "https://github.com/cgaravitoq/framesearch";
export const ISSUES = `${REPO}/issues`;

export function Mark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({
  className = "title-4 font-semibold",
}: {
  className?: string;
}) {
  return (
    <span
      className={`flex flex-col leading-[0.95] tracking-tight ${className}`}
    >
      <span>Frame</span>
      <span>Search</span>
    </span>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center gap-2 rounded-sm ${className}`}
      aria-label="Frame Search home"
    >
      <Mark className="size-6" />
      <Wordmark />
    </Link>
  );
}

export function TwoTone({
  grey,
  black,
  className = "heading-2",
}: {
  grey: ReactNode;
  black: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`block font-medium tracking-[var(--tracking-display)] ${className}`}
    >
      <span className="block text-mute">{grey}</span>
      <span className="block text-ink">{black}</span>
    </span>
  );
}

export function LegalFooter({ note = null }: { note?: string | null }) {
  return (
    <footer>
      {note !== null && (
        <p className="caption-5 pt-12 text-center text-body">{note}</p>
      )}
      <p
        className={`caption-5 pb-12 text-center text-body ${note === null ? "pt-12" : "pt-2"}`}
      >
        {LEGAL}{" "}
        <Link
          to="/about"
          className="underline underline-offset-2 hover:text-ink"
        >
          About and takedown requests
        </Link>
      </p>
    </footer>
  );
}

const SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "numbers", label: "Numbers" },
  { id: "faq", label: "Questions" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element !== null) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-6 z-50 flex justify-center px-4 max-sm:top-3">
      <nav
        aria-label="Main"
        className="flex items-center gap-12 rounded-full bg-paper/70 py-2 pr-2 pl-4 backdrop-blur-xl max-md:w-full max-md:justify-between max-md:gap-4"
      >
        <Logo />
        <ul className="flex items-center gap-10 max-md:hidden">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={active === section.id ? "location" : undefined}
                className="body-6 rounded-sm text-ink-2 transition-colors duration-300 ease-base hover:text-ink aria-[current]:font-medium aria-[current]:text-ink"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Link
            to="/search"
            className="button-sm rounded-full bg-ink px-6 py-2 text-paper transition-transform duration-300 ease-base hover:scale-[1.03] active:scale-[0.98] max-md:px-4"
          >
            Open search
          </Link>
          <button
            type="button"
            className="relative hidden size-10 items-center justify-center rounded-full max-md:flex"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span
              className="absolute h-0.5 w-5 rounded-full bg-ink transition-transform duration-500 ease-base"
              style={{ transform: open ? "rotate(45deg)" : "translateY(-4px)" }}
            />
            <span
              className="absolute h-0.5 w-5 rounded-full bg-ink transition-transform duration-500 ease-base"
              style={{ transform: open ? "rotate(-45deg)" : "translateY(4px)" }}
            />
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 -z-10 bg-paper/95 px-6 pt-24 backdrop-blur-2xl md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <ul className="flex flex-col gap-6">
              {SECTIONS.map((section, i) => (
                <motion.li
                  key={section.id}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.5,
                    ease: EASE,
                    delay: Math.min(i * 0.06, 0.4),
                  }}
                >
                  <a
                    href={`#${section.id}`}
                    className="heading-4 block"
                    onClick={() => setOpen(false)}
                  >
                    {section.label}
                  </a>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

type FootTarget =
  | { label: string; to: "/" | "/search" | "/about"; hash?: string }
  | { label: string; href: string };

function FootLink({ target }: { target: FootTarget }) {
  const inner = (
    <>
      <span
        className="dash absolute top-0 -left-4 text-cream"
        aria-hidden="true"
      >
        -
      </span>
      <span className="label relative text-ash transition-colors duration-300 ease-base">
        {target.label}
        <span
          className="rule absolute inset-x-0 -bottom-0.5 h-px bg-cream"
          aria-hidden="true"
        />
      </span>
    </>
  );
  const style = "foot-link body-6 relative inline-block rounded-sm";
  if ("href" in target) {
    return (
      <a href={target.href} className={style}>
        {inner}
      </a>
    );
  }
  return (
    <Link
      to={target.to}
      {...(target.hash === undefined ? {} : { hash: target.hash })}
      className={style}
    >
      {inner}
    </Link>
  );
}

const COLUMNS: { title: string; links: FootTarget[] }[] = [
  {
    title: "Search",
    links: [
      { to: "/search", label: "Open search" },
      { to: "/", hash: "numbers", label: "Real numbers" },
      { to: "/", hash: "faq", label: "Questions" },
    ],
  },
  {
    title: "Rights",
    links: [
      { to: "/about", label: "About and takedown" },
      { href: ISSUES, label: "Request a removal" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPO, label: "Source code" },
      { href: `${REPO}#self-hosting`, label: "Self hosting" },
      { href: `${REPO}/blob/main/LICENSE`, label: "MIT license" },
    ],
  },
];

const LINES = [0, 1, 2, 3, 4];
const DRAW = [1300, 1150, 1000, 850, 700];

export function Footer() {
  const [ref, seen] = useInView<HTMLElement>("0px 0px -20% 0px");
  const reduced = useReducedMotion();
  const show = seen || reduced;
  const rise = (delay: number) => ({
    initial: false as const,
    animate: show ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : 12 },
    transition: {
      duration: reduced ? 0.3 : 0.7,
      ease: EASE,
      delay: reduced ? 0 : delay,
    },
  });

  return (
    <footer
      ref={ref}
      data-theme="dark"
      className="relative overflow-hidden bg-night text-cream"
    >
      <div className="relative mx-auto max-w-[1440px]">
        <div
          className="dash-line-h pointer-events-none absolute inset-x-0 top-28 max-md:top-16"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-[4.5%] left-[4.5%] grid grid-cols-4 max-md:grid-cols-2"
          aria-hidden="true"
        >
          {LINES.map((i) => (
            <span
              key={i}
              className="dash-line-v absolute top-14 bottom-0 origin-top transition-transform ease-base max-md:top-8"
              style={{
                left: `${i * 25}%`,
                transform: show ? "scaleY(1)" : "scaleY(0)",
                transitionDuration: reduced ? "0ms" : `${DRAW[i]}ms`,
                transitionDelay: reduced ? "0ms" : `${i * 70}ms`,
              }}
            />
          ))}
        </div>

        <div className="relative grid grid-cols-4 px-[4.5%] pt-40 max-md:grid-cols-2 max-md:gap-y-12 max-md:pt-28">
          <motion.div
            className="flex flex-col items-center gap-4 text-center"
            {...rise(0.2)}
          >
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-sm text-cream"
              aria-label="Frame Search home"
            >
              <Mark className="size-9" />
              <Wordmark className="title-1 font-semibold" />
            </Link>
            <p className="caption-2 max-w-48 text-ash">
              Find a film shot by describing it
            </p>
            <p className="caption-2 text-ash">MIT licensed, 2026</p>
          </motion.div>
          {COLUMNS.map((column, i) => (
            <motion.div
              key={column.title}
              className="flex flex-col items-center gap-4 text-center"
              {...rise(0.3 + i * 0.08)}
            >
              <h2 className="title-2 text-cream">{column.title}</h2>
              <ul className="flex flex-col items-center gap-3">
                {column.links.map((target) => (
                  <li key={target.label}>
                    <FootLink target={target} />
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <motion.p
          className="caption-5 relative mx-auto mt-16 max-w-xl px-6 pb-24 text-center text-ash max-md:pb-16"
          {...rise(0.6)}
        >
          {LEGAL}{" "}
          <Link
            to="/about"
            className="underline decoration-ash/50 underline-offset-2 transition-colors duration-300 ease-base hover:text-cream"
          >
            About and takedown requests
          </Link>
        </motion.p>
      </div>
    </footer>
  );
}
