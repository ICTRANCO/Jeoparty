(() => {
  const MUTE_KEY = 'jeoparty.themeMusicMuted';
  const audio = new Audio('/audio/jeopardy-theme.mp3');
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.45;
  let wanted = false;
  let muted = false;
  let retryPending = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch (error) {
    console.warn('Theme music preference could not be read.', error);
  }
  const toggles = new Set();

  function retryOnInteraction() {
    if (retryPending) return;
    retryPending = true;
    const retry = () => {
      window.removeEventListener('pointerdown', retry, true);
      window.removeEventListener('keydown', retry, true);
      retryPending = false;
      if (wanted && !muted) audio.play().catch((error) => console.warn('Theme music could not be played.', error));
    };
    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('keydown', retry, true);
  }

  function play({ restart = false } = {}) {
    wanted = true;
    if (restart) audio.currentTime = 0;
    if (!muted) audio.play().catch(retryOnInteraction);
  }

  function stop() {
    wanted = false;
    audio.pause();
  }

  function renderToggle(button) {
    button.textContent = muted ? 'Music Off' : 'Music On';
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? 'Unmute theme music' : 'Mute theme music');
  }

  function setMuted(value) {
    muted = Boolean(value);
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (error) {
      console.warn('Theme music preference could not be saved.', error);
    }
    if (muted) audio.pause();
    else if (wanted) audio.play().catch(retryOnInteraction);
    toggles.forEach(renderToggle);
  }

  function createToggle(className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `music-toggle ${className}`.trim();
    button.addEventListener('click', () => setMuted(!muted));
    toggles.add(button);
    renderToggle(button);
    return button;
  }

  window.addEventListener('pagehide', () => audio.pause());
  window.ThemeMusic = { play, stop, createToggle, isMuted: () => muted, setMuted };
})();
