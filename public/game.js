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

let board = null;
let activeCell = null;
let disabledTeamsForQuestion = new Set();

async function loadBoard() {
  const res = await fetch('/api/board');
  board = await res.json();
  gameTitleEl.textContent = `🏆 ${board.gameTitle}`;
  document.title = `${board.gameTitle} Board`;
  render();
  renderScoreboard();
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

function renderScoreboard() {
  scoreboardEl.innerHTML = '';
  board.teams.forEach((team, i) => {
    const card = document.createElement('div');
    card.className = 'team-card';

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
  board.teams.forEach((team, i) => {
    const row = document.createElement('div');
    row.className = 'scoring-row' + (disabledTeamsForQuestion.has(i) ? ' disabled-team' : '');

    const label = document.createElement('span');
    label.className = 'scoring-team-name';
    label.textContent = team.name;

    const correctBtn = document.createElement('button');
    correctBtn.className = 'score-btn correct';
    correctBtn.textContent = '✓ Correct';
    correctBtn.disabled = disabledTeamsForQuestion.has(i);
    correctBtn.addEventListener('click', () => applyScore(i, true));

    const incorrectBtn = document.createElement('button');
    incorrectBtn.className = 'score-btn incorrect';
    incorrectBtn.textContent = '✗ Incorrect';
    incorrectBtn.disabled = disabledTeamsForQuestion.has(i);
    incorrectBtn.addEventListener('click', () => applyScore(i, false));

    row.appendChild(label);
    row.appendChild(correctBtn);
    row.appendChild(incorrectBtn);
    scoringControls.appendChild(row);
  });
}

async function applyScore(teamIndex, correct) {
  if (!activeCell) return;
  if (!correct) {
    disabledTeamsForQuestion.add(teamIndex);
  }
  const res = await fetch('/api/board/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamIndex, points: activeCell.points, correct }),
  });
  board = await res.json();
  renderScoreboard();
  renderScoringControls();
  if (correct) {
    await closeOverlay();
  }
}

function openCell(catIndex, points) {
  const cell = cellFor(catIndex, points);
  if (!cell) return;
  activeCell = cell;
  disabledTeamsForQuestion.clear();

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
  render();
}

closeBtn.addEventListener('click', closeOverlay);

resetBtn.addEventListener('click', async () => {
  if (!confirm('Start a new game? This clears which squares have been played and resets scores to 0 (questions and team names stay the same).')) return;
  const res = await fetch('/api/board/reset', { method: 'POST' });
  board = await res.json();
  render();
  renderScoreboard();
});

loadBoard();
