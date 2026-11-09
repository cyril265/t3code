// @effect-diagnostics nodeBuiltinImport:off - Stop is checked against real processes.
import * as NodeChildProcess from "node:child_process";
import { ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ProcessRunner from "../processRunner.ts";
import * as ExternalWaits from "./ExternalWaits.ts";

const processes = ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer));
const threadId = ThreadId.make("thread-1");
const current = (waits: ExternalWaits.ExternalWaits["Service"]) =>
  Stream.runHead(waits.subscribe()).pipe(
    Effect.map((list) => (Option.isSome(list) ? list.value.waits : [])),
  );

it.effect("keeps a wait while its script reports, and hands Stop back to the script", () =>
  Effect.gen(function* () {
    const waits = yield* ExternalWaits.make;
    const subscribed = yield* Deferred.make<void>();
    const updates = yield* waits.subscribe().pipe(
      Stream.tap(() => Deferred.succeed(subscribed, undefined)),
      Stream.takeUntil((list) => list.waits[0]?.detail === "in_progress"),
      Stream.runLast,
      Effect.forkChild,
    );
    yield* Deferred.await(subscribed);

    assert.deepEqual(yield* waits.report({ threadId, waitId: "build", label: "build" }), {
      stopRequested: false,
    });
    yield* waits.report({ threadId, waitId: "build", label: "build", detail: " in_progress " });
    const [started] = yield* current(waits);
    assert.deepEqual(started, {
      threadId,
      waitId: "build",
      label: "build",
      detail: "in_progress",
    });

    // Subscribers may skip intermediate lists but always end on the latest.
    assert.deepEqual(yield* Fiber.join(updates), Option.some({ waits: [started!] }));

    yield* waits.stop(threadId);
    assert.deepEqual(yield* waits.report({ threadId, waitId: "build", label: "build" }), {
      stopRequested: true,
    });
    assert.deepEqual(
      yield* waits.report({ threadId, waitId: "build", label: "build", finished: true }),
      { stopRequested: true },
    );
    assert.deepEqual(yield* current(waits), []);
  }).pipe(Effect.provide(processes)),
);

it.effect("drops a wait whose script stopped reporting once its lease runs out", () =>
  Effect.gen(function* () {
    const waits = yield* ExternalWaits.make;
    yield* waits.report({ threadId, waitId: "deploy", label: "deploy" });

    yield* TestClock.adjust("59999 millis");
    yield* waits.expire;
    assert.equal((yield* current(waits)).length, 1);

    yield* TestClock.adjust("1 millis");
    yield* waits.expire;
    assert.deepEqual(yield* current(waits), []);
  }).pipe(Effect.provide(processes)),
);

/** A process whose command line carries `args`, killed at the end if still running. */
const spawnFixture = (...args: ReadonlyArray<string>) =>
  Effect.acquireRelease(
    Effect.callback<{ child: NodeChildProcess.ChildProcess; exited: Deferred.Deferred<string> }>(
      (resume) => {
        const child = NodeChildProcess.spawn(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)", ...args],
          { stdio: "ignore" },
        );
        const exited = Deferred.makeUnsafe<string>();
        child.once("exit", (_code, signal) =>
          Deferred.doneUnsafe(exited, Effect.succeed(String(signal))),
        );
        child.once("spawn", () => resume(Effect.succeed({ child, exited })));
      },
    ),
    ({ child }) => Effect.sync(() => child.kill("SIGKILL")),
  );

it.live("Stop signals a wait's script only when its command line is that wait's watcher", () =>
  Effect.gen(function* () {
    const waits = yield* ExternalWaits.make;
    const watcher = yield* spawnFixture("__t3-wait-watcher", "/cache/build-1.log", threadId);
    // Watchers this thread's reports claim, whose command lines name another thread or log.
    const otherThread = yield* spawnFixture("__t3-wait-watcher", "/cache/build-2.log", "thread-2");
    const otherLog = yield* spawnFixture("__t3-wait-watcher", "/cache/build-9.log", threadId);
    yield* waits.report({ threadId, waitId: "build-1", label: "build", pid: watcher.child.pid! });
    yield* waits.report({ threadId, waitId: "build-2", label: "b", pid: otherThread.child.pid! });
    yield* waits.report({ threadId, waitId: "build-3", label: "b", pid: otherLog.child.pid! });

    yield* waits.stop(threadId);

    assert.equal(yield* Deferred.await(watcher.exited), "SIGTERM");
    // Stop has returned, so any SIGTERM it sent is already queued ahead of this SIGKILL.
    for (const spared of [otherThread, otherLog]) {
      spared.child.kill("SIGKILL");
      assert.equal(yield* Deferred.await(spared.exited), "SIGKILL");
    }
  }).pipe(Effect.provide(processes)),
);
