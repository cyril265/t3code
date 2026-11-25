#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { fromYaml } from "@t3tools/shared/schemaYaml";
import rootPackageJson from "../package.json" with { type: "json" };
import serverPackageJson from "../apps/server/package.json" with { type: "json" };

import {
  createStagePatchedDependencies,
  createStageWorkspaceConfig,
} from "./build-desktop-artifact.ts";
import { selectCliRuntimeExternalDependencies } from "./lib/cli-external-packages.ts";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

const WorkspaceConfig = Schema.Struct({
  catalog: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  patchedDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

const stageAndroidServer = Effect.fn("stageAndroidServer")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stageDir = process.argv[2];
  if (!stageDir) throw new Error("Usage: stage-android-server.ts <stage-dir>");

  const repoRoot = path.resolve(import.meta.dirname, "..");
  const serverDist = path.join(repoRoot, "apps/server/dist");
  if (!(yield* fileSystem.exists(path.join(serverDist, "bin.mjs")))) {
    throw new Error("Run `vp run --filter t3 build` first.");
  }

  const workspace = yield* Schema.decodeEffect(fromYaml(WorkspaceConfig))(
    yield* fileSystem.readFileString(path.join(repoRoot, "pnpm-workspace.yaml")),
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
      patchedDependencies,
      overrides: resolveCatalogDependencies(workspace.overrides ?? {}, catalog, "apps/server"),
    }),
    supportedArchitectures: { os: ["android"], cpu: ["arm64"] },
    nodeLinker: "hoisted",
  };

  yield* fileSystem.remove(stageDir, { recursive: true, force: true });
  yield* fileSystem.makeDirectory(path.join(stageDir, "bin"), { recursive: true });
  yield* fileSystem.makeDirectory(path.join(stageDir, "lib"), { recursive: true });
  yield* fileSystem.copyFile(
    path.join(repoRoot, "scripts/android-compat.c"),
    path.join(stageDir, "lib/android-compat.c"),
  );
  yield* fileSystem.copy(serverDist, path.join(stageDir, "dist"));
  const packageJson = yield* encodeJson({
    name: "t3-runtime",
    private: true,
    packageManager: rootPackageJson.packageManager,
    dependencies,
  });
  yield* fileSystem.writeFileString(path.join(stageDir, "package.json"), `${packageJson}\n`);
  const workspaceYaml = yield* encodeJson(stageWorkspace);
  yield* fileSystem.writeFileString(
    path.join(stageDir, "pnpm-workspace.yaml"),
    `${workspaceYaml}\n`,
  );
  for (const patch of Object.values(patchedDependencies)) {
    yield* fileSystem.copy(path.join(repoRoot, patch), path.join(stageDir, patch));
  }
  yield* fileSystem.writeFileString(
    path.join(stageDir, "bin/t3"),
    [
      "#!/data/data/com.termux/files/usr/bin/sh",
      'root="$(dirname "$(dirname "$(readlink -f "$0")")")"',
      'export LD_PRELOAD="$root/lib/libt3-android-compat.so${LD_PRELOAD:+:$LD_PRELOAD}"',
      'exec node "$root/dist/bin.mjs" "$@"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

stageAndroidServer().pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
