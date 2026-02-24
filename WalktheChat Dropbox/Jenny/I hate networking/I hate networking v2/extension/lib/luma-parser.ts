// Regex-based HTML parsing helpers — safe to use in service worker (no DOM)

export function extractLinkedInUrlFromHtml(html: string): string {
  const match = html.match(/href="(https:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\/[^"?#]+)[^"]*"/)
  return match ? match[1] : ''
}

export function extractDisplayNameFromHtml(html: string): string {
  // Try <title>Name | Luma</title>
  const titleMatch = html.match(/<title>\s*([^|<\n]+?)\s*(?:\||<)/)
  if (titleMatch) return titleMatch[1].trim()

  // Try og:title
  const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/)
  if (ogMatch) return ogMatch[1].trim()

  return ''
}
