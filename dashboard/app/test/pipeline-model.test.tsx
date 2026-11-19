import {describe, expect, test} from "vitest"
import {agentModeRows, defaultPositions, pipelineGraph} from "../src/components/agents/pipeline-model"
import type {ModeState} from "../src/components/agents/shell"

describe("Quick start graph", () => {
  test("routes CodeGraph through to output without overlapping defaults", () => {
    const graph = pipelineGraph(["omp", "pi", "opencode"])
    const positions = defaultPositions(["omp", "pi", "opencode"])

    expect(graph.edges).toContainEqual({ from: "codegraph", to: "output" })

    const entries = Object.entries(positions)
    for (let i = 0; i < entries.length; i += 1) {
      const [id, a] = entries[i]!
      for (const [otherId, b] of entries.slice(i + 1)) {
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        expect(overlap, `${id} overlaps ${otherId}`).toBe(false)
      }
    }
  })
})

test("shows CodeGraph as unavailable only for hosts without its extension", () => {
  const modes: ModeState = {
    comboDefault: "off",
    comboLevel: "off",
    cavemanDefault: "off",
    rtkDefault: false,
    ponytailDefault: "off",
    pstackDefault: "off",
    headroomDefault: "off",
    codegraphDefault: "on",
    codegraphSync: "live",
  }

  for (const host of ["codex", "dsh", "claude"]) {
    expect(agentModeRows(host, modes).find((row) => row.key === "codegraph")).toMatchObject({
      label: "n/a",
      on: false,
    })
  }
  for (const host of ["omp", "pi", "pig", "opencode"]) {
    expect(agentModeRows(host, modes).find((row) => row.key === "codegraph")).toMatchObject({
      label: "on",
      on: true,
    })
  }
})
