import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DDL, type Film, type Shot } from "@framesearch/schema";
import { dbFile } from "./paths.ts";

export interface StoredShot extends Shot {
  id: number;
}

export interface NewShot {
  time: number;
  shotStart: number;
  shotEnd: number;
  caption: string | null;
  tags: string[];
}

interface ShotRow {
  id: number;
  film: string;
  idx: number;
  time: number;
  shot_start: number;
  shot_end: number;
  caption: string | null;
  tags: string;
}

export function createStore(dir: string): Database {
  const file = dbFile(dir);
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  for (const statement of DDL) db.exec(statement);
  return db;
}

export function openStore(dir: string): Database {
  const file = dbFile(dir);
  if (!existsSync(file)) {
    throw new Error(`no local store at ${file}; index a film first`);
  }
  return new Database(file, { readonly: true });
}

export function readFilm(db: Database, film: string): Film | null {
  return db
    .query<Film, [string]>(
      "SELECT slug, title, duration FROM films WHERE slug = ?1",
    )
    .get(film);
}

export function readShots(db: Database, film: string): StoredShot[] {
  return db
    .query<ShotRow, [string]>(
      "SELECT id, film, idx, time, shot_start, shot_end, caption, tags FROM shots WHERE film = ?1 ORDER BY idx",
    )
    .all(film)
    .map(toShot);
}

export function replaceFilm(
  db: Database,
  film: Film,
  shots: readonly NewShot[],
): StoredShot[] {
  const write = db.transaction((): StoredShot[] => {
    db.run("DELETE FROM shots WHERE film = ?1", [film.slug]);
    db.run(
      "INSERT INTO films (slug, title, duration) VALUES (?1, ?2, ?3) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, duration = excluded.duration",
      [film.slug, film.title, film.duration],
    );
    const highest =
      db
        .query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM shots")
        .get()?.id ?? 0;
    const insert = db.query(
      "INSERT INTO shots (id, film, idx, time, shot_start, shot_end, caption, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    );
    return shots.map((shot, idx) => {
      const id = highest + idx + 1;
      insert.run(
        id,
        film.slug,
        idx,
        shot.time,
        shot.shotStart,
        shot.shotEnd,
        shot.caption,
        JSON.stringify(shot.tags),
      );
      return {
        id,
        film: film.slug,
        idx,
        time: shot.time,
        shotStart: shot.shotStart,
        shotEnd: shot.shotEnd,
        caption: shot.caption,
        tags: shot.tags,
      };
    });
  });
  return write();
}

function toShot(row: ShotRow): StoredShot {
  return {
    id: row.id,
    film: row.film,
    idx: row.idx,
    time: row.time,
    shotStart: row.shot_start,
    shotEnd: row.shot_end,
    caption: row.caption,
    tags: parseTags(row.tags),
  };
}

function parseTags(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((tag): tag is string => typeof tag === "string");
}
