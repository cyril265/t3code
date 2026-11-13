import {
  ChangeWorkingDirectoryMcpInput,
  ChangeWorkingDirectoryMcpResult,
  WorktreeMcpFailure,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  VcsListRefsInput,
  VcsListRefsResult,
  WorktreeMcpHandoffInput,
  WorktreeMcpHandoffResult,
  WorktreeMcpStatusResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as WorktreeMcpService from "../../WorktreeMcpService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  WorktreeMcpService.WorktreeMcpService,
];

const WorktreeToolFailure = Schema.Union([WorktreeMcpFailure, OrchestratorMcpFailure]);

const ChangeWorkingDirectoryTool = Tool.make("t3_change_working_directory", {
  description:
    "Change THIS thread's working directory to any existing directory, Git or not, keeping this conversation. Relative paths use the current directory; ~ is home; path null restores the project directory. Call last and end your turn; the next turn runs there. `continuationPrompt` resumes automatically; omitted, the thread waits. Files stay in place.",

  parameters: ChangeWorkingDirectoryMcpInput,
  success: ChangeWorkingDirectoryMcpResult,
  failure: WorktreeToolFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Change working directory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const WorktreeHandoffTool = Tool.make("t3_worktree_handoff", {
  description:
    "Create a git worktree on a new branch and move THIS thread into it, keeping this conversation. Works from any directory. Runs setup by default. Call last and end your turn; the next turn runs there. `continuationPrompt` resumes automatically; omitted, the thread waits. The worktree stays after the thread is deleted. A separate agent: `t3_thread_launch` with `workspaceStrategy`.",

  parameters: WorktreeMcpHandoffInput,
  success: WorktreeMcpHandoffResult,
  failure: WorktreeToolFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Hand off thread to a git worktree")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const WorktreeStatusTool = Tool.make("t3_worktree_status", {
  description:
    "Report this thread's worktree: attached or not, path, branch, project root, and the `startFromOrigin` default. Check before `t3_worktree_handoff`.",
  // No `parameters`: Tool.make defaults to Tool.EmptyParams, which serializes
  // to a top-level `type: "object"` JSON Schema. An explicit empty
  // Schema.Struct({}) serializes to `anyOf: [object, array]`, which is not a
  // valid MCP tool input schema and makes clients reject the whole server.
  success: WorktreeMcpStatusResult,
  failure: WorktreeToolFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get thread worktree status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const WorktreeListTool = Tool.make("t3_worktree_list", {
  description:
    "List branch refs and checkout paths for a thread's workspace. Omit `threadId` for this thread. Detached worktrees with no branch are left out.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(ThreadId),
    query: VcsListRefsInput.fields.query,
    cursor: VcsListRefsInput.fields.cursor,
    limit: VcsListRefsInput.fields.limit,
    refKind: VcsListRefsInput.fields.refKind,
    includeMatchingRemoteRefs: VcsListRefsInput.fields.includeMatchingRemoteRefs,
  }),
  success: VcsListRefsResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    WorktreeMcpService.WorktreeMcpService,
  ],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
export const WorktreeToolkit = Toolkit.make(
  ChangeWorkingDirectoryTool,
  WorktreeHandoffTool,
  WorktreeStatusTool,
  WorktreeListTool,
);
