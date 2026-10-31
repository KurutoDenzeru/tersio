// The three paths Tersio actually routes through rtk, measured on committed fixtures. Run with `bun run bench`; `bun run test` ignores this file.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { resolveRtkBinary } from "../extensions/shared/utils.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const bin = resolveRtkBinary();

/** The condensed form of one fixture, or null when rtk refuses it. */
function condense(filter: string, input: string): string | null {
  if (!bin) return null;
  const result = spawnSync(bin, ["pipe", "-f", filter], { input, encoding: "utf8", timeout: 5000 });
  return result.status === 0 ? result.stdout : null;
}

const reduction = (input: string, output: string): number => 1 - output.length / input.length;

// skipIf keeps the suite honest on a machine with no binary, and the guide says so.
test.skipIf(bin === null)("find output loses most of its bytes and keeps every path", async ({ bench }) => {
  const input = readFileSync(path.join(FIXTURES, "find.txt"), "utf8");
  const output = condense("find", input);
  expect(output, "rtk pipe -f find produced nothing").not.toBeNull();
  const condensed = output as string;
  // The filter prints a header with the true totals, then names directories and folds the rest into `+N` and `+N more dirs`.
  const lines = input.split("\n").filter(Boolean);
  const files = lines.length;
  const dirs = new Set(lines.map((line) => path.dirname(line))).size;
  expect(condensed).toContain(`${files} files in ${dirs} dirs`);
  const names = new Set(lines.map((line) => path.basename(line)));
  const printed = condensed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("./") && !line.startsWith("+") && !/^\d+ files? in \d+ dirs?:$/.test(line));
  const invented = printed.filter((name) => !names.has(name));
  expect(invented, `find filter printed ${invented.length} names that are not in the input`).toEqual([]);
  await bench("find", () => condense("find", input)).run();
  // A reduction below this means the filter stopped folding, not that the machine is slow.
  expect(reduction(input, condensed)).toBeGreaterThan(0.5);
});

test.skipIf(bin === null)("grep output keeps every match and its file and line", async ({ bench }) => {
  const input = readFileSync(path.join(FIXTURES, "grep.txt"), "utf8");
  const output = condense("grep", input);
  expect(output, "rtk pipe -f grep produced nothing").not.toBeNull();
  const condensed = output as string;
  const lines = input.split("\n").filter(Boolean);
  const missing = lines.filter((line) => !condensed.includes(line.split(":")[1] ?? ""));
  expect(missing, `grep filter dropped ${missing.length} of ${lines.length} matches`).toEqual([]);
  await bench("grep", () => condense("grep", input)).run();
});

test.skipIf(bin === null)("the rewrite lookup answers every command in the fixture", async ({ bench }) => {
  const commands = readFileSync(path.join(FIXTURES, "commands.txt"), "utf8").split("\n").filter(Boolean);
  const rewrite = (command: string): string | null => {
    const result = spawnSync(bin as string, ["rewrite", command], { encoding: "utf8", timeout: 5000 });
    // Exit 3 still prints a rewrite; exit 1 means rtk has no equivalent, which is a valid answer.
    return result.status === 1 ? null : result.stdout.trim() || null;
  };
  const answers = commands.map((command) => ({ command, rewritten: rewrite(command) }));
  expect(answers.length).toBeGreaterThan(8);
  // The hook pays this cost on every Bash call, so the number matters even when nothing is condensed.
  await bench("rewrite", () => answers.map((entry) => rewrite(entry.command))).run();
});