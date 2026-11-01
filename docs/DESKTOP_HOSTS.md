# Desktop hosts: mode changes as chat messages

CLI hosts (Oh My Pi, pi, PiG, OpenCode) show the session modes in a status line, and `/combo`, `/caveman`, `/rtk`, `/ponytail`, `/pstack` run from the terminal. Desktop apps (DeepSeek Harness desktop, Claude Code Desktop, Codex desktop, ZCode) have no reliable status bar, and their command surfaces are thinner — so a mode change must read as a normal chat exchange: a user message that states the new modes, and a short assistant confirmation.

The DeepSeek Harness plugin (`extensions/dsh/`) is the reference implementation.

## The contract

1. **Read and write the host's own section.** Modes live in `~/.tersio/settings.json` under `hosts.<host>`: `cavemanDefault` and `ponytailDefault` are levels, `rtkDefault` is a boolean, `pstackDefault` and `headroomDefault` are `'on' | 'off'` strings. Never write another host's section.
2. **Format the line with the shared module.** `extensions/shared/mode-notice.ts` owns the glyphs (🪨 🗜️ 🧠 🥔 🍃) and the wording: `buildModeNotice(label, modes)` returns the message text, `formatModeLine(modes)` the status line every host agrees on.
3. **Send it as a user message the assistant answers.** Not a toast, not a silent append. The change should appear as a bubble in the conversation and the assistant replies to it.
4. **Deliver with what the host exposes, in this order:**
   - **A real turn** where the host hands the plugin its agent: `agent.followup({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })` — DSH's own `/goal` uses this. The message text ends with "Confirm in one short line." so the reply stays cheap.
   - **A surface append otherwise:** `session.append('user/message', data, { surfaceOp: 'append' })`. The third argument is required: a `user/message` is surface-eligible and is rejected without a `surfaceOp` marker (this cost a debugging round; do not drop it).
   - **Never** a status bar, a toast, or a background append the user cannot see.

## Per host

- **DeepSeek Harness desktop** — shipped. `ctx.commands.register` gives the six slash commands, and each mode change calls `agent.followup` with the formatted message; the assistant confirms in one line. Proof: the commands README's model experience (command results never enter model history) and a sandbox session where `/combo max` produced the bubble and the reply.
- **Claude Code Desktop** — its plugin system carries mods: a mod's hooks can post a message into the session, and the CLI surface already has commands. Reuse steps 1–3 inside the mod; the Desktop app draws the same session, so the message lands where the user reads.
- **Codex desktop** — plugins expose skills and prompts, and no custom slash commands. Keep the message-first contract: the installer writes the prompts, and a mode switch is delivered as the user message the model acknowledges; skills stay on demand.
- **ZCode desktop** — reads its provider config from a settings UI and exposes no plugin hook today, so modes are settings-only until it does. The store contract (step 1) is already correct, so a future surface needs only step 3.

## Choosing the label

`buildModeNotice` takes the sentence's subject: `Tersio combo set to lite`, `Tersio caveman set to full`, `Tersio RTK turned off`. Keep it a statement of what changed — never an instruction to the agent.
