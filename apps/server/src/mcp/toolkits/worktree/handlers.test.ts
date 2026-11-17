import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpToolAccess from "../../McpToolAccess.ts";
import * as WorktreeHandlers from "./handlers.ts";

it.effect("the worktree toolkit registers, so the server starts", () =>
  Layer.build(McpToolAccess.HandlersLayer.layer(WorktreeHandlers.layer)).pipe(
    Effect.asVoid,
    Effect.scoped,
  ),
);
