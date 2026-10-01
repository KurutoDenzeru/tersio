// The host allowlist is a trust boundary; www prefixes get asserted.
import { expect, test } from "vitest";

import { SHARE_ORIGINS, shareUrl, type ShareTarget } from "../../dashboard/app/src/lib/share.ts";

const TARGETS = Object.keys(SHARE_ORIGINS) as ShareTarget[];

test("every share target builds a URL on its own allowlisted host", () => {
  expect(TARGETS).toHaveLength(3);
  for (const target of TARGETS) {
    const url = new URL(shareUrl(target));
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe(new URL(SHARE_ORIGINS[target]).origin);
    expect(url.pathname).toBe(new URL(SHARE_ORIGINS[target]).pathname);
  }
});

test("the host check keeps the www prefix", () => {
  // The exact mistake this file exists for: linkedin.com is not www.linkedin.com.
  expect(new URL(SHARE_ORIGINS.linkedin).host).toBe("www.linkedin.com");
  expect(new URL(shareUrl("linkedin")).host).toBe("www.linkedin.com");
  expect(new URL(SHARE_ORIGINS.reddit).host).toBe("www.reddit.com");
  expect(new URL(SHARE_ORIGINS.x).host).toBe("x.com");
});

test("params ride along, and no params means no stray question mark", () => {
  expect(shareUrl("x", { text: "hello" })).toBe("https://x.com/intent/post?text=hello");
  expect(shareUrl("linkedin")).toBe("https://www.linkedin.com/feed/");
  expect(shareUrl("linkedin", {})).toBe("https://www.linkedin.com/feed/");
});

test("params are encoded and cannot escape into the host", () => {
  const url = shareUrl("x", { text: "a&b=c d/e?f#g" });
  expect(url).toBe("https://x.com/intent/post?text=a%26b%3Dc+d%2Fe%3Ff%23g");
  expect(new URL(url).host).toBe("x.com");
  expect(new URL(url).searchParams.get("text")).toBe("a&b=c d/e?f#g");
});

test("a url injected as a param value stays inside the query string", () => {
  const url = new URL(shareUrl("reddit", { text: "https://evil.example/pwn" }));
  expect(url.origin).toBe("https://www.reddit.com");
  expect(url.searchParams.get("text")).toBe("https://evil.example/pwn");
});
