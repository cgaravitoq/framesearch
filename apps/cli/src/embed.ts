const EMBED_BATCH_SIZE = 8;
const DEFAULT_EMBED_URL = "http://localhost:8104";

type EmbedItem = { text: string } | { image: Uint8Array };

interface EmbedPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface EmbedReply {
  data: { index: number; embedding: number[] }[];
}

function embedUrl(): string {
  return process.env.EMBED_URL ?? DEFAULT_EMBED_URL;
}

function input(item: EmbedItem): string | { content: EmbedPart[] } {
  if ("text" in item) return item.text;
  const base64 = Buffer.from(item.image).toString("base64");
  return {
    content: [
      {
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${base64}` },
      },
    ],
  };
}

export async function embed(
  items: readonly EmbedItem[],
): Promise<Float32Array[]> {
  if (items.length === 0) return [];
  const endpoint = `${embedUrl().replace(/\/+$/, "")}/v1/embeddings`;
  const vectors: Float32Array[] = [];
  for (let start = 0; start < items.length; start += EMBED_BATCH_SIZE) {
    const batch = items.slice(start, start + EMBED_BATCH_SIZE);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: batch.map(input) }),
      });
    } catch (cause) {
      throw new Error(
        `cannot reach the embedding server at ${endpoint}; does EMBED_URL point at a running llama.cpp server?`,
        { cause },
      );
    }
    if (!response.ok) {
      throw new Error(
        `embedding server answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    const reply = (await response.json()) as EmbedReply;
    if (reply.data.length !== batch.length) {
      throw new Error(
        `embedding server returned ${reply.data.length} vectors for ${batch.length} inputs`,
      );
    }
    for (const { index, embedding } of reply.data) {
      if (vectors.length > 0) {
        const dim = vectors[0]?.length ?? 0;
        if (embedding.length !== dim) {
          throw new Error(
            `embedding server returned ${embedding.length} dimensions, expected ${dim}`,
          );
        }
      }
      vectors[start + index] = Float32Array.from(embedding);
    }
  }
  return vectors;
}
