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
(`llm-wiki-cli` on `PATH`, or `DASHBOARD_CLI` pointing at it).
