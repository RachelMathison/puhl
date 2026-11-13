window.createTeamCalendar = function ({ games, team }) {
  const container = document.getElementById('team-calendar');
  const heading = document.getElementById('team-calendar-month');
  const status = document.getElementById('team-calendar-status');
  const escape = games.escapeLeaderHtml;
  let events = [];
  let month = new Date();
  month = new Date(month.getFullYear(), month.getMonth(), 1);
  let generation = 0;

  function resultText(result, event, matchup) {
    const configured = row => games.getConfiguredTeam(row.name, event.leagueKey);
    const own = (result.teams || []).find(row => configured(row)?.displayName === team.name);
    const opponent = (result.teams || []).find(row => configured(row)?.displayName === (matchup.team1Name === team.name ? matchup.team2Name : matchup.team1Name));
    if (!own || !opponent || own.score == null || opponent.score == null) return 'Score unavailable';
    const label = Number(own.score) > Number(opponent.score) ? 'W' : Number(own.score) < Number(opponent.score) ? 'L' : 'T';
    const final = games.completedGameLabel(result.status);
    const extra = final === 'FINAL/OT' ? ' (OT)' : final === 'FINAL/SO' ? ' (SO)' : '';
    return `${label} ${own.score}-${opponent.score}${extra}`;
  }

  function render() {
    const version = ++generation;
    heading.textContent = month.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const monthEvents = events.filter(event => {
      const start = new Date(event.start);
      return start.getFullYear() === month.getFullYear() && start.getMonth() === month.getMonth();
    });
    status.textContent = monthEvents.length ? '' : 'No games scheduled this month.';
    const byDate = new Map();
    monthEvents.forEach(event => {
      const key = games.getLocalDateKey(new Date(event.start));
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(event);
    });
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((first.getDay() + days) / 7) * 7;
    let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<div class="team-calendar-weekday">${day}</div>`).join('');
    const pending = [];
    for (let index = 0; index < cells; index++) {
      const day = index - first.getDay() + 1;
      if (day < 1 || day > days) {
        html += '<div class="team-calendar-day outside" aria-hidden="true"></div>';
        continue;
      }
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const dayEvents = (byDate.get(games.getLocalDateKey(date)) || []).sort((a, b) => new Date(a.start) - new Date(b.start));
      html += `<div class="team-calendar-day${dayEvents.length ? ' has-games' : ''}"><time datetime="${games.getLocalDateKey(date)}">${day}</time>`;
      dayEvents.forEach(event => {
        const start = new Date(event.start);
        const matchup = games.getMatchupDetails(event.title, event.leagueKey);
        const isFirst = matchup.team1Name === team.name;
        const opponent = (isFirst ? matchup.team2Name : matchup.team1Name) || 'Opponent TBD';
        const logo = isFirst ? matchup.oppLogo : matchup.selfLogo;
        const key = `team-calendar-result-${games.getScoreCardKey(event)}`;
        const past = start < new Date();
        const href = games.gameDetailHref(event.gameId, games.getLocalDateKey(start), event, matchup);
        html += `<article class="team-calendar-game" aria-label="${escape(opponent)} on ${escape(start.toLocaleDateString())}">
          <div class="team-calendar-opponent"><img src="${escape(logo)}" alt="${escape(opponent)}" loading="lazy"></div>
          <strong class="team-calendar-opponent-name">${escape(opponent)}</strong>
          ${past ? `<strong id="${key}" class="team-calendar-result">${event.gameId ? 'Loading score...' : 'Score unavailable'}</strong>` : `<time datetime="${escape(start.toISOString())}">${escape(start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))}</time><span class="team-calendar-location">${escape(event.location || 'Location TBD')}</span>`}
          <a class="team-calendar-details" href="${escape(href)}">Game Details <span aria-hidden="true">&rarr;</span></a>
        </article>`;
        if (past && event.gameId) pending.push({ event, matchup, key });
      });
      html += '</div>';
    }
    container.innerHTML = html;
    pending.forEach(({ event, matchup, key }) => {
      games.fetchGameSheet(event.gameId).then(result => {
        if (version !== generation) return;
        const target = document.getElementById(key);
        if (target) target.textContent = resultText(result, event, matchup);
      }).catch(() => {
        if (version !== generation) return;
        const target = document.getElementById(key);
        if (target) target.textContent = 'Score unavailable';
      });
    });
  }

  document.getElementById('team-calendar-previous').addEventListener('click', () => {
    month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    render();
  });
  document.getElementById('team-calendar-next').addEventListener('click', () => {
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    render();
  });
  document.getElementById('team-calendar-today').addEventListener('click', () => {
    const today = new Date();
    month = new Date(today.getFullYear(), today.getMonth(), 1);
    render();
  });
  return { setEvents(value) { events = value; render(); } };
};
