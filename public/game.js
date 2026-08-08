const POINTS = [100, 200, 300, 400, 500];

const boardEl = document.getElementById('board');
const overlay = document.getElementById('overlay');
const flipCard = document.getElementById('flip-card');
const flipFront = document.getElementById('flip-front');
const clueText = document.getElementById('clue-text');
const answerText = document.getElementById('answer-text');
const revealAnswerBtn = document.getElementById('reveal-answer-btn');
const closeBtn = document.getElementById('close-btn');
const resetBtn = document.getElementById('reset-btn');
const overlayControls = document.getElementById('overlay-controls');
const scoreboardEl = document.getElementById('scoreboard');
const scoringControls = document.getElementById('scoring-controls');
const reviewBadge = document.getElementById('review-badge');
const gameTitleEl = document.getElementById('game-title');
const buzzerStatusEl = document.getElementById('buzzer-status');
const buzzerOverlayEl = document.getElementById('buzzer-overlay');
const buzzerResetBtn = document.getElementById('buzzer-reset-btn');
const teamBuzzChipsEl = document.getElementById('team-buzz-chips');

let hostStartBtn = null;

let board = null;
let activeCell = null;
let disabledTeamsForQuestion = new Set();
let buzzerWinner = null;
let buzzersEnabled = false;
let remoteSocket = null;
let remoteReconnectTimer = null;

function connectRemoteControls() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  remoteSocket = new WebSocket(`${protocol}//${location.host}/api/host/events`);
  remoteSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!activeCell) return;

    if (message.type === 'buzzers-ready') {
      buzzersEnabled = true;
      updateHostButtonState();
      updateBuzzerStatus('Buzzers are live');
      renderScoringControls();
    } else if (message.type === 'reveal-answer') {
      revealAnswerBtn.click();
    } else if (message.type === 'score-correct' && buzzerWinner !== null) {
      applyScore(buzzerWinner, true);
    } else if (message.type === 'score-incorrect' && buzzerWinner !== null) {
      applyScore(buzzerWinner, false);
    } else if (message.type === 'close-question') {
      closeOverlay();
    }
  });
  remoteSocket.addEventListener('close', () => {
    clearTimeout(remoteReconnectTimer);
    remoteReconnectTimer = setTimeout(connectRemoteControls, 1500);
  });
}

async function loadBoard() {
  const res = await fetch('/api/board');
  board = await res.json();
  gameTitleEl.textContent = `🏆 ${board.gameTitle}`;
  document.title = `${board.gameTitle} Board`;
  render();
  renderScoreboard();
  if (activeCell) {
    renderScoringControls();
  }
}

function cellFor(catIndex, points) {
  return board.cells.find((c) => c.catIndex === catIndex && c.points === points);
}

function render() {
  boardEl.innerHTML = '';

  board.categories.forEach((name) => {
    const el = document.createElement('div');
    el.className = 'category-cell';
    el.textContent = name;
    boardEl.appendChild(el);
  });

  POINTS.forEach((points) => {
    board.categories.forEach((_, catIndex) => {
      const cell = cellFor(catIndex, points);
      const el = document.createElement('div');
      const hasClue = cell && cell.clue && cell.clue.trim();
      el.className = 'points-cell' + (cell && cell.used ? ' used' : '') + (!hasClue ? ' empty' : '');
      el.textContent = cell && cell.used ? '' : hasClue ? `$${points}` : `$${points}`;
      if (!hasClue && !(cell && cell.used)) {
        el.title = 'No question set yet — add one on the Admin page';
      } else if (cell && cell.used) {
        el.title = 'Click to review this question and adjust scoring';
      }
      if (cell && hasClue) {
        el.addEventListener('click', () => openCell(catIndex, points));
      }
      boardEl.appendChild(el);
    });
  });
}

function updateBuzzerStatus(message) {
  if (buzzerStatusEl) {
    buzzerStatusEl.textContent = message;
  }
  if (buzzerOverlayEl) {
    buzzerOverlayEl.textContent = message;
  }
}

function updateHostButtonState() {
  if (!hostStartBtn) return;
  hostStartBtn.disabled = !activeCell;
  hostStartBtn.textContent = buzzersEnabled ? 'Buzzers Ready' : 'Start Buzzers';
}

function showTeamScoreFlash(teamIndex, delta) {
  if (!scoreboardEl || teamIndex === null || teamIndex === undefined) return;

  const card = scoreboardEl.querySelector(`[data-team-index="${teamIndex}"]`);
  if (!card) return;

  const flash = document.createElement('div');
  flash.className = `score-flash ${delta >= 0 ? 'positive' : 'negative'}`;
  flash.textContent = `${delta >= 0 ? '+' : '-'}${Math.abs(delta)}`;
  card.appendChild(flash);

  requestAnimationFrame(() => {
    flash.classList.add('visible');
  });

  setTimeout(() => {
    flash.remove();
  }, 800);
}

function renderTeamBuzzChips() {
  if (!teamBuzzChipsEl || !board) return;

  teamBuzzChipsEl.innerHTML = '';

  board.teams.forEach((team, index) => {
    const chip = document.createElement('div');
    chip.className = 'team-buzz-chip';

    if (buzzerWinner === index) {
      chip.classList.add('active');
    } else if (disabledTeamsForQuestion.has(index)) {
      chip.classList.add('disabled');
    }

    chip.textContent = team.name;
    teamBuzzChipsEl.appendChild(chip);
  });
}

function resetBuzzers() {
  buzzerWinner = null;
  updateBuzzerStatus('Waiting for a buzz');
  renderTeamBuzzChips();
  renderScoringControls();
}

function setBuzzWinner(teamIndex) {
  buzzerWinner = teamIndex;
  updateBuzzerStatus(`${board.teams[teamIndex].name} buzzed first`);
  renderTeamBuzzChips();
  renderScoringControls();
}

function handleBuzz(teamIndex) {
  if (!activeCell) return;
  if (!buzzersEnabled) {
    updateBuzzerStatus('Waiting for a buzz');
    return;
  }
  if (disabledTeamsForQuestion.has(teamIndex)) {
    updateBuzzerStatus(`${board.teams[teamIndex].name} is disabled for this question`);
    return;
  }
  if (buzzerWinner !== null) return;

  setBuzzWinner(teamIndex);
}

function renderScoreboard() {
  scoreboardEl.innerHTML = '';
  board.teams.forEach((team, i) => {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.dataset.teamIndex = i;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'team-name-input';
    nameInput.value = team.name;
    nameInput.maxLength = 30;
    nameInput.addEventListener('change', () => saveTeamName(i, nameInput));

    const scoreEl = document.createElement('div');
    scoreEl.className = 'team-score';
    scoreEl.textContent = team.score;

    card.appendChild(nameInput);
    card.appendChild(scoreEl);
    scoreboardEl.appendChild(card);
  });
}

async function saveTeamName(i, nameInput) {
  const name = nameInput.value.trim() || `Team ${i + 1}`;
  nameInput.value = name;
  const res = await fetch('/api/board/teams', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teams: board.teams.map((t, idx) => (idx === i ? name : t.name)) }),
  });
  board = await res.json();
  renderScoreboard();
  if (activeCell) renderScoringControls();
}

function renderScoringControls() {
  scoringControls.innerHTML = '';

  const prompt = document.createElement('div');
  prompt.className = 'scoring-prompt';
  prompt.textContent = buzzerWinner === null
    ? 'No team has buzzed yet'
    : `${board.teams[buzzerWinner].name} buzzed first`;

  const buttonRow = document.createElement('div');
  buttonRow.className = 'scoring-button-row';

  const correctBtn = document.createElement('button');
  correctBtn.className = 'score-btn correct';
  correctBtn.textContent = '✓ Correct';
  correctBtn.disabled = buzzerWinner === null;
  correctBtn.addEventListener('click', () => applyScore(buzzerWinner, true));

  const incorrectBtn = document.createElement('button');
  incorrectBtn.className = 'score-btn incorrect';
  incorrectBtn.textContent = '✗ Incorrect';
  incorrectBtn.disabled = buzzerWinner === null;
  incorrectBtn.addEventListener('click', () => applyScore(buzzerWinner, false));

  const hostBtn = document.createElement('button');
  hostBtn.className = 'btn-link host-btn';
  hostBtn.id = 'host-start-btn';
  hostBtn.textContent = buzzersEnabled ? 'Buzzers Ready' : 'Start Buzzers';
  hostBtn.disabled = !activeCell;
  hostBtn.addEventListener('click', () => {
    buzzersEnabled = true;
    updateHostButtonState();
    updateBuzzerStatus('Buzzers are live');
    renderScoringControls();
  });
  hostStartBtn = hostBtn;

  buttonRow.appendChild(correctBtn);
  buttonRow.appendChild(incorrectBtn);
  buttonRow.appendChild(hostBtn);

  scoringControls.appendChild(prompt);
  scoringControls.appendChild(buttonRow);
}

async function applyScore(teamIndex, correct) {
  if (!activeCell || teamIndex === null || teamIndex === undefined) return;

  const res = await fetch('/api/board/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamIndex, points: activeCell.points, correct }),
  });

  if (!res.ok) {
    console.error('Score update failed', await res.text());
    return;
  }

  board = await res.json();
  renderScoreboard();
  render();

  if (!correct) {
    const teamName = board.teams[teamIndex]?.name || 'The first team';
    showTeamScoreFlash(teamIndex, -activeCell.points);
    setTimeout(() => {
      disabledTeamsForQuestion.add(teamIndex);
      buzzerWinner = null;
      updateBuzzerStatus(`${teamName} missed; waiting for the next buzz`);
      renderTeamBuzzChips();
      renderScoringControls();
    }, 700);
    return;
  }

  showTeamScoreFlash(teamIndex, activeCell.points);
  renderTeamBuzzChips();

  setTimeout(() => {
    closeOverlay();
  }, 700);
}

async function publishHostQuestion(catIndex, points) {
  try {
    const res = await fetch('/api/host/question', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catIndex, points }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (err) {
    console.error('Could not update the host answer view', err);
  }
}

function openCell(catIndex, points) {
  const cell = cellFor(catIndex, points);
  if (!cell) return;
  activeCell = cell;
  publishHostQuestion(catIndex, points);
  disabledTeamsForQuestion.clear();
  buzzersEnabled = false;
  resetBuzzers();
  updateHostButtonState();

  flipFront.textContent = `$${points}`;
  clueText.textContent = cell.clue && cell.clue.trim()
    ? cell.clue
    : '(No question has been added for this square yet. Add one on the Admin page.)';

  if (cell.used) {
    answerText.textContent = cell.answer && cell.answer.trim() ? cell.answer : '(No answer set)';
    answerText.style.visibility = 'visible';
    revealAnswerBtn.disabled = true;
    revealAnswerBtn.textContent = 'Answer Shown';
  } else {
    answerText.textContent = '';
    answerText.style.visibility = 'hidden';
    revealAnswerBtn.disabled = false;
    revealAnswerBtn.textContent = 'Reveal Answer';
  }
  reviewBadge.classList.toggle('hidden', !cell.used);
  updateHostButtonState();
  renderTeamBuzzChips();
  renderScoringControls();

  flipCard.classList.remove('flipped');
  overlayControls.classList.remove('visible');
  overlay.classList.remove('hidden');

  void flipCard.offsetWidth;
  setTimeout(() => {
    flipCard.classList.add('flipped');
    overlayControls.classList.add('visible');
  }, 20);
}

revealAnswerBtn.addEventListener('click', () => {
  if (!activeCell) return;
  answerText.textContent = activeCell.answer && activeCell.answer.trim()
    ? activeCell.answer
    : '(No answer set)';
  answerText.style.visibility = 'visible';
});

async function closeOverlay() {
  if (activeCell && !activeCell.used) {
    await fetch('/api/board/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catIndex: activeCell.catIndex, points: activeCell.points }),
    });
    activeCell.used = true;
  }
  reviewBadge.classList.add('hidden');
  overlay.classList.add('hidden');
  flipCard.classList.remove('flipped');
  activeCell = null;
  disabledTeamsForQuestion.clear();
  buzzersEnabled = false;
  updateHostButtonState();
  resetBuzzers();
  await loadBoard();
}

closeBtn.addEventListener('click', closeOverlay);

window.addEventListener('keydown', (event) => {
  if (!activeCell) return;
  if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (event.repeat) return;

  const key = event.key?.toLowerCase();
  let teamIndex = null;

  if (key === 'a' || event.code === 'KeyA') teamIndex = 0;
  else if (key === 'b' || event.code === 'KeyB') teamIndex = 1;
  else if (key === 'l' || event.code === 'KeyL') teamIndex = 2;

  if (teamIndex === null) return;

  event.preventDefault();
  handleBuzz(teamIndex);
});

buzzerResetBtn.addEventListener('click', resetBuzzers);

resetBtn.addEventListener('click', async () => {
  if (!confirm('Start a new game? This clears which squares have been played and resets scores to 0 (questions and team names stay the same).')) return;
  const res = await fetch('/api/board/reset', { method: 'POST' });
  board = await res.json();
  render();
  renderScoreboard();
  renderTeamBuzzChips();
  updateHostButtonState();
});

loadBoard();
updateHostButtonState();
connectRemoteControls();
