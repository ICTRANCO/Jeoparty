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
const buzzerAlert = document.getElementById('host-buzzer-alert');
const scoreAdjustGrid = document.getElementById('host-score-adjust-grid');

const commandMessages = {
  'buzzers-ready': 'Buzzers are live on the gameboard',
  'reveal-answer': 'Answer revealed on the gameboard',
  'score-correct': 'Correct score command sent',
  'score-incorrect': 'Incorrect score command sent',
  'times-up': "Time's up command sent",
  'close-question': 'Question closed on the gameboard',
};

let currentChooser = null;

function renderBuzzer(buzzer, chooser = currentChooser) {
  buzzerAlert.textContent = buzzer
    ? `${buzzer.teamName || 'A team'} buzzed first!`
    : chooser
      ? `${chooser.teamName}'s turn`
      : 'No team has control yet';
  buzzerAlert.classList.remove('visible');
  void buzzerAlert.offsetWidth;
  buzzerAlert.classList.add('visible');
}

function render(state) {
  const question = state?.question;
  currentChooser = state?.chooser || null;
  renderBuzzer(state?.buzzer, currentChooser);
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

function renderScoreAdjustments(board) {
  scoreAdjustGrid.innerHTML = '';
  board.teams.forEach((team, teamIndex) => {
    const card = document.createElement('div');
    card.className = 'host-score-adjust-card';

    const name = document.createElement('strong');
    name.textContent = team.name;
    const total = document.createElement('span');
    total.className = 'host-score-adjust-total';
    total.textContent = team.score;

    const controls = document.createElement('div');
    controls.className = 'host-score-adjust-buttons';
    const subtract = document.createElement('button');
    subtract.className = 'host-score-adjust-btn subtract';
    subtract.textContent = '−100';
    const add = document.createElement('button');
    add.className = 'host-score-adjust-btn add';
    add.textContent = '+100';

    [subtract, add].forEach((button) => {
      button.addEventListener('click', async () => {
        controls.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        const delta = button === add ? 100 : -100;
        const res = await fetch('/api/board/score-adjust', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ teamIndex, delta }),
        });
        if (!res.ok) {
          commandStatus.textContent = (await res.json()).error || 'Score adjustment failed';
          controls.querySelectorAll('button').forEach((item) => { item.disabled = false; });
          return;
        }
        renderScoreAdjustments(await res.json());
        commandStatus.textContent = `${team.name} ${delta > 0 ? '+' : '−'}100`;
      });
    });

    controls.append(subtract, add);
    card.append(name, total, controls);
    scoreAdjustGrid.appendChild(card);
  });
}

async function loadBoardState() {
  const res = await fetch('/api/board');
  if (!res.ok) return;
  const board = await res.json();
  gameTitleEl.textContent = board.gameTitle || 'JEOPARTY!';
  document.title = `${board.gameTitle || 'Jeoparty'} Host View`;
  renderScoreAdjustments(board);
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
    if (message.type === 'buzzer-state') {
      renderBuzzer(message.teamIndex === null ? null : message, currentChooser);
      return;
    }
    if (message.type === 'board-updated') {
      loadBoardState();
      return;
    }
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

loadBoardState();
connect();
