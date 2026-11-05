const CAPTION_MODEL = "google/gemma-4-26b-a4b-it";
export const CAPTION_PREFIX = "title: none | text: ";
const CAPTION_CONCURRENCY = 8;
export const MAX_COST_USD = 0.1;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 180_000;
const SHOT_SIZES = [
  "extreme close-up",
  "close-up",
  "medium",
  "wide",
  "extreme wide",
];
const TIMES_OF_DAY = ["day", "night", "unknown"];
const SETTINGS = ["interior", "exterior", "unknown"];

const PROMPT = `Describe this film frame for a search index. Reply with only a JSON object:
{"caption": one sentence describing who and what is in the frame and what is happening,
 "shot_size": "extreme close-up" | "close-up" | "medium" | "wide" | "extreme wide",
 "time_of_day": "day" | "night" | "unknown",
 "setting": "interior" | "exterior" | "unknown"}`;

interface Caption {
  caption: string;
  tags: string[];
}

interface CaptionOptions {
  apiKey: string;
  budgetUsd: number;
  concurrency?: number;
  ask?: (image: Uint8Array) => Promise<CaptionReply>;
}

interface CaptionReport {
  captions: (Caption | null)[];
  costUsd: number;
  failed: number;
}

interface CaptionReply {
  content: string;
  cost: number;
}

interface ChatBody {
  choices?: { message: { content: string } }[];
  usage?: { cost?: number };
}

function parseCaption(raw: string): Caption | null {
  const object = raw.match(/\{[\s\S]*\}/)?.[0];
  if (object === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(object);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const caption =
    typeof record.caption === "string" ? record.caption.trim() : "";
  const shotSize = text(record.shot_size);
  if (caption === "" || !SHOT_SIZES.includes(shotSize)) return null;
  return {
    caption,
    tags: [
      shotSize,
      pick(record.time_of_day, TIMES_OF_DAY),
      pick(record.setting, SETTINGS),
    ],
  };
}

export async function captionImages(
  images: readonly Uint8Array[],
  options: CaptionOptions,
): Promise<CaptionReport> {
  const captions: (Caption | null)[] = images.map(() => null);
  const concurrency = Math.max(1, options.concurrency ?? CAPTION_CONCURRENCY);
  const ask =
    options.ask ?? ((image: Uint8Array) => request(options.apiKey, image));
  let spent = 0;
  let highest = 0;
  let answered = 0;
  let inflight = 0;
  let failed = 0;
  let next = 0;
  let waiting: (() => void)[] = [];

  const wake = (): void => {
    const parked = waiting;
    waiting = [];
    for (const resume of parked) resume();
  };

  const mayAsk = (): boolean => {
    if (spent >= options.budgetUsd) return false;
    if (answered === 0) return inflight === 0;
    return spent + (inflight + 1) * highest <= options.budgetUsd;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (next >= images.length || spent >= options.budgetUsd) return;
      if (!mayAsk()) {
        if (inflight === 0) return;
        await new Promise<void>((resolve) => waiting.push(resolve));
        continue;
      }
      const image = images[next];
      if (image === undefined) return;
      const index = next;
      next += 1;
      inflight += 1;
      let caption: Caption | null = null;
      try {
        for (let attempt = 0; attempt < 2 && caption === null; attempt += 1) {
          if (attempt > 0 && spent + inflight * highest > options.budgetUsd) {
            break;
          }
          const reply = await ask(image);
          spent += reply.cost;
          highest = Math.max(highest, reply.cost);
          answered += 1;
          caption = parseCaption(reply.content);
        }
      } finally {
        inflight -= 1;
        wake();
      }
      if (caption === null) {
        failed += 1;
        continue;
      }
      captions[index] = caption;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, images.length) }, worker),
  );
  return { captions, costUsd: spent, failed };
}

async function request(
  apiKey: string,
  image: Uint8Array,
): Promise<CaptionReply> {
  const base64 = Buffer.from(image).toString("base64");
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CAPTION_MODEL,
      temperature: 0,
      usage: { include: true },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64}` },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `openrouter answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const body = (await response.json()) as ChatBody;
  return {
    content: body.choices?.[0]?.message.content ?? "",
    cost: body.usage?.cost ?? 0,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function pick(value: unknown, allowed: readonly string[]): string {
  const candidate = text(value);
  return allowed.includes(candidate) ? candidate : "unknown";
}
