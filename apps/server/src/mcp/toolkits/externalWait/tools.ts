import {
  EXTERNAL_WAIT_TOOL_NAME,
  ExternalWaitReportInput,
  ExternalWaitReportResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as ExternalWaits from "../../../externalWaits/ExternalWaits.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const ExternalWaitTool = Tool.make(EXTERNAL_WAIT_TOOL_NAME, {
  description:
    "For wait scripts like t3-wait, not agents. Report every 30s; finished:true removes it.",
  parameters: ExternalWaitReportInput,
  success: ExternalWaitReportResult,
  failure: OrchestratorMcpFailure,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ExternalWaits.ExternalWaits,
  ],
})
  .annotate(Tool.Title, "Report external wait")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ExternalWaitToolkit = Toolkit.make(ExternalWaitTool);
