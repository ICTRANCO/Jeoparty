const SPREADSHEET_ID = '1St9IpVjLblgFGBDO8V7Ma4L3S909tW9nCGFiWPyP2ZE';
const SOURCE_SHEET_ID = 28490002;
const PLAY_LOG_SHEET = 'Jeoparty Play Log';
const WRITE_TOKEN_PROPERTY = 'JEOPARDY_SHEET_WRITE_TOKEN';

function doPost(event) {
  let payload;
  try {
    payload = JSON.parse(event.postData.contents);
  } catch (error) {
    return output_({ ok: false, retryable: false, error: 'Request body must be valid JSON' });
  }

  const expectedToken = PropertiesService.getScriptProperties().getProperty(WRITE_TOKEN_PROPERTY);
  if (!expectedToken || expectedToken.length < 32 || payload.token !== expectedToken) {
    return output_({ ok: false, retryable: true, error: 'Sheet write authorization is not configured or is invalid' });
  }
  if (payload.action !== 'record-play') {
    return output_({ ok: false, retryable: false, error: 'Unsupported action' });
  }
  if (typeof payload.eventId !== 'string' || !payload.eventId || ![1, 2, 3].includes(Number(payload.round))) {
    return output_({ ok: false, retryable: false, error: 'A valid eventId and round are required' });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    return output_(recordPlay_(payload));
  } catch (error) {
    return output_({ ok: false, retryable: true, error: String(error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function recordPlay_(payload) {
  const round = Number(payload.round);
  const category = String(payload.category || '').trim();
  const sourceClue = round === 3 ? String(payload.clue || '').trim() : '';
  if (!category || (round === 3 && !sourceClue)) {
    return { ok: false, retryable: false, error: 'Category and Final Jeopardy clue are required' };
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetById(SOURCE_SHEET_ID);
  if (!sheet) throw new Error('The configured source sheet tab was not found');
  const values = sheet.getDataRange().getValues();
  const headerRowIndex = findHeaderRow_(values);
  if (headerRowIndex < 0) throw new Error('Could not find the source sheet header row');

  const headers = values[headerRowIndex].map(normalizeHeader_);
  const roundColumn = findColumn_(headers, ['round']);
  const categoryColumn = findColumn_(headers, ['category', 'family jeopardy category']);
  const finalClueColumn = findColumn_(headers, ['500 clue']);
  if (roundColumn < 0 || categoryColumn < 0 || finalClueColumn < 0) {
    throw new Error('The source sheet is missing the Round, Category, or 500 Clue column');
  }

  const matchingRows = [];
  for (let index = headerRowIndex + 1; index < values.length; index += 1) {
    const row = values[index];
    if (normalizeCell_(row[categoryColumn]) !== category) continue;
    if (round === 3) {
      if (normalizeCell_(row[roundColumn]) === '' && normalizeCell_(row[finalClueColumn]) === sourceClue) {
        matchingRows.push(index + 1);
      }
    } else if (Number(normalizeCell_(row[roundColumn]).match(/\d+/)?.[0]) === round) {
      matchingRows.push(index + 1);
    }
  }
  if (matchingRows.length !== 1) {
    return {
      ok: false,
      retryable: false,
      error: matchingRows.length ? 'More than one source row matched this category' : 'No source row matched this category',
    };
  }

  let playCountColumn = findColumn_(headers, ['times played']);
  if (playCountColumn < 0) {
    playCountColumn = sheet.getLastColumn();
    sheet.getRange(headerRowIndex + 1, playCountColumn + 1).setValue('Times Played');
    playCountColumn += 1;
  } else {
    playCountColumn += 1;
  }

  const existingCount = Number(sheet.getRange(matchingRows[0], playCountColumn).getValue());
  const currentCount = Number.isSafeInteger(existingCount) && existingCount > 0 ? existingCount : 0;
  const log = getPlayLog_(spreadsheet);
  const logLastRow = log.getLastRow();
  const logRows = logLastRow > 1 ? log.getRange(2, 1, logLastRow - 1, 5).getValues() : [];
  const categoryEvents = logRows.filter((row) => Number(row[2]) === round
    && normalizeCell_(row[3]) === category
    && normalizeCell_(row[4]) === sourceClue);
  if (!categoryEvents.length) {
    const baselinePrefix = `baseline:${encodeURIComponent(JSON.stringify([round, category, sourceClue]))}:`;
    for (let index = 0; index < currentCount; index += 1) {
      const baselineEvent = [`${baselinePrefix}${index + 1}`, new Date(), round, category, sourceClue];
      log.appendRow(baselineEvent);
      logRows.push(baselineEvent);
    }
  }
  const duplicate = logRows.some((row) => String(row[0]) === payload.eventId);
  if (!duplicate) {
    log.appendRow([payload.eventId, new Date(), round, category, sourceClue]);
    logRows.push([payload.eventId, new Date(), round, category, sourceClue]);
  }

  const playCount = logRows.filter((row) => Number(row[2]) === round
    && normalizeCell_(row[3]) === category
    && normalizeCell_(row[4]) === sourceClue).length;
  sheet.getRange(matchingRows[0], playCountColumn).setValue(playCount);
  return { ok: true, playCount, duplicate };
}

function findHeaderRow_(values) {
  const maxRows = Math.min(values.length, 20);
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const headers = values[rowIndex].map(normalizeHeader_);
    if (findColumn_(headers, ['round']) >= 0
      && findColumn_(headers, ['category', 'family jeopardy category']) >= 0) return rowIndex;
  }
  return -1;
}

function findColumn_(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}

function normalizeHeader_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCell_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function getPlayLog_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(PLAY_LOG_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(PLAY_LOG_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Event ID', 'Played At', 'Round', 'Category', 'Final Jeopardy Clue']);
  }
  return sheet;
}

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
