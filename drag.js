/* Cadence — pointer-based drag & drop that works with mouse, pen and touch.
   Draggables: [data-drag-task="<id>"]. Drop targets: [data-drop-day="YYYY-MM-DD" | ""].
   Mouse/pen start after a few pixels of movement; touch starts on a 280ms long-press
   (or immediately from a [data-drag-handle]). Hovering [data-drag-flip] for 550ms clicks it. */
(function () {
  const C = window.Cadence;
  let onDrop = null;
  let s = null; // active session

  C.drag = {
    init(dropHandler) {
      onDrop = dropHandler;
      document.addEventListener('pointerdown', down, { passive: true });
    },
    get active() { return !!(s && s.dragging); }
  };

  function down(e) {
    if (e.button && e.button !== 0) return;
    const src = e.target.closest('[data-drag-task]');
    if (!src || e.target.closest('input,button:not([data-drag-handle]),textarea,select,a')) return;
    const handle = !!e.target.closest('[data-drag-handle]');
    s = { src, id: src.dataset.dragTask, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, type: e.pointerType, pid: e.pointerId, dragging: false, timer: null, flip: null, flipT: null, over: null };
    if (e.pointerType === 'touch' && !handle) {
      s.timer = setTimeout(() => start(), 280);
    } else if (handle) {
      start();
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  function start() {
    if (!s || s.dragging) return;
    s.dragging = true;
    const r = s.src.getBoundingClientRect();
    const g = s.src.cloneNode(true);
    g.classList.add('drag-ghost');
    g.removeAttribute('data-drag-task');
    g.style.width = Math.min(r.width, 280) + 'px';
    document.body.appendChild(g);
    s.ghost = g;
    s.offX = Math.min(s.x0 - r.left, Math.min(r.width, 280) - 12);
    s.offY = s.y0 - r.top;
    s.src.classList.add('drag-src');
    document.documentElement.classList.add('is-dragging');
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* not allowed */ }
    place();
  }

  function move(e) {
    if (!s || e.pointerId !== s.pid) return;
    s.x = e.clientX; s.y = e.clientY;
    if (!s.dragging) {
      const dist = Math.hypot(s.x - s.x0, s.y - s.y0);
      if (s.type === 'touch') { if (dist > 10) cleanup(); return; } // user is scrolling
      if (dist > 5) start(); else return;
    }
    e.preventDefault();
    place();
  }

  function place() {
    s.ghost.style.transform = 'translate(' + (s.x - s.offX) + 'px,' + (s.y - s.offY) + 'px) rotate(-1.5deg)';
    s.ghost.hidden = true;
    const under = document.elementFromPoint(s.x, s.y);
    s.ghost.hidden = false;
    const target = under && under.closest('[data-drop-day]');
    if (target !== s.over) {
      if (s.over) s.over.classList.remove('drop-over');
      s.over = target;
      if (target) target.classList.add('drop-over');
    }
    const flip = under && under.closest('[data-drag-flip]');
    if (flip !== s.flip) {
      clearTimeout(s.flipT);
      s.flip = flip;
      if (flip) s.flipT = setTimeout(function rep() { if (s && s.flip === flip) { flip.click(); s.flipT = setTimeout(rep, 900); } }, 550);
    }
    // edge auto-scroll
    const m = 60, h = window.innerHeight;
    if (s.y < m) window.scrollBy(0, -12); else if (s.y > h - m) window.scrollBy(0, 12);
  }

  function up(e) {
    if (!s || e.pointerId !== s.pid) return;
    if (s.dragging) {
      const target = s.over;
      const id = s.id;
      // swallow the click that follows a drag
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50);
      cleanup();
      if (target && onDrop) onDrop(id, target.dataset.dropDay || null, target);
      return;
    }
    cleanup();
  }
  function cancel() { cleanup(); }

  function cleanup() {
    if (!s) return;
    clearTimeout(s.timer); clearTimeout(s.flipT);
    if (s.ghost) s.ghost.remove();
    if (s.over) s.over.classList.remove('drop-over');
    s.src.classList.remove('drag-src');
    document.documentElement.classList.remove('is-dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    s = null;
  }

  // block the native context menu / text selection during a touch long-press
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('[data-drag-task]') && e.pointerType !== 'mouse') e.preventDefault(); });
  document.addEventListener('touchmove', (e) => { if (s && s.dragging) e.preventDefault(); }, { passive: false });
})();
