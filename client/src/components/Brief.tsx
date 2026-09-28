// A page body rendered as an article: markdown, with wikilinks routed to the
// in-app reader and outside links opened in a new tab.

import Markdown, { defaultUrlTransform } from 'react-markdown'
import { Link } from '@tanstack/react-router'
import { WIKILINK_SCHEME, preparePage, wikilinkTarget } from '@/lib/wikilinks'

export function Brief({ wikiKey, markdown }: { wikiKey: string; markdown: string }) {
  return (
    <div className="prose-brief">
      <Markdown
        // The default transform drops any scheme it does not know, which would blank every wikilink.
        urlTransform={(url) => (url.startsWith(WIKILINK_SCHEME) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            const target = wikilinkTarget(href)
            if (target) {
              return (
                <Link
                  to="/w/$key/page"
                  params={{ key: wikiKey }}
                  search={{ link: target }}
                  className="wikilink"
                >
                  {children}
                </Link>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {preparePage(markdown)}
      </Markdown>
    </div>
  )
}
