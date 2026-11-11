// Guards the model cell: the provider row names a router, never a second copy of the model's own vendor.
import { render } from "@testing-library/react"
import { describe, expect, test } from "vitest"
import { ModelCell } from "../src/components/common"

describe("model cell", () => {
  test("a native provider is not repeated under its model", () => {
    const { container } = render(<ModelCell model="claude-sonnet-5-5" provider="anthropic" />)
    expect(container.textContent).not.toContain("anthropic")
  })

  test("a gateway stays under the model", () => {
    const { container } = render(<ModelCell model="claude-sonnet-5-5" provider="magpie" />)
    expect(container.textContent).toContain("magpie")
  })
})
