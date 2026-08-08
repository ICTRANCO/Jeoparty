import { DurableObject } from 'cloudflare:workers';
import initialBoard from '../data/board.json';

const DEFAULT_GAME_TITLE = 'JEOPARTY!';
const MODEL = 'gpt-4o-mini';

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
  return board;
}

function buildPrompt(categories: string[], ageGroup: string): string {
  const age = ageGroup.trim() || 'general adult audience';
  return `You are writing clues for a home-made Jeoparty-style trivia game.

Categories (use these exact names as JSON keys): ${categories.map((category) => `"${category}"`).join(', ')}

Audience / age group: ${age}

For EACH category, write exactly 5 clues, one for each point value: 100, 200, 300, 400, 500.
- 100 should be the easiest, 500 the hardest, with a smooth difficulty curve in between.
- Keep language, topics, and complexity appropriate for the stated audience/age group.
- Follow classic Jeoparty style: the "clue" is phrased as a statement of fact, and the "answer" is the correct response.
- Keep each clue under 200 characters and each answer under 80 characters.
- Do not reuse the category name verbatim inside its own clues.

Respond with ONLY raw JSON, with each exact category name as a key and five objects containing points, clue, and answer.`;
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

export class GameRoom extends DurableObject<Env> {
  private board!: Board;
  private config!: GameConfig;
  private currentQuestion: HostQuestion | null = null;
  private revision = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.board = normalizedBoard((await ctx.storage.get<Board>('board')) || (initialBoard as Board));
      this.config = (await ctx.storage.get<GameConfig>('config')) || { apiKey: '' };
      this.currentQuestion = (await ctx.storage.get<HostQuestion>('currentQuestion')) || null;
      this.revision = (await ctx.storage.get<number>('revision')) || 0;
      await ctx.storage.put({ board: this.board, config: this.config });
    });
  }

  private hostState(): HostState {
    return { revision: this.revision, question: this.currentQuestion };
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

  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;
    try {
      const command = JSON.parse(message) as { type?: string };
      if (command.type === 'start-buzzers') {
        this.broadcast({ type: 'buzzers-ready', sentAt: Date.now() });
      } else if (['reveal-answer', 'score-correct', 'score-incorrect', 'close-question'].includes(command.type || '')) {
        this.broadcast({ type: command.type, sentAt: Date.now() });
      }
    } catch {
      // Ignore malformed remote-control messages.
    }
  }

  private async setCurrentQuestion(question: HostQuestion | null): Promise<void> {
    this.currentQuestion = question;
    this.revision += 1;
    await this.ctx.storage.put({ currentQuestion: question, revision: this.revision });
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
        const body = await request.json<{ categories?: unknown }>();
        if (!Array.isArray(body.categories) || body.categories.length !== 6) return json({ error: 'categories must be an array of 6 strings' }, 400);
        this.board.categories = body.categories.map((category) => String(category || '').slice(0, 60));
        await this.ctx.storage.put('board', this.board);
        return json(this.board);
      }

      if (url.pathname === '/api/board/cell' && method === 'PUT') {
        const body = await request.json<{ catIndex: number; points: number; clue?: string; answer?: string }>();
        const cell = cellFor(this.board, Number(body.catIndex), Number(body.points));
        if (!cell) return json({ error: 'cell not found' }, 404);
        if (typeof body.clue === 'string') cell.clue = body.clue;
        if (typeof body.answer === 'string') cell.answer = body.answer;
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
        const body = await request.json<{ teamIndex: number; points: number; correct: boolean }>();
        const team = this.board.teams[Number(body.teamIndex)];
        if (!team) return json({ error: 'team not found' }, 404);
        const points = Number(body.points);
        if (!Number.isFinite(points)) return json({ error: 'points must be a number' }, 400);
        team.score += body.correct ? points : -points;
        await this.ctx.storage.put('board', this.board);
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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildPrompt(this.board.categories, ageGroup) }],
      }),
    });
    const data = await response.json<OpenAiResponse>();
    if (!response.ok) return json({ error: `OpenAI API error: ${data.error?.message || response.statusText}` }, response.status);
    const generated = extractJson(data.choices?.[0]?.message?.content || '');
    this.board.categories.forEach((category, catIndex) => {
      const entries = generated[category];
      if (!Array.isArray(entries)) return;
      entries.forEach((entry) => {
        const cell = cellFor(this.board, catIndex, Number(entry.points));
        if (cell) {
          cell.clue = String(entry.clue || '');
          cell.answer = String(entry.answer || '');
        }
      });
    });
    this.board.ageGroup = ageGroup || this.board.ageGroup;
    await this.ctx.storage.put('board', this.board);
    return json(this.board);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return env.GAME_ROOM.getByName('default-game').fetch(request);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

interface Cell { catIndex: number; points: number; clue: string; answer: string; used: boolean }
interface Team { name: string; score: number }
interface Board { gameTitle: string; categories: string[]; ageGroup: string; cells: Cell[]; teams: Team[] }
interface GameConfig { apiKey: string }
interface HostQuestion { catIndex: number; category: string; points: number; clue: string; answer: string }
interface HostState { revision: number; question: HostQuestion | null }
interface GeneratedCell { points: number; clue: string; answer: string }
interface OpenAiResponse { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
