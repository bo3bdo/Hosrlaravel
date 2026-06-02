import { describe, expect, it } from "vitest";
import { mergeHostsFile } from "../src/core/hosts.js";
import type { Site } from "../src/core/types.js";

const site: Site = {
  name: "App",
  domain: "app.test",
  url: "http://app.test",
  path: "C:\\www\\app",
  documentRoot: "C:\\www\\app\\public",
  secured: false,
  phpVersion: "8.4",
  framework: "Laravel"
};

describe("hosts file management", () => {
  it("adds a managed block without removing existing content", () => {
    const next = mergeHostsFile("127.0.0.1 localhost\n", [site]);
    expect(next).toContain("127.0.0.1 localhost");
    expect(next).toContain("# LARABOXS MANAGED START");
    expect(next).toContain("127.0.0.1 app.test");
  });

  it("replaces only the managed block", () => {
    const current = "before\n# LARABOXS MANAGED START\n127.0.0.1 old.test\n# LARABOXS MANAGED END\nafter\n";
    const next = mergeHostsFile(current, [site]);
    expect(next).toContain("before");
    expect(next).toContain("after");
    expect(next).not.toContain("old.test");
    expect(next).toContain("app.test");
  });
});
