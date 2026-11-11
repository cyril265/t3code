#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Schema from "effect/Schema";

import { fromYaml } from "@t3tools/shared/schemaYaml";
import rootPackageJson from "../package.json" with { type: "json" };
import serverPackageJson from "../apps/server/package.json" with { type: "json" };

import { createStagePatchedDependencies, createStageWorkspaceConfig } from "./build-desktop-artifact.ts";
import { selectCliRuntimeExternalDependencies } from "./lib/cli-external-packages.ts";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

const WorkspaceConfig = Schema.Struct({
  catalog: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  patchedDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  allowBuilds: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
});

const stageDir = process.argv[2];
if (!stageDir) throw new Error("Usage: stage-android-server.ts <stage-dir>");

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const serverDist = NodePath.join(repoRoot, "apps/server/dist");
if (!NodeFS.existsSync(NodePath.join(serverDist, "bin.mjs"))) {
  throw new Error("Run `vp run --filter t3 build` first.");
}

const workspace = Schema.decodeUnknownSync(fromYaml(WorkspaceConfig))(
  NodeFS.readFileSync(NodePath.join(repoRoot, "pnpm-workspace.yaml"), "utf8"),
);
const catalog = workspace.catalog ?? {};
const serverDependencies = resolveCatalogDependencies(
  serverPackageJson.dependencies,
  catalog,
  "apps/server",
);
const dependencies = {
  ...selectCliRuntimeExternalDependencies(serverDependencies),
  "@ff-labs/fff-bin-android-arm64": serverDependencies["@ff-labs/fff-node"],
};
const patchedDependencies = createStagePatchedDependencies(
  workspace.patchedDependencies ?? {},
  dependencies,
);
const stageWorkspace = {
  ...createStageWorkspaceConfig({
    platform: "linux",
    arch: "arm64",
    ...(workspace.allowBuilds ? { allowBuilds: workspace.allowBuilds } : {}),
    patchedDependencies,
    overrides: resolveCatalogDependencies(workspace.overrides ?? {}, catalog, "apps/server"),
  }),
  supportedArchitectures: { os: ["android"], cpu: ["arm64"] },
  nodeLinker: "hoisted",
};

NodeFS.rmSync(stageDir, { recursive: true, force: true });
NodeFS.mkdirSync(NodePath.join(stageDir, "bin"), { recursive: true });
NodeFS.cpSync(serverDist, NodePath.join(stageDir, "dist"), { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(stageDir, "package.json"),
  `${JSON.stringify(
    {
      name: "t3-runtime",
      private: true,
      packageManager: rootPackageJson.packageManager,
      dependencies,
    },
    null,
    2,
  )}\n`,
);
NodeFS.writeFileSync(
  NodePath.join(stageDir, "pnpm-workspace.yaml"),
  `${JSON.stringify(stageWorkspace, null, 2)}\n`,
);
for (const patch of Object.values(patchedDependencies)) {
  NodeFS.cpSync(NodePath.join(repoRoot, patch), NodePath.join(stageDir, patch));
}
NodeFS.writeFileSync(
  NodePath.join(stageDir, "bin/t3"),
  [
    "#!/data/data/com.termux/files/usr/bin/sh",
    'root="$(dirname "$(dirname "$(readlink -f "$0")")")"',
    'export LD_PRELOAD="$root/lib/libt3-clear-cache.so${LD_PRELOAD:+:$LD_PRELOAD}"',
    'exec node "$root/dist/bin.mjs" "$@"',
    "",
  ].join("\n"),
  { mode: 0o755 },
);
