/** Adds a scheme to bare domains ("example.com" → "https://example.com"). */
export function normalizeHref(raw: string): string {
  const href = raw.trim()
  if (!href) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`
  return `https://${href}`
}
