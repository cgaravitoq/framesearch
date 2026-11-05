import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Step {
  name?: string;
  run?: string;
}

interface Workflow {
  jobs: { deploy: { steps: Step[] } };
}

function warmStep(): string {
  const workflow = Bun.YAML.parse(
    readFileSync(
      join(import.meta.dir, "../../../.github/workflows/deploy.yml"),
      "utf8",
    ),
  ) as Workflow;
  const step = workflow.jobs.deploy.steps.find(
    (candidate) => candidate.name === "Warm the embedder",
  );
  if (step?.run === undefined) throw new Error("no warm step in deploy.yml");
  return step.run;
}

describe("deploy workflow", () => {
  test(
    "waits for the embedder to answer before the eval starts",
    async () => {
      let prewarms = 0;
      const server = Bun.serve({
        fetch(request) {
          if (new URL(request.url).pathname !== "/api/prewarm") {
            return new Response("not found", { status: 404 });
          }
          prewarms += 1;
          return prewarms === 1
            ? Response.json({ error: "server error" }, { status: 500 })
            : Response.json({ warm: true });
        },
        port: 0,
      });
      try {
        const warm = Bun.spawn(["bash", "-c", warmStep()], {
          env: { ...process.env, BASE_URL: server.url.origin },
          stderr: "ignore",
          stdout: "ignore",
        });
        expect(await warm.exited).toBe(0);
        expect(prewarms).toBe(2);
      } finally {
        server.stop(true);
      }
    },
    { timeout: 20_000 },
  );
});
