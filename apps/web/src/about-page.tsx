import { ISSUES, LegalFooter, Logo, TwoTone } from "./chrome";

export function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 max-md:px-4">
      <main className="body-3 flex flex-col gap-5 pt-8 pb-10 text-body">
        <Logo className="self-start text-ink" />
        <h1 className="mt-10">
          <TwoTone grey="About" black="Frame Search" className="heading-3" />
        </h1>
        <p>
          framesearch is an experimental prototype: describe a shot in plain
          words and it finds the matching frames, each with its film and
          timecode.
        </p>
        <h2 className="title-2 mt-4 text-ink">The frames and their rights</h2>
        <p>
          The frames shown here come from copyrighted films, and every right in
          them stays with the people and companies who own them. This project
          claims no ownership of them and grants no licence to use them.
        </p>
        <p>
          Each frame is a still at reduced resolution, shown for research,
          education and commentary within an experimental project. We believe
          this is fair use, but fair use is a defence judged case by case, not a
          guarantee.
        </p>
        <h2 className="title-2 mt-4 text-ink">Removal requests</h2>
        <p>
          If you hold rights in a film shown here and want its frames removed,
          open an issue at{" "}
          <a
            href={ISSUES}
            className="text-ink underline underline-offset-4 hover:text-accent"
          >
            {ISSUES}
          </a>{" "}
          naming the film, and we will take them down.
        </p>
      </main>
      <LegalFooter />
    </div>
  );
}
