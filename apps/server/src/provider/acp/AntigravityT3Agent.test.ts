import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";

import { antigravityT3McpServer, syncAntigravityT3Agent } from "./AntigravityT3Agent.ts";

const selfInvocation = { command: "/opt/t3/node", entrypoint: "/opt/t3/bin.mjs" };

const makeProfile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profileDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-agent-" });
  const configDirectory = path.join(profileDirectory, "config");
  yield* fs.makeDirectory(configDirectory, { recursive: true });
  return { fs, path, profileDirectory, configDirectory };
});

it.layer(NodeServices.layer)("syncAntigravityT3Agent", (it) => {
  it.effect("adds T3's server and agent beside the user's servers and settings", () =>
    Effect.gen(function* () {
      const { fs, path, profileDirectory, configDirectory } = yield* makeProfile;
      const mcpConfigPath = path.join(configDirectory, "mcp_config.json");
      yield* fs.writeFileString(
        mcpConfigPath,
        '{"mcpServers":{"mine":{"command":"mine"}},"extra":true}',
      );

      expect(yield* syncAntigravityT3Agent({ profileDirectory, selfInvocation })).toBe(true);
      expect(JSON.parse(yield* fs.readFileString(mcpConfigPath))).toEqual({
        extra: true,
        mcpServers: {
          mine: { command: "mine" },
          "t3-code": antigravityT3McpServer(selfInvocation),
        },
      });
      expect(antigravityT3McpServer(selfInvocation)).toMatchObject({
        command: "/opt/t3/node",
        args: ["/opt/t3/bin.mjs", "acp-mcp-bridge"],
        tools: {
          orchestrator_capabilities: { eager: true },
          delegate_task: { eager: true },
          task_status: { eager: true },
        },
      });
      const agent = yield* fs.readFileString(path.join(configDirectory, "agents", "t3-code.md"));
      expect(agent).toMatch(/^---\nname: t3-code\n[\s\S]*inheritMcp: true\n[\s\S]*\n---\n/);
      expect((yield* fs.readDirectory(configDirectory)).toSorted()).toEqual([
        "agents",
        "mcp_config.json",
      ]);
    }),
  );

  it.effect.each([
    {
      name: "someone else's t3-code server",
      file: "mcp_config.json",
      text: '{"mcpServers":{"t3-code":{"command":"theirs"}}}',
    },
    {
      name: "someone else's t3-code agent",
      file: "agents/t3-code.md",
      text: "---\nname: t3-code\n---\nTheirs.\n",
    },
  ])("keeps $name and the old path", ({ file, text }) =>
    Effect.gen(function* () {
      const { fs, path, profileDirectory, configDirectory } = yield* makeProfile;
      const target = path.join(configDirectory, file);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFileString(target, text);

      expect(yield* syncAntigravityT3Agent({ profileDirectory, selfInvocation })).toBe(false);
      expect(yield* fs.readFileString(target)).toBe(text);
    }),
  );

  it.effect.each([
    { name: "invalid JSON", text: '{"mcpServers":{"mine":' },
    { name: "a list of servers", text: '{"mcpServers":[]}' },
    { name: "servers set to false", text: '{"mcpServers":false}' },
  ])("leaves a config with $name byte for byte and keeps the old path", ({ text }) =>
    Effect.gen(function* () {
      const { fs, path, profileDirectory, configDirectory } = yield* makeProfile;
      const mcpConfigPath = path.join(configDirectory, "mcp_config.json");
      yield* fs.writeFileString(mcpConfigPath, text);

      expect(yield* syncAntigravityT3Agent({ profileDirectory, selfInvocation })).toBe(false);
      expect(yield* fs.readFileString(mcpConfigPath)).toBe(text);
    }),
  );
});
