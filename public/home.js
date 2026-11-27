const titleEl = document.getElementById('home-title');
const statusEl = document.getElementById('home-status');
const roundTiles = document.querySelectorAll('.home-tile[data-round]');
let board = null;

async function readApiResponse(res, fallbackMessage) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('json')) {
    throw new Error(
      `The server returned a web page instead of API data (HTTP ${res.status}). Restart the Jeoparty server and reload the Main Screen.`,
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

async function loadBoard() {
  const res = await fetch('/api/board');
  board = await readApiResponse(res, 'Could not load the game board.');
  titleEl.textContent = board.gameTitle || 'JEOPARTY!';
  document.title = `${board.gameTitle || 'Jeoparty'} Main Screen`;
  roundTiles.forEach((tile) => {
    const current = Number(tile.dataset.round) === Number(board.round || 1);
    tile.classList.toggle('is-current', current);
    tile.querySelector('.home-tile-badge')?.remove();
    if (current) {
      const badge = document.createElement('span');
      badge.className = 'home-tile-badge';
      badge.textContent = 'Now playing';
      tile.append(badge);
    }
  });
}

roundTiles.forEach((tile) => {
  tile.addEventListener('click', async () => {
    if (!board) return;
    const round = Number(tile.dataset.round);
    roundTiles.forEach((item) => { item.disabled = true; });
    statusEl.textContent = 'Opening round…';
    try {
      const res = await fetch('/api/board/round', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ round }),
      });
      await readApiResponse(res, 'Could not open that round.');
      location.href = '/';
    } catch (error) {
      statusEl.textContent = error.message;
      roundTiles.forEach((item) => { item.disabled = false; });
    }
  });
});

loadBoard().catch((error) => { statusEl.textContent = error.message; });

if (window.ThemeMusic) {
  window.ThemeMusic.play();
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.ThemeMusic.play();
  });
  document.body.append(window.ThemeMusic.createToggle('music-toggle-home'));
}
