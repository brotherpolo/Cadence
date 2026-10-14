/* Cadence lives at its Firebase Hosting address. The old GitHub Pages address forwards
   there, keeping links to a task (?task=), a record (?record=, ?addTaskFor=) and the page.
   (A file, not inline, so the site can refuse inline scripts.) */
(function () {
  var home = 'https://cadence-tasks.web.app/';
  if (/\.github\.io$/.test(location.hostname)) location.replace(home + location.search + location.hash);
})();
