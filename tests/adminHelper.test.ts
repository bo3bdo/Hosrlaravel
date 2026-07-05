import { describe, expect, it } from "vitest";
import { isAdminHelperAvailable } from "../src/core/adminHelper.js";

describe("admin helper client", () => {
  it("reports unavailable when no token exists and skipping is not set", async () => {
    // In the test environment LARABOXS_HOME points to a temp dir without a token file,
    // and no admin helper is listening on 47890, so availability must resolve to false.
    const available = await isAdminHelperAvailable();
    expect(available).toBe(false);
  });

  it("reports unavailable when explicitly skipped via env", async () => {
    const previous = process.env.LARABOXS_SKIP_ADMIN_HELPER;
    process.env.LARABOXS_SKIP_ADMIN_HELPER = "1";
    try {
      expect(await isAdminHelperAvailable()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.LARABOXS_SKIP_ADMIN_HELPER;
      } else {
        process.env.LARABOXS_SKIP_ADMIN_HELPER = previous;
      }
    }
  });
});
