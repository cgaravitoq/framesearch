import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const FIRST_QUERY = "a farmhouse at night";

export function SearchPill({
  id,
  value,
  onChange,
  onSubmit,
  autoFocus = false,
  wide = false,
  placeholder = "Describe a shot you remember",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  autoFocus?: boolean;
  wide?: boolean;
  placeholder?: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const element = input.current;
    if (!autoFocus || element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [autoFocus]);
  return (
    <search
      className={`relative mx-auto block w-full ${wide ? "max-w-2xl" : "max-w-sm"}`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <label htmlFor={id} className="sr-only">
          Describe a shot
        </label>
        <div
          className={`search-pill flex items-center gap-3 rounded-full bg-ink pr-2 pl-4 text-paper ${wide ? "h-12" : "h-11"}`}
        >
          <Search
            className="size-4 shrink-0 opacity-60"
            strokeWidth={2.2}
            aria-hidden="true"
          />
          <input
            ref={input}
            id={id}
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="body-5 min-w-0 flex-1 appearance-none text-ellipsis bg-transparent text-paper placeholder:text-paper/60 [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="submit"
            className="button-sm shrink-0 rounded-full px-3 py-1 text-paper/70 hover:text-paper"
          >
            Search
          </button>
        </div>
      </form>
    </search>
  );
}

export function HeroSearch({ id = "hero-search" }: { id?: string }) {
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  const go = (q: string) => void navigate({ to: "/search", search: { q } });
  return (
    <SearchPill
      id={id}
      value={value}
      onChange={(next) => {
        setValue(next);
        if (next.trim() !== "") go(next);
      }}
      onSubmit={(next) => go(next.trim() || FIRST_QUERY)}
    />
  );
}
