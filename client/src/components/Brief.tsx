// A page body rendered as an article: markdown, with wikilinks routed to the
// in-app reader and outside links opened in a new tab.

import Markdown from 'react-markdown'
import { Link } from '@tanstack/react-router'
import { preparePage, wikilinkTarget } from '@/lib/wikilinks'

export function Brief({ wikiKey, markdown }: { wikiKey: string; markdown: string }) {
  return (
    <div className="prose-brief">
      <Markdown
        components={{
          a: ({ href, children }) => {
            const target = wikilinkTarget(href)
            if (target) {
              return (
                <Link to="/w/$key/page" params={{ key: wikiKey }} search={{ link: target }} className="wikilink">
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
