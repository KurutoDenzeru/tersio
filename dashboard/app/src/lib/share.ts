// Share destinations. Pure so the host guarantee is testable; the UI never
// builds a share URL itself.

// Fixed origins; only the text passed in is ours.
export const SHARE_ORIGINS = {
  x: "https://x.com/intent/post",
  reddit: "https://www.reddit.com/submit",
  linkedin: "https://www.linkedin.com/feed/",
} as const;

export type ShareTarget = keyof typeof SHARE_ORIGINS;

// Checked at runtime, not by type alone: `keyof` only rejects a bad *key* at
// compile time. The `www.` prefixes are part of these hosts and must match.
const SHARE_HOSTS: Record<ShareTarget, string> = {
  x: "x.com",
  reddit: "www.reddit.com",
  linkedin: "www.linkedin.com",
};

export function shareUrl(target: ShareTarget, params: Record<string, string> = {}): string {
  const base = SHARE_ORIGINS[target];
  if (!base.startsWith(`https://${SHARE_HOSTS[target]}/`)) {
    throw new Error(`Refusing to share to an unlisted host: ${base}`);
  }
  // URLSearchParams cannot fail, and the origin is vetted above.
  const query = new URLSearchParams(params).toString();
  return query ? `${base}?${query}` : base;
}
