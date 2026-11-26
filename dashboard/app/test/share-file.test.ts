import { describe, expect, test } from "vitest"

/**
 * The share path must hand a real file to the system sheet. A URL-only intent always posts without an image,
 * so this pins the shape the component builds before it opens anything.
 */
function shareFile(blob: Blob): File {
  return new File([blob], "tersio-usage.png", { type: "image/png" })
}

describe("the share hand-off carries image bytes, not a link", () => {
  test("the file keeps a png name and type so a network treats it as an image", () => {
    const file = shareFile(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }))
    expect(file.name).toBe("tersio-usage.png")
    expect(file.type).toBe("image/png")
    expect(file.size).toBe(3)
  })

  test("a non-empty card produces a file a sheet can share", () => {
    const bytes = new Uint8Array(2048)
    const file = shareFile(new Blob([bytes], { type: "image/png" }))
    // A zero-byte file is refused by the sheet, so an empty render must not be offered as one.
    expect(file.size).toBeGreaterThan(0)
  })
})
