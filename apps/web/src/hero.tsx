import type { Hit } from "@framesearch/schema";
import { clock } from "./lib/time";

interface HeroProps {
  shot: Hit;
  similarPending: boolean;
  onSimilar: () => void;
}

export function Hero({ shot, similarPending, onSimilar }: HeroProps) {
  return (
    <section className="flex flex-wrap items-stretch gap-6">
      <img
        src={shot.frameUrl}
        alt={shot.caption ?? `${shot.title} at ${clock(shot.time)}`}
        className="aspect-[4/3] max-h-[520px] w-full min-w-0 flex-[999_1_560px] rounded-xl bg-field object-cover"
      />
      <div className="flex min-w-0 flex-[1_1_280px] flex-col justify-end gap-3.5 pb-2">
        <span className="font-mono text-[28px] leading-tight text-accent">
          {clock(shot.time)}
        </span>
        <span className="text-lg font-semibold">{shot.title}</span>
        <p className="m-0 text-[15px] leading-relaxed text-body">
          {shot.caption ?? "This shot has no description yet."}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {shot.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-edge-soft px-2.5 py-1 text-xs text-body"
            >
              {tag}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onSimilar}
          disabled={similarPending}
          className="h-11 self-start rounded-full bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-bright disabled:opacity-60"
        >
          Find similar shots
        </button>
      </div>
    </section>
  );
}
