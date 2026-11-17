import { describe, expect, it } from "vite-plus/test";
import { shortLimitLabels } from "./usageLimitLabels.logic";

describe("shortLimitLabels", () => {
  it.each([
    ["Claude", ["Session", "Weekly", "Weekly · Fable"], ["5h", "7d", "fable"]],
    ["OpenCode Go", ["Go · Session", "Go · Weekly", "Go · Monthly"], ["5h go", "7d go", "30d go"]],
    [
      "Antigravity",
      ["Gemini · 5-hour", "Claude & GPT (shared) · 5-hour", "Claude & GPT (shared) · Weekly"],
      ["gemini", "5h claude & gpt (shared)", "7d claude & gpt (shared)"],
    ],
    [
      "Cursor",
      ["Overall", "Cursor Models", "Other Models"],
      ["overall", "cursor models", "other models"],
    ],
  ])("keeps %s windows distinct", (_provider, labels, expected) => {
    expect(shortLimitLabels(labels)).toEqual(expected);
  });
});
