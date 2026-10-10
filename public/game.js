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
const teamBuzzChipsEl = document.getElementById('team-buzz-chips');
const questionBackBtn = document.getElementById('question-back-btn');
const questionTimerBar = document.getElementById('question-timer-bar');
const questionTimerFill = document.getElementById('question-timer-fill');

let hostStartBtn = null;

let board = null;
let activeCell = null;
let disabledTeamsForQuestion = new Set();
let buzzerWinner = null;
let buzzersEnabled = false;
let remoteSocket = null;
let remoteReconnectTimer = null;
let audioContext = null;
let questionLocked = false;
let timerTimeout = null;
let timerGeneration = 0;
const heldBuzzerKeys = new Set();

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function playTone(frequency, start, duration, type, volume, endFrequency = frequency) {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const beginsAt = context.currentTime + start;
  const endsAt = beginsAt + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, beginsAt);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, endsAt);
  gain.gain.setValueAtTime(0.0001, beginsAt);
  gain.gain.exponentialRampToValueAtTime(volume, beginsAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(beginsAt);
  oscillator.stop(endsAt);
}

function playAnswerSound(correct) {
  if (correct) {
    playTone(784, 0, 0.22, 'sine', 0.24);
    playTone(1174.66, 0.18, 0.5, 'sine', 0.28);
  } else {
    playTone(180, 0, 0.65, 'sawtooth', 0.18, 85);
    playTone(120, 0.04, 0.6, 'square', 0.07, 65);
  }
}

function playTimesUpSound() {
  playTone(440, 0, 0.16, 'square', 0.13, 330);
  playTone(330, 0.2, 0.16, 'square', 0.13, 247);
  playTone(220, 0.4, 0.45, 'sawtooth', 0.16, 110);
}

function playBuzzInSound() {
  playTone(523.25, 0, 0.12, 'square', 0.11);
  playTone(783.99, 0.1, 0.24, 'sine', 0.22);
}

function stopQuestionTimer(hide = true) {
  timerGeneration += 1;
  clearInterval(timerTimeout);
  timerTimeout = null;
  questionTimerFill.innerHTML = '';
  questionTimerBar.classList.toggle('hidden', hide);
  if (hide) questionTimerBar.classList.remove('times-up');
}

function revealCurrentAnswer() {
  if (!activeCell) return;
  answerText.textContent = activeCell.answer && activeCell.answer.trim()
    ? activeCell.answer
    : '(No answer set)';
  answerText.style.visibility = 'visible';
  revealAnswerBtn.disabled = true;
  revealAnswerBtn.textContent = 'Answer Shown';
}

function lockQuestionForTimeout() {
  if (!activeCell || questionLocked) return;
  questionLocked = true;
  buzzersEnabled = false;
  playTimesUpSound();
  revealCurrentAnswer();
  updateBuzzerStatus("Time's up!");
  questionTimerBar.classList.remove('hidden');
  questionTimerBar.classList.add('times-up');
  questionTimerFill.querySelectorAll('.question-timer-chunk').forEach((chunk) => chunk.classList.add('gone'));
  renderTeamBuzzChips();
  renderScoringControls();
}

function startQuestionTimer(seconds) {
  stopQuestionTimer(false);
  if (seconds === null || seconds === undefined) {
    questionTimerBar.classList.add('hidden');
    return;
  }
  const duration = Math.max(1, Math.round(Number(seconds)));
  if (!Number.isFinite(duration)) return;
  const generation = timerGeneration;
  questionTimerBar.classList.remove('hidden', 'times-up');
  const chunkCount = duration * 2 - 1;
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = document.createElement('span');
    chunk.className = 'question-timer-chunk';
    questionTimerFill.appendChild(chunk);
  }

  let elapsed = 0;
  timerTimeout = setInterval(() => {
    if (generation !== timerGeneration) return;
    elapsed += 1;
    const chunks = questionTimerFill.children;
    const leftIndex = elapsed - 1;
    const rightIndex = chunks.length - elapsed;
    chunks[leftIndex]?.classList.add('gone');
    chunks[rightIndex]?.classList.add('gone');
    if (elapsed >= duration) {
      clearInterval(timerTimeout);
      timerTimeout = null;
      // Timer running out no longer auto-scores; it just flags the bar so the
      // host can judge when to call time via the Time's Up button/command.
      questionTimerBar.classList.add('times-up');
    }
  }, 1000);
}

function handleTimesUp() {
  if (!activeCell || questionLocked) return;
  clearInterval(timerTimeout);
  timerTimeout = null;
  timerGeneration += 1;
  questionTimerBar.classList.remove('hidden');
  questionTimerBar.classList.add('times-up');
  questionTimerFill.querySelectorAll('.question-timer-chunk').forEach((chunk) => chunk.classList.add('gone'));
  if (buzzerWinner !== null) {
    // A team has buzzed in — leave the correct/incorrect call to the host
    // instead of auto-scoring them wrong.
    buzzersEnabled = false;
    playTimesUpSound();
    updateBuzzerStatus(`Time's up! Was ${board.teams[buzzerWinner].name} correct?`);
    renderTeamBuzzChips();
    renderScoringControls();
  } else {
    lockQuestionForTimeout();
  }
}

window.addEventListener('pointerdown', getAudioContext, { once: true });
window.addEventListener('keydown', getAudioContext, { once: true });

function sendRealtime(message) {
  if (remoteSocket?.readyState === WebSocket.OPEN) {
    remoteSocket.send(JSON.stringify(message));
  }
}

function connectRemoteControls() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  remoteSocket = new WebSocket(`${protocol}//${location.host}/api/host/events`);
  remoteSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'board-updated') {
      loadBoard();
      return;
    }
    if (!activeCell) return;

    if (message.type === 'buzzers-ready') {
      if (questionLocked) return;
      buzzersEnabled = true;
      startQuestionTimer(board.questionTimerSeconds);
      updateHostButtonState();
      updateBuzzerStatus('Buzzers are live');
      renderTeamBuzzChips();
      renderScoringControls();
    } else if (message.type === 'reveal-answer') {
      revealAnswerBtn.click();
    } else if (message.type === 'score-correct' && buzzerWinner !== null) {
      applyScore(buzzerWinner, true);
    } else if (message.type === 'score-incorrect') {
      const teamIndex = Number.isInteger(message.teamIndex) ? message.teamIndex : buzzerWinner;
      if (teamIndex !== null) applyScore(teamIndex, false);
    } else if (message.type === 'times-up') {
      handleTimesUp();
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
  gameTitleEl.textContent = board.gameTitle;
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
  if (teamIndex === null || teamIndex === undefined) return;

  const teamChip = teamBuzzChipsEl?.querySelector(`[data-team-index="${teamIndex}"]`);
  const target = teamChip || scoreboardEl?.querySelector(`[data-team-index="${teamIndex}"]`);
  if (!target) return;

  const flash = document.createElement('div');
  flash.className = `${teamChip ? 'question-score-flash' : 'score-flash'} ${delta >= 0 ? 'positive' : 'negative'}`;
  flash.textContent = `${delta >= 0 ? '+' : '-'}${Math.abs(delta)}`;
  target.appendChild(flash);

  if (!teamChip) {
    requestAnimationFrame(() => {
      flash.classList.add('visible');
    });
  }

  setTimeout(() => {
    flash.remove();
  }, 1400);
}

function renderTeamBuzzChips() {
  if (!teamBuzzChipsEl || !board) return;

  teamBuzzChipsEl.innerHTML = '';

  board.teams.forEach((team, index) => {
    const chip = document.createElement('div');
    chip.className = 'team-buzz-chip';
    chip.dataset.teamIndex = index;

    if (buzzerWinner === index) {
      chip.classList.add('active');
    } else if (disabledTeamsForQuestion.has(index)) {
      chip.classList.add('disabled');
    } else if (!buzzersEnabled) {
      chip.classList.add('inactive');
    }

    chip.textContent = team.name;
    teamBuzzChipsEl.appendChild(chip);
  });
}

function resetBuzzers(restartTimer = false) {
  buzzerWinner = null;
  sendRealtime({ type: 'buzzer-state', teamIndex: null });
  updateBuzzerStatus('Waiting for a buzz');
  renderTeamBuzzChips();
  renderScoringControls();
  if (restartTimer && activeCell && buzzersEnabled && !questionLocked) {
    startQuestionTimer(board.questionTimerSeconds);
  }
}

function setBuzzWinner(teamIndex) {
  buzzerWinner = teamIndex;
  playBuzzInSound();
  startQuestionTimer(board.buzzTimerSeconds);
  sendRealtime({ type: 'buzzer-state', teamIndex, teamName: board.teams[teamIndex].name });
  updateBuzzerStatus(`${board.teams[teamIndex].name} buzzed first`);
  renderTeamBuzzChips();
  renderScoringControls();
}

function handleBuzz(teamIndex) {
  if (!activeCell || questionLocked) return;
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
  correctBtn.disabled = questionLocked || buzzerWinner === null;
  correctBtn.addEventListener('click', () => applyScore(buzzerWinner, true));

  const incorrectBtn = document.createElement('button');
  incorrectBtn.className = 'score-btn incorrect';
  incorrectBtn.textContent = '✗ Incorrect';
  incorrectBtn.disabled = questionLocked || buzzerWinner === null;
  incorrectBtn.addEventListener('click', () => applyScore(buzzerWinner, false));

  const timesUpBtn = document.createElement('button');
  timesUpBtn.className = 'score-btn times-up';
  timesUpBtn.textContent = "⏰ Time's Up";
  timesUpBtn.disabled = questionLocked || !buzzersEnabled;
  timesUpBtn.addEventListener('click', () => handleTimesUp());

  const hostBtn = document.createElement('button');
  hostBtn.className = 'btn-link host-btn';
  hostBtn.id = 'host-start-btn';
  hostBtn.textContent = buzzersEnabled ? 'Buzzers Ready' : 'Start Buzzers';
  hostBtn.disabled = !activeCell || questionLocked;
  hostBtn.addEventListener('click', () => {
    buzzersEnabled = true;
    startQuestionTimer(board.questionTimerSeconds);
    updateHostButtonState();
    updateBuzzerStatus('Buzzers are live');
    renderTeamBuzzChips();
    renderScoringControls();
  });
  hostStartBtn = hostBtn;

  buttonRow.appendChild(correctBtn);
  buttonRow.appendChild(incorrectBtn);
  buttonRow.appendChild(timesUpBtn);
  buttonRow.appendChild(hostBtn);

  scoringControls.appendChild(prompt);
  scoringControls.appendChild(buttonRow);
}

async function applyScore(teamIndex, correct) {
  if (!activeCell || questionLocked || teamIndex === null || teamIndex === undefined) return;

  const res = await fetch('/api/board/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamIndex, correct }),
  });

  if (!res.ok) {
    console.error('Score update failed', await res.text());
    return;
  }

  board = await res.json();
  stopQuestionTimer();
  playAnswerSound(correct);
  renderScoreboard();
  render();

  if (!correct) {
    const teamName = board.teams[teamIndex]?.name || 'The first team';
    showTeamScoreFlash(teamIndex, -activeCell.points);
    setTimeout(() => {
      disabledTeamsForQuestion.add(teamIndex);
      resetBuzzers();
      const everyTeamMissed = board.teams.every((_, index) => disabledTeamsForQuestion.has(index));
      if (everyTeamMissed) {
        lockQuestionForTimeout();
        return;
      }
      updateBuzzerStatus(`${teamName} missed; waiting for the next buzz`);
      renderTeamBuzzChips();
      renderScoringControls();
      startQuestionTimer(board.questionTimerSeconds);
    }, 1300);
    return;
  }

  showTeamScoreFlash(teamIndex, activeCell.points);

  setTimeout(() => {
    closeOverlay();
  }, 1400);
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
  questionLocked = false;
  stopQuestionTimer();
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
  stopQuestionTimer();
  revealCurrentAnswer();
});

async function closeOverlay() {
  stopQuestionTimer();
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
  questionLocked = false;
  disabledTeamsForQuestion.clear();
  buzzersEnabled = false;
  updateHostButtonState();
  resetBuzzers();
  await loadBoard();
}

closeBtn.addEventListener('click', closeOverlay);

questionBackBtn.addEventListener('click', async () => {
  stopQuestionTimer();
  overlay.classList.add('hidden');
  flipCard.classList.remove('flipped');
  reviewBadge.classList.add('hidden');
  activeCell = null;
  questionLocked = false;
  disabledTeamsForQuestion.clear();
  buzzersEnabled = false;
  updateHostButtonState();
  resetBuzzers();
  await fetch('/api/host/question', { method: 'DELETE' }).catch(() => {});
  await loadBoard();
});

window.addEventListener('keydown', (event) => {
  if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (event.repeat) return;

  const key = event.key?.toLowerCase();
  let teamIndex = null;

  if (key === '1' || event.code === 'Digit1' || event.code === 'Numpad1' || key === 'a' || event.code === 'KeyA') {
    teamIndex = 0;
  } else if (key === '2' || event.code === 'Digit2' || event.code === 'Numpad2' || key === 'b' || event.code === 'KeyB') {
    teamIndex = 1;
  } else if (key === '3' || event.code === 'Digit3' || event.code === 'Numpad3' || key === 'l' || event.code === 'KeyL') {
    teamIndex = 2;
  }

  if (teamIndex === null) return;

  const keyId = event.code || `key:${key}`;
  if (heldBuzzerKeys.has(keyId)) return;
  heldBuzzerKeys.add(keyId);
  event.preventDefault();
  handleBuzz(teamIndex);
});

window.addEventListener('keyup', (event) => {
  const key = event.key?.toLowerCase();
  const keyId = event.code || `key:${key}`;
  heldBuzzerKeys.delete(keyId);
});

window.addEventListener('blur', () => heldBuzzerKeys.clear());

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
