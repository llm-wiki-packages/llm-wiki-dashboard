#!/usr/bin/env node
// A stand-in for llm-wiki-cli: echoes its argv and env back as JSON so tests
// can assert what the server would have run, without a wiki on the box.
// `FAKE_CLI_FAIL=1` makes it answer the way the real CLI does on a bad verb.
const argv = process.argv.slice(2)
if (process.env.FAKE_CLI_FAIL === '1') {
  process.stdout.write(JSON.stringify({ error: 'No such command', _cmd_: {} }))
  process.exit(2)
}
process.stdout.write(
  JSON.stringify({
    argv,
    permissions: process.env.LLM_WIKI_PERMISSIONS ?? null,
    _cmd_: { elapsed_ms: 0, wiki: null, head: null },
  }),
)
