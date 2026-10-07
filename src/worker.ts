import { DurableObject } from 'cloudflare:workers';
import initialBoard from '../data/board.json';

const DEFAULT_GAME_TITLE = 'JEOPARTY!';
const MODEL = 'gpt-4o';
const POINTS = [100, 200, 300, 400, 500];

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function cellFor(board: Board, catIndex: number, points: number): Cell | undefined {
  return board.cells.find((cell) => cell.catIndex === catIndex && cell.points === points);
}

function normalizedBoard(value: Board): Board {
  const board = structuredClone(value);
  if (!Array.isArray(board.teams) || board.teams.length !== 3) {
    board.teams = Array.from({ length: 3 }, (_, index) => ({ name: `Team ${index + 1}`, score: 0 }));
  }
  board.gameTitle = String(board.gameTitle || '').trim() || DEFAULT_GAME_TITLE;
  if (board.questionTimerSeconds === undefined) board.questionTimerSeconds = 5;
  if (board.buzzTimerSeconds === undefined) board.buzzTimerSeconds = 5;
  if (!Array.isArray(board.categoryNotes) || board.categoryNotes.length !== board.categories.length) {
    board.categoryNotes = board.categories.map((_, i) => String(board.categoryNotes?.[i] || ''));
  }
  board.cells.forEach((cell) => {
    if (typeof cell.lowConfidence !== 'boolean') cell.lowConfidence = false;
  });
  if (!Number.isInteger(board.chooserTeamIndex) || !board.teams[board.chooserTeamIndex as number]) board.chooserTeamIndex = null;
  delete (board as Board & { scoreHistory?: unknown[] }).scoreHistory;
  return board;
}

function buildPrompt(categories: string[], ageGroup: string, categoryNotes: string[]): string {
  const age = ageGroup.trim() || 'general adult audience';
  const categoryListing = categories
    .map((c, i) => {
      const note = categoryNotes && categoryNotes[i] ? String(categoryNotes[i]).trim() : '';
      return note ? `- "${c}" — Guidance for this category: ${note}` : `- "${c}"`;
    })
    .join('\n');
  return `You are an expert trivia writer and editor creating clues for a home-made Jeopardy-style game.

Your priorities, in order, are:

1. Factual accuracy
2. Strong fit with the category
3. One clear, unambiguous answer
4. Age-appropriate content
5. A smooth difficulty progression from 100 to 500 points

Categories (use these exact names as JSON keys). Where a category has guidance attached, every clue in that category must follow it:

${categoryListing}

Audience / age group:
${age}

For EACH category, create exactly 5 clues, one for each point value: 100, 200, 300, 400, and 500.

## CATEGORY INTERPRETATION

Before creating clues, determine what each category means.

Every clue must clearly and directly belong to its category.

A clue should pass this test:

"If a player saw the clue first and then saw the category name, would the connection feel obvious and intentional?"

Do not include general trivia that is only loosely related to the category.

If a category contains a special constraint, such as:

* a specific letter
* words beginning or ending a certain way
* a person
* a movie, show, book, or franchise
* a historical period
* a geographic location
* a science or school subject
* a type of wordplay

then EVERY clue in that category must follow that constraint exactly.

Do not use the category name verbatim inside its own clues unless necessary for clarity.

## FACTUAL ACCURACY

Only use facts you are highly confident are correct.

Prefer well-established, stable facts over obscure or questionable trivia.

Do not invent or guess:

* names
* dates
* quotations
* movie or TV details
* song details
* scientific facts
* historical facts
* records or statistics
* character names or relationships

Each clue must have one clearly intended answer.

Avoid clues where two or more reasonable answers could fit.

If you are uncertain whether a fact is correct, do not use it. Replace it with a different fact you know with high confidence.

## DIFFICULTY

Use this scale for the stated audience:

100 points:
Very easy. Most players should know it immediately.

200 points:
Easy. Familiar knowledge, but requires a little thought.

300 points:
Moderate. Requires solid knowledge of the topic.

400 points:
Hard. Less obvious, but still fair for the audience.

500 points:
Challenging. Requires deeper knowledge or an additional inference, but should never depend on an obscure technicality.

Difficulty should come from the knowledge required, not from confusing wording.

The five clues should become progressively harder.

## JEOPARDY-STYLE CLUES

Write each clue as a statement or description, NOT as a direct question.

GOOD:
Clue: "This planet is home to the Great Red Spot."
Answer: "Jupiter"

BAD:
Clue: "What planet has the Great Red Spot?"
Answer: "Jupiter"

Answers should NOT include:
"What is..."
"Who is..."
"Where is..."

Return only the answer itself.

Keep:

* each clue under 200 characters
* each answer under 80 characters

Use clear, natural language appropriate for the stated age group.

## CLUE QUALITY

Each clue should provide enough information for a knowledgeable player to identify the intended answer.

Do not make clues so broad that many answers could work.

BAD:
Clue: "This animal lives in Africa."
Answer: "Lion"

GOOD:
Clue: "Known for the male's large mane, this African big cat lives in groups called prides."
Answer: "Lion"

Do not accidentally include the answer in the clue.

Do not make the clue depend on spelling tricks unless the category specifically calls for them.

Avoid:

* subjective questions
* disputed facts
* opinion-based answers
* trick questions
* misleading wording
* unnecessarily obscure trivia
* clues based on very recent events unless the category specifically requires current events
* duplicate facts or answers within the same game

## INTERNAL REVIEW

After drafting the clues, review EVERY clue before returning the final JSON.

For each clue, silently check:

1. FACT CHECK
   Is the fact correct?

2. ANSWER CHECK
   Does the stated answer correctly satisfy every part of the clue?

3. UNIQUE ANSWER CHECK
   Could another reasonable answer also fit?

4. CATEGORY CHECK
   Does the clue clearly and specifically belong to this category?

5. AGE CHECK
   Is the knowledge and wording appropriate for the stated audience?

6. DIFFICULTY CHECK
   Does the point value match the difficulty relative to the other clues in that category?

7. WORDING CHECK
   Is the clue clear, concise, grammatical, and not phrased as a question?

If ANY check fails, rewrite or replace that clue before returning the result.

Be especially strict about factual accuracy and category fit.

## OUTPUT REQUIREMENTS

Respond with ONLY valid raw JSON.

Do not include:

* markdown
* code fences
* explanations
* introductions
* comments
* notes

Use the exact category names provided above as JSON keys.

For every category, return exactly five objects in this order:

100
200
300
400
500

Use exactly this structure, with one entry per category (repeat the five-clue array for every category listed above):

{
"CategoryNameExactlyAsGiven": [
{
"points": 100,
"clue": "...",
"answer": "..."
},
{
"points": 200,
"clue": "...",
"answer": "..."
},
{
"points": 300,
"clue": "...",
"answer": "..."
},
{
"points": 400,
"clue": "...",
"answer": "..."
},
{
"points": 500,
"clue": "...",
"answer": "..."
}
],
"AnotherCategoryNameExactlyAsGiven": [ ... ]
}

Before responding, perform one final silent review of the entire game and replace any clue that is questionable, ambiguous, incorrectly categorized, or factually uncertain.`;
}

function extractJson(text: string): Record<string, GeneratedCell[]> {
  try {
    return JSON.parse(text) as Record<string, GeneratedCell[]>;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as Record<string, GeneratedCell[]>;
    throw new Error('Could not parse JSON from AI response');
  }
}

function normalizeForMatch(text: string): string {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clueLeaksAnswer(clue: string, answer: string): boolean {
  const normAnswer = normalizeForMatch(answer);
  return normAnswer.length >= 3 && normalizeForMatch(clue).includes(normAnswer);
}

// Flags entries whose clue gives away its own answer, or whose answer
// duplicates another answer in the same category. Returns a Map of
// "catIndex|points" -> reason for entries that should not be trusted.
function findFlaggedEntries(parsed: Record<string, GeneratedCell[]>, categories: string[]): Map<string, string> {
  const flagged = new Map<string, string>();
  categories.forEach((catName, catIndex) => {
    const entries = Array.isArray(parsed[catName]) ? parsed[catName] : [];
    const answerSeenAt = new Map<string, string>();
    entries.forEach((entry) => {
      const key = `${catIndex}|${Number(entry.points)}`;
      if (clueLeaksAnswer(entry.clue, entry.answer)) {
        flagged.set(key, 'The clue gives away the answer');
      }
      const answerKey = String(entry.answer || '').trim().toLowerCase();
      if (!answerKey) return;
      if (answerSeenAt.has(answerKey)) {
        flagged.set(key, 'Duplicate answer used elsewhere in this category');
        flagged.set(answerSeenAt.get(answerKey) as string, 'Duplicate answer used elsewhere in this category');
      } else {
        answerSeenAt.set(answerKey, key);
      }
    });
  });
  return flagged;
}

interface ReviewEntry { category: string; points: number; clue: string; answer: string; categoryNote?: string; knownIssue?: string | null }
interface ReviewProblem { category?: string; points?: number; reason?: string; clue?: string; answer?: string }
interface ReviewResponse { problems?: ReviewProblem[] }
interface Resolution { reason: string; clue: string; answer: string }

function buildReviewPrompt(entries: ReviewEntry[]): string {
  const listing = entries
    .map((e) => {
      const guidance = e.categoryNote ? `\nCategory guidance: ${e.categoryNote}` : '';
      const hint = e.knownIssue ? `\nKNOWN ISSUE: ${e.knownIssue} — this entry MUST be replaced.` : '';
      return `Category: "${e.category}" | Points: ${e.points}\nClue: "${e.clue}"\nAnswer: "${e.answer}"${guidance}${hint}`;
    })
    .join('\n\n');
  return `You are a strict fact-checker and editor doing a final review of a finished Jeopardy-style trivia board before it is used in a live game.

For EACH clue/answer pair below, check:

1. CATEGORY FIT — Does the clue clearly and specifically belong to its stated category, and follow its category guidance (if any) exactly?
2. ANSWER LEAK — Does the clue give away the answer, directly or by naming it in another form?
3. FACTUAL ACCURACY — Is the stated answer actually correct for the clue as written?
4. UNIQUE ANSWER — Could a different, equally valid answer also fit the clue?

Any entry marked KNOWN ISSUE has already failed review and must be replaced regardless of your own judgment.

When an entry has a problem — whether you found it yourself or it was marked as a known issue — write a brand new clue and answer for that exact category and point value, following its category guidance (if any). Match the difficulty to the point value (100 = very easy, 500 = challenging, per the usual Jeopardy-style curve) and follow the same clue style as the rest of the board: a statement of fact, not a question, that does not give away the answer, with exactly one correct answer.

Board:

${listing}

Respond with ONLY raw JSON in exactly this shape (empty array if every entry is fine):

{"problems": [{"category": "ExactCategoryNameAsGiven", "points": 100, "reason": "short explanation", "clue": "replacement clue", "answer": "replacement answer"}]}`;
}

// Second-pass review: sends every generated entry back to the model as a
// fact-checker/editor. Entries already known to be bad (mechanical leak or
// duplicate-answer check) are marked so the model replaces them outright;
// anything else it objects to on its own (category fit, factual accuracy,
// ambiguity) is flagged and replaced too. Returns a Map of "catIndex|points"
// -> { reason, clue, answer } (clue/answer are '' if no replacement was
// produced), or null (distinct from an empty Map) if the call itself failed,
// so callers can tell "nothing wrong" apart from "couldn't check".
async function reviewGeneratedEntries(entries: ReviewEntry[], categories: string[], apiKey: string): Promise<Map<string, Resolution> | null> {
  if (!entries.length) return new Map();
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3072,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildReviewPrompt(entries) }],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json<OpenAiResponse>();
    const text = data.choices?.[0]?.message?.content || '';
    let parsed: ReviewResponse;
    try {
      parsed = JSON.parse(text) as ReviewResponse;
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      parsed = JSON.parse(text.slice(start, end + 1)) as ReviewResponse;
    }
    const flagged = new Map<string, Resolution>();
    const problems = Array.isArray(parsed.problems) ? parsed.problems : [];
    problems.forEach((problem) => {
      const catIndex = categories.indexOf(problem.category || '');
      const points = Number(problem.points);
      if (catIndex === -1 || !POINTS.includes(points)) return;
      flagged.set(`${catIndex}|${points}`, {
        reason: String(problem.reason || 'Flagged by review pass'),
        clue: String(problem.clue || ''),
        answer: String(problem.answer || ''),
      });
    });
    return flagged;
  } catch {
    return null;
  }
}

const GENERATE_MAX_ATTEMPTS = 2;
const REPAIR_MAX_ATTEMPTS = 5;

function toParsedShape(entryMap: Map<string, { clue: string; answer: string }>, categories: string[]): Record<string, GeneratedCell[]> {
  const shape: Record<string, GeneratedCell[]> = {};
  categories.forEach((catName, catIndex) => {
    shape[catName] = POINTS.map((points) => {
      const entry = entryMap.get(`${catIndex}|${points}`) || { clue: '', answer: '' };
      return { points, clue: entry.clue, answer: entry.answer };
    });
  });
  return shape;
}

export class GameRoom extends DurableObject<Env> {
  private board!: Board;
  private config!: GameConfig;
  private currentQuestion: HostQuestion | null = null;
  private currentBuzzer: HostBuzzer | null = null;
  private revision = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.board = normalizedBoard((await ctx.storage.get<Board>('board')) || (initialBoard as Board));
      this.config = (await ctx.storage.get<GameConfig>('config')) || { apiKey: '' };
      this.currentQuestion = (await ctx.storage.get<HostQuestion>('currentQuestion')) || null;
      this.currentBuzzer = (await ctx.storage.get<HostBuzzer>('currentBuzzer')) || null;
      this.revision = (await ctx.storage.get<number>('revision')) || 0;
      await ctx.storage.put({ board: this.board, config: this.config });
    });
  }

  private hostState(): HostState {
    return {
      revision: this.revision,
      question: this.currentQuestion,
      buzzer: this.currentBuzzer,
      chooser: this.board.chooserTeamIndex === null ? null : {
        teamIndex: this.board.chooserTeamIndex,
        teamName: this.board.teams[this.board.chooserTeamIndex].name,
      },
    };
  }

  private broadcastHostState(): void {
    const message = JSON.stringify(this.hostState());
    for (const socket of this.ctx.getWebSockets('host')) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, 'Update failed');
      }
    }
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, 'Update failed');
      }
    }
  }

  async webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    try {
      const command = JSON.parse(message) as { type?: string };
      if (command.type === 'start-buzzers') {
        this.broadcast({ type: 'buzzers-ready', sentAt: Date.now() });
      } else if (command.type === 'buzzer-state') {
        const buzzer = command as { type: string; teamIndex?: number | null; teamName?: string };
        this.currentBuzzer = buzzer.teamIndex === null
          ? null
          : { teamIndex: Number(buzzer.teamIndex), teamName: String(buzzer.teamName || '') };
        await this.ctx.storage.put('currentBuzzer', this.currentBuzzer);
        this.broadcast({
          type: 'buzzer-state',
          teamIndex: buzzer.teamIndex,
          teamName: buzzer.teamName,
          sentAt: Date.now(),
        });
      } else if (['reveal-answer', 'score-correct', 'score-incorrect', 'times-up', 'close-question'].includes(command.type || '')) {
        this.broadcast({ type: command.type, sentAt: Date.now() });
      }
    } catch {
      // Ignore malformed remote-control messages.
    }
  }

  private async setCurrentQuestion(question: HostQuestion | null): Promise<void> {
    this.currentQuestion = question;
    this.currentBuzzer = null;
    this.revision += 1;
    await this.ctx.storage.put({ currentQuestion: question, currentBuzzer: null, revision: this.revision });
    this.broadcastHostState();
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const method = request.method;

      if (url.pathname === '/api/host/events' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server, ['host']);
        server.send(JSON.stringify(this.hostState()));
        return new Response(null, { status: 101, webSocket: client });
      }

      if (url.pathname === '/api/board' && method === 'GET') return json(this.board);

      if (url.pathname === '/api/board/title' && method === 'PUT') {
        const body = await request.json<{ title?: string }>();
        this.board.gameTitle = String(body.title || '').trim().slice(0, 60) || DEFAULT_GAME_TITLE;
        await this.ctx.storage.put('board', this.board);
        return json(this.board);
      }

      if (url.pathname === '/api/board/categories' && method === 'PUT') {
        const body = await request.json<{ categories?: unknown; categoryNotes?: unknown }>();
        if (!Array.isArray(body.categories) || body.categories.length !== 6) return json({ error: 'categories must be an array of 6 strings' }, 400);
        if (body.categoryNotes !== undefined && (!Array.isArray(body.categoryNotes) || body.categoryNotes.length !== 6)) {
          return json({ error: 'categoryNotes must be an array of 6 strings' }, 400);
        }
        this.board.categories = body.categories.map((category) => String(category || '').slice(0, 60));
        if (body.categoryNotes !== undefined) {
          this.board.categoryNotes = body.categoryNotes.map((note) => String(note || '').slice(0, 300));
        }
        await this.ctx.storage.put('board', this.board);
        return json(this.board);
      }

      if (url.pathname === '/api/board/timers' && method === 'PUT') {
        const body = await request.json<{ questionTimerSeconds?: number | null; buzzTimerSeconds?: number | null }>();
        const normalizeTimer = (value: number | null | undefined) => value === null ? null : Number(value);
        const questionTimerSeconds = normalizeTimer(body.questionTimerSeconds);
        const buzzTimerSeconds = normalizeTimer(body.buzzTimerSeconds);
        const valid = (value: number | null) => value === null || (Number.isFinite(value) && value >= 1 && value <= 120);
        if (!valid(questionTimerSeconds) || !valid(buzzTimerSeconds)) return json({ error: 'Timers must be between 1 and 120 seconds, or disabled' }, 400);
        this.board.questionTimerSeconds = questionTimerSeconds;
        this.board.buzzTimerSeconds = buzzTimerSeconds;
        await this.ctx.storage.put('board', this.board);
        return json(this.board);
      }

      if (url.pathname === '/api/board/cell' && method === 'PUT') {
        const body = await request.json<{ catIndex: number; points: number; clue?: string; answer?: string }>();
        const cell = cellFor(this.board, Number(body.catIndex), Number(body.points));
        if (!cell) return json({ error: 'cell not found' }, 404);
        if (typeof body.clue === 'string') cell.clue = body.clue;
        if (typeof body.answer === 'string') cell.answer = body.answer;
        cell.lowConfidence = false;
        await this.ctx.storage.put('board', this.board);
        return json(cell);
      }

      if (url.pathname === '/api/board/reveal' && method === 'POST') {
        const body = await request.json<{ catIndex: number; points: number }>();
        const cell = cellFor(this.board, Number(body.catIndex), Number(body.points));
        if (!cell) return json({ error: 'cell not found' }, 404);
        cell.used = true;
        await this.ctx.storage.put('board', this.board);
        return json(cell);
      }

      if (url.pathname === '/api/board/reset' && method === 'POST') {
        this.board.cells.forEach((cell) => { cell.used = false; });
        this.board.teams.forEach((team) => { team.score = 0; });
        this.board.chooserTeamIndex = null;
        await this.ctx.storage.put('board', this.board);
        await this.setCurrentQuestion(null);
        return json(this.board);
      }

      if (url.pathname === '/api/board/teams' && method === 'PUT') {
        const body = await request.json<{ teams?: unknown }>();
        if (!Array.isArray(body.teams) || body.teams.length !== 3) return json({ error: 'teams must be an array of 3 names' }, 400);
        const teamNames = body.teams;
        this.board.teams.forEach((team, index) => {
          team.name = String(teamNames[index] || '').slice(0, 30) || `Team ${index + 1}`;
        });
        await this.ctx.storage.put('board', this.board);
        return json(this.board);
      }

      if (url.pathname === '/api/board/score' && method === 'POST') {
        const body = await request.json<{ teamIndex: number; correct: boolean }>();
        if (!this.currentQuestion) return json({ error: 'No active question to score' }, 400);
        const team = this.board.teams[Number(body.teamIndex)];
        if (!team) return json({ error: 'team not found' }, 404);
        const points = this.currentQuestion.points;
        team.score += body.correct ? points : -points;
        if (body.correct) this.board.chooserTeamIndex = Number(body.teamIndex);
        await this.ctx.storage.put('board', this.board);
        this.broadcastHostState();
        this.broadcast({ type: 'board-updated', sentAt: Date.now() });
        return json(this.board);
      }

      if (url.pathname === '/api/board/score-adjust' && method === 'POST') {
        const body = await request.json<{ teamIndex: number; delta: number }>();
        const team = this.board.teams[Number(body.teamIndex)];
        const delta = Number(body.delta);
        if (!team) return json({ error: 'team not found' }, 404);
        if (delta !== 100 && delta !== -100) return json({ error: 'delta must be 100 or -100' }, 400);
        team.score += delta;
        await this.ctx.storage.put('board', this.board);
        this.broadcast({ type: 'board-updated', sentAt: Date.now() });
        return json(this.board);
      }

      if (url.pathname === '/api/host/question' && method === 'GET') return json(this.hostState());

      if (url.pathname === '/api/host/question' && method === 'POST') {
        const body = await request.json<{ catIndex: number; points: number }>();
        const catIndex = Number(body.catIndex);
        const points = Number(body.points);
        const cell = cellFor(this.board, catIndex, points);
        if (!cell) return json({ error: 'cell not found' }, 404);
        await this.setCurrentQuestion({
          catIndex,
          category: this.board.categories[catIndex] || `Category ${catIndex + 1}`,
          points,
          clue: cell.clue || '',
          answer: cell.answer || '',
        });
        return json(this.hostState());
      }

      if (url.pathname === '/api/host/question' && method === 'DELETE') {
        await this.setCurrentQuestion(null);
        return json(this.hostState());
      }

      if (url.pathname === '/api/config' && method === 'GET') return json({ hasApiKey: Boolean(this.config.apiKey) });

      if (url.pathname === '/api/config/apikey' && method === 'POST') {
        const body = await request.json<{ apiKey?: string }>();
        if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) return json({ error: 'apiKey is required' }, 400);
        this.config = { apiKey: body.apiKey.trim() };
        await this.ctx.storage.put('config', this.config);
        return json({ hasApiKey: true });
      }

      if (url.pathname === '/api/config/apikey' && method === 'DELETE') {
        this.config = { apiKey: '' };
        await this.ctx.storage.put('config', this.config);
        return json({ hasApiKey: false });
      }

      if (url.pathname === '/api/generate' && method === 'POST') return this.generateQuestions(request);
      return json({ error: 'not found' }, 404);
    } catch (error) {
      console.error(JSON.stringify({ message: 'request failed', error: error instanceof Error ? error.message : String(error) }));
      return json({ error: error instanceof Error ? error.message : 'Request failed' }, 500);
    }
  }

  private async generateQuestions(request: Request): Promise<Response> {
    if (!this.config.apiKey) return json({ error: 'No API key configured. Add one on the Admin page first.' }, 400);
    const body = await request.json<{ ageGroup?: string }>();
    const ageGroup = String(body.ageGroup || '');
    const categories = this.board.categories;
    const categoryNotes = this.board.categoryNotes;
    const prompt = buildPrompt(categories, ageGroup, categoryNotes);

    let generated: Record<string, GeneratedCell[]> = {};
    let flagged = new Map<string, string>();

    for (let attempt = 1; attempt <= GENERATE_MAX_ATTEMPTS; attempt++) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await response.json<OpenAiResponse>();
      if (!response.ok) return json({ error: `OpenAI API error: ${data.error?.message || response.statusText}` }, response.status);
      generated = extractJson(data.choices?.[0]?.message?.content || '');
      flagged = findFlaggedEntries(generated, categories);
      if (flagged.size === 0) break;
    }

    // Flat working copy of every generated entry, keyed by "catIndex|points",
    // that the repair rounds below read from and write back into.
    const entryMap = new Map<string, { clue: string; answer: string }>();
    categories.forEach((category, catIndex) => {
      const entries = Array.isArray(generated[category]) ? generated[category] : [];
      entries.forEach((entry) => {
        const points = Number(entry.points);
        entryMap.set(`${catIndex}|${points}`, { clue: String(entry.clue || ''), answer: String(entry.answer || '') });
      });
    });

    // Iterative review-and-repair: each round sends the model an independent
    // editor pass over every entry still unresolved (plus its category peers,
    // for duplicate-answer context). A round's silence on a given entry IS
    // the confirmation that it's now fine — that's what drops it out of the
    // active set. An entry that's flagged again (even after a fix was
    // applied) stays active for another round. Repeats up to
    // REPAIR_MAX_ATTEMPTS times; whatever is still active afterward keeps
    // its current (possibly imperfect) content but is marked low-confidence
    // for the admin to spot-check, rather than being blanked out.
    // Round 1 always covers the whole board (matching a plain independent
    // review pass, even when the mechanical check found nothing); later
    // rounds only revisit what's still actively flagged.
    const everFlagged = new Map<string, string>();
    let activeKeys = new Set<string>(entryMap.keys());
    let reasonMap = new Map<string, string>(flagged);

    for (let round = 1; round <= REPAIR_MAX_ATTEMPTS && activeKeys.size > 0; round++) {
      const activeCatIndexes = new Set([...activeKeys].map((key) => Number(key.split('|')[0])));
      const reviewCandidates: ReviewEntry[] = [];
      categories.forEach((category, catIndex) => {
        if (!activeCatIndexes.has(catIndex)) return;
        POINTS.forEach((points) => {
          const key = `${catIndex}|${points}`;
          const entry = entryMap.get(key);
          if (!entry) return;
          reviewCandidates.push({
            category,
            points,
            clue: entry.clue,
            answer: entry.answer,
            categoryNote: categoryNotes && categoryNotes[catIndex] ? String(categoryNotes[catIndex]).trim() : '',
            knownIssue: activeKeys.has(key) ? reasonMap.get(key) : null,
          });
        });
      });

      const reviewResults = await reviewGeneratedEntries(reviewCandidates, categories, this.config.apiKey);
      if (reviewResults === null) continue; // call failed; retry next round with the same active set

      const newActive = new Set<string>();
      reviewResults.forEach((result, key) => {
        reasonMap.set(key, result.reason);
        everFlagged.set(key, result.reason);
        const applied = result.clue && result.answer && !clueLeaksAnswer(result.clue, result.answer);
        if (applied) entryMap.set(key, { clue: result.clue, answer: result.answer });
        newActive.add(key);
      });
      activeKeys = newActive;
      reasonMap = new Map([...reasonMap].filter(([key]) => activeKeys.has(key)));
    }

    // Safety net: re-run the deterministic leak/duplicate check across the
    // final board even if review considers everything resolved, and force
    // anything it still catches into the low-confidence set.
    findFlaggedEntries(toParsedShape(entryMap, categories), categories).forEach((reason, key) => {
      activeKeys.add(key);
      if (!everFlagged.has(key)) everFlagged.set(key, reason);
    });

    categories.forEach((category, catIndex) => {
      POINTS.forEach((points) => {
        const key = `${catIndex}|${points}`;
        const entry = entryMap.get(key);
        if (!entry) return;
        const cell = cellFor(this.board, catIndex, points);
        if (!cell) return;
        cell.clue = entry.clue;
        cell.answer = entry.answer;
        cell.lowConfidence = activeKeys.has(key);
      });
    });
    this.board.ageGroup = ageGroup || this.board.ageGroup;
    await this.ctx.storage.put('board', this.board);

    const warnings = [...everFlagged.entries()].map(([key, reason]) => {
      const [catIndex, points] = key.split('|');
      const label = `${categories[Number(catIndex)]} — $${points}`;
      return activeKeys.has(key)
        ? `${label}: low confidence after ${REPAIR_MAX_ATTEMPTS} review attempts — please check (${reason})`
        : `${label}: replaced (${reason})`;
    });

    return json({ ...this.board, warnings });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return env.GAME_ROOM.getByName('default-game').fetch(request);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

interface Cell { catIndex: number; points: number; clue: string; answer: string; used: boolean; lowConfidence: boolean }
interface Team { name: string; score: number }
interface Board { gameTitle: string; categories: string[]; categoryNotes: string[]; ageGroup: string; cells: Cell[]; teams: Team[]; chooserTeamIndex: number | null; questionTimerSeconds: number | null; buzzTimerSeconds: number | null }
interface GameConfig { apiKey: string }
interface HostQuestion { catIndex: number; category: string; points: number; clue: string; answer: string }
interface HostBuzzer { teamIndex: number; teamName: string }
interface HostState { revision: number; question: HostQuestion | null; buzzer: HostBuzzer | null; chooser: HostBuzzer | null }
interface GeneratedCell { points: number; clue: string; answer: string }
interface OpenAiResponse { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
