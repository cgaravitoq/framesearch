import { LegalFooter, Logo, TwoTone } from "./chrome";
import { HeroSearch } from "./search-pill";

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6">
      <main className="flex min-h-[80svh] flex-col items-center justify-center gap-6 text-center">
        <Logo />
        <h1>
          <TwoTone
            grey="This page is not in any film."
            black="Describe the shot instead."
          />
        </h1>
        <div className="mt-6 w-full">
          <HeroSearch id="missing-search" />
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
