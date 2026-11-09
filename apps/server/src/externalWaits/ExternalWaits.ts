import {
  type ExternalWait,
  type ExternalWaitList,
  type ExternalWaitReportInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ProcessRunner from "../processRunner.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";

/** Each report renews the wait for this long; a script that stops reporting drops off. */
const LEASE_MS = 60_000;

interface HeldWait {
  readonly wait: ExternalWait;
  readonly expiresAtMs: number;
  readonly stopRequested: boolean;
  readonly pid?: number;
}
type HeldWaits = ReadonlyMap<string, HeldWait>;

/** Waits scripts such as t3-wait report for a thread. Memory only: a restart drops them until their next report. */
export class ExternalWaits extends Context.Service<
  ExternalWaits,
  {
    readonly report: (
      input: ExternalWaitReportInput,
    ) => Effect.Effect<{ readonly stopRequested: boolean }>;
    readonly stop: (threadId: ThreadId) => Effect.Effect<void>;
    readonly subscribe: () => Stream.Stream<ExternalWaitList>;
    readonly expire: Effect.Effect<void>;
  }
>()("t3/externalWaits/ExternalWaits") {}

const waitKey = (threadId: ThreadId, waitId: string) => JSON.stringify([threadId, waitId]);

/**
 * Whether a command line is t3-wait's watcher for this wait, which runs as
 * `t3-wait __t3-wait-watcher <dir>/<waitId>.log <threadId> …`. A reused or forged pid fails;
 * so does a log path with spaces, whose script still sees Stop on its next report.
 */
const isWatcherOf = (command: string, wait: ExternalWait) => {
  const args = command.trim().split(" ");
  const marker = args.indexOf("__t3-wait-watcher");
  return (
    marker > 0 &&
    args[marker + 1]?.endsWith(`/${wait.waitId}.log`) === true &&
    args[marker + 2] === wait.threadId
  );
};

export const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const held = yield* Ref.make<HeldWaits>(new Map());

  /** Signals the script itself, so Stop does not wait for its next report. */
  const terminate = Effect.fn("ExternalWaits.terminate")(function* (
    pid: number,
    wait: ExternalWait,
  ) {
    if ((yield* HostProcess.Platform) === "win32") return;
    const command = yield* runner
      .run({
        command: "ps",
        args: ["-o", "command=", "-p", String(pid)],
        timeout: Duration.seconds(5),
      })
      .pipe(
        Effect.map((result) => (result.code === 0 ? result.stdout : "")),
        Effect.orElseSucceed(() => ""),
      );
    if (!isWatcherOf(command, wait)) {
      return yield* Effect.logWarning("external wait pid does not belong to its wait", {
        pid,
        waitId: wait.waitId,
      });
    }
    yield* Effect.try(() => process.kill(pid, "SIGTERM")).pipe(Effect.ignore({ log: true }));
  });
  // Notifications re-emit the full list, so subscribers need only the newest signal.
  const changes = yield* PubSub.sliding<void>(1);
  const notify = (changed: boolean) =>
    changed ? PubSub.publish(changes, undefined).pipe(Effect.asVoid) : Effect.void;

  const report: ExternalWaits["Service"]["report"] = Effect.fn("ExternalWaits.report")(
    function* (input) {
      const nowMs = yield* Clock.currentTimeMillis;
      const key = waitKey(input.threadId, input.waitId);
      const detail = input.detail?.trim();
      const [result, changed] = yield* Ref.modify(held, (current) => {
        const previous = current.get(key);
        const stopRequested = previous?.stopRequested ?? false;
        const next = new Map(current);
        if (input.finished === true) {
          next.delete(key);
          return [[{ stopRequested }, previous !== undefined] as const, next];
        }
        const wait: ExternalWait = {
          threadId: input.threadId,
          waitId: input.waitId,
          label: input.label,
          ...(detail === undefined || detail.length === 0 ? {} : { detail }),
        };
        const pid = input.pid ?? previous?.pid;
        next.set(key, {
          wait,
          expiresAtMs: nowMs + LEASE_MS,
          stopRequested,
          ...(pid === undefined ? {} : { pid }),
        });
        const changed =
          previous === undefined ||
          previous.wait.label !== wait.label ||
          previous.wait.detail !== wait.detail;
        return [[{ stopRequested }, changed] as const, next];
      });
      yield* notify(changed);
      return result;
    },
  );

  const stop: ExternalWaits["Service"]["stop"] = Effect.fn("ExternalWaits.stop")(
    function* (threadId) {
      const stopping = yield* Ref.modify(held, (current) => {
        const entries: Array<HeldWait> = [];
        let next: Map<string, HeldWait> | undefined;
        for (const [key, entry] of current) {
          if (entry.wait.threadId !== threadId || entry.stopRequested) continue;
          next ??= new Map(current);
          next.set(key, { ...entry, stopRequested: true });
          entries.push(entry);
        }
        return [entries, next ?? current];
      });
      // Scripts whose pid fails the check still see stopRequested on their next report.
      yield* Effect.forEach(
        stopping,
        (entry) => (entry.pid === undefined ? Effect.void : terminate(entry.pid, entry.wait)),
        { concurrency: "unbounded", discard: true },
      );
    },
  );

  const expire = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const changed = yield* Ref.modify(held, (current) => {
      const next = new Map([...current].filter(([, entry]) => entry.expiresAtMs > nowMs));
      return next.size === current.size ? [false, current] : [true, next];
    });
    yield* notify(changed);
  });

  const list = Ref.get(held).pipe(
    Effect.map((current): ExternalWaitList => ({
      waits: Array.from(current.values(), (entry) => entry.wait),
    })),
  );

  const subscribe: ExternalWaits["Service"]["subscribe"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading so a change between the two is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list)),
        );
      }),
    );

  return ExternalWaits.of({ report, stop, subscribe, expire });
});

export const layer = Layer.effect(
  ExternalWaits,
  Effect.gen(function* () {
    const service = yield* make;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("external-waits", service.expire);
    return service;
  }),
);
