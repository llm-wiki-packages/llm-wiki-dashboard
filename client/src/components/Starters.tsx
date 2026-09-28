// What a wiki with no watches shows on Fleet: three places work usually
// lives, each with the two commands that start pulling from it. The commands
// are the channel skills' own enable steps, with this wiki's key filled in.

import { useState } from 'react'
import { Check, Copy, Mail, NotebookTabs, Video } from 'lucide-react'
import { Card, SectionLabel, cn } from './ui'

const STARTERS = [
  {
    id: 'gmail',
    icon: Mail,
    title: 'A mailbox',
    pitch: 'Client threads become pages: who asked what, and by when.',
    skill: 'channel-gmail',
    add: 'pipeline jobs add work-mail slug=work-mail skill=channel-gmail options.mailbox=you@example.com every=1d',
  },
  {
    id: 'notion',
    icon: NotebookTabs,
    title: 'A Notion workspace',
    pitch: 'Tasks and records, kept current as they change.',
    skill: 'channel-notion-tasks',
    add: 'pipeline jobs add notion-tasks slug=notion-tasks skill=channel-notion-tasks options.workspace=YOUR-WORKSPACE every=1d',
  },
  {
    id: 'youtube',
    icon: Video,
    title: 'A video worth keeping',
    pitch: 'Transcribed, summarized, and filed under the areas it touches.',
    skill: 'channel-youtube',
    add: "pipeline jobs add 'https://www.youtube.com/watch?v=VIDEO-ID' slug=my-video skill=channel-youtube",
  },
] as const

export function Starters({ wikiKey, cli, channelNoun }: { wikiKey: string; cli: string; channelNoun: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const chosen = STARTERS.find((s) => s.id === open)
  return (
    <Card className="flex flex-col gap-4">
      <SectionLabel>Start a {channelNoun}</SectionLabel>
      <p className="text-sm text-ink-2">Nothing is watched yet. Point this at where your work happens and it fills in on its own.</p>
      <div className="grid gap-3 md:grid-cols-3">
        {STARTERS.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.id} className="flex flex-col gap-2.5 rounded-xl border border-line bg-paper p-4">
              <div className="flex items-center gap-2.5">
                <Icon className="size-5 text-accent" />
                <span className="text-[15px] font-semibold">{s.title}</span>
              </div>
              <p className="text-sm leading-[1.5] text-ink-2">{s.pitch}</p>
              <button
                type="button"
                aria-expanded={open === s.id}
                onClick={() => setOpen(open === s.id ? null : s.id)}
                className="self-start text-sm font-semibold text-accent"
              >
                {open === s.id ? 'Hide the commands' : 'Show me how'}
              </button>
            </div>
          )
        })}
      </div>
      {chosen && (
        <CommandBlock
          lines={[
            `${cli} wiki ${wikiKey} skills install ${chosen.skill}`,
            `${cli} wiki ${wikiKey} skills enable ${chosen.skill} --confirm`,
            `${cli} wiki ${wikiKey} ${chosen.add}`,
          ]}
        />
      )}
    </Card>
  )
}

export function CommandBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false)
  const text = lines.join('\n')
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-ink p-3 pr-12 text-[12.5px] leading-[1.6] text-paper">{text}</pre>
      <button
        type="button"
        aria-label="Copy the commands"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        className={cn('absolute right-2 top-2 rounded-md p-1.5 text-paper/70 hover:text-paper')}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  )
}
