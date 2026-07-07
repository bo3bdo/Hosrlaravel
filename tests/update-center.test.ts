import { describe, expect, it } from "vitest";

describe("update center application version", () => {
  it("reads the current version from package.json", async () => {
    const { getApplicationUpdateStatus } = await import("../src/core/updateCenter.js");
    const status = await getApplicationUpdateStatus();
    expect(status.currentVersion).toBe("0.1.27");
    expect(status.status).toBe("unavailable");
  });
});
