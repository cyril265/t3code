import {
  type ChangeWorkingDirectoryMcpInput,
  type ChangeWorkingDirectoryMcpResult,
  CommandId,
  type GitCommandError,
  MessageId,
  type ProjectId,
  WorktreeMcpFailure,
  type WorktreeMcpContinuationStatus,
  type WorktreeMcpHandoffInput,
  type WorktreeMcpHandoffResult,
  type WorktreeMcpSetupScriptStatus,
  type WorktreeMcpStatusResult,
  type VcsListRefsInput,
  type VcsListRefsResult,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import type { McpInvocationScope, McpThreadInvocationScope } from "./McpInvocationContext.ts";

export class WorktreeMcpService extends Context.Service<
  WorktreeMcpService,
  {
    readonly changeWorkingDirectory: (
      scope: McpInvocationScope,
      input: ChangeWorkingDirectoryMcpInput,
    ) => Effect.Effect<ChangeWorkingDirectoryMcpResult, WorktreeMcpFailure>;
    readonly handoff: (
      scope: McpInvocationScope,
      input: WorktreeMcpHandoffInput,
    ) => Effect.Effect<WorktreeMcpHandoffResult, WorktreeMcpFailure>;
    readonly status: (
      scope: McpInvocationScope,
    ) => Effect.Effect<WorktreeMcpStatusResult, WorktreeMcpFailure>;
    readonly listRefs: (
      input: Omit<VcsListRefsInput, "cwd"> & {
        readonly worktreePath: string | null;
        readonly workspaceRoot: string;
      },
    ) => Effect.Effect<VcsListRefsResult, GitCommandError | PlatformError.PlatformError>;
  }
>()("t3/mcp/WorktreeMcpService") {}

function failure(code: WorktreeMcpFailure["code"], message: string): WorktreeMcpFailure {
  return new WorktreeMcpFailure({ code, message });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

const asOperationFailed = (prefix: string) =>
  Effect.mapError((error: unknown) =>
    failure("operation_failed", `${prefix}: ${errorMessage(error)}`),
  );

const make = Effect.gen(function* () {
  const random = yield* SecureRandom.SecureRandom;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const setupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;

  // Serialize handoffs per thread to avoid creating two worktrees and orphaning one.
  const handoffThreadsInFlight = new Set<string>();

  const requireThreadScope = (scope: McpInvocationScope) =>
    scope.thread === undefined
      ? Effect.fail(
          failure(
            "thread_credential_required",
            "Worktree and directory tools act as the calling T3 thread, so they need an agent running inside T3 Code.",
          ),
        )
      : Effect.succeed(scope as McpThreadInvocationScope);

  const requireCapability = (scope: McpInvocationScope) =>
    scope.capabilities.has("worktree")
      ? Effect.void
      : Effect.fail(
          failure("capability_denied", "This MCP credential does not grant worktree capabilities."),
        );

  const loadThread = (scope: McpThreadInvocationScope) =>
    threadManagement.getThreadRecords(scope.thread.threadId, []).pipe(
      Effect.mapError((error) =>
        error._tag === "OrchestratorProjectionError"
          ? failure("thread_not_found", `Thread '${scope.thread.threadId}' was not found.`)
          : failure(
              "operation_failed",
              `Unable to read thread ${scope.thread.threadId}: ${errorMessage(error)}`,
            ),
      ),
      Effect.filterOrFail(
        (projection) => projection.thread.deletedAt === null,
        () => failure("thread_not_found", `Thread '${scope.thread.threadId}' was not found.`),
      ),
    );

  const loadProject = (scope: McpThreadInvocationScope, projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      asOperationFailed(`Unable to read project ${projectId}`),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              failure(
                "project_not_found",
                `Project '${projectId}' was not found for thread '${scope.thread.threadId}'.`,
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const readDefaultStartFromOrigin = (projectId: ProjectId) =>
    serverSettings.getSettings.pipe(
      Effect.map(
        (settings) =>
          resolveProjectSettings(settings, projectId).settings.newWorktreesStartFromOrigin,
      ),
      asOperationFailed("Unable to read server settings"),
    );

  const handoffIds = (scope: McpThreadInvocationScope) =>
    random.uuidV4().pipe(
      Effect.map((uuid) => {
        const part = (kind: string, operation: string) =>
          [kind, "mcp", encodeURIComponent(scope.thread.providerSessionId), operation, uuid].join(
            ":",
          );
        return {
          commandId: CommandId.make(part("command", "worktree-handoff")),
          continuationCommandId: CommandId.make(part("command", "worktree-continuation")),
          continuationMessageId: MessageId.make(part("message", "worktree-continuation")),
        };
      }),
      Effect.orDie,
    );

  const performHandoff = Effect.fn("WorktreeMcpService.performHandoff")(function* (
    scope: McpThreadInvocationScope,
    input: WorktreeMcpHandoffInput,
  ) {
    const projection = yield* loadThread(scope);
    if (projection.thread.archivedAt !== null) {
      return yield* failure(
        "invalid_request",
        `Thread '${scope.thread.threadId}' is archived and cannot be handed off to a worktree.`,
      );
    }

    const project = yield* loadProject(scope, projection.thread.projectId);
    const projectCwd = project.workspaceRoot;

    const localStatus = yield* gitWorkflow
      .localStatus({ cwd: projectCwd })
      .pipe(asOperationFailed("Unable to read git status"));
    if (!localStatus.isRepo) {
      return yield* failure(
        "invalid_request",
        `Project workspace '${projectCwd}' is not a git repository.`,
      );
    }

    const localBranchNames = yield* gitWorkflow
      .listLocalBranchNames(projectCwd)
      .pipe(asOperationFailed("Unable to list branches"));
    if (localBranchNames.includes(input.branch)) {
      const existingRef = yield* gitWorkflow
        .listRefs({ cwd: projectCwd, query: input.branch, refKind: "local" })
        .pipe(
          Effect.map((result) =>
            result.refs.find((ref) => ref.name === input.branch && ref.isRemote !== true),
          ),
          Effect.orElseSucceed(() => undefined),
        );
      const checkoutPath = existingRef?.worktreePath ?? null;
      return yield* failure(
        "invalid_request",
        `Branch '${input.branch}' already exists${
          checkoutPath === null ? "" : ` and is checked out at '${checkoutPath}'`
        }. Choose a different branch name, or delete the existing branch${
          checkoutPath === null ? "" : " and its worktree"
        } first.`,
      );
    }

    let baseRef = input.baseRef;
    if (baseRef === undefined) {
      if (localStatus.refName === null) {
        return yield* failure(
          "invalid_request",
          "Could not determine the current branch of the project workspace (detached HEAD?). Pass baseRef explicitly.",
        );
      }
      baseRef = localStatus.refName;
    }

    const startFromOrigin =
      input.startFromOrigin ?? (yield* readDefaultStartFromOrigin(project.id));

    let worktreeBaseRef = baseRef;
    let baseRefName = baseRef;
    let startedFromOrigin = false;
    if (startFromOrigin) {
      const resolvedRemoteBase = yield* gitWorkflow
        .fetchWorktreeBaseCommit({ cwd: projectCwd, refName: baseRef })
        .pipe(asOperationFailed(`Unable to fetch the remote base of '${baseRef}'`));
      if (resolvedRemoteBase !== null) {
        worktreeBaseRef = resolvedRemoteBase.commitSha;
        baseRefName = `refs/remotes/${resolvedRemoteBase.remoteRefName}`;
        startedFromOrigin = true;
      }
    }

    const ids = yield* handoffIds(scope);

    // Mask interruption after worktree creation through setup; binding can detach providers without live directory switching.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const worktree = yield* restore(
          gitWorkflow
            .createWorktree({
              cwd: projectCwd,
              refName: worktreeBaseRef,
              newRefName: input.branch,
              baseRefName,
              path: null,
            })
            .pipe(asOperationFailed("Unable to create the worktree")),
        );
        const worktreePath = worktree.worktree.path;

        const reportFailed = (logMessage: string) =>
          Effect.catchCause((cause: Cause.Cause<unknown>) => {
            const detail = errorMessage(Cause.squash(cause));
            return Effect.logWarning(logMessage, {
              threadId: scope.thread.threadId,
              worktreePath,
              detail,
            }).pipe(Effect.as({ status: "failed", detail } as const));
          });

        const removeCreatedWorktree = Effect.suspend(() =>
          gitWorkflow.removeWorktree({ cwd: projectCwd, path: worktreePath, force: true }).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                gitWorkflow.deleteLocalBranch({
                  cwd: projectCwd,
                  refName: worktree.worktree.refName,
                  force: true,
                }),
              ),
            ),
          ),
        ).pipe(Effect.ignoreCause({ log: true }));

        const recheckAndBind = Effect.gen(function* () {
          // A concurrent directory change may have landed during git work; do not orphan the new worktree.
          const recheck = yield* loadThread(scope);
          if (recheck.thread.worktreePath !== projection.thread.worktreePath) {
            return yield* failure(
              "invalid_request",
              `Thread '${scope.thread.threadId}' changed directories while the worktree was being created; the handoff was rolled back.`,
            );
          }
          if (recheck.thread.archivedAt !== null) {
            return yield* failure(
              "invalid_request",
              `Thread '${scope.thread.threadId}' was archived while the worktree was being created; the handoff was rolled back.`,
            );
          }
          yield* threadManagement
            .dispatch({
              type: "thread.metadata.update",
              commandId: ids.commandId,
              threadId: scope.thread.threadId,
              branch: worktree.worktree.refName,
              worktreePath,
              expectedWorktreePath: projection.thread.worktreePath,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause as Cause.Cause<never>)
                  : Effect.fail(
                      failure(
                        "operation_failed",
                        `Unable to re-point the thread at the worktree: ${errorMessage(Cause.squash(cause))}`,
                      ),
                    ),
              ),
            );
        }).pipe(
          // Do not remove on interruption alone; the thread binding may already have committed.
          Effect.onError((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : removeCreatedWorktree,
          ),
        );

        // Queue continuation immediately after binding; a detaching provider terminates the caller, so relaunch needs a durable message.
        const queueContinuation: Effect.Effect<WorktreeMcpContinuationStatus, WorktreeMcpFailure> =
          Effect.suspend(() =>
            input.continuationPrompt === undefined
              ? Effect.succeed<WorktreeMcpContinuationStatus>({ status: "skipped" })
              : threadManagement
                  .sendToThread({
                    projectId: projection.thread.projectId,
                    commandId: ids.continuationCommandId,
                    threadId: scope.thread.threadId,
                    messageId: ids.continuationMessageId,
                    text: input.continuationPrompt,
                    attachments: [],
                    mode: "queue",
                    createdBy: "agent",
                    creationSource: "mcp",
                  })
                  .pipe(
                    Effect.map((sendResult): WorktreeMcpContinuationStatus => ({
                      status: "scheduled",
                      delivery: sendResult.delivery,
                    })),
                    reportFailed("worktree handoff continuation failed to queue"),
                  ),
          );

        const continuation = yield* recheckAndBind.pipe(Effect.andThen(queueContinuation));

        yield* vcsStatusBroadcaster
          .refreshStatus(worktreePath)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);

        let setupScript: WorktreeMcpSetupScriptStatus = { status: "skipped" };
        if (input.runSetupScript ?? true) {
          setupScript = yield* setupScriptRunner
            .runForThread({
              threadId: scope.thread.threadId,
              projectId: projection.thread.projectId,
              projectCwd,
              worktreePath,
              project: {
                id: project.id,
                workspaceRoot: project.workspaceRoot,
                scripts: project.scripts,
              },
            })
            .pipe(
              Effect.map((result): WorktreeMcpSetupScriptStatus =>
                result.status === "started"
                  ? {
                      status: "started",
                      scriptName: result.scriptName,
                      terminalId: result.terminalId,
                    }
                  : result.status === "skipped-for-link"
                    ? { status: "skipped" }
                    : { status: "no-script" },
              ),
              reportFailed("worktree handoff setup script failed"),
            );
        }

        const result: WorktreeMcpHandoffResult = {
          worktreePath,
          branch: worktree.worktree.refName,
          baseRef,
          startedFromOrigin,
          setupScript,
          continuation,
          note:
            continuation.status === "scheduled"
              ? "Worktree recorded. End this turn now; the queued continuation runs in the worktree with the conversation preserved. The worktree stays after this thread is deleted."
              : "Worktree recorded. End this turn now; the next message runs in the worktree with the conversation preserved. The worktree stays after this thread is deleted.",
        };
        return result;
      }),
    );
  });

  const handoff: WorktreeMcpService["Service"]["handoff"] = Effect.fn("WorktreeMcpService.handoff")(
    function* (callerScope, input) {
      yield* requireCapability(callerScope);
      const scope = yield* requireThreadScope(callerScope);
      // Acquire and register cleanup atomically so cancellation cannot strand the guard until restart.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          if (handoffThreadsInFlight.has(scope.thread.threadId)) {
            return Effect.fail(
              failure(
                "handoff_in_progress",
                `A worktree handoff is already in progress for thread '${scope.thread.threadId}'.`,
              ),
            );
          }
          handoffThreadsInFlight.add(scope.thread.threadId);
          return restore(performHandoff(scope, input)).pipe(
            Effect.ensuring(
              Effect.sync(() => handoffThreadsInFlight.delete(scope.thread.threadId)),
            ),
          );
        }),
      );
    },
  );

  const changeWorkingDirectory = Effect.fn("WorktreeMcpService.changeWorkingDirectory")(function* (
    callerScope: McpInvocationScope,
    input: ChangeWorkingDirectoryMcpInput,
  ) {
    yield* requireCapability(callerScope);
    const scope = yield* requireThreadScope(callerScope);
    const projection = yield* loadThread(scope);
    if (projection.thread.archivedAt !== null) {
      return yield* failure("invalid_request", "An archived thread cannot change directories.");
    }
    const project = yield* loadProject(scope, projection.thread.projectId);
    const projectRoot = yield* fileSystem
      .realPath(project.workspaceRoot)
      .pipe(Effect.orElseSucceed(() => path.resolve(project.workspaceRoot)));
    const previousCwd = projection.thread.worktreePath ?? projectRoot;
    const requested =
      input.path === null
        ? projectRoot
        : path.resolve(previousCwd, expandHomePath(input.path, yield* HostProcess.HomeDirectory));
    const cwd = yield* fileSystem
      .realPath(requested)
      .pipe(asOperationFailed("Unable to resolve the working directory"));
    const stat = yield* fileSystem
      .stat(cwd)
      .pipe(asOperationFailed("Unable to read the working directory"));
    if (stat.type !== "Directory") {
      return yield* failure(
        "invalid_request",
        "The working directory must be an existing directory.",
      );
    }
    const branch = yield* gitWorkflow.localStatus({ cwd }).pipe(
      Effect.map((status) => (status.isRepo ? status.refName : null)),
      Effect.orElseSucceed(() => null),
    );
    const ids = yield* handoffIds(scope);
    // Providers without live directory switching detach on binding; still record the continuation.
    const continuation = yield* Effect.uninterruptible(
      threadManagement
        .dispatch({
          type: "thread.metadata.update",
          commandId: ids.commandId,
          threadId: scope.thread.threadId,
          branch,
          // Legacy name: this is the per-thread cwd override that runtimes and clients read.
          worktreePath: cwd === projectRoot ? null : cwd,
          expectedWorktreePath: projection.thread.worktreePath,
        })
        .pipe(
          asOperationFailed("Unable to change the thread directory"),
          Effect.andThen(() =>
            input.continuationPrompt === undefined
              ? Effect.succeed<WorktreeMcpContinuationStatus>({ status: "skipped" })
              : threadManagement
                  .sendToThread({
                    projectId: project.id,
                    commandId: ids.continuationCommandId,
                    threadId: scope.thread.threadId,
                    messageId: ids.continuationMessageId,
                    text: input.continuationPrompt,
                    attachments: [],
                    mode: "queue",
                    createdBy: "agent",
                    creationSource: "mcp",
                  })
                  .pipe(
                    Effect.map((result): WorktreeMcpContinuationStatus => ({
                      status: "scheduled",
                      delivery: result.delivery,
                    })),
                    Effect.catchCause((cause) =>
                      Effect.succeed<WorktreeMcpContinuationStatus>({
                        status: "failed",
                        detail: errorMessage(Cause.squash(cause)),
                      }),
                    ),
                  ),
          ),
        ),
    );
    return {
      cwd,
      previousCwd,
      continuation,
      note: "Working directory recorded. End this turn now; the next turn runs there with the conversation preserved. Files stay in place.",
    } satisfies ChangeWorkingDirectoryMcpResult;
  });

  const status: WorktreeMcpService["Service"]["status"] = Effect.fn("WorktreeMcpService.status")(
    function* (callerScope) {
      yield* requireCapability(callerScope);
      const scope = yield* requireThreadScope(callerScope);
      const projection = yield* loadThread(scope);
      const project = yield* loadProject(scope, projection.thread.projectId);

      const defaultStartFromOrigin = yield* readDefaultStartFromOrigin(project.id);

      const result: WorktreeMcpStatusResult = {
        attached: projection.thread.worktreePath !== null,
        worktreePath: projection.thread.worktreePath,
        branch: projection.thread.branch,
        projectWorkspaceRoot: project.workspaceRoot,
        defaultStartFromOrigin,
      };
      return result;
    },
  );

  const listRefs: WorktreeMcpService["Service"]["listRefs"] = Effect.fn(
    "WorktreeMcpService.listRefs",
  )(function* ({ worktreePath, workspaceRoot, ...refs }) {
    // Storage cleanup removes a worktree but keeps its path on the thread.
    const cwd =
      worktreePath !== null && (yield* fileSystem.exists(worktreePath))
        ? worktreePath
        : workspaceRoot;
    return yield* gitWorkflow.listRefs({ ...refs, cwd });
  });

  return WorktreeMcpService.of({ changeWorkingDirectory, handoff, status, listRefs });
});

export const layer: Layer.Layer<
  WorktreeMcpService,
  never,
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | Path.Path
  | ThreadManagementService.ThreadManagementService
  | ProjectService.ProjectService
  | ServerSettings.ServerSettingsService
  | GitWorkflowService.GitWorkflowService
  | ProjectSetupScriptRunner.ProjectSetupScriptRunner
  | VcsStatusBroadcaster.VcsStatusBroadcaster
> = Layer.effect(WorktreeMcpService, make);
