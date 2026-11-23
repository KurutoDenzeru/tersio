import {describe, expect, test} from "vitest"
import {agentModeRows, defaultPositions, edgeLit, pipelineGraph, storedPositionsVersion} from "../src/components/agents/pipeline-model"
import type {ModeState} from "../src/components/agents/shell"

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

describe("Quick start graph", () => {
  test("chains the prompt modes, and each band hands its work to the output with one line", () => {
    const graph = pipelineGraph(["omp", "pi", "opencode"])
    const positions = defaultPositions(["omp", "pi", "opencode"])

    expect(graph.edges).toContainEqual({ from: "prompt", to: "group-modes" })
    expect(graph.edges).toContainEqual({ from: "caveman", to: "pstack" })
    expect(graph.edges).toContainEqual({ from: "pstack", to: "rtk" })
    expect(graph.edges).toContainEqual({ from: "rtk", to: "ponytail" })
    expect(graph.edges).toContainEqual({ from: "group-modes", to: "output" })
    expect(graph.edges).toContainEqual({ from: "group-optional", to: "output" })
    // One connector per band: three hosts must not draw three lines.
    expect(graph.edges.filter((edge) => edge.from === "group-hosts")).toHaveLength(1)
    expect(graph.edges.filter((edge) => edge.from === "group-optional")).toHaveLength(1)

    const entries = Object.entries(positions)
    for (let i = 0; i < entries.length; i += 1) {
      const [id, a] = entries[i]!
      for (const [otherId, b] of entries.slice(i + 1)) {
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        expect(overlap, `${id} overlaps ${otherId}`).toBe(false)
      }
    }
  })

  test("a band is lit when any member is, and dark when every member is off", () => {
    const hosts = { installed: { omp: true }, present: {}, versions: {}, modeVersions: {} }
    expect(edgeLit("group-hosts", modes, hosts as never)).toBe(true)
    // CodeGraph is outside the prompt chain, so it cannot light the feedback band's own connector.
    expect(edgeLit("group-modes", modes, hosts as never)).toBe(false)
    const lit = { ...modes, rtkDefault: true }
    expect(edgeLit("group-modes", lit, hosts as never)).toBe(true)
    // The optional band ships on: CodeGraph defaults to on, headroom to off.
    expect(edgeLit("group-optional", modes, hosts as never)).toBe(true)
  })

  test("stored layouts older than the bands fall back to the default", () => {
    expect(storedPositionsVersion({ layout: 1, boxes: { prompt: { x: 8, y: 8, w: 224, h: 72 } } })).toEqual({})
    expect(
      storedPositionsVersion({ layout: 2, boxes: { prompt: { x: 8, y: 8, w: 224, h: 72 }, bad: "x" } }),
    ).toEqual({ prompt: { x: 8, y: 8, w: 224, h: 72 } })
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
