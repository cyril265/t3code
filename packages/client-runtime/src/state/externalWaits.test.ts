import { RunId, ThreadId, type ExternalWait } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { overlayExternalWaits, withExternalWaitStop } from "./externalWaits.ts";
import { v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const idle = { ...v2ThreadShell, id: ThreadId.make("idle"), activeRunId: null };
const running = { ...v2ThreadShell, id: ThreadId.make("running"), activeRunId: RunId.make("run") };
const other = { ...v2ThreadShell, id: ThreadId.make("other"), activeRunId: null };
const snapshot = { ...v2ShellSnapshot, threads: [idle, running, other] };
const wait = (threadId: ThreadId, detail?: string): ExternalWait => ({
  threadId,
  waitId: `build-${threadId}`,
  label: "build",
  ...(detail === undefined ? {} : { detail }),
});

describe("overlayExternalWaits", () => {
  it("adds a wait to its idle thread's background work, and leaves running and other threads alone", () => {
    const overlaid = overlayExternalWaits(snapshot, [
      wait(idle.id, "in_progress"),
      wait(running.id),
    ])!;
    const [withWait, stillRunning, untouched] = overlaid.threads;

    const [task, ...rest] = withWait!.pendingBackgroundTasks ?? [];
    expect(rest).toEqual([]);
    expect(task).toMatchObject({ taskId: "external-wait:build-idle", kind: "background_task" });
    expect(task!.description).toContain("build");
    expect(task!.description).toContain("in_progress");
    expect(stillRunning).toBe(running);
    expect(untouched).toBe(other);
  });

  it("keeps the snapshot and thread objects while nothing changed", () => {
    expect(overlayExternalWaits(snapshot, [])).toBe(snapshot);
    const waits = [wait(idle.id, "queued")];
    const first = overlayExternalWaits(snapshot, waits)!;
    expect(overlayExternalWaits(snapshot, [wait(idle.id, "queued")])!.threads[0]).toBe(
      first.threads[0],
    );
    const changed = overlayExternalWaits(snapshot, [wait(idle.id, "running")])!.threads[0]!;
    expect(changed.pendingBackgroundTasks?.[0]?.description).toContain("running");
    expect(first.threads[0]!.pendingBackgroundTasks?.[0]?.description).toContain("queued");
  });
});

describe("withExternalWaitStop", () => {
  const external = { taskId: "external-wait:build" };
  const provider = { taskId: "bash-1" };
  const run = async (tasks: ReadonlyArray<{ readonly taskId: string }>, waitsFail = false) => {
    const calls: Array<string> = [];
    const stop = withExternalWaitStop(
      tasks,
      async () => {
        calls.push("waits");
        return { _tag: waitsFail ? "Failure" : "Success" } as const;
      },
      async () => {
        calls.push("interrupt");
        return { _tag: "Success" } as const;
      },
    );
    return { result: await stop(undefined), calls: calls.toSorted() };
  };

  it("stops external waits through the server and provider work through an interrupt", async () => {
    expect(await run([provider])).toEqual({ result: { _tag: "Success" }, calls: ["interrupt"] });
    expect(await run([external])).toEqual({ result: { _tag: "Success" }, calls: ["waits"] });
    expect(await run([external, provider], true)).toEqual({
      result: { _tag: "Failure" },
      calls: ["interrupt", "waits"],
    });
  });
});
