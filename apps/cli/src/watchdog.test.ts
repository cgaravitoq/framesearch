import { expect, test } from "bun:test";
import { alwaysOn, watchedHours } from "./watchdog.ts";

const hours = watchedHours(new Date("2026-11-07T09:17:00Z"), 3);

test("watches the complete hours before now", () => {
  expect(hours).toEqual([
    "2026-11-07T06:00:00Z",
    "2026-11-07T07:00:00Z",
    "2026-11-07T08:00:00Z",
  ]);
});

test("flags only an instance seen in every watched hour", () => {
  const sightings = [
    ...hours.map((hour) => ({ hour, application: "app", instance: "stuck" })),
    { hour: "2026-11-07T06:00:00Z", application: "app", instance: "brief" },
    { hour: "2026-11-07T08:00:00Z", application: "app", instance: "brief" },
    { hour: "2026-11-07T05:00:00Z", application: "app", instance: "old" },
  ];
  expect(alwaysOn(sightings, hours)).toEqual([
    { application: "app", instance: "stuck" },
  ]);
});
