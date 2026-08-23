const POINTS = [100, 200, 300, 400, 500];

const gameTitleInput = document.getElementById('game-title-input');
const saveTitleBtn = document.getElementById('save-title-btn');
const titleStatus = document.getElementById('title-status');

const categoryInputsEl = document.getElementById('category-inputs');
const saveCategoriesBtn = document.getElementById('save-categories-btn');
const categoryStatus = document.getElementById('category-status');
const questionTimerInput = document.getElementById('question-timer');
const buzzTimerInput = document.getElementById('buzz-timer');
const saveTimersBtn = document.getElementById('save-timers-btn');
const timerStatus = document.getElementById('timer-status');

const ageGroupInput = document.getElementById('age-group');
const apiKeyInput = document.getElementById('api-key');
const saveKeyBtn = document.getElementById('save-key-btn');
const clearKeyBtn = document.getElementById('clear-key-btn');
const keyStatus = document.getElementById('key-status');
const generateBtn = document.getElementById('generate-btn');
const generateStatus = document.getElementById('generate-status');

const qaTable = document.getElementById('qa-table');

let board = null;

function setStatus(el, message, type) {
  el.textContent = message;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

async function loadBoard() {
  const res = await fetch('/api/board');
  board = await res.json();
  gameTitleInput.value = board.gameTitle || '';
  ageGroupInput.value = board.ageGroup || '';
  questionTimerInput.value = board.questionTimerSeconds === null ? 'none' : String(board.questionTimerSeconds ?? 5);
  buzzTimerInput.value = board.buzzTimerSeconds === null ? 'none' : String(board.buzzTimerSeconds ?? 5);
  renderCategoryInputs();
  renderQaTable();
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const config = await res.json();
  apiKeyInput.placeholder = config.hasApiKey ? 'Key saved (enter a new one to replace)' : 'sk-...';
}

function renderCategoryInputs() {
  categoryInputsEl.innerHTML = '';
  board.categories.forEach((name, i) => {
    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    label.textContent = `Category ${i + 1}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = name;
    input.dataset.index = i;
    input.maxLength = 60;
    field.appendChild(label);
    field.appendChild(input);
    categoryInputsEl.appendChild(field);
  });
}

function cellFor(catIndex, points) {
  return board.cells.find((c) => c.catIndex === catIndex && c.points === points);
}

function renderQaTable() {
  qaTable.innerHTML = '';

  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  board.categories.forEach((name) => {
    const th = document.createElement('th');
    th.textContent = name;
    headRow.appendChild(th);
  });
  qaTable.appendChild(headRow);

  POINTS.forEach((points) => {
    const row = document.createElement('tr');
    const pointCell = document.createElement('td');
    pointCell.className = 'points-label';
    pointCell.textContent = `$${points}`;
    row.appendChild(pointCell);

    board.categories.forEach((_, catIndex) => {
      const cell = cellFor(catIndex, points);
      const td = document.createElement('td');

      const wrap = document.createElement('div');
      wrap.className = 'qa-cell';

      const clueLabel = document.createElement('div');
      clueLabel.className = 'qa-label';
      clueLabel.textContent = 'Clue';
      const clueBox = document.createElement('textarea');
      clueBox.value = cell.clue || '';
      clueBox.rows = 3;

      const answerLabel = document.createElement('div');
      answerLabel.className = 'qa-label';
      answerLabel.textContent = 'Answer';
      const answerBox = document.createElement('textarea');
      answerBox.value = cell.answer || '';
      answerBox.rows = 2;

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn secondary';
      saveBtn.textContent = 'Save Question';
      saveBtn.style.fontSize = '0.75rem';
      saveBtn.style.padding = '6px 10px';

      const cellStatus = document.createElement('div');
      cellStatus.className = 'status-msg';

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          const res = await fetch('/api/board/cell', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              catIndex,
              points,
              clue: clueBox.value,
              answer: answerBox.value,
            }),
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
          const updated = await res.json();
          cell.clue = updated.clue;
          cell.answer = updated.answer;
          setStatus(cellStatus, 'Saved', 'ok');
        } catch (err) {
          setStatus(cellStatus, err.message, 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });

      wrap.appendChild(clueLabel);
      wrap.appendChild(clueBox);
      wrap.appendChild(answerLabel);
      wrap.appendChild(answerBox);
      wrap.appendChild(saveBtn);
      wrap.appendChild(cellStatus);
      td.appendChild(wrap);
      row.appendChild(td);
    });

    qaTable.appendChild(row);
  });
}

saveTitleBtn.addEventListener('click', async () => {
  saveTitleBtn.disabled = true;
  try {
    const res = await fetch('/api/board/title', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: gameTitleInput.value.trim() }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    board = await res.json();
    gameTitleInput.value = board.gameTitle;
    setStatus(titleStatus, 'Title saved.', 'ok');
  } catch (err) {
    setStatus(titleStatus, err.message, 'error');
  } finally {
    saveTitleBtn.disabled = false;
  }
});

saveCategoriesBtn.addEventListener('click', async () => {
  const inputs = categoryInputsEl.querySelectorAll('input');
  const categories = Array.from(inputs).map((i) => i.value.trim() || `Category ${Number(i.dataset.index) + 1}`);
  saveCategoriesBtn.disabled = true;
  try {
    const res = await fetch('/api/board/categories', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    board = await res.json();
    renderQaTable();
    setStatus(categoryStatus, 'Categories saved.', 'ok');
  } catch (err) {
    setStatus(categoryStatus, err.message, 'error');
  } finally {
    saveCategoriesBtn.disabled = false;
  }
});

saveTimersBtn.addEventListener('click', async () => {
  const timerValue = (input) => input.value === 'none' ? null : Number(input.value);
  saveTimersBtn.disabled = true;
  try {
    const res = await fetch('/api/board/timers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        questionTimerSeconds: timerValue(questionTimerInput),
        buzzTimerSeconds: timerValue(buzzTimerInput),
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    board = await res.json();
    setStatus(timerStatus, 'Timer settings saved.', 'ok');
  } catch (err) {
    setStatus(timerStatus, err.message, 'error');
  } finally {
    saveTimersBtn.disabled = false;
  }
});

saveKeyBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus(keyStatus, 'Enter a key first.', 'error');
    return;
  }
  saveKeyBtn.disabled = true;
  try {
    const res = await fetch('/api/config/apikey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    apiKeyInput.value = '';
    await loadConfig();
    setStatus(keyStatus, 'API key saved.', 'ok');
  } catch (err) {
    setStatus(keyStatus, err.message, 'error');
  } finally {
    saveKeyBtn.disabled = false;
  }
});

clearKeyBtn.addEventListener('click', async () => {
  clearKeyBtn.disabled = true;
  try {
    await fetch('/api/config/apikey', { method: 'DELETE' });
    await loadConfig();
    setStatus(keyStatus, 'API key cleared.', 'ok');
  } finally {
    clearKeyBtn.disabled = false;
  }
});

generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  setStatus(generateStatus, 'Generating questions with AI… this can take up to a minute.', '');
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ageGroup: ageGroupInput.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');
    const { warnings, ...cleanBoard } = data;
    board = cleanBoard;
    renderQaTable();
    if (warnings && warnings.length) {
      setStatus(generateStatus, `Generated, but left blank for you to write by hand (answer was given away or reused): ${warnings.join(', ')}`, 'error');
    } else {
      setStatus(generateStatus, 'Questions generated. Review and edit below, then save any tweaks.', 'ok');
    }
  } catch (err) {
    setStatus(generateStatus, err.message, 'error');
  } finally {
    generateBtn.disabled = false;
  }
});

loadBoard();
loadConfig();
