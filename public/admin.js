const ROUND_POINTS = {
  1: [100, 200, 300, 400, 500],
  2: [200, 400, 600, 800, 1000],
};

const gameTitleInput = document.getElementById('game-title-input');
const saveTitleBtn = document.getElementById('save-title-btn');
const titleStatus = document.getElementById('title-status');

const categoryInputsEl = document.getElementById('category-inputs');
const saveCategoriesBtn = document.getElementById('save-categories-btn');
const clearCategoriesBtn = document.getElementById('clear-categories-btn');
const undoClearCategoriesBtn = document.getElementById('undo-clear-categories-btn');
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
const roundSelect = document.getElementById('round-select');
const roundStatus = document.getElementById('round-status');
const finalPanel = document.getElementById('final-admin-panel');
const finalCategoryInput = document.getElementById('final-category');
const finalClueInput = document.getElementById('final-clue');
const finalAnswerInput = document.getElementById('final-answer');
const finalStatus = document.getElementById('final-status');
const loadFinalSheetBtn = document.getElementById('load-final-sheet-btn');
const finalSheetSelectWrap = document.getElementById('final-sheet-select-wrap');
const finalSheetSelect = document.getElementById('final-sheet-question');
const useFinalSheetBtn = document.getElementById('use-final-sheet-btn');
const finalSheetPreview = document.getElementById('final-sheet-preview');
const finalSheetStatus = document.getElementById('final-sheet-status');
const finalConfidenceNotice = document.getElementById('final-confidence-notice');
const sheetImportPanel = document.getElementById('sheet-import-panel');
const loadSheetCategoriesBtn = document.getElementById('load-sheet-categories-btn');
const sheetImportRoundLabel = document.getElementById('sheet-import-round-label');
const sheetImportControls = document.getElementById('sheet-import-controls');
const sheetCategorySelects = document.getElementById('sheet-category-selects');
const sheetImportPreview = document.getElementById('sheet-import-preview');
const importSheetBtn = document.getElementById('import-sheet-btn');
const sheetImportStatus = document.getElementById('sheet-import-status');

let board = null;
let clearedCategoryValues = null;
let sheetCategories = [];
let sheetCategoriesRound = null;
let sheetFinalQuestions = [];
let selectedFinalSheetQuestion = null;
const POINTS = () => ROUND_POINTS[board.round] || ROUND_POINTS[1];

function setStatus(el, message, type) {
  el.textContent = message;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

async function loadBoard() {
  const res = await fetch('/api/board');
  board = await res.json();
  if (sheetCategoriesRound !== Number(board.round)) {
    sheetCategories = [];
    sheetCategoriesRound = null;
    sheetImportControls.hidden = true;
    sheetCategorySelects.innerHTML = '';
    sheetImportPreview.innerHTML = '';
    importSheetBtn.disabled = true;
    setStatus(sheetImportStatus, '', '');
  }
  gameTitleInput.value = board.gameTitle || '';
  ageGroupInput.value = board.ageGroup || '';
  roundSelect.value = String(board.round || 1);
  finalCategoryInput.value = board.finalJeopardy?.category || '';
  finalClueInput.value = board.finalJeopardy?.clue || '';
  finalAnswerInput.value = board.finalJeopardy?.answer || '';
  selectedFinalSheetQuestion = null;
  renderFinalConfidenceNotice(board.finalJeopardy?.lowConfidence, board.finalJeopardy?.confidenceNote);
  questionTimerInput.value = board.questionTimerSeconds === null ? 'none' : String(board.questionTimerSeconds ?? 5);
  buzzTimerInput.value = board.buzzTimerSeconds === null ? 'none' : String(board.buzzTimerSeconds ?? 5);
  const isFinal = Number(board.round) === 3;
  finalPanel.hidden = !isFinal;
  document.getElementById('category-panel').hidden = isFinal;
  sheetImportPanel.hidden = isFinal;
  document.getElementById('timer-panel').hidden = isFinal;
  document.getElementById('generate-panel').hidden = isFinal;
  document.getElementById('questions-panel').hidden = isFinal;
  sheetImportRoundLabel.textContent = isFinal
    ? 'Sheet categories are available for Rounds 1 and 2.'
    : `Active board: Round ${board.round}. Round 2 sheet clues map to $200–$1,000.`;
  loadSheetCategoriesBtn.textContent = isFinal ? 'Load Categories from Sheet' : `Load Round ${board.round} Categories from Sheet`;
  if (isFinal) {
    categoryInputsEl.innerHTML = '';
    qaTable.innerHTML = '';
  } else {
    renderCategoryInputs();
    renderQaTable();
  }
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const config = await res.json();
  apiKeyInput.placeholder = config.hasApiKey ? 'Key saved (enter a new one to replace)' : 'sk-...';
}

function renderFinalConfidenceNotice(lowConfidence, confidenceNote = '') {
  finalConfidenceNotice.textContent = `⚠ Low confidence — please review${confidenceNote ? `: ${confidenceNote}` : ''}`;
  finalConfidenceNotice.hidden = !lowConfidence;
}

function renderFinalSheetPreview(question) {
  finalSheetPreview.innerHTML = '';
  if (!question) {
    finalSheetPreview.hidden = true;
    return;
  }
  const category = document.createElement('strong');
  category.textContent = question.category;
  const clue = document.createElement('p');
  clue.textContent = `Clue: ${question.clue}`;
  const answer = document.createElement('p');
  answer.textContent = `Answer: ${question.answer}`;
  const usage = document.createElement('p');
  usage.textContent = `Previously played ${Number(question.playCount) || 0} time(s).`;
  finalSheetPreview.append(category, clue, answer, usage);
  if (question.lowConfidence) {
    const warning = document.createElement('p');
    warning.className = 'sheet-confidence-warning';
    warning.textContent = `⚠ Review answer — ${question.confidence || 'non-High confidence'}${question.confidenceNote ? `; ${question.confidenceNote}` : ''}`;
    finalSheetPreview.appendChild(warning);
  }
  finalSheetPreview.hidden = false;
}

function renderCategoryInputs() {
  categoryInputsEl.innerHTML = '';
  const categoryNotes = Array.isArray(board.categoryNotes) ? board.categoryNotes : [];
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

    const notesLabel = document.createElement('label');
    notesLabel.textContent = 'AI guidance (optional)';
    const notesBox = document.createElement('textarea');
    notesBox.className = 'category-notes-input';
    notesBox.value = categoryNotes[i] || '';
    notesBox.dataset.index = i;
    notesBox.maxLength = 300;
    notesBox.rows = 2;
    notesBox.placeholder = 'e.g. focus on 90s movies, avoid sports trivia, only use MCU films not comics';

    field.appendChild(label);
    field.appendChild(input);
    field.appendChild(notesLabel);
    field.appendChild(notesBox);
    categoryInputsEl.appendChild(field);
  });
}

function getCategoryFieldValues() {
  return {
    categories: Array.from(categoryInputsEl.querySelectorAll('input')).map((input) => input.value),
    categoryNotes: Array.from(categoryInputsEl.querySelectorAll('.category-notes-input')).map((input) => input.value),
  };
}

function setCategoryFieldValues(values) {
  categoryInputsEl.querySelectorAll('input').forEach((input, index) => {
    input.value = values.categories[index] || '';
  });
  categoryInputsEl.querySelectorAll('.category-notes-input').forEach((input, index) => {
    input.value = values.categoryNotes[index] || '';
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

  POINTS().forEach((points) => {
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
      wrap.classList.toggle('qa-cell-low-confidence', Boolean(cell.lowConfidence));

      const lowConfidenceNotice = document.createElement('div');
      lowConfidenceNotice.className = 'qa-low-confidence-notice';
      lowConfidenceNotice.textContent = `⚠ Low confidence — please review${cell.confidenceNote ? `: ${cell.confidenceNote}` : ''}`;
      lowConfidenceNotice.hidden = !cell.lowConfidence;

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
          cell.lowConfidence = updated.lowConfidence;
          cell.confidenceNote = updated.confidenceNote || '';
          wrap.classList.toggle('qa-cell-low-confidence', Boolean(updated.lowConfidence));
          lowConfidenceNotice.hidden = !updated.lowConfidence;
          lowConfidenceNotice.textContent = `⚠ Low confidence — please review${cell.confidenceNote ? `: ${cell.confidenceNote}` : ''}`;
          setStatus(cellStatus, 'Saved', 'ok');
        } catch (err) {
          setStatus(cellStatus, err.message, 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });

      wrap.appendChild(lowConfidenceNotice);
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

function selectedSheetCategories() {
  const names = Array.from(sheetCategorySelects.querySelectorAll('select')).map((select) => select.value);
  if (names.length !== 6 || names.some((name) => !name) || new Set(names).size !== 6) return [];
  return names.map((name) => sheetCategories.find((category) => category.name === name));
}

function renderSheetImportPreview() {
  const selected = selectedSheetCategories();
  importSheetBtn.disabled = selected.length !== 6;
  sheetImportPreview.innerHTML = '';
  if (!selected.length) {
    sheetImportPreview.textContent = 'Choose six different categories to preview their clues, answers, and review flags.';
    return;
  }

  const targetPoints = ROUND_POINTS[board.round];
  selected.forEach((category, categoryIndex) => {
    const flaggedCount = category.cells.filter((cell) => cell.lowConfidence).length;
    const details = document.createElement('details');
    details.className = 'sheet-category-preview';
    const summary = document.createElement('summary');
    const playCount = Number(category.playCount) || 0;
    summary.textContent = `${categoryIndex + 1}. ${category.name} — ${playCount} previous play(s); ${flaggedCount} answer${flaggedCount === 1 ? '' : 's'} flagged for review`;
    details.appendChild(summary);

    category.cells.forEach((cell, cellIndex) => {
      const entry = document.createElement('div');
      entry.className = 'sheet-clue-preview';
      const points = document.createElement('strong');
      points.textContent = `$${targetPoints[cellIndex]}`;
      const clue = document.createElement('p');
      clue.textContent = `Clue: ${cell.clue}`;
      const answer = document.createElement('p');
      answer.textContent = `Answer: ${cell.answer}`;
      entry.append(points, clue, answer);
      if (cell.lowConfidence) {
        const confidence = document.createElement('p');
        confidence.className = 'sheet-confidence-warning';
        confidence.textContent = `⚠ Review answer — ${cell.confidence || 'non-High confidence'}${cell.confidenceNote ? `; ${cell.confidenceNote}` : ''}`;
        entry.appendChild(confidence);
      }
      details.appendChild(entry);
    });
    sheetImportPreview.appendChild(details);
  });
}

function renderSheetCategorySelects() {
  sheetCategorySelects.innerHTML = '';
  for (let index = 0; index < 6; index += 1) {
    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    label.textContent = `Category ${index + 1}`;
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Sheet category ${index + 1}`);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a category…';
    select.appendChild(placeholder);
    sheetCategories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.name;
      option.textContent = `${category.name} (${Number(category.playCount) || 0} previous plays)`;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      const selectedNames = Array.from(sheetCategorySelects.querySelectorAll('select'))
        .map((item) => item.value)
        .filter(Boolean);
      sheetCategorySelects.querySelectorAll('select').forEach((item) => {
        Array.from(item.options).forEach((option) => {
          option.disabled = Boolean(option.value && option.value !== item.value && selectedNames.includes(option.value));
        });
      });
      renderSheetImportPreview();
    });
    field.append(label, select);
    sheetCategorySelects.appendChild(field);
  }
  renderSheetImportPreview();
}

loadSheetCategoriesBtn.addEventListener('click', async () => {
  if (!board || ![1, 2].includes(Number(board.round))) {
    setStatus(sheetImportStatus, 'Open Round 1 or Round 2 before loading categories.', 'error');
    return;
  }
  loadSheetCategoriesBtn.disabled = true;
  const round = Number(board.round);
  sheetCategories = [];
  sheetCategoriesRound = null;
  sheetImportControls.hidden = true;
  sheetCategorySelects.innerHTML = '';
  sheetImportPreview.innerHTML = '';
  importSheetBtn.disabled = true;
  setStatus(sheetImportStatus, 'Loading categories from the Google Sheet…', '');
  try {
    const res = await fetch(`/api/sheet/categories?round=${round}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load sheet categories');
    if (!Array.isArray(data.categories) || !data.categories.length) throw new Error('The sheet did not return any categories for this round');
    if (Number(board.round) !== round) throw new Error('The active round changed while categories were loading. Load them again.');
    sheetCategories = data.categories;
    sheetCategoriesRound = round;
    sheetImportControls.hidden = false;
    renderSheetCategorySelects();
    const trackingWarning = data.sheetTrackingWarning
      || (!data.trackingConfigured ? 'Play-count tracking is not configured; played categories will not update the sheet until setup is complete.' : '');
    setStatus(
      sheetImportStatus,
      `Loaded ${sheetCategories.length} categories for Round ${round}, ordered by least played.${trackingWarning ? ` ${trackingWarning}` : ''}`,
      trackingWarning ? 'error' : 'ok',
    );
  } catch (error) {
    setStatus(sheetImportStatus, error.message, 'error');
  } finally {
    loadSheetCategoriesBtn.disabled = false;
  }
});

importSheetBtn.addEventListener('click', async () => {
  const categories = selectedSheetCategories();
  if (categories.length !== 6 || sheetCategoriesRound !== Number(board.round)) {
    setStatus(sheetImportStatus, 'Choose six different categories before importing.', 'error');
    return;
  }
  const round = Number(board.round);
  const replace = window.confirm(
    `Import these six categories into Round ${round}? This replaces the round's categories, clues, and answers and resets its squares to unplayed. Team scores and Daily Doubles stay unchanged.`,
  );
  if (!replace) return;

  importSheetBtn.disabled = true;
  setStatus(sheetImportStatus, `Importing into Round ${round}…`, '');
  try {
    const res = await fetch('/api/board/import-sheet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ round, categories }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    await loadBoard();
    setStatus(sheetImportStatus, `Imported six categories into Round ${round}. Review any highlighted answers before play.`, 'ok');
  } catch (error) {
    setStatus(sheetImportStatus, error.message, 'error');
    renderSheetImportPreview();
  }
});

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
  const notesInputs = categoryInputsEl.querySelectorAll('.category-notes-input');
  const categories = Array.from(inputs).map((i) => i.value.trim() || `Category ${Number(i.dataset.index) + 1}`);
  const categoryNotes = Array.from(notesInputs).map((t) => t.value.trim());
  saveCategoriesBtn.disabled = true;
  try {
    const res = await fetch('/api/board/categories', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories, categoryNotes }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    board = await res.json();
    clearedCategoryValues = null;
    clearCategoriesBtn.disabled = false;
    undoClearCategoriesBtn.disabled = true;
    renderCategoryInputs();
    renderQaTable();
    setStatus(categoryStatus, 'Categories saved.', 'ok');
  } catch (err) {
    setStatus(categoryStatus, err.message, 'error');
  } finally {
    saveCategoriesBtn.disabled = false;
  }
});

clearCategoriesBtn.addEventListener('click', () => {
  clearedCategoryValues = getCategoryFieldValues();
  setCategoryFieldValues({ categories: [], categoryNotes: [] });
  clearCategoriesBtn.disabled = true;
  undoClearCategoriesBtn.disabled = false;
  setStatus(categoryStatus, 'Category and AI guidance fields cleared. Save Categories to apply, or undo to restore them.', 'ok');
});

undoClearCategoriesBtn.addEventListener('click', () => {
  if (!clearedCategoryValues) return;
  setCategoryFieldValues(clearedCategoryValues);
  clearedCategoryValues = null;
  clearCategoriesBtn.disabled = false;
  undoClearCategoriesBtn.disabled = true;
  setStatus(categoryStatus, 'Cleared category fields restored.', 'ok');
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

document.getElementById('save-round-btn').addEventListener('click', async () => {
  const button = document.getElementById('save-round-btn');
  button.disabled = true;
  try {
    const res = await fetch('/api/board/round', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ round: Number(roundSelect.value) }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Could not open that round');
    board = await res.json();
    await loadBoard();
    setStatus(roundStatus, `Round ${board.round} is now active.`, 'ok');
  } catch (error) {
    setStatus(roundStatus, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

loadFinalSheetBtn.addEventListener('click', async () => {
  if (!board || Number(board.round) !== 3) {
    setStatus(finalSheetStatus, 'Open Final Jeopardy before loading questions.', 'error');
    return;
  }
  loadFinalSheetBtn.disabled = true;
  sheetFinalQuestions = [];
  finalSheetSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a question…';
  finalSheetSelect.appendChild(placeholder);
  finalSheetSelectWrap.hidden = true;
  useFinalSheetBtn.disabled = true;
  renderFinalSheetPreview(null);
  setStatus(finalSheetStatus, 'Loading Final Jeopardy questions from the Google Sheet…', '');
  try {
    const res = await fetch('/api/sheet/final-questions');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load Final Jeopardy questions');
    if (!Array.isArray(data.questions) || !data.questions.length) throw new Error('The sheet did not return any Final Jeopardy questions');
    if (Number(board.round) !== 3) throw new Error('The active round changed while questions were loading. Load them again.');
    sheetFinalQuestions = data.questions;
    sheetFinalQuestions.forEach((question, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      const cluePreview = question.clue.length > 90 ? `${question.clue.slice(0, 90)}…` : question.clue;
      option.textContent = `${question.category} (${Number(question.playCount) || 0} previous plays) — ${cluePreview}`;
      finalSheetSelect.appendChild(option);
    });
    finalSheetSelectWrap.hidden = false;
    const trackingWarning = data.sheetTrackingWarning
      || (!data.trackingConfigured ? 'Play-count tracking is not configured; played questions will not update the sheet until setup is complete.' : '');
    setStatus(
      finalSheetStatus,
      `Loaded ${sheetFinalQuestions.length} Final Jeopardy questions, ordered by least played.${trackingWarning ? ` ${trackingWarning}` : ''}`,
      trackingWarning ? 'error' : 'ok',
    );
  } catch (error) {
    setStatus(finalSheetStatus, error.message, 'error');
  } finally {
    loadFinalSheetBtn.disabled = false;
  }
});

finalSheetSelect.addEventListener('change', () => {
  const question = finalSheetSelect.value === '' ? null : sheetFinalQuestions[Number(finalSheetSelect.value)];
  renderFinalSheetPreview(question);
  useFinalSheetBtn.disabled = !question;
});

useFinalSheetBtn.addEventListener('click', () => {
  const question = finalSheetSelect.value === '' ? null : sheetFinalQuestions[Number(finalSheetSelect.value)];
  if (!question) return;
  selectedFinalSheetQuestion = question;
  finalCategoryInput.value = question.category;
  finalClueInput.value = question.clue;
  finalAnswerInput.value = question.answer;
  renderFinalConfidenceNotice(question.lowConfidence, question.confidenceNote);
  setStatus(finalSheetStatus, 'Fields filled from the sheet. Review them below, then save Final Jeopardy.', 'ok');
});

[finalCategoryInput, finalClueInput, finalAnswerInput].forEach((input) => {
  input.addEventListener('input', () => {
    if (!selectedFinalSheetQuestion && !board?.finalJeopardy?.lowConfidence) return;
    selectedFinalSheetQuestion = null;
    if (board?.finalJeopardy) {
      board.finalJeopardy.lowConfidence = false;
      board.finalJeopardy.confidenceNote = '';
    }
    renderFinalConfidenceNotice(false);
    setStatus(finalSheetStatus, 'Manual edits will be saved as entered. Save Final Jeopardy to apply.', '');
  });
});

document.getElementById('save-final-btn').addEventListener('click', async () => {
  const button = document.getElementById('save-final-btn');
  button.disabled = true;
  try {
    const res = await fetch('/api/board/final', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: finalCategoryInput.value,
        clue: finalClueInput.value,
        answer: finalAnswerInput.value,
        lowConfidence: selectedFinalSheetQuestion?.lowConfidence === true,
        confidenceNote: selectedFinalSheetQuestion?.confidenceNote || '',
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    board = await res.json();
    renderFinalConfidenceNotice(board.finalJeopardy.lowConfidence, board.finalJeopardy.confidenceNote);
    setStatus(finalStatus, 'Final Jeopardy saved.', 'ok');
  } catch (error) {
    setStatus(finalStatus, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});
