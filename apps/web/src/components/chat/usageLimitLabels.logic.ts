const CADENCE = new Map([
  ["session", "5h"],
  ["5-hour", "5h"],
  ["weekly", "7d"],
  ["monthly", "30d"],
]);

/**
 * "Weekly" reads 7d. A scope with one window drops its cadence ("Weekly · Fable" reads fable);
 * a scope with several keeps it ("Go · Weekly" reads go 7d). Other names stay, lowercased.
 */
export function shortLimitLabels(labels: readonly string[]): string[] {
  const parsed = labels.map((label) => {
    const parts = label.split(" · ");
    return {
      label,
      scope: parts
        .filter((part) => !CADENCE.has(part.toLowerCase()))
        .join(" · ")
        .toLowerCase(),
      cadence: parts.map((part) => CADENCE.get(part.toLowerCase())).find(Boolean) ?? null,
    };
  });
  return parsed.map(({ label, scope, cadence }) => {
    if (cadence === null) return label.toLowerCase();
    if (scope === "") return cadence;
    return parsed.filter((other) => other.scope === scope).length > 1
      ? `${scope} ${cadence}`
      : scope;
  });
}
