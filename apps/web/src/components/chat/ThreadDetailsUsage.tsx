import type {
  OrchestrationV2ProviderTurnTokenUsage,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectProviderUsageLimits,
  customEndpointLimitPool,
  formatDuration,
  type LimitAccount,
  type LimitPace,
  type LimitPoolWindow,
  limitsNotice,
  paceOf,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import type { ReactNode } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: "Ahead of pace",
  on: "On pace",
  under: "Under pace",
};

export interface ThreadDetailsUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
  /** When the thread's last provider turn ended; null while it works. */
  readonly idleSince: number | null;
  readonly working: boolean;
  /** The last provider turn's usage: its prompt cache expiry and the cache it re-billed. */
  readonly latestTokenUsage: OrchestrationV2ProviderTurnTokenUsage | null;
}

type UsageTone = "error" | "warning" | null;

const limitTone = (left: number): UsageTone =>
  left <= 10 ? "error" : left <= 20 ? "warning" : null;

/** The selected provider's limit windows. Each row reads as room left. */
export function ThreadDetailsUsage({
  providerInstanceId,
  providers,
  sources,
}: Pick<ThreadDetailsUsageInput, "providerInstanceId" | "providers" | "sources">) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const report =
    providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, sources, now)
      : null;
  // Only this instance's data: the report keeps one instance per login, and any other entry may be
  // a different login or workspace, so fall back to the instance's own snapshot.
  const limits =
    report?.accounts.find((entry) => entry.instanceId === providerInstanceId)?.limits ??
    providers.find((provider) => provider.instanceId === providerInstanceId)?.usageLimits;
  if (!limits) return null;
  const notice = limitsNotice(limits);
  const pool =
    notice && providerInstanceId !== null
      ? customEndpointLimitPool(providerInstanceId, providers, sources, now)
      : null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage limits"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {pool?.servedBy ? (
          <>
            <ServedByRow {...pool.servedBy} now={now} />
            {pool.servedBy.account.limits.windows.map((window) => (
              <LimitRow key={window.id} window={window} now={now} />
            ))}
          </>
        ) : pool ? (
          pool.windows.map((window) => <PoolRow key={window.id} window={window} now={now} />)
        ) : notice ? (
          <UsageRow
            label="Limits"
            fill={null}
            tone={null}
            value="Unavailable"
            tooltip={<span className="text-foreground">{notice}</span>}
          />
        ) : (
          limits.windows.map((window) => <LimitRow key={window.id} window={window} now={now} />)
        )}
      </div>
    </ThreadDetailsSection>
  );
}

// Pi's bar for a miss worth showing.
const CACHE_MISS_MIN_TOKENS = 20_000;
const CACHE_MISS_MIN_COST_USD = 0.1;

type CacheMiss = NonNullable<OrchestrationV2ProviderTurnTokenUsage["cacheMiss"]>;

const formatIdle = (ms: number) => (ms < 60_000 ? "<1m" : formatDuration(ms));

/** The thread's context window, how long it has been idle, and the latest turn's prompt cache miss. */
export function ThreadDetailsContext({
  contextWindow: usage,
  idleSince,
  working,
  latestTokenUsage,
}: Pick<ThreadDetailsUsageInput, "contextWindow" | "idleSince" | "working" | "latestTokenUsage">) {
  const cacheMiss = latestTokenUsage?.cacheMiss;
  const shownMiss =
    cacheMiss !== undefined &&
    (cacheMiss.tokens >= CACHE_MISS_MIN_TOKENS ||
      (cacheMiss.costUsd ?? 0) >= CACHE_MISS_MIN_COST_USD)
      ? cacheMiss
      : null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title="Context window"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {usage ? <ContextRow usage={usage} /> : null}
        {working || idleSince !== null ? (
          <IdleRow
            since={working ? null : idleSince}
            promptCacheExpiresAt={latestTokenUsage?.promptCacheExpiresAt ?? null}
            miss={shownMiss}
          />
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

/** The bar fills as context is used; the tick marks auto-compaction. */
function ContextRow({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  return (
    <UsageRow
      label="Context"
      fill={used}
      tone={used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null}
      tick={tick}
      muted
      value={
        maxTokens !== null ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}` : usedTokens
      }
      ariaValue={used !== null ? `${used}% used` : `${usedTokens} tokens used`}
      tooltip={
        <>
          <span className="text-foreground">
            {used !== null ? `Context: ${used}% used` : `Context: ${usedTokens} tokens used`}
          </span>
          {maxTokens !== null ? (
            <span className="text-muted-foreground">
              {usage.usedTokens.toLocaleString("en-US")} of {maxTokens.toLocaleString("en-US")}{" "}
              tokens
            </span>
          ) : null}
          {threshold !== null && threshold > 0 ? (
            <span className="text-muted-foreground">
              {formatContextWindowCompactionMessage(threshold)}
            </span>
          ) : null}
        </>
      }
    />
  );
}

/** Idle time on the right, so it never moves; the latest turn's cache miss sits in the bar column. */
function IdleRow({
  since,
  promptCacheExpiresAt,
  miss,
}: {
  /** Null while the agent works. */
  readonly since: number | null;
  readonly promptCacheExpiresAt: string | null;
  readonly miss: CacheMiss | null;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const idle = since === null ? "working" : formatIdle(now - since);
  const missTokens = miss === null ? null : formatContextWindowTokens(miss.tokens);
  const missCost =
    miss?.costUsd !== undefined && miss.costUsd >= 0.01 ? `$${miss.costUsd.toFixed(2)}` : null;
  const missReason =
    miss === null
      ? ""
      : miss.modelChanged
        ? " after model switch"
        : miss.expected
          ? ` after ${formatIdle(miss.idleMs)} idle`
          : "";
  return (
    <UsageRow
      label="Idle"
      fill={null}
      tone={null}
      detail={
        miss === null
          ? null
          : {
              text: `miss ${missTokens}${missCost === null ? "" : ` · ${missCost}`}`,
              tone: miss.expected ? null : "warning",
            }
      }
      value={idle}
      tooltip={
        <>
          <span className="text-foreground">{since === null ? "Working" : `Idle for ${idle}`}</span>
          {since !== null && promptCacheExpiresAt !== null ? (
            <span className="text-muted-foreground">
              Prompt cache {Date.parse(promptCacheExpiresAt) > now ? "expires" : "expired"} at{" "}
              {formatUpcomingTimestamp(promptCacheExpiresAt, timestampFormat, now)}
            </span>
          ) : null}
          {miss !== null ? (
            <span className="text-foreground">
              Cache miss{missReason}: {missTokens} tokens re-billed
              {missCost === null ? "" : ` (~${missCost})`}
            </span>
          ) : null}
        </>
      }
    />
  );
}

function LimitRow({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = remainingPercent(window);
  const pace = paceOf(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  return (
    <UsageRow
      label={window.label}
      fill={left}
      tone={limitTone(left)}
      value={`${left}%`}
      ariaValue={`${left}% left`}
      tooltip={
        <>
          <span className="text-foreground">
            {window.label}: {left}% left
          </span>
          {window.resetsAt && resetsAt > now ? (
            <span className="text-muted-foreground">
              Resets in {formatDuration(resetsAt - now)} ·{" "}
              {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)}
            </span>
          ) : null}
          {pace ? <span className="text-muted-foreground">{PACE_LABEL[pace]}</span> : null}
        </>
      }
    />
  );
}

function ServedByRow({
  account,
  at,
  now,
}: {
  readonly account: LimitAccount;
  readonly at: number;
  readonly now: number;
}) {
  const name = account.email ?? account.displayName ?? "Proxy account";
  return (
    <UsageRow
      label="Account"
      fill={null}
      tone={null}
      value={name}
      tooltip={
        <>
          <span className="text-foreground">
            {account.sourceLabel ?? "The proxy"} last answered through {name}
          </span>
          <span className="text-muted-foreground">
            {now - at < 60_000 ? "Just now" : `${formatDuration(now - at)} ago`}
          </span>
        </>
      }
    />
  );
}

function PoolRow({ window, now }: { readonly window: LimitPoolWindow; readonly now: number }) {
  const left = window.remainingPercent;
  const accounts = window.members.length;
  const next = window.resets.find((reset) => reset.at > now);
  return (
    <UsageRow
      label={window.label}
      fill={left}
      tone={limitTone(left)}
      value={`${left}%`}
      ariaValue={`${left}% left`}
      tooltip={
        <>
          <span className="text-foreground">
            {window.label}: {left}% left across {accounts} account{accounts === 1 ? "" : "s"}
          </span>
          {next ? (
            <span className="text-muted-foreground">
              Next reset in {formatDuration(next.at - now)} · +{next.restoresPercent}%
            </span>
          ) : null}
          {window.pace ? (
            <span className="text-muted-foreground">{PACE_LABEL[window.pace]}</span>
          ) : null}
        </>
      }
    />
  );
}

/** One label, hairline, and value row; the whole row opens the details tooltip. */
function UsageRow({
  label,
  fill,
  tone,
  tick = null,
  detail = null,
  value,
  ariaValue = detail === null ? value : `${detail.text}, ${value}`,
  tooltip,
  muted = false,
}: {
  readonly label: string;
  /** Bar fill from 0 to 100. Null hides the bar. */
  readonly fill: number | null;
  readonly tone: UsageTone;
  /** A marker on the bar, from 0 to 100. */
  readonly tick?: number | null;
  /** Text in the bar column of a row without a bar. */
  readonly detail?: { readonly text: string; readonly tone: UsageTone } | null;
  readonly value: string;
  readonly ariaValue?: string;
  readonly tooltip: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`${label}: ${ariaValue}`}
            className="col-span-3 grid h-6 cursor-default grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
          />
        }
      >
        <span className="max-w-28 truncate text-muted-foreground">{label}</span>
        {fill !== null ? (
          <span className="relative h-[3px] rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20">
            {fill > 0 ? (
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  tone === "error"
                    ? "bg-error"
                    : tone === "warning"
                      ? "bg-warning"
                      : muted
                        ? "bg-muted-foreground"
                        : "bg-foreground/80",
                )}
                style={{ width: `max(${fill}%, 6px)` }}
              />
            ) : null}
            {tick !== null ? (
              <span
                aria-hidden
                className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/60"
                style={{ left: `${tick}%` }}
              />
            ) : null}
          </span>
        ) : null}
        {fill === null && detail !== null ? (
          <span
            className={cn(
              "truncate font-medium tabular-nums",
              detail.tone === "error"
                ? "text-error-foreground"
                : detail.tone === "warning"
                  ? "text-warning-foreground"
                  : "text-muted-foreground",
            )}
          >
            {detail.text}
          </span>
        ) : null}
        <span
          className={cn(
            // Text-only rows span the bar column so they never widen the shared value column.
            "text-end font-medium tabular-nums",
            fill === null && detail === null && "col-span-2",
            tone === "error"
              ? "text-error-foreground"
              : tone === "warning"
                ? "text-warning-foreground"
                : fill === null
                  ? "text-muted-foreground"
                  : "text-foreground/80",
          )}
        >
          {value}
        </span>
      </TooltipTrigger>
      {/* Rows sit 8px inside the card; clear its edge instead of overlapping it. */}
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">{tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}
