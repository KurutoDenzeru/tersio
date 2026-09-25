# Architecture

Tersio is one npm package with two faces: a **CLI** (`tersio install|update|doctor|dashboard…`) and an **OMP plugin** whose feature-gated extensions load inside the OMP host.

## Components

```mermaid
flowchart TB
  subgraph CLI["CLI (node tersio.ts)"]
    INST["cli/install.ts<br/>copies extensions to<br/>~/.omp/agent/extensions + rtk.ts wiring"]
    DASH["cli/dashboard.ts<br/>Dashboard dist runtime (127.0.0.1)"]
    APP["dashboard/app/<br/>Vite + React + shadcn source"]
    DOC["cli/doctor.ts · update.ts · uninstall.ts"]
  end

  subgraph HOST["OMP host"]
    subgraph EXT["extensions/ (loaded per omp.features)"]
      CAV["caveman-session<br/>/caveman"]
      RTK["rtk-session<br/>/rtk + rtk_run tool"]
      COMBO["combo-toggle<br/>/combo presets"]
      TCMD["tersio-commands<br/>/tersio status|dashboard|usage"]
      UPD["ai-addons-updater<br/>/ai-addons"]
    end
    subgraph SHARED["extensions/shared/"]
      SS["session-state.ts<br/>in-process bridge (Symbol.for)<br/>+ last-wins session entries"]
      LEDGER["usage-ledger.ts<br/>~/.tersio/usage.db"]
      PS["plugin-settings.ts<br/>session-start defaults"]
    end
    BIN["rtk binary (PATH, then ~/.bun/bin)"]
    PONY["@dietrichgebert/ponytail<br/>bundled tersio dep (/ponytail)"]
  end

  INST -->|registers| EXT
  EXT -->|reads/writes| SS
  COMBO & TCMD -->|publish state| SS
  SS -->|listener mirror, no reload| CAV & RTK
  RTK -->|exec| BIN
  COMBO -->|loads instructions| PONY
  TCMD & CLI --> LEDGER
  APP -->|build| DASH
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
  U->>A: /tersio dashboard → usage-ledger rows → Dashboard
```

## Key invariants

- **Bridge, not reload:** `session-state.ts` uses a `Symbol.for` global bridge; a toggle publishes and siblings mirror live. Custom session entries are the persistence layer — `reconcileSharedComboEntries` rebuilds state on resume/branch.
- **Subagents inherit:** `isOmpSubagentPrompt` makes subagent turns read shared state instead of local flags.
- **Prompt persistence:** Caveman, RTK, and Ponytail extensions inject active modes each turn. The former separate reinforcement extension is retired because it duplicated the same directives.
- **Ledger is best-effort:** append-only JSONL; `tersio reset` writes a watermark instead of deleting host-owned files.
- **Always on:** `omp.extensions` in `package.json` loads every mode extension. Only `updater` stays an optional feature.
- **Single owner:** OMP plugin manifests load Tersio extensions and nested Ponytail. `config.yml` holds only rtk-owned wiring; doctor removes retired, duplicate, or legacy manifest-owned entries.
- **Caveman rule ownership:** `extensions/caveman-session/rule.md` ships beside the manifest-loaded extension. Doctor and updater inspect that installed plugin path, not the retired agent copy.
