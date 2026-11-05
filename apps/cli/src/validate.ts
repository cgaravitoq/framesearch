import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseFilmSlug, type Validated } from "@framesearch/core";

const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".mov", ".webm", ".m4v", ".avi"];

interface FilmTitle {
  title: string;
  slug: string;
}

export function parseVideoPath(raw: string): Validated<string> {
  const value = raw.trim();
  if (value === "") return { ok: false, error: "video path is empty" };
  const path = resolve(value);
  if (!existsSync(path)) return { ok: false, error: `no file at ${path}` };
  if (!statSync(path).isFile())
    return { ok: false, error: `${path} is not a file` };
  const extension = extname(path).toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      error: `${path} is not a video; expected one of ${VIDEO_EXTENSIONS.join(", ")}`,
    };
  }
  return { ok: true, value: path };
}

export function parseTitle(raw: string): Validated<FilmTitle> {
  const title = raw.trim();
  if (title === "") return { ok: false, error: "title is empty" };
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const parsed = parseFilmSlug(slug);
  if (!parsed.ok) {
    return {
      ok: false,
      error: `title ${JSON.stringify(title)} gives no film slug`,
    };
  }
  return { ok: true, value: { title, slug: parsed.value } };
}

export function parseFilmArg(raw: string): Validated<string> {
  return parseFilmSlug(raw.trim());
}

export function unwrap<T>(result: Validated<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export function parseBaseUrl(raw: string): Validated<string> {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: `${value} is not a url` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: `${value} is not an http or https url` };
  }
  return {
    ok: true,
    value: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
  };
}
