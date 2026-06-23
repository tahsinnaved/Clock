/* ============================================================
   Study Timer — Application Logic
   A minimal, offline study timer with session tracking.
   All data persisted via localStorage.
   ============================================================ */

;(function () {
  'use strict';

  // ─── Constants ───
  const STORAGE_KEY = 'studytimer_sessions';

  // ─── State ───
  let timerState  = 'idle';   // idle | running | paused | finished
  let totalSecs   = 0;        // total seconds set by user
  let remainSecs  = 0;        // remaining seconds
  let intervalId  = null;
  let sessionStart = null;    // Date when timer was first started

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

  // ─── Display Updates ───

  /** Update the big timer digits */
  function updateDisplay() {
    const { h, m, s } = toHMS(remainSecs);
    dom.digitH.textContent = pad(h);
    dom.digitM.textContent = pad(m);
    dom.digitS.textContent = pad(s);
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
  }

  /** Update status line text */
  function setStatus(html) {
    dom.statusLine.innerHTML = html;
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
      updateDisplay();
    }

    timerState = 'running';
    applyStateClasses();
    updateControls();
    setStatus('Studying… Press <kbd>Space</kbd> to pause');

    intervalId = setInterval(() => {
      remainSecs--;
      updateDisplay();
      updateProgress();

      if (remainSecs <= 0) {
        finishTimer();
      }
    }, 1000);
  }

  /** Pause the countdown */
  function pauseTimer() {
    clearInterval(intervalId);
    intervalId = null;
    timerState = 'paused';
    applyStateClasses();
    updateControls();
    setStatus('Paused — Press <kbd>Space</kbd> to resume');
  }

  /** Resume after pause */
  function resumeTimer() {
    startTimer();
  }

  /** Timer reached zero */
  function finishTimer() {
    clearInterval(intervalId);
    intervalId = null;
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
  dom.btnSave.addEventListener('click', saveCurrentSession);
  dom.btnDiscard.addEventListener('click', discardSession);

  /** Range slider live updates */
  dom.noteMotivation.addEventListener('input', () => {
    dom.motivationVal.textContent = dom.noteMotivation.value;
  });

  dom.noteFocus.addEventListener('input', () => {
    dom.focusVal.textContent = dom.noteFocus.value;
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
  updateDisplay();
  renderHistory();
  setStatus('Press <kbd>Space</kbd> to start');

})();
