import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { laraboxsHome } from "../src/core/paths.js";

const originalHome = process.env.LARABOXS_HOME;
const originalUserProfile = process.env.USERPROFILE;

describe("laraboxs home path", () => {
  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.LARABOXS_HOME;
    } else {
      process.env.LARABOXS_HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it("uses %USERPROFILE%\\.config\\laraboxs by default on Windows", () => {
    delete process.env.LARABOXS_HOME;
    process.env.USERPROFILE = "C:\\Users\\demo";

    expect(laraboxsHome()).toBe(path.join("C:\\Users\\demo", ".config", "laraboxs"));
  });

  it("prefers an explicit LARABOXS_HOME override", () => {
    process.env.LARABOXS_HOME = "C:\\custom\\laraboxs";
    process.env.USERPROFILE = "C:\\Users\\demo";

    expect(laraboxsHome()).toBe(path.resolve("C:\\custom\\laraboxs"));
  });
});
