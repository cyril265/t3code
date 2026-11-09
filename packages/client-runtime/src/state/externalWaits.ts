import {
  EXTERNAL_WAIT_WS_METHODS,
  type EnvironmentId,
  type ExternalWait,
  type OrchestrationV2PendingBackgroundTask,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

const NO_WAITS: ReadonlyArray<ExternalWait> = [];
const EXTERNAL_WAIT_TASK_ID_PREFIX = "external-wait:";

const isExternalWaitTask = (task: Pick<OrchestrationV2PendingBackgroundTask, "taskId">) =>
  task.taskId.startsWith(EXTERNAL_WAIT_TASK_ID_PREFIX);

// A background task holds completion, so the thread reads as Waiting, as it does for Claude's own background waits.
export function externalWaitTasks(
  waits: ReadonlyArray<ExternalWait>,
  threadId: ThreadId,
): Array<OrchestrationV2PendingBackgroundTask> {
  return waits
    .filter((wait) => wait.threadId === threadId)
    .map((wait) => ({
      taskId: `${EXTERNAL_WAIT_TASK_ID_PREFIX}${wait.waitId}`,
      kind: "background_task",
      description: wait.detail === undefined ? wait.label : `${wait.label} · ${wait.detail}`,
    }));
}

const overlaid = new WeakMap<
  OrchestrationV2ThreadShell,
  { readonly key: string; readonly thread: OrchestrationV2ThreadShell }
>();

/** Adds each thread's external waits to its background work while no run is active, as the server does for provider work. */
export function overlayExternalWaits(
  snapshot: OrchestrationV2ShellSnapshot | null,
  waits: ReadonlyArray<ExternalWait>,
): OrchestrationV2ShellSnapshot | null {
  if (snapshot === null || waits.length === 0) return snapshot;
  const waiting = new Set(waits.map((wait) => wait.threadId));
  let changed = false;
  const threads = snapshot.threads.map((thread) => {
    if (!waiting.has(thread.id) || thread.activeRunId !== null) return thread;
    const tasks = externalWaitTasks(waits, thread.id);
    const key = JSON.stringify(tasks);
    // Keep the object while its waits are unchanged, so rows keyed on it do not re-render.
    const cached = overlaid.get(thread);
    changed = true;
    if (cached?.key === key) return cached.thread;
    const next = {
      ...thread,
      pendingBackgroundTasks: [...(thread.pendingBackgroundTasks ?? []), ...tasks],
    };
    overlaid.set(thread, { key, thread: next });
    return next;
  });
  return changed ? { ...snapshot, threads } : snapshot;
}

/** Stop on background work also ends external waits, which the provider's interrupt cannot reach. */
export function withExternalWaitStop<
  Target,
  Stopped extends { readonly _tag: string },
  Interrupted,
>(
  tasks: ReadonlyArray<Pick<OrchestrationV2PendingBackgroundTask, "taskId">>,
  stopWaits: (target: Target) => Promise<Stopped>,
  interrupt: (target: Target) => Promise<Interrupted>,
): (target: Target) => Promise<Stopped | Interrupted> {
  return async (target) => {
    if (!tasks.some(isExternalWaitTask)) return interrupt(target);
    if (tasks.every(isExternalWaitTask)) return stopWaits(target);
    const [stopped, interrupted] = await Promise.all([stopWaits(target), interrupt(target)]);
    return stopped._tag === "Failure" ? stopped : interrupted;
  };
}

export function createExternalWaitAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const live = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:external-waits:live",
    tag: EXTERNAL_WAIT_WS_METHODS.subscribe,
  });
  // Servers without external waits fail the subscription; their threads simply show none.
  const waitsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      Option.match(AsyncResult.value(get(live({ environmentId, input: {} }))), {
        onNone: () => NO_WAITS,
        onSome: (list) => list.waits,
      }),
    ).pipe(Atom.withLabel(`external-waits:${environmentId}`)),
  );
  const withExternalWaits = (
    snapshotAtom: (environmentId: EnvironmentId) => Atom.Atom<OrchestrationV2ShellSnapshot | null>,
  ) =>
    Atom.family((environmentId: EnvironmentId) =>
      Atom.make((get) =>
        overlayExternalWaits(get(snapshotAtom(environmentId)), get(waitsAtom(environmentId))),
      ).pipe(Atom.withLabel(`external-waits:snapshot:${environmentId}`)),
    );
  const stop = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:external-waits:stop",
    tag: EXTERNAL_WAIT_WS_METHODS.stop,
  });
  return { waitsAtom, withExternalWaits, stop };
}
