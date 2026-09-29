import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Brief } from './Brief'

describe('Brief', () => {
  it('renders an image as a link and never as an <img> that would load it', () => {
    const html = renderToString(<Brief wikiKey="kb" markdown={'See ![the chart](https://evil.example/pixel.png?leak=1) here.'} />)
    expect(html).not.toMatch(/<img/)
    expect(html).toMatch(/<a href="https:\/\/evil.example\/pixel.png\?leak=1"[^>]*>the chart \(image\)<\/a>/)
  })
})
