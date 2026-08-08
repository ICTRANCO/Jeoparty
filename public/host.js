const emptyState = document.getElementById('host-empty');
const questionView = document.getElementById('host-question');
const categoryEl = document.getElementById('host-category');
const pointsEl = document.getElementById('host-points');
const clueEl = document.getElementById('host-clue');
const answerEl = document.getElementById('host-answer');
const connectionEl = document.getElementById('host-connection');
const gameTitleEl = document.getElementById('host-game-title');
const buzzersBtn = document.getElementById('host-buzzers-btn');
const remoteButtons = document.querySelectorAll('.host-remote-btn');
const commandStatus = document.getElementById('host-command-status');

const commandMessages = {
  'buzzers-ready': 'Buzzers are live on the gameboard',
  'reveal-answer': 'Answer revealed on the gameboard',
  'score-correct': 'Correct score command sent',
  'score-incorrect': 'Incorrect score command sent',
  'close-question': 'Question closed on the gameboard',
};

function render(state) {
  const question = state?.question;
  emptyState.classList.toggle('hidden', Boolean(question));
  questionView.classList.toggle('hidden', !question);
  remoteButtons.forEach((button) => { button.disabled = !question; });
  buzzersBtn.classList.remove('active');
  commandStatus.textContent = '';
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

let socket;
let reconnectTimer;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/api/host/events`);
  socket.addEventListener('open', () => {
    connectionEl.textContent = 'Live';
    connectionEl.classList.add('connected');
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (commandMessages[message.type]) {
      commandStatus.textContent = commandMessages[message.type];
      if (message.type === 'buzzers-ready') buzzersBtn.classList.add('active');
      return;
    }
    render(message);
  });
  socket.addEventListener('close', () => {
    connectionEl.textContent = 'Reconnecting…';
    connectionEl.classList.remove('connected');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });
}

remoteButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      commandStatus.textContent = 'Game connection is not ready';
      return;
    }
    commandStatus.textContent = 'Sending command...';
    socket.send(JSON.stringify({ type: button.dataset.command }));
  });
});

loadTitle();
connect();
