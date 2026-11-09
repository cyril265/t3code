import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** A script outside the agent, such as t3-wait, waiting on something for a thread. Held in server memory under a lease. */
export const ExternalWait = Schema.Struct({
  threadId: ThreadId,
  waitId: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  detail: Schema.optional(TrimmedNonEmptyString),
});
export type ExternalWait = typeof ExternalWait.Type;

export const ExternalWaitList = Schema.Struct({ waits: Schema.Array(ExternalWait) });
export type ExternalWaitList = typeof ExternalWaitList.Type;

export const ExternalWaitSubscribeInput = Schema.Struct({});

export const ExternalWaitStopInput = Schema.Struct({ threadId: ThreadId });
export type ExternalWaitStopInput = typeof ExternalWaitStopInput.Type;

export const ExternalWaitReportInput = Schema.Struct({
  threadId: ThreadId,
  waitId: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  detail: Schema.optional(Schema.String.check(Schema.isMaxLength(500))).annotate({
    description: "Latest output line.",
  }),
  finished: Schema.optional(Schema.Boolean),
  pid: Schema.optional(Schema.Int.check(Schema.isGreaterThan(1))),
});
export type ExternalWaitReportInput = typeof ExternalWaitReportInput.Type;

export const ExternalWaitReportResult = Schema.Struct({ stopRequested: Schema.Boolean });

export const EXTERNAL_WAIT_TOOL_NAME = "t3_external_wait";

export const EXTERNAL_WAIT_WS_METHODS = {
  subscribe: "externalWaits.subscribe",
  stop: "externalWaits.stop",
} as const;

export const WsExternalWaitsSubscribeRpc = Rpc.make(EXTERNAL_WAIT_WS_METHODS.subscribe, {
  payload: ExternalWaitSubscribeInput,
  success: ExternalWaitList,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsExternalWaitsStopRpc = Rpc.make(EXTERNAL_WAIT_WS_METHODS.stop, {
  payload: ExternalWaitStopInput,
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});
