import type { OrchestrationV2ProviderTurnTokenUsage } from "@t3tools/contracts";

import type { TokenRates } from "../usage/usagePricing.ts";

export type PromptCacheMiss = NonNullable<OrchestrationV2ProviderTurnTokenUsage["cacheMiss"]>;

export interface PromptCacheSample {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly promptCacheExpiresAt: string | undefined;
  readonly promptCacheTtlMs: number | undefined;
  readonly updatedAt: string;
  readonly model: string | undefined;
}

const MIN_MISSED_TOKENS = 1024;
const DEFAULT_PROMPT_CACHE_TTL_MS = 5 * 60_000;

export function promptCacheSample(
  usage: OrchestrationV2ProviderTurnTokenUsage,
  model: string | undefined,
): PromptCacheSample | null {
  if (usage.inputTokens === undefined || usage.cachedInputTokens === undefined) return null;
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    promptCacheExpiresAt: usage.promptCacheExpiresAt,
    promptCacheTtlMs: usage.promptCacheTtlMs,
    updatedAt: usage.updatedAt,
    model,
  };
}

/** The prompt cache `prev` left that `cur` did not read back, without cost. */
export function promptCacheMiss(
  prev: PromptCacheSample,
  cur: PromptCacheSample,
): Omit<PromptCacheMiss, "costUsd"> | null {
  // A shorter prompt was compacted or rewound, so the old cache no longer applies.
  if (cur.inputTokens < prev.inputTokens) return null;
  // Every sample of one request reports the same cache counts.
  if (
    cur.cachedInputTokens === prev.cachedInputTokens &&
    cur.cacheWriteTokens === prev.cacheWriteTokens
  ) {
    return null;
  }
  const tokens = prev.cachedInputTokens + prev.cacheWriteTokens - cur.cachedInputTokens;
  if (tokens < MIN_MISSED_TOKENS) return null;
  const requestMs = Date.parse(cur.updatedAt);
  const previousMs = Date.parse(prev.updatedAt);
  const expiresMs =
    prev.promptCacheExpiresAt === undefined
      ? previousMs + (prev.promptCacheTtlMs ?? DEFAULT_PROMPT_CACHE_TTL_MS)
      : Date.parse(prev.promptCacheExpiresAt);
  const idleMs = requestMs - previousMs;
  const modelChanged =
    prev.model !== undefined && cur.model !== undefined && prev.model !== cur.model;
  return {
    tokens,
    idleMs: Number.isFinite(idleMs) ? Math.max(0, Math.round(idleMs)) : 0,
    modelChanged,
    expected: modelChanged || requestMs > expiresMs,
  };
}

/** The missed prefix is billed again: at most `cacheWriteTokens` at the write rate, the rest as uncached input. */
export function promptCacheMissCostUsd(
  tokens: number,
  cacheWriteTokens: number,
  rates: TokenRates,
): number {
  const written = Math.min(tokens, cacheWriteTokens);
  return (
    written * rates.cacheCreationCostPerToken +
    (tokens - written) * rates.inputCostPerToken -
    tokens * rates.cacheReadCostPerToken
  );
}

export function addPromptCacheMiss(
  turn: PromptCacheMiss | undefined,
  miss: PromptCacheMiss,
): PromptCacheMiss {
  if (turn === undefined) return miss;
  // One unpriced miss leaves the turn's total unknown, not cheaper.
  const costUsd =
    turn.costUsd === undefined || miss.costUsd === undefined
      ? undefined
      : turn.costUsd + miss.costUsd;
  return {
    tokens: turn.tokens + miss.tokens,
    ...(costUsd === undefined ? {} : { costUsd }),
    idleMs: turn.idleMs,
    modelChanged: turn.modelChanged,
    expected: turn.expected && miss.expected,
  };
}
