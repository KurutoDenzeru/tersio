// pstack ships its whole tree: the index routes to files, so every named file must exist, and no
// Cursor-only surface may survive the copy.
import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PSTACK = path.join(root, "extensions", "pstack");
const read = (p: string): string => fs.readFileSync(p, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const tree = walk(PSTACK);
const rel = (p: string): string => path.relative(PSTACK, p).replace(/\\/g, "/");
const isProvenance = (l: string): boolean => /^\s*(?:\*\s*)?(?:Forked from|Source:)/.test(l);

test("the tree ships a leaf per principle, a file per playbook, and every routed skill", () => {
  const principles = tree.filter((f) => /^principles\/.+\.md$/.test(rel(f)));
  const playbooks = tree.filter((f) => /^playbooks\/.+\.md$/.test(rel(f)));
  const skills = tree.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(rel(f)));
  expect(principles.length, "one leaf per upstream principle entry").toBe(24);
  expect(playbooks.length, "one file per upstream playbook").toBe(23);
  expect(skills.length, "the skills the index and playbooks route to").toBe(18);
  expect(read(path.join(PSTACK, "references", "bugbot-triage.md")).length).toBeGreaterThan(1000);
});

test("no Cursor-only surface survives anywhere in the tree", () => {
  // Every file is read by the model, so one surviving slash command teaches it a command it has no handler for.
  const banned = [/\/setup-pstack/, /poteto-agent/, /subagent_type/, /AskQuestion/,
    /disable-model-invocation/, /cursor-team-kit/, /grok-4/, /claude-opus-5/, /environment: "cloud"/,
    /skillsthe /, /the [\w-]+ skill`/, /`the [\w-]+ skill`/, /pstack-models\.mdc/, /\/loop\b/, /\.cursor/,
    // Cursor's control skills and helper scripts never ship in this tree, so naming them sends the model to a missing file.
    /control-ui/, /control-cli/, /agent-transcripts/, /scripts\/worktree-audit\.sh/, /scripts\/log\.sh/,
    /scripts\/watch-pr/, /scripts\/orch\//, /scripts\/check-plan\.mjs/];
  for (const f of tree) {
    for (const l of read(f).split("\n")) {
      if (isProvenance(l)) continue;
      for (const pat of banned) expect(pat.test(l), `${rel(f)} still matches ${pat}: ${l.trim().slice(0, 60)}`).toBe(false);
      // A provenance line may name the upstream path; a rule line may never teach a command.
      expect(l, `${rel(f)} teaches a command: ${l.trim().slice(0, 60)}`).not.toMatch(/\/poteto-mode|\/setup-pstack/);
    }
  }
});

test("no port artifacts survive the Cursor-surface removal", () => {
  // The port stripped Cursor surface with a regex; these are the mangled shapes it left behind.
  const banned = [/skillsthe /, /\.\.\.the /, /\.\.the /, /the [\w-]+ skill`/, /`the [\w-]+ skill`/,
    /`the ask tool`/, /\/loop\b/, /\.cursor/, /\bCursor\b/, /cloud_base_branch/, /pstack-models\.mdc/, /\. \./];
  for (const f of tree) {
    const lines = read(f).split("\n");
    for (const l of lines) {
      if (isProvenance(l)) continue;
      for (const pat of banned) expect(pat.test(l), `${rel(f)} still matches ${pat}: ${l.trim().slice(0, 60)}`).toBe(false);
      // An empty inline code span is a stripped arg, never content; fence lines and ```lang openers carry their own backticks.
      if (!l.trimStart().startsWith("```")) {
        expect(l, `${rel(f)} has an empty code span: ${l.trim().slice(0, 60)}`).not.toMatch(/``(?![`a-z])/);
      }
    }
  }
});

test("every relative link in the tree resolves to a shipped file", () => {
  // The port rewrote upstream's directory layout, so a stale upstream path reads as a dead link.
  for (const f of tree) {
    const dir = path.dirname(f);
    for (const m of read(f).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target) || !/[./]/.test(target)) continue;
      const file = target.split("#")[0];
      const resolved = path.normalize(path.join(dir, file));
      expect(fs.existsSync(resolved), `${rel(f)} links ${target}, which the tree does not ship`).toBe(true);
    }
  }
});

test("every path the index names resolves to a shipped file", () => {
  // The index routes by relative path; a rename upstream would silently break the mode.
  const body = read(path.join(PSTACK, "rule.md"));
  const onDisk = new Set(tree.map(rel));
  // Generic placeholders in the routing sentence are not paths.
  const placeholders = [...body.matchAll(/`[\w-]+\/<title[^`]*>\.md`/g)].map((m) => m[0].slice(1, -1));
  for (const p of placeholders) expect(p, `placeholder ${p} must use <title>, not a literal name`).toMatch(/<title/);
  // Every concrete path must exist; the rest route by the generic pattern above.
  const named = [...body.matchAll(/`(?:principles|playbooks|skills|references)\/[^`<]+\.md`/g)].map((m) => m[0].slice(1, -1));
  expect(named.length, "the index names at least one concrete file").toBeGreaterThan(0);
  for (const n of named) expect(onDisk.has(n), `rule.md names ${n}, which the tree does not ship`).toBe(true);
  // And every entry in the Principles section has its leaf on disk, keyed on the leaf's own H1 title.
  const leafTitles = new Set(
    tree.filter((p) => /^principles\//.test(rel(p))).map((p) => (/^#\s+(.+)$/m.exec(read(p))?.[1] ?? "").trim().toLowerCase()),
  );
  const principlesSection = body.slice(body.indexOf("## Principles"), body.indexOf("## Autonomy"));
  for (const m of principlesSection.matchAll(/\*\*([A-Z][^*]+?)\.\*\*/g)) {
    const title = m[1].trim();
    if (["Core", "Architecture", "Verification", "Delegation", "Meta"].includes(title)) continue;
    expect(leafTitles.has(title.toLowerCase()), `no leaf for the principle "${title}"`).toBe(true);
  }
  expect(leafTitles.size, "one leaf per upstream principle entry").toBe(24);
});

test("the index carries every upstream principle entry with its own trigger text", () => {
  const body = read(path.join(PSTACK, "rule.md"));
  const entries = [
    "Laziness Protocol", "Foundational Thinking", "Redesign from First Principles", "Attack the Premise",
    "Subtract Before You Add", "Minimize Reader Load", "Outcome-Oriented Execution", "Experience First",
    "Exhaust the Design Space", "Build the Lever", "Model the Domain", "Boundary Discipline",
    "Type System Discipline", "Make Operations Idempotent", "Migrate Callers Then Delete Legacy APIs",
    "Separate Before Serializing Shared State", "Prove It Works", "Fix Root Causes",
    "Sequence Work into Verifiable Units", "Test Behavior, Not Implementation", "Explain the Number",
    "Guard the Context Window", "Never Block on the Human", "Encode Lessons in Structure",
  ];
  for (const e of entries) expect(body, `rule.md lost ${e}`).toContain(`**${e}.**`);
  // The sections upstream groups them under.
  for (const g of ["Core", "Architecture", "Verification", "Delegation", "Meta"]) expect(body).toContain(`**${g}**`);
  // The sections upstream carries that we kept.
  for (const s of ["Non-negotiables", "Autonomy", "Subagents", "Writing the reply", "Comments", "Playbooks"]) {
    expect(body).toContain(`## ${s}`);
  }
});
