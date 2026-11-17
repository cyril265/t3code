const CADENCE = new Map([
  ["session", "5h"],
  ["5-hour", "5h"],
  ["weekly", "7d"],
  ["monthly", "30d"],
]);

/**
 * "Weekly" reads 7d. A scope with one window drops its cadence ("Weekly · Fable" reads fable);
 * a scope with several leads with it ("Go · Weekly" reads 7d go), so truncation keeps it visible.
 * Other names stay, lowercased.
 */
export function shortLimitLabels(labels: readonly string[]): string[] {
  const parsed = labels.map((label) => {
    const parts = label.split(" · ");
    return {
      scope: parts
        .filter((part) => !CADENCE.has(part.toLowerCase()))
        .join(" · ")
        .toLowerCase(),
      cadence: parts.map((part) => CADENCE.get(part.toLowerCase())).find(Boolean) ?? null,
    };
  });
  return parsed.map(({ scope, cadence }) => {
    if (cadence === null) return scope;
    if (scope === "") return cadence;
    return parsed.filter((other) => other.scope === scope).length > 1
      ? `${cadence} ${scope}`
      : scope;
  });
}
