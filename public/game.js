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

let board = null;
let activeCell = null;

async function loadBoard() {
  const res = await fetch('/api/board');
  board = await res.json();
  render();
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
      }
      if (cell && !cell.used) {
        el.addEventListener('click', () => openCell(catIndex, points));
      }
      boardEl.appendChild(el);
    });
  });
}

function openCell(catIndex, points) {
  const cell = cellFor(catIndex, points);
  if (!cell) return;
  activeCell = cell;

  flipFront.textContent = `$${points}`;
  clueText.textContent = cell.clue && cell.clue.trim()
    ? cell.clue
    : '(No question has been added for this square yet. Add one on the Admin page.)';
  answerText.textContent = '';
  answerText.style.visibility = 'hidden';
  revealAnswerBtn.disabled = false;
  revealAnswerBtn.textContent = 'Reveal Answer';

  flipCard.classList.remove('flipped');
  overlayControls.classList.remove('visible');
  overlay.classList.remove('hidden');

  // Force layout so the browser registers the un-flipped state before
  // transitioning, otherwise the flip transition can be skipped entirely.
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

closeBtn.addEventListener('click', async () => {
  if (activeCell) {
    await fetch('/api/board/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catIndex: activeCell.catIndex, points: activeCell.points }),
    });
    activeCell.used = true;
  }
  overlay.classList.add('hidden');
  flipCard.classList.remove('flipped');
  activeCell = null;
  render();
});

resetBtn.addEventListener('click', async () => {
  if (!confirm('Start a new game? This clears which squares have been played (questions stay the same).')) return;
  const res = await fetch('/api/board/reset', { method: 'POST' });
  board = await res.json();
  render();
});

loadBoard();
