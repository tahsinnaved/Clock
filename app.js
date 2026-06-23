/* ============================================================
   Study Timer — Application Logic
   A minimal, offline study timer with session tracking.
   All data persisted via localStorage.
   ============================================================ */

;(function () {
  'use strict';

  // ─── Constants ───
  const STORAGE_KEY = 'studytimer_sessions';
  const THEME_STORAGE_KEY = 'studytimer_theme';
  const HIGH_CONTRAST_THEME = 'high-contrast';
  const FLIP_DURATION_MS = 550;
  const PIP_CANVAS_WIDTH = 960;
  const PIP_CANVAS_HEIGHT = 540;

  // ─── State ───
  let timerState  = 'idle';   // idle | running | paused | finished
  let totalSecs   = 0;        // total seconds set by user
  let remainSecs  = 0;        // remaining seconds
  let intervalId  = null;
  let endTimestamp = null;    // absolute end time while running
  let sessionStart = null;    // Date when timer was first started
  let pipCanvasContext = null;

  // ─── DOM References ───
  const $ = (id) => document.getElementById(id);

  const dom = {
    app:          $('app'),
    timerDisplay: $('timerDisplay'),
    timeSetup:    $('timeSetup'),
    digitH:       $('digitH'),
    digitM:       $('digitM'),
    digitS:       $('digitS'),
    inputH:       $('inputH'),
    inputM:       $('inputM'),
    inputS:       $('inputS'),
    statusLine:   $('statusLine'),
    progressTrack:$('progressTrack'),
    progressFill: $('progressFill'),
    btnStart:     $('btnStart'),
    btnPause:     $('btnPause'),
    btnReset:     $('btnReset'),
    btnTheme:     $('btnTheme'),
    btnPip:       $('btnPip'),
    sessionForm:  $('sessionForm'),
    noteSubject:  $('noteSubject'),
    noteMotivation: $('noteMotivation'),
    noteFocus:    $('noteFocus'),
    motivationVal:$('motivationVal'),
    focusVal:     $('focusVal'),
    btnSave:      $('btnSave'),
    btnDiscard:   $('btnDiscard'),
    historyList:  $('historyList'),
    emptyState:   $('emptyState'),
    pipCanvas:    $('pipCanvas'),
    pipVideo:     $('pipVideo'),
  };

  // ─── Helpers ───

  /** Pad number to 2 digits */
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** Convert total seconds to { h, m, s } */
  function toHMS(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return { h, m, s };
  }

  /** Format seconds to readable duration string */
  function formatDuration(secs) {
    const { h, m, s } = toHMS(secs);
    if (h > 0) return `${h}h ${pad(m)}m`;
    if (m > 0) return `${m}m ${pad(s)}s`;
    return `${s}s`;
  }

  /** Format a Date to short date string */
  function formatDate(d) {
    const date = new Date(d);
    return date.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  /** Format a Date to time string */
  function formatTime(d) {
    const date = new Date(d);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit'
    });
  }

  /** Determine whether the browser can open picture-in-picture */
  function isPictureInPictureSupported() {
    return !!(
      document.pictureInPictureEnabled &&
      dom.pipCanvas &&
      typeof dom.pipCanvas.captureStream === 'function' &&
      dom.pipVideo &&
      typeof dom.pipVideo.requestPictureInPicture === 'function'
    );
  }

  /** Determine whether high contrast mode is active */
  function isHighContrastTheme() {
    return document.body.classList.contains('theme-high-contrast');
  }

  /** Read the saved theme preference */
  function loadThemePreference() {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      return savedTheme === HIGH_CONTRAST_THEME ? HIGH_CONTRAST_THEME : 'vintage';
    } catch {
      return 'vintage';
    }
  }

  /** Persist the current theme preference */
  function saveThemePreference(theme) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures and keep the in-memory theme.
    }
  }

  /** Keep the theme toggle button in sync with the current theme */
  function syncThemeButton() {
    if (!dom.btnTheme) return;

    const active = isHighContrastTheme();
    dom.btnTheme.textContent = active ? 'Vintage' : 'High Contrast';
    dom.btnTheme.classList.toggle('is-active', active);
    dom.btnTheme.setAttribute('aria-pressed', String(active));
    dom.btnTheme.title = active ? 'Switch to vintage mode' : 'Switch to high contrast mode';
  }

  /** Apply a theme and persist the choice */
  function applyTheme(theme) {
    const nextTheme = theme === HIGH_CONTRAST_THEME ? HIGH_CONTRAST_THEME : 'vintage';
    document.body.classList.toggle('theme-high-contrast', nextTheme === HIGH_CONTRAST_THEME);
    saveThemePreference(nextTheme);
    syncThemeButton();
    updatePictureInPictureFrame();
  }

  /** Toggle between vintage and high contrast themes */
  function toggleTheme() {
    applyTheme(isHighContrastTheme() ? 'vintage' : HIGH_CONTRAST_THEME);
  }

  /** Return the remaining seconds currently shown by the timer */
  function getCurrentRemainingSecs() {
    if (timerState === 'running' && endTimestamp !== null) {
      return Math.max(0, Math.ceil((endTimestamp - Date.now()) / 1000));
    }
    return remainSecs;
  }

  /** Return the plain text currently shown in the status line */
  function getStatusText() {
    return (dom.statusLine.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** Map timer state to a short label for PiP */
  function getPiPStateLabel() {
    switch (timerState) {
      case 'running':
        return 'Running';
      case 'paused':
        return 'Paused';
      case 'finished':
        return 'Complete';
      default:
        return 'Ready';
    }
  }

  /** Draw a rounded rectangle path */
  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  /** Keep the PiP toggle in sync with the current browser state */
  function syncPiPButton() {
    if (!dom.btnPip) return;

    const active = document.pictureInPictureElement === dom.pipVideo;
    dom.btnPip.textContent = active ? 'Exit PiP' : 'PiP';
    dom.btnPip.classList.toggle('is-active', active);
    dom.btnPip.setAttribute('aria-pressed', String(active));
  }

  /** Render the timer into the PiP canvas */
  function renderPictureInPicture() {
    if (!pipCanvasContext || !dom.pipCanvas) return;

    const canvas = dom.pipCanvas;
    const ctx = pipCanvasContext;
    const width = canvas.width;
    const height = canvas.height;
    const displaySecs = timerState === 'idle' ? readInputTime() : getCurrentRemainingSecs();
    const { h, m, s } = toHMS(displaySecs);
    const timeText = `${pad(h)}:${pad(m)}:${pad(s)}`;
    const statusText = getStatusText() || 'Press Space to start';
    const stateLabel = getPiPStateLabel();
    const progressTotal = timerState === 'idle' ? Math.max(readInputTime(), totalSecs) : totalSecs;
    const progressElapsed = timerState === 'idle' ? 0 : Math.max(0, totalSecs - remainSecs);
    const progressPct = progressTotal > 0 ? Math.min(1, progressElapsed / progressTotal) : 0;
    const highContrastTheme = isHighContrastTheme();

    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, width, height);
    if (highContrastTheme) {
      background.addColorStop(0, '#ffffff');
      background.addColorStop(1, '#ededed');
    } else {
      background.addColorStop(0, '#f7f2e8');
      background.addColorStop(1, '#eee5d8');
    }
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    if (!highContrastTheme) {
      const glow = ctx.createRadialGradient(width * 0.3, height * 0.3, 0, width * 0.3, height * 0.3, width * 0.85);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
      glow.addColorStop(0.55, 'rgba(255, 255, 255, 0.12)');
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }

    roundRectPath(ctx, 34, 30, width - 68, height - 60, 30);
    ctx.fillStyle = highContrastTheme ? 'rgba(255, 255, 255, 0.95)' : 'rgba(251, 248, 243, 0.92)';
    ctx.fill();
    ctx.strokeStyle = highContrastTheme ? 'rgba(17, 17, 17, 0.16)' : 'rgba(17, 17, 17, 0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = highContrastTheme ? '#111111' : '#7a746c';
    ctx.font = highContrastTheme ? '700 24px "IBM Plex Sans", sans-serif' : '600 24px "Libre Baskerville", serif';
    ctx.fillText('Study Timer', width / 2, 92);

    const labelText = stateLabel.toUpperCase();
    const labelWidth = ctx.measureText(labelText).width + 34;
    roundRectPath(ctx, width / 2 - labelWidth / 2, 112, labelWidth, 34, 17);
    ctx.fillStyle = highContrastTheme ? 'rgba(17, 17, 17, 0.04)' : timerState === 'paused' ? 'rgba(17, 17, 17, 0.07)' : timerState === 'finished' ? 'rgba(17, 17, 17, 0.1)' : 'rgba(17, 17, 17, 0.05)';
    ctx.fill();
    ctx.strokeStyle = highContrastTheme ? 'rgba(17, 17, 17, 0.18)' : timerState === 'paused' ? 'rgba(17, 17, 17, 0.18)' : timerState === 'finished' ? 'rgba(17, 17, 17, 0.22)' : 'rgba(17, 17, 17, 0.14)';
    ctx.stroke();
    ctx.fillStyle = '#111111';
    ctx.font = '700 16px "IBM Plex Mono", monospace';
    ctx.fillText(labelText, width / 2, 134);

    ctx.save();
    ctx.shadowBlur = highContrastTheme ? 0 : 18;
    ctx.shadowColor = highContrastTheme ? 'rgba(0, 0, 0, 0)' : 'rgba(17, 17, 17, 0.12)';
    ctx.fillStyle = timerState === 'paused' ? (highContrastTheme ? '#3d3d3d' : '#5d5851') : '#111111';
    ctx.font = '700 112px "IBM Plex Mono", monospace';
    ctx.fillText(timeText, width / 2, height / 2 + 28);
    ctx.restore();

    const barWidth = width * 0.7;
    const barX = (width - barWidth) / 2;
    const barY = height - 124;
    roundRectPath(ctx, barX, barY, barWidth, 14, 7);
    ctx.fillStyle = highContrastTheme ? 'rgba(17, 17, 17, 0.12)' : 'rgba(17, 17, 17, 0.08)';
    ctx.fill();

    if (progressPct > 0) {
      roundRectPath(ctx, barX, barY, barWidth * progressPct, 14, 7);
      const fill = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
      if (highContrastTheme) {
        fill.addColorStop(0, '#111111');
        fill.addColorStop(0.5, '#444444');
        fill.addColorStop(1, '#8a8a8a');
      } else {
        fill.addColorStop(0, '#111111');
        fill.addColorStop(0.5, '#4a4a4a');
        fill.addColorStop(1, '#8a857e');
      }
      ctx.fillStyle = fill;
      ctx.fill();
    }

    ctx.fillStyle = highContrastTheme ? '#4f4f4f' : '#7a746c';
    ctx.font = '500 24px "IBM Plex Sans", sans-serif';
    ctx.fillText(statusText, width / 2, height - 72);
  }

  /** Update the PiP canvas and keep the video stream fresh */
  function updatePictureInPictureFrame() {
    renderPictureInPicture();
  }

  /** Prepare the hidden PiP canvas/video pair */
  function initializePictureInPicture() {
    if (!isPictureInPictureSupported()) {
      dom.btnPip.disabled = true;
      dom.btnPip.title = 'Picture-in-Picture is not supported in this browser';
      return;
    }

    dom.pipCanvas.width = PIP_CANVAS_WIDTH;
    dom.pipCanvas.height = PIP_CANVAS_HEIGHT;
    pipCanvasContext = dom.pipCanvas.getContext('2d');

    dom.pipVideo.srcObject = dom.pipCanvas.captureStream(1);
    dom.pipVideo.muted = true;
    dom.pipVideo.playsInline = true;
    dom.pipVideo.autoplay = true;
    dom.pipVideo.addEventListener('enterpictureinpicture', syncPiPButton);
    dom.pipVideo.addEventListener('leavepictureinpicture', syncPiPButton);

    dom.btnPip.disabled = false;
    dom.btnPip.title = 'Open picture-in-picture';
    syncPiPButton();
    updatePictureInPictureFrame();
  }

  /** Open or close the PiP window */
  async function togglePictureInPicture() {
    if (!isPictureInPictureSupported()) {
      setStatus('Picture-in-Picture is not supported in this browser.');
      return;
    }

    try {
      if (document.pictureInPictureElement === dom.pipVideo) {
        await document.exitPictureInPicture();
        return;
      }

      updatePictureInPictureFrame();
      await dom.pipVideo.play();
      await dom.pipVideo.requestPictureInPicture();
    } catch {
      setStatus('Unable to open Picture-in-Picture.');
    }
  }

  // ─── Display Updates ───

  /** Update the big timer digits */
  function updateDisplay() {
    const { h, m, s } = toHMS(remainSecs);
    setFlippingNumber(dom.digitH, pad(h));
    setFlippingNumber(dom.digitM, pad(m));
    setFlippingNumber(dom.digitS, pad(s));
    updatePictureInPictureFrame();
  }

  /** Update a two-digit timer group with per-character page flips */
  function setFlippingNumber(digit, nextValue) {
    const digitChars = digit.querySelectorAll('.digit-char');

    if (digitChars.length !== nextValue.length) {
      digit.textContent = nextValue;
      return;
    }

    digit.dataset.value = nextValue;

    digitChars.forEach((digitChar, index) => {
      setFlippingChar(digitChar, nextValue[index]);
    });
  }

  /** Update a single character with a page-flip animation */
  function setFlippingChar(digitChar, nextChar) {
    const currentFace = digitChar.querySelector('.digit-face-current');
    const nextFace = digitChar.querySelector('.digit-face-next');

    if (!currentFace || !nextFace) {
      digitChar.textContent = nextChar;
      return;
    }

    const currentChar = digitChar.dataset.value || currentFace.textContent || nextChar;

    if (currentChar === nextChar) {
      currentFace.textContent = nextChar;
      nextFace.textContent = nextChar;
      digitChar.dataset.value = nextChar;
      return;
    }

    currentFace.textContent = currentChar;
    nextFace.textContent = nextChar;
    digitChar.dataset.value = nextChar;

    digitChar.classList.remove('is-flipping');
    void digitChar.offsetWidth;
    digitChar.classList.add('is-flipping');

    clearTimeout(digitChar.flipTimerId);
    digitChar.flipTimerId = setTimeout(() => {
      currentFace.textContent = nextChar;
      nextFace.textContent = nextChar;
      digitChar.classList.remove('is-flipping');
    }, FLIP_DURATION_MS);
  }

  /** Update progress bar */
  function updateProgress() {
    if (totalSecs === 0) {
      dom.progressFill.style.width = '0%';
      return;
    }
    const elapsed = totalSecs - remainSecs;
    const pct = (elapsed / totalSecs) * 100;
    dom.progressFill.style.width = pct + '%';
  }

  /** Apply state classes to the app container */
  function applyStateClasses() {
    dom.app.classList.remove('timer-active', 'timer-running', 'timer-paused', 'timer-finished');

    if (timerState !== 'idle') {
      dom.app.classList.add('timer-active');
    }
    if (timerState === 'running') {
      dom.app.classList.add('timer-running');
    }
    if (timerState === 'paused') {
      dom.app.classList.add('timer-paused');
    }
    if (timerState === 'finished') {
      dom.app.classList.add('timer-finished');
    }

    updatePictureInPictureFrame();
  }

  /** Update status line text */
  function setStatus(html) {
    dom.statusLine.innerHTML = html;
    updatePictureInPictureFrame();
  }

  /** Update button visibility */
  function updateControls() {
    switch (timerState) {
      case 'idle':
        dom.btnStart.hidden  = false;
        dom.btnStart.textContent = 'Start';
        dom.btnPause.hidden  = true;
        dom.btnReset.hidden  = true;
        dom.sessionForm.hidden = true;
        break;
      case 'running':
        dom.btnStart.hidden  = true;
        dom.btnPause.hidden  = false;
        dom.btnPause.textContent = 'Pause';
        dom.btnReset.hidden  = false;
        dom.sessionForm.hidden = true;
        break;
      case 'paused':
        dom.btnStart.hidden  = false;
        dom.btnStart.textContent = 'Resume';
        dom.btnPause.hidden  = true;
        dom.btnReset.hidden  = false;
        dom.sessionForm.hidden = true;
        break;
      case 'finished':
        dom.btnStart.hidden  = true;
        dom.btnPause.hidden  = true;
        dom.btnReset.hidden  = false;
        dom.sessionForm.hidden = false;
        break;
    }
  }

  // ─── Timer Logic ───

  /** Read time inputs and compute total seconds */
  function readInputTime() {
    const h = Math.max(0, Math.min(23, parseInt(dom.inputH.value) || 0));
    const m = Math.max(0, Math.min(59, parseInt(dom.inputM.value) || 0));
    const s = Math.max(0, Math.min(59, parseInt(dom.inputS.value) || 0));
    return h * 3600 + m * 60 + s;
  }

  /** Start the countdown */
  function startTimer() {
    if (timerState === 'idle') {
      totalSecs = readInputTime();
      if (totalSecs === 0) {
        setStatus('⚠ Set a time greater than zero');
        return;
      }
      remainSecs = totalSecs;
      sessionStart = new Date();
    }

    remainSecs = timerState === 'paused' ? remainSecs : totalSecs;
    endTimestamp = Date.now() + remainSecs * 1000;
    timerState = 'running';
    applyStateClasses();
    updateControls();
    setStatus('Studying… Press <kbd>Space</kbd> to pause');
    updateDisplay();
    updateProgress();

    intervalId = setInterval(() => {
      remainSecs = getCurrentRemainingSecs();

      if (remainSecs <= 0) {
        finishTimer();
        return;
      }

      updateDisplay();
      updateProgress();
    }, 1000);
  }

  /** Pause the countdown */
  function pauseTimer() {
    remainSecs = getCurrentRemainingSecs();
    clearInterval(intervalId);
    intervalId = null;
    endTimestamp = null;
    timerState = 'paused';
    applyStateClasses();
    updateControls();
    setStatus('Paused — Press <kbd>Space</kbd> to resume');
    updateDisplay();
    updateProgress();
  }

  /** Resume after pause */
  function resumeTimer() {
    startTimer();
  }

  /** Timer reached zero */
  function finishTimer() {
    clearInterval(intervalId);
    intervalId = null;
    endTimestamp = null;
    remainSecs = 0;
    timerState = 'finished';
    updateDisplay();
    updateProgress();
    applyStateClasses();
    updateControls();
    setStatus('Session complete! Save your notes below.');

    // Focus the subject input for quick note entry
    setTimeout(() => dom.noteSubject.focus(), 100);
  }

  /** Reset everything back to idle */
  function resetTimer() {
    clearInterval(intervalId);
    intervalId = null;
    endTimestamp = null;
    timerState = 'idle';
    totalSecs = 0;
    remainSecs = 0;
    sessionStart = null;
    updateDisplay();
    dom.progressFill.style.width = '0%';
    applyStateClasses();
    updateControls();
    setStatus('Press <kbd>Space</kbd> to start');
  }

  // ─── Spacebar Toggle ───

  /** Main spacebar handler */
  function handleSpacebar() {
    switch (timerState) {
      case 'idle':
        startTimer();
        break;
      case 'running':
        pauseTimer();
        break;
      case 'paused':
        resumeTimer();
        break;
      case 'finished':
        // On finished state, spacebar does nothing (user should save/discard)
        break;
    }
  }

  // ─── Session Persistence (localStorage) ───

  /** Load sessions from localStorage */
  function loadSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /** Save sessions array to localStorage */
  function saveSessions(sessions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  /** Save current session with notes */
  function saveCurrentSession() {
    const duration = totalSecs - remainSecs; // actual studied time
    if (duration < 1) return; // don't save empty sessions

    const session = {
      id: Date.now(),
      date: sessionStart ? sessionStart.toISOString() : new Date().toISOString(),
      duration: duration,
      subject: dom.noteSubject.value.trim() || 'Untitled',
      motivation: parseInt(dom.noteMotivation.value) || 5,
      focus: parseInt(dom.noteFocus.value) || 5,
    };

    const sessions = loadSessions();
    sessions.unshift(session); // newest first
    saveSessions(sessions);
    renderHistory();
    resetFormFields();
    resetTimer();
  }

  /** Discard session without saving */
  function discardSession() {
    resetFormFields();
    resetTimer();
  }

  /** Reset the notes form to defaults */
  function resetFormFields() {
    dom.noteSubject.value = '';
    dom.noteMotivation.value = 5;
    dom.noteFocus.value = 5;
    dom.motivationVal.textContent = '5';
    dom.focusVal.textContent = '5';
  }

  /** Delete a session by id */
  function deleteSession(id) {
    let sessions = loadSessions();
    sessions = sessions.filter(s => s.id !== id);
    saveSessions(sessions);
    renderHistory();
  }

  // ─── History Rendering ───

  /** Render session cards into the history panel */
  function renderHistory() {
    const sessions = loadSessions();
    dom.historyList.innerHTML = '';

    if (sessions.length === 0) {
      dom.emptyState.hidden = false;
      return;
    }

    dom.emptyState.hidden = true;

    sessions.forEach(s => {
      const card = document.createElement('div');
      card.className = 'session-card';
      card.innerHTML = `
        <button class="session-delete" data-id="${s.id}" title="Delete session">✕</button>
        <div class="session-card-head">
          <span class="session-date">${formatDate(s.date)} · ${formatTime(s.date)}</span>
          <span class="session-duration">${formatDuration(s.duration)}</span>
        </div>
        <div class="session-subject">${escapeHtml(s.subject)}</div>
        <div class="session-scores">
          <span><span class="score-icon">🔥</span> Motivation <span class="score-num">${s.motivation}</span>/10</span>
          <span><span class="score-icon">🎯</span> Focus <span class="score-num">${s.focus}</span>/10</span>
        </div>
      `;
      dom.historyList.appendChild(card);
    });
  }

  /** Basic HTML escaping for user-entered text */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Event Listeners ───

  /** Keyboard: Spacebar for timer control */
  document.addEventListener('keydown', (e) => {
    // Don't intercept space when user is typing in an input/textarea
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      handleSpacebar();
    }
  });

  /** Button clicks */
  dom.btnStart.addEventListener('click', () => {
    if (timerState === 'paused') resumeTimer();
    else startTimer();
  });

  dom.btnPause.addEventListener('click', pauseTimer);
  dom.btnReset.addEventListener('click', resetTimer);
  dom.btnTheme.addEventListener('click', toggleTheme);
  dom.btnPip.addEventListener('click', togglePictureInPicture);
  dom.btnSave.addEventListener('click', saveCurrentSession);
  dom.btnDiscard.addEventListener('click', discardSession);

  /** Range slider live updates */
  dom.noteMotivation.addEventListener('input', () => {
    dom.motivationVal.textContent = dom.noteMotivation.value;
  });

  dom.noteFocus.addEventListener('input', () => {
    dom.focusVal.textContent = dom.noteFocus.value;
  });

  /** Keep PiP in sync when the user changes the configured time */
  [dom.inputH, dom.inputM, dom.inputS].forEach((input) => {
    input.addEventListener('input', updatePictureInPictureFrame);
  });

  /** History delete button (event delegation) */
  dom.historyList.addEventListener('click', (e) => {
    const btn = e.target.closest('.session-delete');
    if (!btn) return;
    const id = parseInt(btn.dataset.id);
    if (id) deleteSession(id);
  });

  /** Prevent form submission on Enter in inputs */
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  });

  // ─── Init ───
  applyTheme(loadThemePreference());
  initializePictureInPicture();
  updateDisplay();
  renderHistory();
  setStatus('Press <kbd>Space</kbd> to start');

})();
