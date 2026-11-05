import { DDL, type Film, vectorsKey } from "@framesearch/schema";
import type { StoredShot } from "./store.ts";

export function publishSql(film: Film, shots: readonly StoredShot[]): string {
  const statements = [...DDL];
  statements.push(...removeStatements(film.slug));
  statements.push(
    `INSERT INTO films (slug, title, duration) VALUES (${text(film.slug)}, ${text(film.title)}, ${number(film.duration)})`,
  );
  for (const shot of shots) {
    statements.push(
      `INSERT INTO shots (id, film, idx, time, shot_start, shot_end, caption, tags) VALUES (${shot.id}, ${text(film.slug)}, ${shot.idx}, ${number(shot.time)}, ${number(shot.shotStart)}, ${number(shot.shotEnd)}, ${shot.caption === null ? "NULL" : text(shot.caption)}, ${text(JSON.stringify(shot.tags))})`,
    );
  }
  for (const shot of shots) {
    const body = ftsText(shot);
    if (body === "") continue;
    statements.push(
      `INSERT INTO shots_fts (rowid, caption) VALUES (${shot.id}, ${text(body)})`,
    );
  }
  return render(statements);
}

export function unpublishSql(film: string): string {
  return render([...DDL, publishedDelete(film), ...removeStatements(film)]);
}

export function publishedVersionSql(
  film: string,
  at: number,
  key: string,
): string {
  const version = `MAX(${number(at)}, COALESCE((SELECT MAX(version) FROM published), 0) + 1)`;
  return `INSERT INTO published (film, version, vectors_key, prior_vectors_key) VALUES (${text(film)}, ${version}, ${text(key)}, NULL) ON CONFLICT (film) DO UPDATE SET version = excluded.version, vectors_key = excluded.vectors_key, prior_vectors_key = COALESCE(published.vectors_key, ${text(vectorsKey(film))})`;
}

export function publishedVectorsSql(film: string): string {
  return `SELECT vectors_key AS current, prior_vectors_key AS prior FROM published WHERE film = ${text(film)}`;
}

export function publishedFramesSql(film: string): string {
  return `SELECT idx FROM shots WHERE film = ${text(film)} ORDER BY idx`;
}

export function ftsText(shot: StoredShot): string {
  const parts = shot.caption === null ? [] : [shot.caption];
  parts.push(...shot.tags);
  return parts.join(" ").trim();
}

function publishedDelete(film: string): string {
  return `DELETE FROM published WHERE film = ${text(film)}`;
}

function removeStatements(film: string): string[] {
  const slug = text(film);
  return [
    `DELETE FROM shots_fts WHERE rowid IN (SELECT id FROM shots WHERE film = ${slug})`,
    `DELETE FROM shots WHERE film = ${slug}`,
    `DELETE FROM films WHERE slug = ${slug}`,
  ];
}

function render(statements: readonly string[]): string {
  return `${statements.join(";\n")};\n`;
}

function text(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`cannot write ${value} to D1`);
  return String(value);
}
