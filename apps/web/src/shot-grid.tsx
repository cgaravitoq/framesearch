import type { Hit } from "@framesearch/schema";
import { clock } from "./lib/time";

interface ShotGridProps {
  shots: Hit[];
  selectedId: number | null;
  onPick: (shot: Hit) => void;
}

export function ShotGrid({ shots, selectedId, onPick }: ShotGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-2.5">
      {shots.map((shot) => (
        <button
          key={shot.shotId}
          type="button"
          aria-pressed={shot.shotId === selectedId}
          onClick={() => onPick(shot)}
          className="rounded-lg border-2 border-transparent p-1 text-left hover:border-edge-soft aria-pressed:border-accent"
        >
          <img
            src={shot.frameUrl}
            alt={shot.caption ?? `${shot.title} at ${clock(shot.time)}`}
            loading="lazy"
            className="block aspect-[4/3] w-full rounded-md bg-field object-cover"
          />
          <span className="block pt-1.5 font-mono text-xs text-accent">
            {clock(shot.time)}
          </span>
          <span className="block pt-0.5 text-[11px] leading-tight text-muted">
            {shot.title}
          </span>
        </button>
      ))}
    </div>
  );
}
