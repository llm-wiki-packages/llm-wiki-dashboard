# Mockups

The design canvas the dashboard was built from. Two directions are on it:

- **Direction E, executive view** (the one built): `Today.dc.html`,
  `New.dc.html`, `Fleet.dc.html`, `Briefing.dc.html`. Light, warm, attention
  first. One terracotta accent for "new / needs you", teal for "working now".
- **Direction A, operations room** (superseded, kept for comparison):
  `Main.dc.html`, `Wiki.dc.html`, `Ticket.dc.html`, plus two home alternates
  `HomeB.dc.html` (ledger) and `HomeC.dc.html` (orbit).

`canvas.json` lays the boards out. `BRIEF.md` is the design brief the boards
were drawn from, with the real CLI JSON shapes captured on the dev machine.

The `.dc.html` files are Design Component pages. They render inside the
canvas editor's runtime (the `support.js` they reference is the editor's),
so opening one directly in a browser shows the markup without the template
holes filled. Read them for layout, copy, and color; the live canvas is the
place to view them.
