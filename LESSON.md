# LESSONS

A mistake book. Every agent reads this at startup. Each entry is a rule we
learned the hard way, with the commit that broke it, the commit that fixed
it, and an example of doing it right.

## How this file works

- **Daily review.** Once a day, review that day's commits and look only for:
  - rework: a fix for something committed earlier,
  - commits that should not have been merged as they were,
  - verification that was too weak to catch the problem.
- **Record or bump.** A new mistake gets a new entry. A repeat gets a new
  date added to its `Seen` line (one date per day, not per commit).
- **Seen 3× → hard rule.** When an entry has been seen on 3 different days,
  move it into **Hard rules** below. Hard rules are not suggestions.
- **Acceptance.** In every commit body and PR description, state what was
  verified: regression tests added/run, real usage checked (live run,
  browser, e2e), and anything that was **not** run and why.

Entry template:

```md
**<one-line rule>**
- <which commit / issue went wrong, and what the consequence was>
- <fix commit>
- Done right: <an example of doing it right>
- Seen N× (YYYY-MM-DD, YYYY-MM-DD).
```

## Hard rules

_None yet. Entries graduate here at Seen 3×._

## Lessons

**Constrain user input at every layer, not just in the widget.**
- The trip date picker let users pick past dates; a saved past date went
  straight through to planning.
- Fix: a0d2d0b
- Done right: disable past days in the calendar, stop paging before the
  current month, and set `min=today` on the hidden inputs so form
  validation also rejects it.
- Seen 1× (2026-10-12).

**Scope hover/focus triggers to the element they describe.**
- The amenity popover opened when hovering anywhere on a result card and
  covered the image and title.
- Fix: 9fd3fb6
- Done right: only the amenity chips (hover, focus or tap) open the list,
  anchored to the chips, flipping below when there is no room above.
- Seen 1× (2026-10-12).

**Release every claim/lock on all exit paths: success, stop and failure.**
- A stopped or failed trip turn kept its revision claim, so the previous
  turn's components stayed disabled.
- Fix: 2504809
- Done right: release the claim in the stop and error paths too, with an
  integration test (`turn.int.spec.ts`) for each path.
- Seen 1× (2026-10-12).

**Verify LLM-facing contracts with a live run, not only with fakes.**
- Fake-LLM tests passed, but live runs showed `show_results` items citing
  the tool name instead of the callId (grounding dropped every hotel) and
  drafts listing several hotels per night (no day linked to a stay).
- Fix: a9701ca, plus the live check in bcc5ab0
- Done right: show the model each tool result's `callId`, state "one hotel
  per night" in the prompt, and run the live check before calling an LLM
  feature done.
- Seen 1× (2026-10-12).

**When a constructor gains a dependency, update every test that builds it in the same commit.**
- Adding `McpService` to `ModelChatReply` left `chat-reply.spec.ts`
  constructing it the old way; it needed a follow-up commit.
- Fix: e75fbab
- Done right: grep for `new X(` / test modules providing `X` and run the
  full service test suite before committing.
- Seen 1× (2026-10-12).

**Add commit trailers once.**
- Several commits on 2026-10-12 (e.g. a0d2d0b, 9fd3fb6, 2504809, a9701ca)
  carry the `Co-Authored-By` trailer twice.
- Fix: none yet (history not rewritten).
- Done right: check `git log -1` after committing; exactly one trailer.
- Seen 1× (2026-10-12).

**Commit messages say what broke, why, and how it was verified.**
- 2f91660 "Fixed the issue that mcap tools weren't triggered" touched 10
  files (+630/−56) with no body, no cause and no verification notes.
- Fix: process, from abd1e46 onward (conventional scopes + explanatory body).
- Done right: a9701ca: names the live-run symptom and the two causes.
- Seen 1× (2026-10-11).
