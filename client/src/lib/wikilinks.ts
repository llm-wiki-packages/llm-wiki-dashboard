// `[[Page › Section|alias]]` in a page body becomes a link the reader can
// follow. The body is markdown, so the rewrite is to a markdown link with a
// `wikilink:` scheme that the Brief component turns into an in-app route.

export const WIKILINK_SCHEME = 'wikilink:'

export function withWikilinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
    const label = (alias ?? target).trim()
    return `[${label}](${WIKILINK_SCHEME}${encodeURIComponent(target.trim())})`
  })
}

export function wikilinkTarget(href: string | undefined): string | null {
  if (!href || !href.startsWith(WIKILINK_SCHEME)) return null
  try {
    return decodeURIComponent(href.slice(WIKILINK_SCHEME.length))
  } catch {
    return null
  }
}
