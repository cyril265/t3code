import type {
  OrchestrationV2ProviderTurnTokenUsage,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
<<<<<<< HEAD
  type LimitPace,
  type LimitPoolWindow,
=======
  collectProviderUsageLimits,
<<<<<<< HEAD
  type LimitPace,
=======
  customEndpointLimitPool,
  formatDuration,
  type LimitAccount,
  type LimitPace,
  type LimitPoolWindow,
  limitsNotice,
>>>>>>> 924450cc96 (fix(web): show CLI Proxy limits for Claude Code routed through it)
>>>>>>> 38eb978323 (fix(web): show CLI Proxy limits for Claude Code routed through it)
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
<<<<<<< HEAD
import { formatDuration, limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { Link } from "@tanstack/react-router";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import type { ReactNode } from "react";
=======
import { Children, type ReactNode } from "react";
>>>>>>> 408323da32 (feat(web): show usage limits as one compact line)

import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
<<<<<<< HEAD
import {
  nextPoolReset,
  poolSources,
  resolveThreadDetailsLimits,
  resolveThreadHttpQuotas,
} from "./ThreadDetailsUsage.logic";
=======
import { shortLimitLabels } from "./usageLimitLabels.logic";
>>>>>>> b51bd9a490 (feat(web): show usage limits as one compact line)

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

<<<<<<< HEAD
function limitTone(left: number): UsageTone {
  if (left <= 10) return "error";
  if (left <= 20) return "warning";
  return null;
}

=======
<<<<<<< HEAD
>>>>>>> 38eb978323 (fix(web): show CLI Proxy limits for Claude Code routed through it)
/** The selected provider's limit windows. Each row reads as room left and opens the usage page. */
=======
const limitTone = (left: number): UsageTone =>
  left <= 10 ? "error" : left <= 20 ? "warning" : null;

const withShortLabels = <Window extends { readonly label: string }>(windows: readonly Window[]) => {
  const labels = shortLimitLabels(windows.map((window) => window.label));
  return windows.map((window, index) => [window, labels[index] ?? window.label] as const);
};

/** The selected provider's limit windows. Each row reads as room left. */
>>>>>>> 924450cc96 (fix(web): show CLI Proxy limits for Claude Code routed through it)
export function ThreadDetailsUsage({
  providerInstanceId,
  model,
  providers,
  sources,
<<<<<<< HEAD
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const gt = useGT();
<<<<<<< HEAD
=======
  const m = useMessages();
=======
}: Pick<ThreadDetailsUsageInput, "providerInstanceId" | "providers" | "sources">) {
>>>>>>> 7a864c1eee (feat: show idle time and prompt cache misses in thread details)
>>>>>>> a279cc0eba (feat: show idle time and prompt cache misses in thread details)
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
<<<<<<< HEAD
  const resolved = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  const quotas = resolveThreadHttpQuotas(providerInstanceId, sources);
  if (!resolved && quotas.length === 0) return null;
=======
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
<<<<<<< HEAD
  const notice = limitsNotice(limits, m);
=======
  const notice = limitsNotice(limits);
  const pool =
    notice && providerInstanceId !== null
      ? customEndpointLimitPool(providerInstanceId, providers, sources, now)
      : null;
>>>>>>> 924450cc96 (fix(web): show CLI Proxy limits for Claude Code routed through it)
>>>>>>> 38eb978323 (fix(web): show CLI Proxy limits for Claude Code routed through it)

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title={gt("Usage limits")}
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
<<<<<<< HEAD
<<<<<<< HEAD
        {resolved?.kind === "pool"
          ? resolved.windows.map((window) => <PoolRow key={window.id} window={window} now={now} />)
          : resolved &&
            (quotas.length === 0 || limitsNotice(resolved.limits) === null) && (
              <InstanceRows limits={resolved.limits} now={now} />
            )}
        {quotas.map(({ key, accountLabel, window }) => (
          <LimitRow key={key} window={window} now={now} accountLabel={accountLabel} />
        ))}
=======
        {pool ? (
=======
        {pool?.servedBy ? (
          <>
            <LimitLine>
              <ServedBy {...pool.servedBy} now={now} />
            </LimitLine>
            <LimitLine>
              {withShortLabels(pool.servedBy.account.limits.windows).map(([window, shortLabel]) => (
                <WindowLimit key={window.id} window={window} shortLabel={shortLabel} now={now} />
              ))}
            </LimitLine>
          </>
        ) : pool ? (
<<<<<<< HEAD
>>>>>>> 245b0854eb (fix(web): show the CLI Proxy account a thread is running on)
          pool.windows.map((window) => <PoolRow key={window.id} window={window} now={now} />)
=======
          <LimitLine>
            {withShortLabels(pool.windows).map(([window, shortLabel]) => (
              <PoolLimit key={window.id} window={window} shortLabel={shortLabel} now={now} />
            ))}
          </LimitLine>
>>>>>>> b51bd9a490 (feat(web): show usage limits as one compact line)
        ) : notice ? (
          <UsageRow
            label={gt("Limits", { $context: "usage limits row label" })}
            fill={null}
            tone={null}
            value={gt("Unavailable")}
            tooltip={<span className="text-foreground">{notice}</span>}
            opensUsage
          />
        ) : (
          <LimitLine>
            {withShortLabels(limits.windows).map(([window, shortLabel]) => (
              <WindowLimit key={window.id} window={window} shortLabel={shortLabel} now={now} />
            ))}
          </LimitLine>
        )}
>>>>>>> 38eb978323 (fix(web): show CLI Proxy limits for Claude Code routed through it)
      </div>
    </ThreadDetailsSection>
  );
}

<<<<<<< HEAD
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
  return limits.windows.map((window) => <LimitRow key={window.id} window={window} now={now} />);
}

/** The thread's context window. The bar fills as context is used; the tick marks auto-compaction. */
export function ThreadDetailsContext({ usage }: { readonly usage: ContextWindowSnapshot }) {
=======
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
>>>>>>> a279cc0eba (feat: show idle time and prompt cache misses in thread details)
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
<<<<<<< HEAD
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title={gt("Context window")}
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
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
      </div>
    </ThreadDetailsSection>
=======
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
>>>>>>> 7a864c1eee (feat: show idle time and prompt cache misses in thread details)
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
<<<<<<< HEAD
    <UsageRow
      label={window.label}
      fill={left}
<<<<<<< HEAD
      tone={limitTone(left)}
=======
<<<<<<< HEAD
      tone={left <= 10 ? "error" : left <= 20 ? "warning" : null}
>>>>>>> 38eb978323 (fix(web): show CLI Proxy limits for Claude Code routed through it)
      tick={timeLeft}
=======
=======
    <LimitItem
      label={shortLabel}
>>>>>>> 408323da32 (feat(web): show usage limits as one compact line)
      tone={limitTone(left)}
>>>>>>> 924450cc96 (fix(web): show CLI Proxy limits for Claude Code routed through it)
      value={`${left}%`}
<<<<<<< HEAD
      ariaValue={gt("{left}% left", { left })}
      opensUsage
=======
      ariaLabel={`${window.label}: ${left}% left`}
>>>>>>> 408323da32 (feat(web): show usage limits as one compact line)
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

<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
function PoolRow({ window, now }: { readonly window: LimitPoolWindow; readonly now: number }) {
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
    <UsageRow
      label={window.label}
      fill={left}
      tone={limitTone(left)}
      value={`${left}%`}
      ariaValue={gt("{left}% left", { left })}
      opensUsage
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

=======
<<<<<<< HEAD
>>>>>>> 38eb978323 (fix(web): show CLI Proxy limits for Claude Code routed through it)
=======
<<<<<<< HEAD
>>>>>>> 245b0854eb (fix(web): show the CLI Proxy account a thread is running on)
=======
<<<<<<< HEAD
>>>>>>> b51bd9a490 (feat(web): show usage limits as one compact line)
/** One label, hairline, and value row; the whole row opens the details tooltip. With `opensUsage` it links to the usage page. */
=======
=======
function ServedByRow({
=======
function ServedBy({
>>>>>>> 408323da32 (feat(web): show usage limits as one compact line)
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

<<<<<<< HEAD
>>>>>>> e40588df8b (fix(web): show the CLI Proxy account a thread is running on)
function PoolRow({ window, now }: { readonly window: LimitPoolWindow; readonly now: number }) {
=======
function PoolLimit({
  window,
  shortLabel,
  now,
}: {
  readonly window: LimitPoolWindow;
  readonly shortLabel: string;
  readonly now: number;
}) {
>>>>>>> 408323da32 (feat(web): show usage limits as one compact line)
  const left = window.remainingPercent;
  const accounts = window.members.length;
  const next = window.resets.find((reset) => reset.at > now);
  return (
    <LimitItem
      label={shortLabel}
      tone={limitTone(left)}
      value={`${left}%`}
      ariaLabel={`${window.label}: ${left}% left`}
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
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={ariaLabel}
            className={cn("flex h-6 min-w-0 items-center gap-1 px-1", HOVER_TARGET)}
          />
        }
      >
        <span className="truncate text-muted-foreground">{label}</span>
        {value !== null ? (
          <span
            className={cn(
              "font-medium tabular-nums",
              tone === "error"
                ? "text-error-foreground"
                : tone === "warning"
                  ? "text-warning-foreground"
                  : "text-foreground/80",
            )}
          >
            {value}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        <div className="flex flex-col gap-0.5">{tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}

/** One label, hairline, and value row; the whole row opens the details tooltip. */
>>>>>>> 924450cc96 (fix(web): show CLI Proxy limits for Claude Code routed through it)
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
    "aria-label": gt("{label}: {value}", { label, value: ariaValue }),
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
<<<<<<< HEAD
          opensUsage ? <Link to="/usage" {...rowProps} /> : <div tabIndex={0} {...rowProps} />
=======
          <div
            tabIndex={0}
            aria-label={`${label}: ${ariaValue}`}
            className={cn(
              "col-span-3 grid h-6 grid-cols-subgrid items-center px-2.5",
              HOVER_TARGET,
            )}
          />
>>>>>>> 408323da32 (feat(web): show usage limits as one compact line)
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
        <div className="flex flex-col gap-0.5">
          {tooltip}
          {opensUsage ? <span className="text-muted-foreground">{gt("Open usage")}</span> : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
