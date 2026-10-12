/* Cadence — toasts with optional action (Undo) */
(function () {
  const C = window.Cadence;
  C.toast = function (msg, opts) {
    opts = opts || {};
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="toast-msg">' + C.esc(msg) + '</span>' +
      (opts.action ? '<button class="toast-btn" type="button">' + C.esc(opts.action) + '</button>' : '') +
      '<button class="toast-x" type="button" aria-label="Dismiss">' + C.icon('x') + '</button>';
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    let gone = false;
    const close = () => {
      if (gone) return; gone = true;
      el.classList.remove('in');
      setTimeout(() => el.remove(), 250);
    };
    const t = setTimeout(close, opts.duration || 5000);
    if (opts.action) el.querySelector('.toast-btn').onclick = () => { clearTimeout(t); close(); opts.onAction && opts.onAction(); };
    el.querySelector('.toast-x').onclick = () => { clearTimeout(t); close(); };
    while (root.children.length > 3) root.firstElementChild.remove();
    return close;
  };
})();
