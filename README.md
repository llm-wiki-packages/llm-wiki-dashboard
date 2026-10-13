# llm-wiki-dashboard

The reference dashboard for llm-wiki wikis. It answers three questions for the
person whose life the wikis capture: what is new today, what is running right
now and what is coming up, and what the agents are reporting. It is a
starting point to fork and customize, not a product with settings for
everything.

## Run it

```sh
npm install
npm run dev          # server on :4180 with hot reload, client on :5173 proxying /api
npm start            # build the client, serve everything from :4180
npm run start:mock   # same, on the bundled fixture dataset (demo mode)
npm run check        # typecheck + tests
```

Through the machine CLI, once the package is installed: `llm-wiki-cli dashboard`.

## Layout

| dir | what |
| :-- | :-- |
| `server/` | Hono on Node. Reads the ops CLI's `--json` answers and each wiki's page frontmatter, serves `/api/*` and one SSE stream, and the built client. |
| `client/` | Vite + React + TanStack Router/Query + Tailwind. Five screens (Today, What's new, Fleet, Briefings, Search) and a page reader that `[[wikilinks]]` and search results open. |
| `shared/` | The API types both sides import, and `brand.ts`, the one file that names the product. |
| `docs/mockups/` | The design canvas the screens were built from. |
| `scripts/start-jailed.sh` | The nono jail the server runs under: its grants are the profile. `npm run start:jailed`. |

## Rules the server keeps

- **Read-only by default.** Every CLI call carries `LLM_WIKI_PERMISSIONS=read`
  and `llm-wiki-cli wiki --read-only`. The server knows its mode (`read` or
  `write`) and shows it; v0 ships no write routes.
- **Fixed argv.** Routes choose the verb. Nothing from the browser reaches a
  command line. Every argv spelling lives in `server/src/data/cli.ts`.
- **Loopback and a token.** Binds 127.0.0.1; the opened URL carries a token
  the API checks.
- **One config.** Every environment variable and default is read in
  `server/src/config/`. Nowhere else calls `process.env`.
- **One name.** `shared/src/brand.ts` is the only place the product name
  appears. Change it there.

## Replay

**Replay** in the header walks a recorded day at 1 minute to 1 hour per
second, and every screen follows the clock. The day comes from the wiki's git
history: `git log` gives the commits and the runs they close, and
`op show <session>` gives the paths each commit touched. Both answers are
kept in a SQLite file under `$XDG_STATE_HOME/llm-wiki-dashboard/`, filled
incrementally, so a day costs the CLI calls once. Demo mode replays a canned
day as yesterday. A link can start it: `/w/<key>?replay=2026-09-26&speed=3600&autoplay=1`
(`replay=1` picks the latest day).

## Ask the wiki

Search has an **Answer** mode. Pressing Ask runs the question in one jailed
agent session on the wiki, and the answer streams in as the agent works: a
status line names each step (searching, reading a page) with the time so far,
and the text renders as it arrives, with `[[wikilink]]` citations that open in
the reader. Leaving the page or pressing Stop ends the session. A finished
answer is kept for the tab, so the same question shows again without running
until **Ask again**.

The server runs:

```
llm-wiki-cli wiki <key> harness run sandbox=read-search skill=<skill> [agent=<a>] [model=<m>] [effort=<e>] --stream -- <question>
```

This is the one CLI call without the read floor. `harness run` counts as a
writing verb because it spends model budget, and the read floor must stay safe
to pre-approve. The session runs jailed in `read-search`, which writes nothing
in the wiki. The question is the only thing from the browser on that line: it
goes after `--`, is at most 8 KiB, and never starts with a dash. The gear picks
the model and the effort ("default" passes neither, so the harness uses your
own), the skill and, when the wiki has enabled agents, the agent, kept per
browser. The server accepts only what `DASHBOARD_ASK_MODELS`,
`DASHBOARD_ASK_EFFORTS` and `DASHBOARD_ASK_SKILLS` list (default skill
`llm-wiki:search`, which the llm-wiki plugin ships with an answer mode), and one
question at a time per wiki (`DASHBOARD_ASK_CONCURRENCY` raises that; each answer is a paid session). The stream is the CLI's own JSON lines relayed as
server-sent events; there is no AI library. An answer is an agent's words, so
the page never loads anything from it: an image renders as a link.

Ask is off, and the page says why before anyone types, when:

- the CLI has no `harness run` yet (update the llm-wiki plugins);
- the dashboard runs in a jail (`npm run start:jailed`), because a confined
  process cannot start another: use `npm start` for Ask;
- the wiki has no `read-search` sandbox (the page shows `sandboxes seed
  read-search`, then `sandboxes enable read-search`), or has one that is not
  enabled on this machine.

Demo mode streams a canned answer with the same steps.

## Presenting

`/` jumps to Search from any screen and `Esc` clears it. The "demo data"
label hides with its ×, and `d` brings it back. Every screen is checked at
1280×800 for clipped text and sideways scroll.

## Customizing

Fork. Change `shared/src/brand.ts` and `client/src/theme.css` first; that
covers name, colors, and type. Hide or reorder screens in
`client/src/routes/`. The data layer in `server/src/data/` is the part that
should survive a fork: it owns the CLI seam and the frontmatter reading.

**Themes and modes.** Three themes ship (Paper, Slate, Sage), each in light
and dark; the header picks them and the choice is kept per browser. A theme
is one block of token overrides per mode in `client/src/theme.css` plus one
entry in `client/src/lib/theme.ts`. Add yours the same way; the components
only ever name tokens.

## Requirements

Node 24 or later, and the llm-wiki ops distribution on the machine
(`llm-wiki-cli` on `PATH`, or `DASHBOARD_CLI` pointing at it), at
`min_ops_version` in `llm-wiki-package.json` or later: the build that answers
`jobs ls`, `jobs due`, `jobs show` and `tickets ls` as groups of their own,
with the reshaped job record (`kind`, `claim`, `machine`, and a routines job's
steps, each a skill, an op or a script), and each job's due verdict: why it is
or is not due on this machine, when it next is, and the tickets running here
(`jobs ls --verbose` and `jobs show`). The dashboard derives no dueness of its
own. An older build refuses `--verbose`, and one before 0.7.0 answers none of
those verbs.

<!-- TODO: confirm min_ops_version in llm-wiki-package.json once the merger assigns the version batch that consumes simple10/llm-wiki-plugins's pending intent 3295-jobs-verdict (#3301). Ops is 0.7.0 on main and the intent is minor, so 0.8.0 is expected but not yet assigned. The manifest's key set is closed, so the TODO lives here. -->
