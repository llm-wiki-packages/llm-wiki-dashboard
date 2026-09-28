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

/** Raw HTML a page carries (an embedded player, mostly) is not rendered: it becomes a link to what it embedded. */
function withoutRawHtml(markdown: string): string {
  return markdown
    .replace(/<iframe[^>]*src="([^"]+)"[^>]*>\s*<\/iframe>/gi, (_m, src: string) => {
      let host = ''
      try {
        host = new URL(src.replace(/&amp;/g, '&')).hostname
      } catch {
        // not a URL; drop it
      }
      return host ? `*[Embedded player · ${host}](${src.replace(/&amp;/g, '&')})*` : ''
    })
    .replace(/<\/?(div|span|br|img|video|audio|source|script|style)[^>]*>/gi, '')
}

/** An Obsidian callout (`> [!summary] …`) becomes a plain blockquote whose first line names the kind. */
function withCallouts(markdown: string): string {
  return markdown.replace(/^> \[!(\w+)\][ \t]*(.*)$/gm, (_m, kind: string, rest: string) => `> **${kind.charAt(0).toUpperCase()}${kind.slice(1)}**${rest ? ` ${rest}` : ''}`)
}

/** Everything a page body needs before react-markdown sees it. */
export function preparePage(markdown: string): string {
  return withWikilinks(withCallouts(withoutRawHtml(markdown)))
}

export function wikilinkTarget(href: string | undefined): string | null {
  if (!href || !href.startsWith(WIKILINK_SCHEME)) return null
  try {
    return decodeURIComponent(href.slice(WIKILINK_SCHEME.length))
  } catch {
    return null
  }
}
