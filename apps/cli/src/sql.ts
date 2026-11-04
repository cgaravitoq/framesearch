import { DDL, type Film } from "@framesearch/schema";
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
  return render([...DDL, ...removeStatements(film)]);
}

export function publishedFramesSql(film: string): string {
  return `SELECT idx FROM shots WHERE film = ${text(film)} ORDER BY idx`;
}

export function ftsText(shot: StoredShot): string {
  const parts = shot.caption === null ? [] : [shot.caption];
  parts.push(...shot.tags);
  return parts.join(" ").trim();
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
