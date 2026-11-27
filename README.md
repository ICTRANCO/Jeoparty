# Jeoparty! — Game and Clue-Writing Guide

## What is Jeopardy?

Jeopardy! is a quiz game in which players choose a category and point value, then receive a clue. The player who knows the response tries to buzz in first. In the traditional format, players phrase their responses as questions—for example, “What is Saturn?”—and a host decides whether the response is correct.

This project is a customizable, Jeopardy-style game with a Jeopardy round, a Double Jeopardy round (values of 200–1,000), and a Final Jeopardy clue. Use the Main Screen to switch between rounds. Each board round has six categories with five clues and two randomly placed Daily Doubles; a new game reshuffles their locations. The Admin view manages each round independently and edits the final category, clue, and answer. Host View shows the active clue and answer, manages Daily Double wagers, and records Final Jeopardy wagers and results. Theme and Daily Double sounds play during the game; the theme can be muted from the Main Screen or game board. The categories, audience, clues, and answers can be tailored to a group or event.

## Import categories from the family sheet

In Admin, open Round 1 or Round 2, load categories from the linked sheet, and choose six distinct categories to preview their clues, answers, and confidence flags. Confirming the import replaces that round’s categories and clues and resets its squares to unplayed; team scores and Daily Doubles remain unchanged. Sheet values for Round 2 are mapped by clue order to the board’s $200–$1,000 values. Answers marked Medium or otherwise not High confidence, plus entries with sheet notes, remain highlighted for host review until edited in Admin.

For Final Jeopardy, open the Final Jeopardy round in Admin and load a question from the sheet’s unassigned rows. Choose a question to preview and fill the final category, clue, and answer fields, then save. Any non-High confidence answer or sheet note is retained as a review warning; editing the fields clears that warning.

## Track category play counts

The app can record one play per sheet category per game. Final Jeopardy is recorded after all teams have been scored. Admin lists categories and Final Jeopardy questions in ascending play-count order and shows their existing counts; played choices remain available.

1. Create a Google Apps Script project and paste in [`apps-script/Code.gs`](./apps-script/Code.gs).
2. In the Apps Script project settings, add the script property `JEOPARDY_SHEET_WRITE_TOKEN`. Use a long random token (at least 32 characters) and keep it private.
3. Deploy the script as a web app that executes as your Google account. Allow the app to reach the web app, then copy its `/exec` URL. The shared token authorizes writes; do not put it in source control or chat.
4. Configure both `JEOPARDY_SHEET_WRITE_URL` (the `/exec` URL) and `JEOPARDY_SHEET_WRITE_TOKEN` for the app server.

For a local PowerShell session, set the two environment variables before starting the server:

```powershell
$env:JEOPARDY_SHEET_WRITE_URL = 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
$env:JEOPARDY_SHEET_WRITE_TOKEN = 'the-same-private-token-set-in-Apps-Script'
npm start
```

For Cloudflare, add both as Worker secrets with `npx wrangler secret put JEOPARDY_SHEET_WRITE_URL` and `npx wrangler secret put JEOPARDY_SHEET_WRITE_TOKEN`, then deploy. Never commit the values. If tracking is unconfigured or temporarily unavailable, updates remain queued and retry on later sheet loads, clue closes, and scoring requests. The Apps Script play log deduplicates retries and preserves any pre-existing `Times Played` values.

## Build a good board

### Choose focused categories

- Make each category clear and distinct; a player should understand what belongs in it.
- Keep every clue in a category tied directly to that category.
- If a category has a special rule—such as a specific subject, word pattern, location, or time period—apply the rule to every clue in that category.
- Avoid repeating the same fact or answer in multiple categories.

### Write clues as clues, not questions

Present a concise statement, description, or set of identifying facts. The player supplies the response. Avoid asking “What is…?” or “Who is…?” in the clue itself.

**Good**

- Category: **7-Letter Words**
- Clue: “A young child just learning to walk, or a clothing size often worn by one.”
- Answer: “Toddler”

**Avoid**

- Clue: “What is a toddler?”
- Answer: “A young child”

The second example gives away the response and reverses the clue-and-answer format.

### Make each clue fair and unambiguous

- Include enough information for a knowledgeable player to identify one intended response.
- Check whether another reasonable response could also fit. If so, add a distinguishing detail or choose a different clue.
- Avoid clues that are too broad, rely on misleading wording, or require a guess about what the writer had in mind.
- Keep the clue self-contained. Do not rely on contestants’ names, private context, or information that is not displayed or generally known.
- Use clear wording appropriate to the audience; difficulty should come from the knowledge required, not confusing phrasing.

### Increase difficulty with the point value

For each category, arrange clues from easier to harder:

| Value | Suggested difficulty |
| --- | --- |
| 100 | Very familiar; most of the intended audience should know it quickly. |
| 200 | Easy, with a small step of recall or thought. |
| 300 | Moderate; requires solid knowledge of the category. |
| 400 | Challenging, but fair for the intended audience. |
| 500 | The most demanding clue in the category, without relying on an obscure technicality. |

Set difficulty for the audience you actually expect. A clue that is easy for adults may be difficult for younger players, and vice versa.

## Develop the answer

- Put the response itself in the answer field—not “What is…?”, “Who is…?”, or a full explanation.
- Make sure the answer satisfies every part of the clue and is as specific as the wording requires. If the clue asks for a country, for example, a city is not enough.
- Use a short canonical answer, such as “Saturn,” “The Nile,” or “United States.”
- Make sure the answer does not include key words from the cateogry title
- Decide before play whether common equivalents, alternate spellings, abbreviations, or reasonable pronunciation differences count. If useful, note accepted alternatives alongside the canonical answer for the host.
- Avoid answers that require a particular spelling unless the category explicitly tests spelling or wordplay.
- For a multi-part clue, make clear that all parts are required and include all of them in the answer.

In traditional Jeopardy!, the player says the answer in question form. The stored answer should still be the plain response so the host can judge it easily.

## Fact-check before play

Verify names, dates, quotations, records, and other specific claims using a reliable source. Prefer stable, well-established facts. Replace anything uncertain, disputed, subjective, or likely to become outdated. Also check that:

1. The clue is factually correct.
2. The intended answer is correct and complete.
3. No other reasonable answer fits equally well.
4. The clue clearly belongs in its category.
5. The wording and difficulty suit the audience and point value.
6. The clue does not reveal its own answer.

## Quick writing pattern

1. Choose a focused category and a fact that fits it.
2. Write the plain answer first.
3. Draft a short statement that points clearly to that answer without naming it.
4. Check for other plausible answers and add a useful distinguishing detail if needed.
5. Confirm the fact and set its difficulty relative to the other clues in the category.
6. Record the canonical answer and any alternatives the host should accept.
