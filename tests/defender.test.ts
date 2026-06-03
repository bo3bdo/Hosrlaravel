import { describe, expect, it } from "vitest";
import { isPathCoveredByExclusion, renderDefenderExclusionScript } from "../src/core/defender.js";

describe("Windows Defender exclusion helpers", () => {
  it("treats exact paths and child folders as covered", () => {
    expect(isPathCoveredByExclusion("C:\\Sites", "C:\\Sites")).toBe(true);
    expect(isPathCoveredByExclusion("C:\\Sites\\App", "C:\\Sites")).toBe(true);
    expect(isPathCoveredByExclusion("C:\\Sites\\Nested\\App", "C:\\Sites\\")).toBe(true);
  });

  it("does not treat sibling folders as covered", () => {
    expect(isPathCoveredByExclusion("C:\\Sites2\\App", "C:\\Sites")).toBe(false);
    expect(isPathCoveredByExclusion("C:\\Sites\\App2", "C:\\Sites\\App")).toBe(false);
  });

  it("renders an elevated script with escaped paths", () => {
    const script = renderDefenderExclusionScript("C:\\Sites\\Bob's App");

    expect(script).toContain("Add-MpPreference -ExclusionPath $target");
    expect(script).toContain("C:\\Sites\\Bob''s App");
  });
});
