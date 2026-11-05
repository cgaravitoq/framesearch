import { describe, expect, test } from "bun:test";
import { fakeDb } from "./support.ts";

describe("fakeDb", () => {
  test("records a read that binds no parameters", async () => {
    const { db, queries } = fakeDb({ rows: [{ id: 1 }] });
    await db.prepare("SELECT id FROM shots").all();
    expect(queries).toEqual([{ args: [], sql: "SELECT id FROM shots" }]);
  });

  test("records only the statements that run", async () => {
    const { db, queries } = fakeDb();
    db.prepare("SELECT id FROM shots");
    expect(queries).toEqual([]);
  });

  test("records a bound statement once, with its arguments", async () => {
    const { db, queries } = fakeDb();
    await db
      .prepare("SELECT id FROM shots WHERE film = ?1")
      .bind("night")
      .all();
    expect(queries).toEqual([
      { args: ["night"], sql: "SELECT id FROM shots WHERE film = ?1" },
    ]);
  });
});
