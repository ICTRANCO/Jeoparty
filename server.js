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
const MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function defaultBoard() {
  const categories = Array.from({ length: NUM_CATEGORIES }, (_, i) => `Category ${i + 1}`);
  const cells = [];
  for (let c = 0; c < NUM_CATEGORIES; c++) {
    for (const points of POINTS) {
      cells.push({ catIndex: c, points, clue: '', answer: '', used: false });
    }
  }
  return { categories, ageGroup: '', cells };
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
  return JSON.parse(raw);
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

// ---- Board ----

app.get('/api/board', async (req, res) => {
  const board = await readBoard();
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

app.post('/api/board/reset', async (req, res) => {
  const board = await readBoard();
  board.cells.forEach((c) => (c.used = false));
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
  return `You are writing clues for a home-made Jeopardy-style trivia game.

Categories (use these exact names as JSON keys): ${categories.map((c) => `"${c}"`).join(', ')}

Audience / age group: ${age}

For EACH category, write exactly 5 clues, one for each point value: 100, 200, 300, 400, 500.
- 100 should be the easiest, 500 the hardest, with a smooth difficulty curve in between.
- Keep language, topics, and complexity appropriate for the stated audience/age group.
- Follow classic Jeopardy style: the "clue" is phrased as a statement of fact (not a question), and the "answer" is the correct response to it.
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      let message = errBody;
      try {
        message = JSON.parse(errBody).error?.message || errBody;
      } catch {}
      return res.status(response.status).json({ error: `Anthropic API error: ${message}` });
    }

    const data = await response.json();
    const text = (data.content || []).map((b) => b.text || '').join('');
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
    console.log(`Jeopardy server running at http://localhost:${PORT}`);
  });
});
