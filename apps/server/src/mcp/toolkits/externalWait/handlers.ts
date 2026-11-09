import * as Effect from "effect/Effect";

import * as ExternalWaits from "../../../externalWaits/ExternalWaits.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ExternalWaitToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(ExternalWaitToolkit, {
  t3_external_wait: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) => ExternalWaits.ExternalWaits.pipe(Effect.flatMap((waits) => waits.report(input))),
  ),
});
