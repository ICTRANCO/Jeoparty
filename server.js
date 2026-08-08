const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3131;

const DATA_DIR = path.join(__dirname, 'data');
const BOARD_PATH = path.join(DATA_DIR, 'board.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const POINTS = [100, 200, 300, 400, 500];
const NUM_CATEGORIES = 6;
const NUM_TEAMS = 3;
const MODEL = 'gpt-4o-mini';

let currentQuestion = null;
let currentQuestionRevision = 0;
const hostViewClients = new Set();

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
  return { gameTitle: DEFAULT_GAME_TITLE, categories, ageGroup: '', cells, teams: defaultTeams() };
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
  return { revision: currentQuestionRevision, question: currentQuestion };
}

function notifyHostViews() {
  const message = `data: ${JSON.stringify(hostViewState())}\n\n`;
  hostViewClients.forEach((client) => client.write(message));
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
  currentQuestionRevision += 1;
  notifyHostViews();
  res.json(hostViewState());
});

app.delete('/api/host/question', (req, res) => {
  currentQuestion = null;
  currentQuestionRevision += 1;
  notifyHostViews();
  res.json(hostViewState());
});

app.post('/api/board/reset', async (req, res) => {
  const board = await readBoard();
  board.cells.forEach((c) => (c.used = false));
  board.teams.forEach((t) => (t.score = 0));
  await writeBoard(board);
  currentQuestion = null;
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
  const { teamIndex, points, correct } = req.body;
  const board = await readBoard();
  const team = board.teams[teamIndex];
  if (!team) return res.status(404).json({ error: 'team not found' });
  const value = Number(points);
  if (!Number.isFinite(value)) {
    return res.status(400).json({ error: 'points must be a number' });
  }
  team.score += correct ? value : -value;
  await writeBoard(board);
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
  return `You are writing clues for a home-made Jeoparty-style trivia game.

Categories (use these exact names as JSON keys): ${categories.map((c) => `"${c}"`).join(', ')}

Audience / age group: ${age}

For EACH category, write exactly 5 clues, one for each point value: 100, 200, 300, 400, 500.
- 100 should be the easiest, 500 the hardest, with a smooth difficulty curve in between.
- Keep language, topics, and complexity appropriate for the stated audience/age group.
- Follow classic Jeoparty style: the "clue" is phrased as a statement of fact (not a question), and the "answer" is the correct response to it.
- Keep each clue under 200 characters and each answer under 80 characters.
- Do not reuse the category name verbatim inside its own clues.

Respond with ONLY raw JSON (no markdown code fences, no commentary) in exactly this shape:
{
  "CategoryNameExactlyAsGiven": [
    {"points": 100, "clue": "...", "answer": "..."},
    {"points": 200, "clue": "...", "answer": "..."},
    {"points": 300, "clue": "...", "answer": "..."},
    {"points": 400, "clue": "...", "answer": "..."},
    {"points": 500, "clue": "...", "answer": "..."}
  ],
  ...
}`;
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
    const parsed = extractJson(text);

    for (let c = 0; c < categories.length; c++) {
      const catName = categories[c];
      const entries = parsed[catName];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const cell = cellFor(board, c, Number(entry.points));
        if (cell) {
          cell.clue = String(entry.clue || '');
          cell.answer = String(entry.answer || '');
        }
      }
    }
    board.ageGroup = ageGroup || board.ageGroup;

    await writeBoard(board);
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

ensureDataFiles().then(() => {
  app.listen(PORT, () => {
    console.log(`Jeoparty server running at http://localhost:${PORT}`);
  });
});
