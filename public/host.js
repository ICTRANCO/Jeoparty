const emptyState = document.getElementById('host-empty');
const questionView = document.getElementById('host-question');
const categoryEl = document.getElementById('host-category');
const pointsEl = document.getElementById('host-points');
const clueEl = document.getElementById('host-clue');
const answerEl = document.getElementById('host-answer');
const connectionEl = document.getElementById('host-connection');
const gameTitleEl = document.getElementById('host-game-title');
const buzzersBtn = document.getElementById('host-buzzers-btn');
const remoteButtons = document.querySelectorAll('.host-remote-btn[data-command]');
const commandStatus = document.getElementById('host-command-status');
const buzzerAlert = document.getElementById('host-buzzer-alert');
const scoreAdjustGrid = document.getElementById('host-score-adjust-grid');
const roundLabel = document.getElementById('host-round-label');
const scoreAdjustHelp = document.getElementById('host-score-adjust-help');
const dailyDoublePanel = document.getElementById('host-daily-double');
const dailyDoubleForm = document.getElementById('host-daily-double-form');
const dailyDoubleTeam = document.getElementById('host-daily-double-team');
const dailyDoubleAmount = document.getElementById('host-daily-double-amount');
const dailyDoubleSubmit = document.getElementById('host-daily-double-submit');
const dailyDoubleStatus = document.getElementById('host-daily-double-status');

const commandMessages = {
  'buzzers-ready': 'Buzzers are live on the gameboard',
  'reveal-answer': 'Answer revealed on the gameboard',
  'score-correct': 'Correct score command sent',
  'score-incorrect': 'Incorrect score command sent',
  'times-up': "Time's up command sent",
  'close-question': 'Question closed on the gameboard',
};

let currentChooser = null;
let currentQuestion = null;
let currentBoard = null;

function renderBuzzer(buzzer, chooser = currentChooser) {
  buzzerAlert.textContent = currentQuestion?.dailyDouble && currentQuestion.dailyDouble.wager === null
    ? 'Daily Double: enter the wager'
    : currentQuestion?.final
    ? 'Final Jeopardy: record each team’s wager and response below'
    : buzzer
      ? `${buzzer.teamName || 'A team'} buzzed first!`
      : chooser
        ? `${chooser.teamName}'s turn`
        : 'No team has control yet';
  buzzerAlert.classList.remove('visible');
  void buzzerAlert.offsetWidth;
  buzzerAlert.classList.add('visible');
}

function renderDailyDoubleWager() {
  const state = currentQuestion?.dailyDouble;
  dailyDoublePanel.classList.toggle('hidden', !state);
  if (!state || !currentBoard) return;

  dailyDoubleTeam.replaceChildren(new Option('Choose a team…', ''));
  currentBoard.teams.forEach((team, index) => {
    dailyDoubleTeam.append(new Option(`${team.name} (${team.score})`, String(index)));
  });
  dailyDoubleTeam.value = state.teamIndex === null ? '' : String(state.teamIndex);
  dailyDoubleAmount.value = state.wager === null ? '' : String(state.wager);
  const selectedTeam = dailyDoubleTeam.value === '' ? null : currentBoard.teams[Number(dailyDoubleTeam.value)];
  dailyDoubleAmount.max = String(Math.max(selectedTeam?.score || 0, state.topValue));
  dailyDoubleAmount.placeholder = `0–${dailyDoubleAmount.max}`;
  dailyDoubleSubmit.disabled = state.scored;
  dailyDoubleStatus.textContent = state.scored
    ? 'This Daily Double has been scored.'
    : state.wager === null
      ? `Wager up to the greater of the team's score or $${state.topValue}.`
      : `${state.teamName} wagered $${state.wager}. You can adjust the wager until it is scored.`;
}

function render(state) {
  const question = state?.question;
  currentQuestion = question || null;
  currentChooser = state?.chooser || null;
  if (currentBoard) renderScoreAdjustments(currentBoard);
  renderBuzzer(state?.buzzer, currentQuestion?.final ? null : currentChooser);
  emptyState.classList.toggle('hidden', Boolean(question));
  questionView.classList.toggle('hidden', !question);
  const isDailyDouble = Boolean(question?.dailyDouble);
  const hasDailyDoubleWager = isDailyDouble && question.dailyDouble.wager !== null;
  remoteButtons.forEach((button) => {
    const revealOnly = button.dataset.command === 'reveal-answer';
    button.hidden = Boolean(question?.final && !revealOnly);
    if (isDailyDouble && ['start-buzzers', 'times-up'].includes(button.dataset.command)) button.hidden = true;
    button.disabled = !question
      || (question.final && !revealOnly)
      || (isDailyDouble && !hasDailyDoubleWager && revealOnly)
      || (isDailyDouble && ['score-correct', 'score-incorrect'].includes(button.dataset.command)
        && (!hasDailyDoubleWager || question.dailyDouble.scored));
  });
  buzzersBtn.disabled = !question || Boolean(question.final) || isDailyDouble;
  buzzersBtn.classList.remove('active');
  commandStatus.textContent = '';
  renderDailyDoubleWager();
  if (!question) return;

  categoryEl.textContent = question.category;
  pointsEl.textContent = question.final ? 'Final Jeopardy'
    : question.dailyDouble ? `Daily Double · $${question.points}` : `$${question.points}`;
  clueEl.textContent = question.dailyDouble && question.dailyDouble.wager === null
    ? 'Set the Daily Double wager to reveal this clue.'
    : question.clue.trim() || '(No question has been added for this square.)';
  answerEl.textContent = question.answer.trim() || '(No answer has been set.)';

  questionView.classList.remove('host-question-updated');
  void questionView.offsetWidth;
  questionView.classList.add('host-question-updated');
}

function renderScoreAdjustments(board) {
  scoreAdjustGrid.innerHTML = '';
  const isFinal = Boolean(currentQuestion?.final);
  scoreAdjustHelp.textContent = isFinal
    ? 'Enter each team’s wager (up to its current score), then record whether its response was correct.'
    : 'Use “Wrong” to deduct the active question’s value from that team only.';
  board.teams.forEach((team, teamIndex) => {
    const card = document.createElement('div');
    card.className = `host-score-adjust-card${isFinal ? ' final-wager' : ''}`;

    const name = document.createElement('strong');
    name.textContent = team.name;
    const total = document.createElement('span');
    total.className = 'host-score-adjust-total';
    total.textContent = team.score;

    const controls = document.createElement('div');
    controls.className = 'host-score-adjust-buttons';
    if (isFinal) {
      const wager = document.createElement('input');
      wager.type = 'number';
      wager.min = '0';
      wager.max = String(Math.max(0, team.score));
      wager.step = '1';
      wager.className = 'host-final-wager';
      wager.setAttribute('aria-label', `${team.name} Final Jeopardy wager`);
      const savedWager = board.finalWagers?.[teamIndex];
      wager.value = savedWager === null || savedWager === undefined ? '' : String(savedWager);
      wager.placeholder = `0–${Math.max(0, team.score)}`;
      const scored = Boolean(board.finalScoredTeams?.[teamIndex]);
      const addResultButton = (correct) => {
        const button = document.createElement('button');
        button.className = `host-score-adjust-btn ${correct ? 'add' : 'subtract'}`;
        button.textContent = correct ? 'Correct' : 'Incorrect';
        button.disabled = scored;
        button.addEventListener('click', async () => {
          const value = Number(wager.value);
          if (!Number.isInteger(value) || value < 0 || value > Math.max(0, team.score)) {
            commandStatus.textContent = `Enter a whole-number wager from 0 to ${Math.max(0, team.score)} for ${team.name}`;
            wager.focus();
            return;
          }
          controls.querySelectorAll('button').forEach((item) => { item.disabled = true; });
          commandStatus.textContent = `Scoring ${team.name}…`;
          try {
            const res = await fetch('/api/board/score', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ teamIndex, correct, wager: value }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Score update failed');
            currentBoard = data;
            renderScoreAdjustments(data);
            commandStatus.textContent = data.sheetTrackingWarning
              || (data.pendingSheetPlayCount
                ? 'Sheet play-count update queued for sync.'
                : `${team.name} ${correct ? 'correct' : 'incorrect'} — wager $${value}`);
          } catch (error) {
            commandStatus.textContent = error.message;
            controls.querySelectorAll('button').forEach((item) => { item.disabled = false; });
          }
        });
        return button;
      };
      controls.append(wager, addResultButton(true), addResultButton(false));
      card.append(name, total, controls);
      scoreAdjustGrid.appendChild(card);
      return;
    }

    const subtract = document.createElement('button');
    subtract.className = 'host-score-adjust-btn subtract';
    subtract.textContent = '−100';
    const add = document.createElement('button');
    add.className = 'host-score-adjust-btn add';
    add.textContent = '+100';
    const dailyDouble = currentQuestion?.dailyDouble;
    const wrongAnswerPoints = dailyDouble ? dailyDouble.wager : currentQuestion?.points;
    const wrongAnswer = document.createElement('button');
    wrongAnswer.className = 'host-score-adjust-btn wrong-answer';
    wrongAnswer.textContent = wrongAnswerPoints !== null && wrongAnswerPoints !== undefined
      ? `Wrong −${wrongAnswerPoints}`
      : 'Wrong answer';
    wrongAnswer.title = wrongAnswerPoints
      ? `Deduct ${wrongAnswerPoints} points from ${team.name} for a wrong answer`
      : 'Open a question to enable wrong-answer deductions';
    wrongAnswer.disabled = dailyDouble
      ? dailyDouble.wager === null || dailyDouble.scored || dailyDouble.teamIndex !== teamIndex
      : !wrongAnswerPoints;

    [subtract, add, wrongAnswer].forEach((button) => {
      button.addEventListener('click', async () => {
        if (button === wrongAnswer) {
          if (!socket || socket.readyState !== WebSocket.OPEN) {
            commandStatus.textContent = 'Game connection is not ready';
            return;
          }
          controls.querySelectorAll('button').forEach((item) => { item.disabled = true; });
          commandStatus.textContent = `Marking ${team.name} incorrect…`;
          socket.send(JSON.stringify({ type: 'score-incorrect', teamIndex }));
          return;
        }

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
        currentBoard = await res.json();
        renderScoreAdjustments(currentBoard);
        commandStatus.textContent = `${team.name} ${delta > 0 ? '+' : '−'}100`;
      });
    });

    controls.append(subtract, add, wrongAnswer);
    card.append(name, total, controls);
    scoreAdjustGrid.appendChild(card);
  });
}

async function loadBoardState() {
  const res = await fetch('/api/board');
  if (!res.ok) return;
  const board = await res.json();
  currentBoard = board;
  gameTitleEl.textContent = board.gameTitle || 'JEOPARTY!';
  roundLabel.textContent = Number(board.round) === 3 ? 'Final Jeopardy!'
    : `Round ${board.round || 1} — ${Number(board.round) === 2 ? 'Double Jeopardy!' : 'Jeopardy!'}`;
  document.title = `${board.gameTitle || 'Jeoparty'} Host View`;
  renderScoreAdjustments(board);
  renderDailyDoubleWager();
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
      commandStatus.textContent = message.type === 'score-incorrect' && Number.isInteger(message.teamIndex)
        ? `${currentBoard?.teams[message.teamIndex]?.name || 'Player'} marked incorrect`
        : commandMessages[message.type];
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

dailyDoubleTeam.addEventListener('change', () => {
  const team = currentBoard?.teams[Number(dailyDoubleTeam.value)];
  const maximum = Math.max(team?.score || 0, currentQuestion?.dailyDouble?.topValue || 0);
  dailyDoubleAmount.max = String(maximum);
  dailyDoubleAmount.placeholder = `0–${maximum}`;
});

dailyDoubleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (dailyDoubleTeam.value === '') {
    dailyDoubleStatus.textContent = 'Choose a team to wager.';
    dailyDoubleTeam.focus();
    return;
  }
  const teamIndex = Number(dailyDoubleTeam.value);
  const team = currentBoard?.teams[teamIndex];
  const wager = Number(dailyDoubleAmount.value);
  const maximum = Math.max(team?.score || 0, currentQuestion?.dailyDouble?.topValue || 0);
  if (!team || !Number.isInteger(wager) || wager < 0 || wager > maximum) {
    dailyDoubleStatus.textContent = `Enter a whole-number wager from 0 to ${maximum} and choose a team.`;
    return;
  }
  dailyDoubleSubmit.disabled = true;
  dailyDoubleStatus.textContent = 'Setting wager…';
  try {
    const res = await fetch('/api/board/wager', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamIndex, wager }),
    });
    const state = await res.json();
    if (!res.ok) throw new Error(state.error || 'Could not set the wager.');
    render(state);
    dailyDoubleStatus.textContent = `${team.name} wagered $${wager}.`;
  } catch (error) {
    dailyDoubleStatus.textContent = error.message;
    dailyDoubleSubmit.disabled = false;
  }
});

loadBoardState();
connect();
