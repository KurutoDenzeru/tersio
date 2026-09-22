# Architecture

Tersio is one npm package with two faces: a **CLI** (`tersio install|update|doctor|gain…`) and an **OMP plugin** whose feature-gated extensions load inside the OMP host.

## Components

```mermaid
flowchart TB
  subgraph CLI["CLI (node tersio.ts)"]
    INST["cli/install.ts<br/>copies extensions to<br/>~/.omp/agent/extensions + rtk.ts wiring"]
    DASH["cli/dashboard.ts<br/>gain dashboard (127.0.0.1)"]
    DOC["cli/doctor.ts · update.ts · uninstall.ts"]
  end

  subgraph HOST["OMP host"]
    subgraph EXT["extensions/ (loaded per omp.features)"]
      CAV["caveman-session<br/>/caveman"]
      RTK["rtk-session<br/>/rtk + rtk_run tool"]
      COMBO["combo-toggle<br/>/combo presets"]
      REINF["shared/mode-reinforcement<br/>re-asserts modes each turn"]
      TCMD["tersio-commands<br/>/tersio status|gain|usage"]
      UPD["ai-addons-updater<br/>/ai-addons"]
    end
    subgraph SHARED["extensions/shared/"]
      SS["session-state.ts<br/>in-process bridge (Symbol.for)<br/>+ last-wins session entries"]
      LEDGER["usage-ledger.ts<br/>~/.omp/plugins/tersio-usage.jsonl"]
      PS["plugin-settings.ts<br/>session-start defaults"]
    end
    BIN["rtk binary (~/.bun/bin/rtk)"]
    PONY["@dietrichgebert/ponytail plugin<br/>(/ponytail)"]
  end

  INST -->|registers| EXT
  EXT -->|reads/writes| SS
  COMBO & TCMD -->|publish state| SS
  SS -->|listener mirror, no reload| CAV & RTK
  CAV & RTK & REINF & COMBO -->|inject prompt block on<br/>before_agent_start| HOST
  RTK -->|exec| BIN
  COMBO -->|loads instructions| PONY
  TCMD & CLI --> LEDGER
  DASH -->|summarize| LEDGER
```

## One turn, runtime flow

```mermaid
sequenceDiagram
  participant U as User
  participant X as Extension (caveman/rtk/combo)
  participant B as session-state bridge
  participant A as OMP agent
  U->>X: /combo balanced
  X->>B: setSharedComboLevel()
  B-->>X: publish → sibling listeners sync (no reload)
  X->>B: persist as custom session entries (resume-safe)
  A->>X: before_agent_start
  X-->>A: system prompt + mode blocks (caveman rule, RTK prompt, ponytail)
  A->>A: turn runs (rtk_run tool → rtk binary when on)
  U->>A: /tersio gain → usage-ledger rows → dashboard
```

## Key invariants

- **Bridge, not reload:** `session-state.ts` uses a `Symbol.for` global bridge; a toggle publishes and siblings mirror live. Custom session entries are the persistence layer — `reconcileSharedComboEntries` rebuilds state on resume/branch.
- **Subagents inherit:** `isOmpSubagentPrompt` makes subagent turns read shared state instead of local flags.
- **Reinforcement:** `mode-reinforcement.ts` re-appends the mode block after Ponytail's prompt and after compaction; last-wins entry scan ignores corrupt writes.
- **Ledger is best-effort:** append-only JSONL; `tersio reset` writes a watermark instead of deleting host-owned files.
- **Features are optional:** `omp.features` in `package.json` gates each extension file, so `tersio[caveman,ponytail]` subsets load only those.
