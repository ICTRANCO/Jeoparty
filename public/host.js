const emptyState = document.getElementById('host-empty');
const questionView = document.getElementById('host-question');
const categoryEl = document.getElementById('host-category');
const pointsEl = document.getElementById('host-points');
const clueEl = document.getElementById('host-clue');
const answerEl = document.getElementById('host-answer');
const connectionEl = document.getElementById('host-connection');
const gameTitleEl = document.getElementById('host-game-title');

function render(state) {
  const question = state?.question;
  emptyState.classList.toggle('hidden', Boolean(question));
  questionView.classList.toggle('hidden', !question);
  if (!question) return;

  categoryEl.textContent = question.category;
  pointsEl.textContent = `$${question.points}`;
  clueEl.textContent = question.clue.trim() || '(No question has been added for this square.)';
  answerEl.textContent = question.answer.trim() || '(No answer has been set.)';

  questionView.classList.remove('host-question-updated');
  void questionView.offsetWidth;
  questionView.classList.add('host-question-updated');
}

async function loadTitle() {
  const res = await fetch('/api/board');
  if (!res.ok) return;
  const board = await res.json();
  gameTitleEl.textContent = board.gameTitle || 'JEOPARTY!';
  document.title = `${board.gameTitle || 'Jeoparty'} Host View`;
}

const events = new EventSource('/api/host/events');
events.onopen = () => {
  connectionEl.textContent = 'Live';
  connectionEl.classList.add('connected');
};
events.onmessage = (event) => render(JSON.parse(event.data));
events.onerror = () => {
  connectionEl.textContent = 'Reconnecting…';
  connectionEl.classList.remove('connected');
};

loadTitle();
