import { useAtomValue } from "@effect/atom-react";
import { externalWaitTasks } from "@t3tools/client-runtime/state/external-waits";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { externalWaits } from "../../state/threads";

/** External waits on this thread, as the background tasks the timeline row shows. */
export function useExternalWaitTasks(environmentId: EnvironmentId, threadId: ThreadId) {
  return externalWaitTasks(useAtomValue(externalWaits.waitsAtom(environmentId)), threadId);
}
