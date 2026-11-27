import type {
  OrchestrationV2ProviderTurnTokenUsage,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  customEndpointLimitPool,
  type LimitAccount,
  type LimitPace,
  type LimitPoolWindow,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { formatDuration, limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { Link } from "@tanstack/react-router";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import { Children, type ReactNode } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  nextPoolReset,
  poolSources,
  resolveThreadDetailsLimits,
  resolveThreadHttpQuotas,
} from "./ThreadDetailsUsage.logic";
import { shortLimitLabels } from "./usageLimitLabels.logic";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: msg("Ahead of pace"),
  on: msg("On pace"),
  under: msg("Under pace"),
};

export interface ThreadDetailsUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
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

const toneText = (tone: UsageTone, fallback: string) =>
  tone === "error"
    ? "text-error-foreground"
    : tone === "warning"
      ? "text-warning-foreground"
      : fallback;

const withShortLabels = <Window extends { readonly label: string }>(windows: readonly Window[]) => {
  const labels = shortLimitLabels(windows.map((window) => window.label));
  return windows.map((window, index) => [window, labels[index] ?? window.label] as const);
};

/** The selected provider's limit windows. Each row reads as room left. */
export function ThreadDetailsUsage({
  providerInstanceId,
  model,
  providers,
  sources,
}: Pick<ThreadDetailsUsageInput, "providerInstanceId" | "model" | "providers" | "sources">) {
  const gt = useGT();
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const resolved = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  const quotas = resolveThreadHttpQuotas(providerInstanceId, sources);
  const pool =
    resolved?.kind === "pool" && providerInstanceId !== null
      ? customEndpointLimitPool(providerInstanceId, providers, sources, now)
      : null;
  const servedBy = pool?.servedBy;
  const shownServedBy =
    servedBy &&
    resolved?.kind === "pool" &&
    resolved.windows.some((window) =>
      window.members.some(
        ({ account }) =>
          account.key === servedBy.account.key || account.key.endsWith(`:${servedBy.account.key}`),
      ),
    )
      ? servedBy
      : null;
  if (!resolved && quotas.length === 0) return null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title={gt("Usage limits")}
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {shownServedBy ? (
          <LimitLine>
            <ServedBy {...shownServedBy} now={now} />
          </LimitLine>
        ) : null}
        {resolved?.kind === "pool" ? (
          <LimitLine>
            {withShortLabels(resolved.windows).map(([window, shortLabel]) => (
              <PoolLimit key={window.id} window={window} shortLabel={shortLabel} now={now} />
            ))}
          </LimitLine>
        ) : resolved && (quotas.length === 0 || limitsNotice(resolved.limits) === null) ? (
          <InstanceRows limits={resolved.limits} now={now} />
        ) : null}
        {quotas.length > 0 ? (
          <LimitLine>
            {quotas.map(({ key, accountLabel, window }) => (
              <WindowLimit
                key={key}
                window={window}
                shortLabel={window.label}
                now={now}
                accountLabel={accountLabel}
              />
            ))}
          </LimitLine>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

function InstanceRows({
  limits,
  now,
}: {
  readonly limits: ServerProviderUsageLimits;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const notice = limitsNotice(limits, m);
  if (notice) {
    return (
      <UsageRow
        label={gt("Limits", { $context: "usage limits row label" })}
        fill={null}
        tone={null}
        value={gt("Unavailable")}
        tooltip={<span className="text-foreground">{notice}</span>}
        opensUsage
      />
    );
  }
  return <WindowLimits windows={limits.windows} now={now} />;
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
  const gt = useGT();
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
      title={gt("Context window")}
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
  const gt = useGT();
  const m = useMessages();
  const locale = useLocale();
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  return (
    <UsageRow
      label={gt("Context", { $context: "context window row label" })}
      fill={used}
      tone={used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null}
      tick={tick}
      muted
      value={
        maxTokens !== null
          ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}`
          : usedTokens
      }
      ariaValue={
        used !== null
          ? gt("{used}% used", { used })
          : gt("{usedTokens} tokens used", { usedTokens })
      }
      tooltip={
        <>
          <span className="text-foreground">
            {used !== null
              ? gt("Context: {used}% used", { used })
              : gt("Context: {usedTokens} tokens used", { usedTokens })}
          </span>
          {maxTokens !== null ? (
            <span className="text-muted-foreground">
              {gt("{used} of {max} tokens", {
                used: usage.usedTokens.toLocaleString(locale),
                max: maxTokens.toLocaleString(locale),
              })}
            </span>
          ) : null}
          {threshold !== null && threshold > 0 ? (
            <span className="text-muted-foreground">
              {formatContextWindowCompactionMessage(threshold, m)}
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

function WindowLimits({
  windows,
  now,
}: {
  readonly windows: readonly ServerProviderUsageWindow[];
  readonly now: number;
}) {
  return (
    <LimitLine>
      {withShortLabels(windows).map(([window, shortLabel]) => (
        <WindowLimit key={window.id} window={window} shortLabel={shortLabel} now={now} />
      ))}
    </LimitLine>
  );
}

function WindowLimit({
  window,
  shortLabel,
  now,
  accountLabel,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly shortLabel: string;
  readonly now: number;
  readonly accountLabel?: string;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = remainingPercent(window);
  const pace = paceOf(window, now);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  return (
    <LimitItem
      label={shortLabel}
      tone={limitTone(left)}
      value={`${left}%`}
      ariaLabel={gt("{label}: {left}% left", { label: window.label, left })}
      tooltip={
        <>
          <span className="text-foreground">
            {gt("{label}: {left}% left", { label: window.label, left })}
          </span>
          {accountLabel ? <span className="text-muted-foreground">{accountLabel}</span> : null}
          {pace && timeLeft !== null ? (
            <span className="text-muted-foreground">
              {m(PACE_LABEL[pace])} · {gt("{timeLeft}% of the window left", { timeLeft })}
            </span>
          ) : null}
          {window.resetsAt && resetsAt > now ? (
            <span className="text-muted-foreground">
              {gt("Resets in {duration} · {time}", {
                duration: formatDuration(resetsAt - now, m),
                time: formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m),
              })}
            </span>
          ) : null}
        </>
      }
    />
  );
}

function ServedBy({
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
    <LimitItem
      label={name}
      value={null}
      ariaLabel={`Account: ${name}`}
      tone={null}
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

function PoolLimit({
  window,
  shortLabel,
  now,
}: {
  readonly window: LimitPoolWindow;
  readonly shortLabel: string;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = window.remainingPercent;
  const accounts = window.members.length;
  const from = poolSources(window);
  const sourceLabels = [...from.hubs, ...(from.signedIn ? [gt("Signed-in accounts")] : [])];
  const next = nextPoolReset(window, now);
  const resetsAt = next?.member.window.resetsAt;
  const reset =
    next && resetsAt
      ? {
          duration: formatDuration(next.at - now, m),
          time: formatUpcomingTimestamp(resetsAt, timestampFormat, now, undefined, m),
        }
      : null;
  return (
    <LimitItem
      label={shortLabel}
      tone={limitTone(left)}
      value={`${left}%`}
      ariaLabel={gt("{label}: {left}% left", { label: window.label, left })}
      tooltip={
        <>
          <span className="text-foreground">
            {accounts > 1
              ? gt("{label}: {left}% left across {accounts} accounts", {
                  label: window.label,
                  left,
                  accounts,
                })
              : gt("{label}: {left}% left", { label: window.label, left })}
          </span>
          {window.pace ? (
            <span className="text-muted-foreground">{m(PACE_LABEL[window.pace])}</span>
          ) : null}
          {next && reset ? (
            <span className="text-muted-foreground">
              {accounts > 1
                ? gt("+{percent}% in {duration} · {time}", {
                    percent: next.restoresPercent,
                    ...reset,
                  })
                : gt("Resets in {duration} · {time}", reset)}
            </span>
          ) : null}
          {sourceLabels.length > 0 ? (
            <span className="text-muted-foreground">
              {gt("From {sources}", { sources: sourceLabels.join(", ") })}
            </span>
          ) : null}
        </>
      }
    />
  );
}


const HOVER_TARGET =
  "cursor-default rounded-lg outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]";

/** Items spread across the line with middots centred between them. */
function LimitLine({ children }: { readonly children: ReactNode }) {
  return (
    <div className="col-span-3 flex min-w-0 items-center justify-between px-1.5">
      {Children.map(children, (child, index) => (
        <>
          {index > 0 ? (
            <span aria-hidden className="text-muted-foreground/60">
              ·
            </span>
          ) : null}
          {child}
        </>
      ))}
    </div>
  );
}

function LimitItem({
  label,
  tone,
  value,
  ariaLabel,
  tooltip,
}: {
  readonly label: string;
  readonly tone: UsageTone;
  readonly value: string | null;
  readonly ariaLabel: string;
  readonly tooltip: ReactNode;
}) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/usage"
            aria-label={ariaLabel}
            className={cn("flex h-6 min-w-0 items-center gap-1 px-1", HOVER_TARGET, "cursor-pointer")}
          />
        }
      >
        <span className="truncate text-muted-foreground">{label}</span>
        {value !== null ? (
          <span className={cn("font-medium tabular-nums", toneText(tone, "text-foreground/80"))}>
            {value}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        <div className="flex flex-col gap-0.5">
          {tooltip}
          <span className="text-muted-foreground">{gt("Open usage")}</span>
        </div>
      </TooltipPopup>
    </Tooltip>
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
  ariaValue,
  tooltip,
  muted = false,
  opensUsage = false,
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
  readonly opensUsage?: boolean;
}) {
  const gt = useGT();
  const rowProps = {
    "aria-label": gt("{label}: {value}", {
      label,
      value: ariaValue ?? (detail === null ? value : `${detail.text}, ${value}`),
    }),
    className: cn(
      "col-span-3 grid h-6 grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]",
      opensUsage
        ? "group cursor-pointer active:bg-black/[0.06] dark:active:bg-white/[0.12]"
        : "cursor-default",
    ),
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          opensUsage ? <Link to="/usage" {...rowProps} /> : <div tabIndex={0} {...rowProps} />
        }
      >
        <span className="max-w-28 truncate text-muted-foreground group-hover:text-foreground">
          {label}
        </span>
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
                className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/75"
                style={{ left: `clamp(0.5px, ${tick}%, calc(100% - 0.5px))` }}
              />
            ) : null}
          </span>
        ) : null}
        {fill === null && detail !== null ? (
          <span
            className={cn(
              "truncate font-medium tabular-nums",
              toneText(detail.tone, "text-muted-foreground"),
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
            toneText(tone, fill === null ? "text-muted-foreground" : "text-foreground/80"),
          )}
        >
          {value}
        </span>
      </TooltipTrigger>
      {/* Rows sit 8px inside the card; clear its edge instead of overlapping it. */}
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">
          {tooltip}
          {opensUsage ? <span className="text-muted-foreground">{gt("Open usage")}</span> : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
