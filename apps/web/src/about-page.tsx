import { Link } from "@tanstack/react-router";

const ISSUES_URL = "https://github.com/cgaravitoq/framesearch/issues";

export function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pt-7 pb-10 text-[15px] leading-relaxed text-body sm:px-6">
      <Link
        to="/"
        className="font-mono text-[15px] font-medium text-accent no-underline"
      >
        framesearch
      </Link>
      <h1 className="m-0 text-lg font-semibold text-ink">About</h1>
      <p className="m-0">
        framesearch is an experimental prototype: describe a shot in plain words
        and it finds the matching frames, each with its film and timecode.
      </p>
      <h2 className="m-0 text-base font-semibold text-ink">
        The frames and their rights
      </h2>
      <p className="m-0">
        The frames shown here come from copyrighted films, and every right in
        them stays with the people and companies who own them. This project
        claims no ownership of them and grants no licence to use them.
      </p>
      <p className="m-0">
        Each frame is a still at reduced resolution, shown for research,
        education and commentary within an experimental project. We believe this
        is fair use, but fair use is a defence judged case by case, not a
        guarantee.
      </p>
      <h2 className="m-0 text-base font-semibold text-ink">Removal requests</h2>
      <p className="m-0">
        If you hold rights in a film shown here and want its frames removed,
        open an issue at{" "}
        <a href={ISSUES_URL} className="text-accent underline">
          {ISSUES_URL}
        </a>{" "}
        naming the film, and we will take them down.
      </p>
    </main>
  );
}
