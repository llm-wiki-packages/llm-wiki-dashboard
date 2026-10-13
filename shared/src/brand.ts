// The one place the product's name and voice live. Nothing else in the
// server or client spells the name: import from here, or read it off
// `/api/config`, which the server fills from this file plus its config.

export const brand = {
  /** The name shown in the header, the browser tab, and the greeting. */
  productName: 'Mission Control',
  /** A short line under the name on empty states and the about panel. */
  tagline: 'What changed, what is running, and what is coming up.',
  /** What the UI calls one knowledge base. "wiki" is the engine's word. */
  wikiNoun: 'wiki',
  wikiNounPlural: 'wikis',
  /** What the UI calls a watched source. The engine's word is "job". */
  channelNoun: 'channel',
  channelNounPlural: 'channels',
  /** What the UI calls a machine that does work for a wiki. */
  machineNoun: 'machine',
  machineNounPlural: 'machines',
  /** The label on the report the wiki's report job writes. */
  briefingNoun: 'briefing',
  briefingNounPlural: 'briefings',
} as const

export type Brand = typeof brand
