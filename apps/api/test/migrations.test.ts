import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DDL } from "@framesearch/schema";

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface Table {
  name: string;
  type: string;
  sql: string;
  columns: Column[];
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function fromMigrations(upTo?: number): Database {
  const db = new Database(":memory:");
  for (const name of migrationFiles().slice(0, upTo)) {
    db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  }
  return db;
}

function fromDdl(): Database {
  const db = new Database(":memory:");
  for (const statement of DDL) db.exec(statement);
  return db;
}

function shape(db: Database): Table[] {
  const tables = db
    .query<{ name: string; type: string; sql: string | null }, []>(
      "SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return tables.map((table) => ({
    columns: db
      .query<Column, []>(`PRAGMA table_info(${JSON.stringify(table.name)})`)
      .all(),
    name: table.name,
    sql: (table.sql ?? "")
      .replace(/\s+/g, " ")
      .replace(/\s*([,()])/g, "$1")
      .trim(),
    type: table.type,
  }));
}

function alreadyApplied(error: unknown): boolean {
  return String(error).includes("duplicate column name");
}

describe("migrations", () => {
  test("build the schema packages/schema declares", () => {
    const migrated = new Map(
      shape(fromMigrations()).map((table) => [table.name, table]),
    );
    for (const table of shape(fromDdl())) {
      expect({ name: table.name, table: migrated.get(table.name) }).toEqual({
        name: table.name,
        table,
      });
    }
  });

  test("apply twice without changing the schema", () => {
    const once = fromMigrations();
    const first = shape(once);
    for (const name of migrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS, name), "utf8");
      try {
        once.exec(sql);
      } catch (error) {
        if (!alreadyApplied(error)) throw error;
      }
    }
    expect(shape(once)).toEqual(first);
  });

  test("give every film published before the table a version", () => {
    const db = fromMigrations(
      migrationFiles().indexOf("0003_published_versions.sql"),
    );
    db.exec(
      "INSERT INTO films (slug, title, duration) VALUES ('night-of-the-living-dead', 'Night of the Living Dead', 5760)",
    );
    db.exec(
      readFileSync(join(MIGRATIONS, "0003_published_versions.sql"), "utf8"),
    );
    const rows = db
      .query<{ film: string; version: number }, []>(
        "SELECT film, version FROM published",
      )
      .all();
    expect(rows.map((row) => row.film)).toEqual(["night-of-the-living-dead"]);
    expect(rows[0]?.version).toBeGreaterThan(0);
  });

  test("leave a film published before the vectors key without one", () => {
    const db = fromMigrations(
      migrationFiles().indexOf("0004_published_vectors_key.sql"),
    );
    db.exec(
      "INSERT INTO films (slug, title, duration) VALUES ('night-of-the-living-dead', 'Night of the Living Dead', 5760)",
    );
    db.exec(
      "INSERT INTO published (film, version) VALUES ('night-of-the-living-dead', 3)",
    );
    db.exec(
      readFileSync(join(MIGRATIONS, "0004_published_vectors_key.sql"), "utf8"),
    );
    const row = db
      .query<
        { prior_vectors_key: string | null; vectors_key: string | null },
        []
      >(
        "SELECT vectors_key, prior_vectors_key FROM published WHERE film = 'night-of-the-living-dead'",
      )
      .get();
    expect(row).toEqual({ prior_vectors_key: null, vectors_key: null });
  });
});
