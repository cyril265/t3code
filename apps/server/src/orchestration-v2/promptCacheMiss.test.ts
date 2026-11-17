import { expect, it } from "@effect/vitest";

import {
  promptCacheMiss,
  promptCacheMissCostUsd,
  type PromptCacheSample,
} from "./promptCacheMiss.ts";

const prev: PromptCacheSample = {
  inputTokens: 100_000,
  cachedInputTokens: 90_000,
  cacheWriteTokens: 10_000,
  promptCacheExpiresAt: "2026-11-14T10:05:00.000Z",
  promptCacheTtlMs: undefined,
  updatedAt: "2026-11-14T10:00:00.000Z",
  model: "claude-opus-4-5",
};
const next = (overrides: Partial<PromptCacheSample>): PromptCacheSample => ({
  ...prev,
  inputTokens: 102_000,
  updatedAt: "2026-11-14T10:02:00.000Z",
  ...overrides,
});

it.each<{
  readonly name: string;
  readonly prevOverrides?: Partial<PromptCacheSample>;
  readonly cur: PromptCacheSample;
  readonly miss: ReturnType<typeof promptCacheMiss>;
}>([
  {
    name: "a full cache read is a hit",
    cur: next({ cachedInputTokens: 100_000, cacheWriteTokens: 2_000 }),
    miss: null,
  },
  {
    name: "a miss under 1024 tokens is ignored",
    cur: next({ cachedInputTokens: 98_977, cacheWriteTokens: 3_023 }),
    miss: null,
  },
  {
    name: "a miss after the cache expired is expected",
    cur: next({
      cachedInputTokens: 0,
      cacheWriteTokens: 106_000,
      updatedAt: "2026-11-14T10:12:00.000Z",
    }),
    miss: { tokens: 100_000, idleMs: 12 * 60_000, modelChanged: false, expected: true },
  },
  {
    name: "a miss after a model switch is expected",
    cur: next({ cachedInputTokens: 0, cacheWriteTokens: 102_000, model: "claude-sonnet-4-5" }),
    miss: { tokens: 100_000, idleMs: 2 * 60_000, modelChanged: true, expected: true },
  },
  {
    name: "a miss within the cache lifetime on the same model is unexpected",
    cur: next({ cachedInputTokens: 40_000, cacheWriteTokens: 62_000 }),
    miss: { tokens: 60_000, idleMs: 2 * 60_000, modelChanged: false, expected: false },
  },
  {
    name: "without an expiry, a known one-hour cache lifetime keeps a 10-minute miss unexpected",
    prevOverrides: { promptCacheExpiresAt: undefined, promptCacheTtlMs: 60 * 60_000 },
    cur: next({
      cachedInputTokens: 40_000,
      cacheWriteTokens: 62_000,
      updatedAt: "2026-11-14T10:10:00.000Z",
    }),
    miss: { tokens: 60_000, idleMs: 10 * 60_000, modelChanged: false, expected: false },
  },
  {
    name: "a shrunk prompt has no baseline",
    cur: next({ inputTokens: 30_000, cachedInputTokens: 0, cacheWriteTokens: 30_000 }),
    miss: null,
  },
])("$name", ({ prevOverrides, cur, miss }) => {
  expect(promptCacheMiss({ ...prev, ...prevOverrides }, cur)).toEqual(miss);
});

it("prices re-written tokens at the write rate and the rest as uncached input, minus the read rate", () => {
  const rates = {
    inputCostPerToken: 5e-6,
    outputCostPerToken: 25e-6,
    cacheReadCostPerToken: 0.5e-6,
    cacheCreationCostPerToken: 6.25e-6,
    cacheCreation1hCostPerToken: 10e-6,
  };
  expect(promptCacheMissCostUsd(100_000, 106_000, rates)).toBeCloseTo(0.575);
  expect(promptCacheMissCostUsd(100_000, 0, rates)).toBeCloseTo(0.45);
  expect(promptCacheMissCostUsd(60_000, 1_000, rates)).toBeCloseTo(
    1_000 * 5.75e-6 + 59_000 * 4.5e-6,
  );
});
