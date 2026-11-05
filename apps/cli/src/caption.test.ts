import { describe, expect, test } from "bun:test";
import { captionImages } from "./caption.ts";

const CAPTIONED = JSON.stringify({
  caption: "a man in a doorway",
  shot_size: "medium",
  time_of_day: "night",
  setting: "interior",
});

function images(count: number): Uint8Array[] {
  return Array.from({ length: count }, () => new Uint8Array(1));
}

describe("captionImages", () => {
  test("stops asking once the budget is spent though requests run in parallel", async () => {
    let asked = 0;
    const report = await captionImages(images(20), {
      apiKey: "",
      budgetUsd: 0.01,
      concurrency: 8,
      ask: async () => {
        asked += 1;
        return { content: CAPTIONED, cost: 0.004 };
      },
    });
    expect(asked).toBe(2);
    expect(report.costUsd).toBeCloseTo(0.008, 6);
    expect(report.captions.filter((caption) => caption !== null)).toHaveLength(
      2,
    );
    expect(report.failed).toBe(0);
  });

  test("holds the budget when parallel requests retry an unreadable reply", async () => {
    const report = await captionImages(images(40), {
      apiKey: "",
      budgetUsd: 0.1,
      concurrency: 8,
      ask: async () => {
        await Bun.sleep(1);
        return { content: "not json", cost: 0.01 };
      },
    });
    expect(report.costUsd).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  test("keeps its concurrency when the replies carry no cost", async () => {
    let running = 0;
    let peak = 0;
    await captionImages(images(16), {
      apiKey: "",
      budgetUsd: 0.01,
      concurrency: 8,
      ask: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await Bun.sleep(1);
        running -= 1;
        return { content: CAPTIONED, cost: 0 };
      },
    });
    expect(peak).toBe(8);
  });
});
