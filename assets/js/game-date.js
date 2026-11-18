(() => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  function pacificDateKey(date) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(date)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  window.isPastGameDay = (start, now = new Date()) => pacificDateKey(start) < pacificDateKey(now);
})();
