const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = process.env.PORT || 3131;

const DATA_DIR = path.join(__dirname, 'data');
const BOARD_PATH = path.join(DATA_DIR, 'board.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const POINTS = [100, 200, 300, 400, 500];
const NUM_CATEGORIES = 6;
const NUM_TEAMS = 3;
const MODEL = 'gpt-4o';

let currentQuestion = null;
let currentQuestionRevision = 0;
let currentBuzzer = null;
let currentChooser = null;
const hostViewClients = new Set();
const realtimeClients = new Set();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function defaultTeams() {
  return Array.from({ length: NUM_TEAMS }, (_, i) => ({ name: `Team ${i + 1}`, score: 0 }));
}

const DEFAULT_GAME_TITLE = 'JEOPARTY!';

function defaultBoard() {
  const categories = Array.from({ length: NUM_CATEGORIES }, (_, i) => `Category ${i + 1}`);
  const cells = [];
  for (let c = 0; c < NUM_CATEGORIES; c++) {
    for (const points of POINTS) {
      cells.push({ catIndex: c, points, clue: '', answer: '', used: false });
    }
  }
  return { gameTitle: DEFAULT_GAME_TITLE, categories, ageGroup: '', cells, teams: defaultTeams(), questionTimerSeconds: 5, buzzTimerSeconds: 5 };
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(BOARD_PATH);
  } catch {
    await fs.writeFile(BOARD_PATH, JSON.stringify(defaultBoard(), null, 2));
  }
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    await fs.writeFile(CONFIG_PATH, JSON.stringify({ apiKey: '' }, null, 2));
  }
}

async function readBoard() {
  const raw = await fs.readFile(BOARD_PATH, 'utf-8');
  const board = JSON.parse(raw);
  if (!Array.isArray(board.teams) || board.teams.length !== NUM_TEAMS) {
    board.teams = defaultTeams();
  }
  if (typeof board.gameTitle !== 'string' || !board.gameTitle.trim()) {
    board.gameTitle = DEFAULT_GAME_TITLE;
  }
  if (!Number.isInteger(board.chooserTeamIndex) || !board.teams[board.chooserTeamIndex]) {
    board.chooserTeamIndex = null;
  }
  if (board.questionTimerSeconds !== null && !Number.isFinite(board.questionTimerSeconds)) board.questionTimerSeconds = 5;
  if (board.buzzTimerSeconds !== null && !Number.isFinite(board.buzzTimerSeconds)) board.buzzTimerSeconds = 5;
  if (board.questionTimerSeconds === undefined) board.questionTimerSeconds = 5;
  if (board.buzzTimerSeconds === undefined) board.buzzTimerSeconds = 5;
  delete board.scoreHistory;
  return board;
}

async function writeBoard(board) {
  await fs.writeFile(BOARD_PATH, JSON.stringify(board, null, 2));
}

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function writeConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function cellFor(board, catIndex, points) {
  return board.cells.find((c) => c.catIndex === catIndex && c.points === points);
}

function hostViewState() {
  return { revision: currentQuestionRevision, question: currentQuestion, buzzer: currentBuzzer, chooser: currentChooser };
}

function notifyHostViews() {
  const state = JSON.stringify(hostViewState());
  hostViewClients.forEach((client) => client.write(`data: ${state}\n\n`));
  realtimeClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(state);
  });
}

function broadcastRealtime(message) {
  const payload = JSON.stringify(message);
  realtimeClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// ---- Board ----

app.get('/api/board', async (req, res) => {
  const board = await readBoard();
  res.json(board);
});

app.put('/api/board/title', async (req, res) => {
  const { title } = req.body;
  const board = await readBoard();
  board.gameTitle = String(title || '').trim().slice(0, 60) || DEFAULT_GAME_TITLE;
  await writeBoard(board);
  res.json(board);
});

app.put('/api/board/categories', async (req, res) => {
  const { categories } = req.body;
  if (!Array.isArray(categories) || categories.length !== NUM_CATEGORIES) {
    return res.status(400).json({ error: `categories must be an array of ${NUM_CATEGORIES} strings` });
  }
  const board = await readBoard();
  board.categories = categories.map((c) => String(c || '').slice(0, 60));
  await writeBoard(board);
  res.json(board);
});

app.put('/api/board/timers', async (req, res) => {
  const normalizeTimer = (value) => value === null ? null : Number(value);
  const questionTimerSeconds = normalizeTimer(req.body.questionTimerSeconds);
  const buzzTimerSeconds = normalizeTimer(req.body.buzzTimerSeconds);
  const valid = (value) => value === null || (Number.isFinite(value) && value >= 1 && value <= 120);
  if (!valid(questionTimerSeconds) || !valid(buzzTimerSeconds)) {
    return res.status(400).json({ error: 'Timers must be between 1 and 120 seconds, or disabled' });
  }
  const board = await readBoard();
  board.questionTimerSeconds = questionTimerSeconds;
  board.buzzTimerSeconds = buzzTimerSeconds;
  await writeBoard(board);
  res.json(board);
});

app.put('/api/board/cell', async (req, res) => {
  const { catIndex, points, clue, answer } = req.body;
  const board = await readBoard();
  const cell = cellFor(board, catIndex, points);
  if (!cell) return res.status(404).json({ error: 'cell not found' });
  if (typeof clue === 'string') cell.clue = clue;
  if (typeof answer === 'string') cell.answer = answer;
  await writeBoard(board);
  res.json(cell);
});

app.post('/api/board/reveal', async (req, res) => {
  const { catIndex, points } = req.body;
  const board = await readBoard();
  const cell = cellFor(board, catIndex, points);
  if (!cell) return res.status(404).json({ error: 'cell not found' });
  cell.used = true;
  await writeBoard(board);
  res.json(cell);
});

// ---- Host answer view ----

app.get('/api/host/question', (req, res) => {
  res.json(hostViewState());
});

app.get('/api/host/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  hostViewClients.add(res);
  res.write(`data: ${JSON.stringify(hostViewState())}\n\n`);

  req.on('close', () => {
    hostViewClients.delete(res);
  });
});

app.post('/api/host/question', async (req, res) => {
  const catIndex = Number(req.body.catIndex);
  const points = Number(req.body.points);
  const board = await readBoard();
  const cell = cellFor(board, catIndex, points);
  if (!cell) return res.status(404).json({ error: 'cell not found' });

  currentQuestion = {
    catIndex,
    category: board.categories[catIndex] || `Category ${catIndex + 1}`,
    points,
    clue: cell.clue || '',
    answer: cell.answer || '',
  };
  currentBuzzer = null;
  currentQuestionRevision += 1;
  notifyHostViews();
  res.json(hostViewState());
});

app.delete('/api/host/question', (req, res) => {
  currentQuestion = null;
  currentBuzzer = null;
  currentQuestionRevision += 1;
  notifyHostViews();
  res.json(hostViewState());
});

app.post('/api/board/reset', async (req, res) => {
  const board = await readBoard();
  board.cells.forEach((c) => (c.used = false));
  board.teams.forEach((t) => (t.score = 0));
  board.chooserTeamIndex = null;
  await writeBoard(board);
  currentQuestion = null;
  currentChooser = null;
  currentQuestionRevision += 1;
  notifyHostViews();
  res.json(board);
});

// ---- Teams / scoring ----

app.put('/api/board/teams', async (req, res) => {
  const { teams } = req.body;
  if (!Array.isArray(teams) || teams.length !== NUM_TEAMS) {
    return res.status(400).json({ error: `teams must be an array of ${NUM_TEAMS} names` });
  }
  const board = await readBoard();
  board.teams.forEach((t, i) => {
    t.name = String(teams[i] || '').slice(0, 30) || `Team ${i + 1}`;
  });
  await writeBoard(board);
  res.json(board);
});

app.post('/api/board/score', async (req, res) => {
  const { teamIndex, correct } = req.body;
  if (!currentQuestion) {
    return res.status(400).json({ error: 'No active question to score' });
  }
  const board = await readBoard();
  const team = board.teams[teamIndex];
  if (!team) return res.status(404).json({ error: 'team not found' });
  const value = currentQuestion.points;
  team.score += correct ? value : -value;
  if (correct) {
    board.chooserTeamIndex = Number(teamIndex);
    currentChooser = { teamIndex: Number(teamIndex), teamName: team.name };
  }
  await writeBoard(board);
  notifyHostViews();
  broadcastRealtime({ type: 'board-updated', sentAt: Date.now() });
  res.json(board);
});

app.post('/api/board/score-adjust', async (req, res) => {
  const teamIndex = Number(req.body.teamIndex);
  const delta = Number(req.body.delta);
  const board = await readBoard();
  const team = board.teams[teamIndex];
  if (!team) return res.status(404).json({ error: 'team not found' });
  if (![100, -100].includes(delta)) {
    return res.status(400).json({ error: 'delta must be 100 or -100' });
  }
  team.score += delta;
  await writeBoard(board);
  broadcastRealtime({ type: 'board-updated', sentAt: Date.now() });
  res.json(board);
});

// ---- Config (API key never sent back to the client) ----

app.get('/api/config', async (req, res) => {
  const config = await readConfig();
  res.json({ hasApiKey: Boolean(config.apiKey) });
});

app.post('/api/config/apikey', async (req, res) => {
  const { apiKey } = req.body;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'apiKey is required' });
  }
  await writeConfig({ apiKey: apiKey.trim() });
  res.json({ hasApiKey: true });
});

app.delete('/api/config/apikey', async (req, res) => {
  await writeConfig({ apiKey: '' });
  res.json({ hasApiKey: false });
});

// ---- AI generation ----

function buildPrompt(categories, ageGroup) {
  const age = ageGroup && ageGroup.trim() ? ageGroup.trim() : 'general adult audience';
  return `You are an expert trivia writer and editor creating clues for a home-made Jeopardy-style game.

Your priorities, in order, are:

1. Factual accuracy
2. Strong fit with the category
3. One clear, unambiguous answer
4. Age-appropriate content
5. A smooth difficulty progression from 100 to 500 points

Categories (use these exact names as JSON keys):
${categories.map((c) => `"${c}"`).join(', ')}

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

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Could not parse JSON from AI response');
  }
}

function normalizeForMatch(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clueLeaksAnswer(clue, answer) {
  const normAnswer = normalizeForMatch(answer);
  return normAnswer.length >= 3 && normalizeForMatch(clue).includes(normAnswer);
}

// Flags entries whose clue gives away its own answer, or whose answer
// duplicates another answer in the same category. Returns a Set of
// "catIndex|points" keys for entries that should not be trusted.
function findFlaggedEntries(parsed, categories) {
  const flagged = new Set();
  categories.forEach((catName, catIndex) => {
    const entries = Array.isArray(parsed[catName]) ? parsed[catName] : [];
    const answerSeenAt = new Map();
    entries.forEach((entry) => {
      const key = `${catIndex}|${Number(entry.points)}`;
      if (clueLeaksAnswer(entry.clue, entry.answer)) flagged.add(key);
      const answerKey = String(entry.answer || '').trim().toLowerCase();
      if (!answerKey) return;
      if (answerSeenAt.has(answerKey)) {
        flagged.add(key);
        flagged.add(answerSeenAt.get(answerKey));
      } else {
        answerSeenAt.set(answerKey, key);
      }
    });
  });
  return flagged;
}

const GENERATE_MAX_ATTEMPTS = 2;

app.post('/api/generate', async (req, res) => {
  try {
    const config = await readConfig();
    if (!config.apiKey) {
      return res.status(400).json({ error: 'No API key configured. Add one on the Admin page first.' });
    }

    const board = await readBoard();
    const { ageGroup } = req.body;
    const categories = board.categories;

    const prompt = buildPrompt(categories, ageGroup);

    let parsed;
    let flagged = new Set();

    for (let attempt = 1; attempt <= GENERATE_MAX_ATTEMPTS; attempt++) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        let message = errBody;
        try {
          message = JSON.parse(errBody).error?.message || errBody;
        } catch {}
        return res.status(response.status).json({ error: `OpenAI API error: ${message}` });
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      parsed = extractJson(text);
      flagged = findFlaggedEntries(parsed, categories);
      if (flagged.size === 0) break;
    }

    for (let c = 0; c < categories.length; c++) {
      const catName = categories[c];
      const entries = parsed[catName];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const points = Number(entry.points);
        const cell = cellFor(board, c, points);
        if (!cell) continue;
        if (flagged.has(`${c}|${points}`)) {
          cell.clue = '';
          cell.answer = '';
        } else {
          cell.clue = String(entry.clue || '');
          cell.answer = String(entry.answer || '');
        }
      }
    }
    board.ageGroup = ageGroup || board.ageGroup;

    await writeBoard(board);

    const warnings = [...flagged].map((key) => {
      const [catIndex, points] = key.split('|');
      return `${categories[Number(catIndex)]} — $${points}`;
    });

    res.json({ ...board, warnings });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

ensureDataFiles().then(() => {
  const server = http.createServer(app);
  const realtimeServer = new WebSocketServer({ server, path: '/api/host/events' });

  realtimeServer.on('connection', (socket) => {
    realtimeClients.add(socket);
    socket.send(JSON.stringify(hostViewState()));
    socket.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        if (message.type === 'start-buzzers') {
          broadcastRealtime({ type: 'buzzers-ready', sentAt: Date.now() });
        } else if (message.type === 'buzzer-state') {
          currentBuzzer = message.teamIndex === null
            ? null
            : { teamIndex: message.teamIndex, teamName: message.teamName };
          broadcastRealtime({
            type: 'buzzer-state',
            teamIndex: message.teamIndex,
            teamName: message.teamName,
            sentAt: Date.now(),
          });
        } else if (['reveal-answer', 'score-correct', 'score-incorrect', 'times-up', 'close-question'].includes(message.type)) {
          broadcastRealtime({ type: message.type, sentAt: Date.now() });
        }
      } catch {}
    });
    socket.on('close', () => realtimeClients.delete(socket));
  });

  server.listen(PORT, () => {
    console.log(`Jeoparty server running at http://localhost:${PORT}`);
  });
});
