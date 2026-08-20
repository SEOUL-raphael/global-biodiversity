import { logger } from "./logger";

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIM = 384;

let pipelinePromise: Promise<(text: string, opts?: unknown) => Promise<{ data: Float32Array }>> | null = null;

async function getEncoder() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const tx = (await import("@xenova/transformers")) as typeof import("@xenova/transformers");
      tx.env.allowLocalModels = false;
      tx.env.allowRemoteModels = true;
      logger.info({ model: EMBED_MODEL }, "[embed] loading encoder (first call may download ~25MB)");
      const pipe = await tx.pipeline("feature-extraction", EMBED_MODEL, {
        quantized: true,
      });
      logger.info({ model: EMBED_MODEL }, "[embed] encoder ready");
      return pipe as unknown as (text: string, opts?: unknown) => Promise<{ data: Float32Array }>;
    })().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

export async function embed(text: string): Promise<number[]> {
  const enc = await getEncoder();
  const out = await enc(text.slice(0, 2000), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function ensureEncoderReady(): Promise<boolean> {
  try {
    await getEncoder();
    return true;
  } catch (err) {
    logger.warn({ err }, "[embed] encoder unavailable");
    return false;
  }
}
