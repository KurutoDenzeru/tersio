# Codex host research

Status: Implemented for [issue #63](https://github.com/KurutoDenzeru/tersio/issues/63).

Phase 1 research led to the Phase 2 host support in this branch.

Tested with Codex CLI `0.163.0-alpha.11.2` on macOS on 2026-10-24.

## Recommendation

- Ship the `.codex-plugin/plugin.json` compatibility manifest for Codex v1.
- Bundle skills, MCP configuration, and hooks in that plugin.
- Publish a repo marketplace first at `.agents/plugins/marketplace.json`.
- Use plugin hooks for always-on modes.
- Keep `AGENTS.md` as an opt-in fallback.
- Use rollout JSONL for usage totals. Do not use MCP as the stats source.
- Keep RTK integration out of v1.
- Keep one prompt hook. Do not add a `SessionStart` hook.

The compatibility manifest is the only tested layout that loads plugin hooks in this build. A root `plugin.json` loads skills. Its `extensions.com.openai.hooks` field did not run a hook. A root `hooks` field did not load either.

## 1. Plugin anatomy

### Official format

A portable plugin has a root `plugin.json`. The manifest uses the [Agent Plugins schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json). Portable packages discover skills from `skills/`. They discover MCP servers from `mcp.json`.

Codex-specific metadata goes under `extensions.com.openai`. The [packaging guide](https://developers.openai.com/plugins/build/plugins) lists hooks in that object. The guide also says `.codex-plugin/plugin.json` remains a supported compatibility fallback.

The documented portable layout is:

```text
plugin/
  plugin.json
  skills/
  mcp.json
  hooks/
  assets/
```

The documented Codex compatibility layout is:

```text
plugin/
  .codex-plugin/plugin.json
  .mcp.json
  hooks/hooks.json
  skills/
```

### Test result

| Layout | Skill loaded | Hook ran |
|---|---|---|
| Root `plugin.json` | Yes | No |
| Root `plugin.json` with `extensions.com.openai.hooks` | Yes | No |
| Root `plugin.json` with root `hooks` field | Yes | No |
| Root `plugin.json` plus `.codex-plugin/plugin.json` | Yes | No |
| `.codex-plugin/plugin.json` alone | Yes | Yes |

The root `hooks` test printed this warning:

```text
ignoring unknown Agent Plugins manifest field ... field="hooks"
```

The compatibility manifest used a `hooks` field with the path `./hooks/hooks.json`. The hook then received `PLUGIN_ROOT` and `PLUGIN_DATA`.

### Decision

Ship `.codex-plugin/plugin.json` for Codex v1.

Do not add a root `plugin.json` beside it. The mixed test did not run the hook, even though the compatibility manifest was present.

Revisit the portable layout when a Codex release loads portable hooks. The compatibility format can remain until then.

The shipped marketplace plugin has five files:

```text
plugins/tersio/
  .codex-plugin/plugin.json
  .mcp.json
  hooks/hooks.json
  skills/status/SKILL.md
  package.json
```

The plugin calls `tersio` from `PATH`. It carries no build output and no dependencies.

## 2. Marketplace publication

### Options

| Option | Use |
|---|---|
| Repo marketplace | First release. It lives in the Tersio repository and is easy to review. |
| Personal marketplace | Installer fallback. The installer can write it when the user wants a local copy. |
| Universal public directory | Later step. It needs a separate submission review. |

The [packaging guide](https://developers.openai.com/plugins/build/plugins) gives these paths:

- Repo marketplace: `$REPO_ROOT/.agents/plugins/marketplace.json`
- Personal marketplace: `~/.agents/plugins/marketplace.json`
- Installed cache: `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`

The marketplace `source.path` is relative to the marketplace root. Keep it inside that root.

The guide also gives this limitation:

- Lifecycle hooks work only in manually installed Codex desktop plugins.
- A plugin with lifecycle hooks is not eligible for the public plugin directory.

Tersio needs hooks for always-on modes. Thus, Tersio cannot use the public directory in v1. Keep public publication as a later decision.

### Test result

These commands worked with a local marketplace:

```bash
codex plugin marketplace add /absolute/path/to/marketplace --json
codex plugin add tersio-spike@tersio-spike --json
codex plugin remove tersio-spike@tersio-spike --json
codex plugin marketplace remove tersio-spike --json
```

Observed state:

- `plugin add` wrote the cache path and the enabled plugin entry.
- `plugin remove` deleted the cache and the enabled plugin entry.
- `plugin remove` kept `~/.codex/plugins/data/tersio-spike-tersio-spike`.
- `marketplace remove` deleted the marketplace entry and did not remove the data directory.

### Decision

Publish the repo marketplace first.

The installer can add the repo marketplace, then install `tersio@tersio`. It can write a personal marketplace only when the repo marketplace is not suitable.

The repo marketplace is at `.agents/plugins/marketplace.json`. Its source path is `./plugins/tersio`.

The personal marketplace is at `~/.agents/plugins/marketplace.json`. The installer reads its existing name and keeps every other plugin entry. The plugin ID follows that name, such as `tersio@my-market`.

The personal marketplace path resolves from `$HOME` at call time. Tests can then use a temporary home without a stale module-level path.

The local fallback is a 15-file bundled plugin at `~/.tersio/codex-plugin/`:

```text
codex-plugin/
  .codex-plugin/plugin.json
  .mcp.json
  hooks/hooks.json
  skills/status/SKILL.md
  package.json
  tersio
  dist/tersio.js
  extensions/caveman/rule.md
  extensions/caveman/rule-lite.md
  extensions/caveman/rule-ultra.md
  extensions/caveman/rule-megacave-lite.md
  extensions/caveman/rule-megacave.md
  extensions/caveman/rule-megacave-ultra.md
  extensions/ponytail/hooks/ponytail-instructions.js
  extensions/pstack/rule.md
```

The bundled plugin also copies its runtime dependencies and dashboard. Its hook uses the absolute Node path that installed it. Its MCP launcher uses the absolute cache path, because Codex expands `PLUGIN_ROOT` in hooks but not in MCP arguments.

### Version flow

The marketplace is a Git source. `codex plugin marketplace upgrade` refreshes the marketplace snapshot. The plugin entry points at the released plugin version.

Do not promise that `marketplace upgrade` installs a new plugin version. The tested CLI refreshes marketplace sources. A Codex release can change install behavior. Thus, the installer must read the installed version from the cache or the plugin manifest.

Tersio update should:

1. Refresh the marketplace.
2. Read the available plugin version.
3. Install the plugin only when the version differs.
4. Report the version that Codex will load.

The shipped update follows the layout on disk:

- **Bundled:** rebuild the bundled plugin. Do not switch to the marketplace.
- **Marketplace:** run `codex plugin marketplace upgrade tersio`, then `codex plugin add tersio@tersio`.

The update does not migrate one layout to the other. Two MCP servers would remain until the old cache is removed.

## 3. Mode injection

### Official behavior

[Skills](https://developers.openai.com/codex/skills) use progressive disclosure. Codex sees each skill name and description at session start. It reads the full `SKILL.md` only after selection.

That behavior does not keep a mode rule active for every turn. A skill is therefore not a mode surface.

[Hooks](https://developers.openai.com/codex/hooks) provide the needed events:

- `SessionStart` runs at startup, resume, clear, compact, or fork.
- `UserPromptSubmit` runs before each user prompt is sent.
- Plain stdout from either hook becomes developer context.
- JSON output can use `hookSpecificOutput.additionalContext`.

Hooks work in Codex CLI and Codex in the ChatGPT desktop app. They do not cover cloud Work with local-access restrictions. Codex lists plugin hooks for trust review before use.

`AGENTS.md` is also persistent. Codex reads it when it builds the instruction chain. The [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md) says the chain is built once per run.

### Test result

A user hook at `~/.codex/hooks.json` ran both events:

- `SessionStart` added `TERSIO_HOOK_CONTEXT_SESSION` as developer context.
- `UserPromptSubmit` added `TERSIO_HOOK_CONTEXT_PROMPT` as developer context.

Both markers appeared in the rollout JSONL as `hooks.additional_context`.

Plugin hooks also ran when the plugin used `.codex-plugin/plugin.json`. A hook with no output did not affect the turn.

Non-managed hooks stayed trust-gated. The tests used `--dangerously-bypass-hook-trust` only to isolate loading. The installer must not add that flag.

### Decision

Use hooks for always-on modes:

- `UserPromptSubmit` injects the current mode block.
- Each hook reads `~/.tersio/settings.json`.
- Each hook writes the current block to stdout.

`UserPromptSubmit` runs for startup, resume, and every prompt. One hook therefore covers every turn without a second block from `SessionStart`.

The real test used Codex CLI `0.163.0-alpha.11.2` with a temporary `CODEX_HOME`:

- The lite preset produced one `Caveman lite active` block.
- The rollout JSONL recorded the block as a `developer` message.
- The same result held for the marketplace and bundled layouts.

Keep `AGENTS.md` as an opt-in fallback. The installer can add one managed block when the user asks for it. It must not rewrite unrelated project instructions.

Use skills only for on-demand work, such as status and help.

## 4. Usage stats

### Source

Codex CLI writes rollout JSONL under:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

The files carry these rows:

| Row | Facts |
|---|---|
| `session_meta` | `cwd`, `model_provider` |
| `turn_context` | `model` |
| `token_usage_record` | `usage`, `turn_token_usage`, `thread_token_usage` |
| `event_msg.token_count` | `info.last_token_usage` |

The token fields are:

- `input_tokens`
- `cached_input_tokens`
- `cache_write_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `total_tokens`

The files carry no cost field. Use the Tersio price table to estimate cost.

The files do not provide one stable tool-call schema across clients. Exclude tool calls from v1 stats.

### Existing Tersio support

Tersio already classifies Codex token rows in:

- `extensions/shared/usage-ledger.ts`
- `extensions/shared/usage-store.ts`

The parser reads provider and model context. It then writes token rows with the `codex` host.

`sessionsDirs()` in `extensions/shared/usage-ledger.ts` reads `~/.codex/sessions` with the omp and pi paths.

### Decision

Use rollout JSONL as the Codex stats source.

Do not use MCP as the primary source for historical Codex stats. MCP can expose Tersio data and actions. It does not replace the rollout record.

Do not claim that MCP replaces per-session Codex stats.

## 5. Install, detect, and uninstall

### Detection

Add `codex` to `HostId` in `cli/hosts.ts`.

Detect Codex when either condition holds:

- The `codex` binary is on `PATH`.
- `~/.codex/` exists.

Read the installed plugin version from the cache path or the plugin manifest. Do not infer it from the marketplace entry.

### Install

The installer should:

1. Run `codex plugin marketplace add KurutoDenzeru/tersio --sparse .agents/plugins --sparse plugins/tersio`.
2. Run `codex plugin add tersio@tersio`.
3. Report that the plugin hooks need trust review in `/hooks`.
4. Leave `AGENTS.md` unchanged unless the user chooses the fallback.

If the marketplace is already configured, keep the existing source.

If the marketplace install fails, write the bundled fallback. The fallback writes a personal marketplace and runs `codex plugin add tersio@<personal-marketplace>`.

A disabled plugin runs `codex plugin add` again. Codex then enables it.

If `codex plugin add` fails, do not write a fake cache entry. Report the failure.

### Uninstall

The installer should:

1. Run `codex plugin remove tersio@tersio`.
2. Remove the Tersio entry from the personal marketplace.
3. Remove `~/.tersio/codex-plugin/` and the unregistered legacy directory.
4. Remove `~/.tersio/settings.json` only with the normal Tersio settings cleanup.
5. Keep `~/.codex/plugins/data/tersio-tersio` unless the user asks for data removal.

The tested remove command deleted the installed cache. It kept the plugin data directory. The installer must not delete `PLUGIN_DATA` by default.

Do not remove unrelated Codex plugins, marketplaces, or user hooks.

The installer does not remove the repo marketplace. It belongs to the user and can serve future installs.

## 6. RTK and tool filtering

### Official behavior

Codex hooks support `PreToolUse` and `PostToolUse` for Bash and unified exec. `PreToolUse` can rewrite a command through `updatedInput`. `PostToolUse` can replace or block the result.

These hooks are trust-gated. Plugin hooks also need review. Some tool paths can opt out of the hook path. The hook guide calls the tool hooks a guardrail. It does not call them a complete enforcement boundary.

### Decision

Phase 2 landed RTK integration after a later session proved the three conditions below.

Reasons:

- RTK needs a tested rewrite contract for Codex `PreToolUse`.
- RTK needs a tested output filter for Codex `PostToolUse`.
- Trust review adds a second setup step.
- A partial rewrite can change command meaning.

The shipped `PreToolUse` hook proves each condition in `test/cli/codex.test.ts`:

1. The rewrite leaves unsupported commands alone: a command whose `rtk rewrite` exits non-zero passes through untouched.
2. The filter preserves errors and exit status: the hook only rewrites, and it never changes exit paths.
3. The hooks work after trust review: Codex reviews and trusts plugin hooks in `/hooks` before they run.
4. The user can disable RTK without leaving a rewrite path active.

## Phase 2 implementation

The implementation has these parts:

- `HostId: 'codex'`
- Codex detection in `cli/hosts.ts`
- Codex install, update, doctor, and uninstall paths
- `~/.codex/sessions` in `sessionsDirs()`
- Codex hook commands
- Repo marketplace and plugin package
- Dashboard host and session support

Do not add RTK.

Do not add a Codex adapter to `extensions/shared/host.ts` for events Codex does not emit.

## Example

The working layout is in [`docs/examples/codex-plugin`](examples/codex-plugin).

It has:

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `hooks/hooks.json`
- `skills/status/SKILL.md`

This example is a shape reference. The shipped plugin adds `package.json`.

## Sources

- [Codex plugins](https://developers.openai.com/codex/plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Hooks](https://developers.openai.com/codex/hooks)
- [Build skills](https://developers.openai.com/codex/skills)
- [AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Custom prompts (deprecated)](https://developers.openai.com/codex/custom-prompts)
- [Non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)
- [Agent Plugins schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
