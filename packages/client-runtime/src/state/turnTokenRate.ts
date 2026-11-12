import {
  latestProviderTurnForAttempt,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { resolveActiveThreadRun } from "./threadWorkflows.ts";

type TokenRateTurn = Pick<
  OrchestrationV2ProviderTurn,
  "status" | "startedAt" | "completedAt" | "turnTokenUsage"
>;

export function activeTokenRateTurn(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "providerTurns">,
): OrchestrationV2ProviderTurn | null {
  const activeRun = resolveActiveThreadRun(projection);
  const turn = latestProviderTurnForAttempt(projection.providerTurns, activeRun?.activeAttemptId);
  return turn?.status === "running" ? turn : null;
}

function formatRate(outputTokens: number, elapsedMs: number | undefined): string | null {
  return outputTokens > 0 && elapsedMs !== undefined && elapsedMs > 0
    ? `${((outputTokens / elapsedMs) * 1000).toFixed(1)} tok/s avg`
    : null;
}

export function formatTurnTokenRate(turn: TokenRateTurn | null): string | null {
  const usage = turn?.turnTokenUsage;
  if (
    turn?.status !== "completed" ||
    usage?.usageStatus !== "complete" ||
    usage.localCommand ||
    turn.startedAt === null ||
    turn.completedAt === null
  ) {
    return null;
  }

  return formatRate(
    usage.outputTokens,
    DateTime.toEpochMillis(turn.completedAt) - DateTime.toEpochMillis(turn.startedAt),
  );
}

export function formatLiveTurnTokenUsage(turn: TokenRateTurn | null): string | null {
  const usage = turn?.turnTokenUsage;
  const outputTokens = usage?.outputTokens;
  if (
    turn?.status !== "running" ||
    usage?.usageStatus === "unavailable" ||
    usage?.localCommand === true ||
    outputTokens === undefined
  )
    return null;
  const rate = formatRate(outputTokens, usage?.elapsedMs);
  return `${outputTokens.toLocaleString("en-US")} output ${outputTokens === 1 ? "token" : "tokens"}${rate === null ? "" : ` · ${rate}`}`;
}
