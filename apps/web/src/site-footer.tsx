import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="pb-8 text-xs text-muted">
      Frames are copyrighted and belong to their owners, shown at reduced
      resolution for research, education and commentary.{" "}
      <Link to="/about" className="underline hover:text-body">
        About and takedown requests
      </Link>
    </footer>
  );
}
