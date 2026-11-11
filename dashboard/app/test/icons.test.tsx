// Guards the icons the UI names by string: a missing registry key falls back to a question mark.
import { render } from "@testing-library/react"
import { describe, expect, test } from "vitest"
import { Icon } from "../src/components/icon"

/** Names the dashboard asks for in tables, dialogs, spinners, and the agent list. */
const NAMES = [
  "asterisk",
  "book-open",
  "chevron-down",
  "chevron-up",
  "chevrons-up-down",
  "corner-down-right",
  "dot",
  "eye",
  "eye-off",
  "file-pen",
  "file-plus",
  "file-search",
  "hourglass",
  "list-todo",
  "loader-circle",
  "message-circle",
  "monitor",
  "moon",
  "network",
  "sparkles",
  "square-pen",
  "target",
]

describe("icon registry", () => {
  test.each(NAMES)("%s draws its own lucide mark", (name) => {
    const { container } = render(<Icon name={name} />)
    expect(container.innerHTML).toContain(`lucide-${name}`)
  })
})
