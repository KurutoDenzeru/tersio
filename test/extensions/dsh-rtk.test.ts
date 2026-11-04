import { describe, expect, test } from "vitest";
import { interceptBashCall } from "../../extensions/dsh/index.ts";

const rewriteTo = (next: string) => async () => next;

describe("rtk interception", () => {
  test("rewrites a plain bash command when the mode is on", async () => {
    const replaced = await interceptBashCall("bash", { command: "git status" }, true, rewriteTo("rtk git status"));
    expect(replaced).toEqual({ command: "rtk git status" });
  });

  test("keeps every other argument untouched", async () => {
    const replaced = await interceptBashCall("bash", { command: "git status", timeoutMs: 10 }, true, rewriteTo("rtk git status"));
    expect(replaced).toEqual({ command: "rtk git status", timeoutMs: 10 });
  });

  test("does nothing when the mode is off, the tool is not bash, or the command is empty", async () => {
    await expect(interceptBashCall("bash", { command: "git status" }, false, rewriteTo("rtk git status"))).resolves.toBeNull();
    await expect(interceptBashCall("read", { command: "git status" }, true, rewriteTo("rtk git status"))).resolves.toBeNull();
    await expect(interceptBashCall("bash", { command: "  " }, true, rewriteTo("rtk git status"))).resolves.toBeNull();
    await expect(interceptBashCall("bash", {}, true, rewriteTo("rtk git status"))).resolves.toBeNull();
    await expect(interceptBashCall("bash", null, true, rewriteTo("rtk git status"))).resolves.toBeNull();
  });

  test("never nests rtk inside rtk, and never rewrites to the same text", async () => {
    await expect(interceptBashCall("bash", { command: "rtk git status" }, true, rewriteTo("rtk rtk git status"))).resolves.toBeNull();
    await expect(interceptBashCall("bash", { command: "git status" }, true, rewriteTo("git status"))).resolves.toBeNull();
  });

  test("a failed rewrite leaves the command alone", async () => {
    const broken = async () => {
      throw new Error("rtk is missing");
    };
    await expect(interceptBashCall("bash", { command: "git status" }, true, broken)).resolves.toBeNull();
  });
});
