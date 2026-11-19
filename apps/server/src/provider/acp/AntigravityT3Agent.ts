import { selfInvocationArgs, type SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export const ANTIGRAVITY_T3_AGENT = "t3-code";
export const ANTIGRAVITY_T3_MCP_SERVER = "t3-code";

/**
 * Core orchestration tools loaded eagerly; every other T3 tool is listed by name and read on demand.
 */
const EAGER_T3_TOOLS = ["orchestrator_capabilities", "delegate_task", "task_status"] as const;

/** Sessions of a process that runs T3's agent send no MCP servers; agy would load them eagerly. */
export const WITHOUT_SESSION_MCP_SERVERS = {
  mcpServers: [],
  acpMcpServers: [],
  httpMcpServers: [],
} as const;

const T3_AGENT_DESCRIPTION =
  "description: Antigravity in T3 Code with core tools; T3 Code tools load on demand.";

const T3_AGENT_FILE = `---
name: ${ANTIGRAVITY_T3_AGENT}
${T3_AGENT_DESCRIPTION}
mainAgent: true
subagent: false
inheritCustomizations: true
inheritMcp: true
tools:
  - read_file
  - write_file
  - edit_file
  - run_command
  - manage_task
  - search_web
  - ask_question
  - generate_image
---
You are a coding agent. Work in the user's workspace and use your tools to complete their requests.
`;

const McpServers = Schema.Record(Schema.String, Schema.Unknown);
const McpConfig = Schema.StructWithRest(
  Schema.Struct({ mcpServers: Schema.optional(McpServers) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
const McpConfigJson = Schema.fromJsonString(McpConfig);
const decodeMcpConfig = Schema.decodeEffect(McpConfigJson);
const encodeMcpConfig = Schema.encodeSync(McpConfigJson);

const isT3BridgeEntry = (entry: unknown) =>
  Predicate.isObject(entry) && Array.isArray(entry.args) && entry.args.at(-1) === "acp-mcp-bridge";

/** The profile's entry for T3's server; helpers may run beside exactly this entry. */
export const antigravityT3McpServer = (self: SelfInvocation) => ({
  command: self.command,
  args: [...selfInvocationArgs(self, ["acp-mcp-bridge"])],
  // The bridge reads T3_ACP_MCP_ENDPOINT and T3_ACP_MCP_AUTHORIZATION from the agy process.
  env: { ELECTRON_RUN_AS_NODE: "1" },
  tools: Object.fromEntries(EAGER_T3_TOOLS.map((tool) => [tool, { eager: true }])),
});

const writeIfChanged = Effect.fn("AntigravityT3Agent.writeIfChanged")(function* (
  target: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const current = yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => undefined));
  if (current === content) return;
  // Every session's agy reads these files at startup; never let one see a partial write.
  const directory = yield* fs.makeTempDirectoryScoped({
    directory: path.dirname(target),
    prefix: `.${path.basename(target)}-`,
  });
  const temporary = path.join(directory, path.basename(target));
  yield* fs.writeFileString(temporary, content);
  yield* fs.rename(temporary, target);
}, Effect.scoped);

/**
 * One shared entry serves every thread; each agy process carries its thread's MCP credentials.
 * Older runtimes may keep it: without credentials the bridge exits, and agy serves the same-named
 * server T3 sends with the session. A config T3 cannot read or parse is left untouched.
 */
export const syncAntigravityT3Agent = Effect.fn("syncAntigravityT3Agent")(
  function* (input: {
    readonly profileDirectory: string;
    readonly selfInvocation: SelfInvocation;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configDirectory = path.join(input.profileDirectory, "config");
    const mcpConfigPath = path.join(configDirectory, "mcp_config.json");
    const text = (yield* fs.exists(mcpConfigPath)) ? yield* fs.readFileString(mcpConfigPath) : "";
    // CLI 1.5.8 writes an empty file before any server exists.
    const config = text.trim().length === 0 ? {} : yield* decodeMcpConfig(text);
    const agentPath = path.join(configDirectory, "agents", `${ANTIGRAVITY_T3_AGENT}.md`);
    const agent = (yield* fs.exists(agentPath)) ? yield* fs.readFileString(agentPath) : undefined;
    const server = config.mcpServers?.[ANTIGRAVITY_T3_MCP_SERVER];
    // Someone else's server or agent under T3's names stays, and sessions keep the old path.
    if (
      (agent !== undefined && !agent.includes(T3_AGENT_DESCRIPTION)) ||
      (server !== undefined && !isT3BridgeEntry(server))
    ) {
      return false;
    }
    yield* fs.makeDirectory(path.join(configDirectory, "agents"), { recursive: true });
    yield* writeIfChanged(
      mcpConfigPath,
      `${encodeMcpConfig({
        ...config,
        mcpServers: {
          ...config.mcpServers,
          [ANTIGRAVITY_T3_MCP_SERVER]: antigravityT3McpServer(input.selfInvocation),
        },
      })}\n`,
    );
    yield* writeIfChanged(agentPath, T3_AGENT_FILE);
    return true;
  },
  // Sessions then fall back to sending T3's server with every session, as before.
  Effect.catch((cause) =>
    Effect.logWarning("Could not configure T3 Code tools in the Antigravity profile.", {
      cause,
    }).pipe(Effect.as(false)),
  ),
);
