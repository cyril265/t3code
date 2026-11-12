import {
  MessageId,
  NodeId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Run,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  type OrchestrationV2ProviderTurn,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  activeTokenRateTurn,
  formatLiveTurnTokenUsage,
  formatTurnTokenRate,
} from "./turnTokenRate.ts";

const turn = {
  status: "completed",
  startedAt: DateTime.makeUnsafe("2026-11-12T12:00:00.000Z"),
  completedAt: DateTime.makeUnsafe("2026-11-12T12:00:02.500Z"),
  turnTokenUsage: {
    usageScope: "main_agent",
    usageStatus: "complete",
    inputTokens: 10_000,
    outputTokens: 100,
    reasoningTokens: 60,
    hasSubagents: true,
    otherUsage: { inputTokens: 20_000, outputTokens: 5_000 },
  },
} satisfies Pick<
  OrchestrationV2ProviderTurn,
  "status" | "startedAt" | "completedAt" | "turnTokenUsage"
>;

describe("formatTurnTokenRate", () => {
  it("uses only the main agent's output, with reasoning counted once, over the full provider turn", () => {
    expect(formatTurnTokenRate(turn)).toBe("40.0 tok/s avg");
    expect(
      formatTurnTokenRate({
        ...turn,
        completedAt: DateTime.makeUnsafe("2026-11-12T12:00:03.000Z"),
      }),
    ).toBe("33.3 tok/s avg");
  });

  it.each(["pending", "running", "interrupted", "failed", "cancelled"] as const)(
    "hides the rate for a %s turn even if usage is present",
    (status) => {
      expect(formatTurnTokenRate({ ...turn, status })).toBeNull();
    },
  );

  it("hides missing, incomplete, and local-command usage instead of using context counters", () => {
    expect(formatTurnTokenRate(null)).toBeNull();
    const { turnTokenUsage: _usage, ...withoutUsage } = turn;
    const contextOnly = { ...withoutUsage, tokenUsage: { usedTokens: 10_000, outputTokens: 500 } };
    expect(formatTurnTokenRate(contextOnly)).toBeNull();
    for (const usageStatus of ["partial", "unavailable"] as const) {
      expect(
        formatTurnTokenRate({
          ...turn,
          turnTokenUsage: { ...turn.turnTokenUsage, usageStatus },
        }),
      ).toBeNull();
    }
    expect(
      formatTurnTokenRate({
        ...turn,
        turnTokenUsage: { ...turn.turnTokenUsage, localCommand: true },
      }),
    ).toBeNull();
    expect(
      formatTurnTokenRate({
        ...turn,
        turnTokenUsage: { ...turn.turnTokenUsage, outputTokens: 0 },
      }),
    ).toBeNull();
  });

  it("requires both timestamps and a positive duration", () => {
    expect(formatTurnTokenRate({ ...turn, startedAt: null })).toBeNull();
    expect(formatTurnTokenRate({ ...turn, completedAt: null })).toBeNull();
    expect(formatTurnTokenRate({ ...turn, completedAt: turn.startedAt })).toBeNull();
    expect(
      formatTurnTokenRate({
        ...turn,
        completedAt: DateTime.makeUnsafe("2026-11-12T11:59:59.000Z"),
      }),
    ).toBeNull();
  });
});

describe("live turn token usage", () => {
  const running = {
    ...turn,
    status: "running" as const,
    completedAt: null,
    turnTokenUsage: { ...turn.turnTokenUsage, usageStatus: "partial" as const, elapsedMs: 1_000 },
  };

  it("uses the server sample duration across updates and remote clocks", () => {
    expect(formatLiveTurnTokenUsage(running)).toBe("100 output tokens · 100.0 tok/s avg");
    const next = {
      ...running,
      turnTokenUsage: { ...running.turnTokenUsage, outputTokens: 150, elapsedMs: 2_000 },
    };
    expect(formatLiveTurnTokenUsage(next)).toBe("150 output tokens · 75.0 tok/s avg");
    expect(
      formatLiveTurnTokenUsage({ ...next, startedAt: DateTime.makeUnsafe("2030-01-01T00:00:00Z") }),
    ).toBe("150 output tokens · 75.0 tok/s avg");
    expect(
      formatLiveTurnTokenUsage({
        ...next,
        turnTokenUsage: { ...next.turnTokenUsage, elapsedMs: 5_000 },
      }),
    ).toBe("150 output tokens · 30.0 tok/s avg");
    expect(formatLiveTurnTokenUsage(turn)).toBeNull();
  });

  it("shows known counts without inventing a rate when timing is unavailable", () => {
    const { elapsedMs: _elapsed, ...withoutTiming } = running.turnTokenUsage;
    expect(formatLiveTurnTokenUsage({ ...running, turnTokenUsage: withoutTiming })).toBe(
      "100 output tokens",
    );
    expect(
      formatLiveTurnTokenUsage({ ...running, turnTokenUsage: { ...withoutTiming, elapsedMs: 0 } }),
    ).toBe("100 output tokens");
    expect(
      formatLiveTurnTokenUsage({
        ...running,
        turnTokenUsage: { ...withoutTiming, outputTokens: 0 },
      }),
    ).toBe("0 output tokens");
    expect(
      formatLiveTurnTokenUsage({
        ...running,
        turnTokenUsage: { ...running.turnTokenUsage, outputTokens: 1 },
      }),
    ).toBe("1 output token · 1.0 tok/s avg");
    expect(formatLiveTurnTokenUsage(null)).toBeNull();
    expect(
      formatLiveTurnTokenUsage({
        ...running,
        turnTokenUsage: { usageScope: "main_agent", usageStatus: "partial", hasSubagents: false },
      }),
    ).toBeNull();
    expect(
      formatLiveTurnTokenUsage({
        ...running,
        turnTokenUsage: { ...withoutTiming, usageStatus: "unavailable" },
      }),
    ).toBeNull();
    expect(
      formatLiveTurnTokenUsage({
        ...running,
        turnTokenUsage: { ...withoutTiming, localCommand: true },
      }),
    ).toBeNull();
  });

  it("returns only a running provider turn on the active attempt", () => {
    const attemptId = RunAttemptId.make("active-attempt");
    const active: OrchestrationV2Run = {
      id: RunId.make("active"),
      threadId: ThreadId.make("thread"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      providerThreadId: null,
      userMessageId: MessageId.make("message"),
      rootNodeId: null,
      activeAttemptId: attemptId,
      status: "running",
      ordinal: 1,
      requestedAt: turn.startedAt,
      startedAt: turn.startedAt,
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    };
    const providerTurn: OrchestrationV2ProviderTurn = {
      ...running,
      id: ProviderTurnId.make("live-turn"),
      providerThreadId: ProviderThreadId.make("thread"),
      nodeId: NodeId.make("root"),
      runAttemptId: attemptId,
      nativeTurnRef: null,
      ordinal: 1,
    };
    const projection = { runs: [active], providerTurns: [providerTurn] };
    expect(activeTokenRateTurn(projection)).toBe(providerTurn);
    expect(activeTokenRateTurn({ ...projection, runs: [] })).toBeNull();
    expect(
      activeTokenRateTurn({
        ...projection,
        providerTurns: [{ ...providerTurn, status: "completed" }],
      }),
    ).toBeNull();
  });
});
