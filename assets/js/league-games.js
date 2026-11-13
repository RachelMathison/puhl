// Shared calendar loading, team matching, score cards, and scoresheet caching.
window.createLeagueGames = function ({ divisions: LEAGUE_STRUCTURE, statsUrl: SCHEDULE_STATS_API_URL, onUpdate = () => {} }) {
const SCORE_SHEET_API_URL = 'https://score-sheet.portland.hockey/';
const teamLogos = window.pageTeamLogos || {};
const allTeamConfigs = [];
let scheduleLeaderPlayersByTeam = new Map();
let scheduleStandingsByTeam = new Map();
const gameSheetResults = new Map();
const gameSheetRequests = new Map();
Object.entries(LEAGUE_STRUCTURE).forEach(([leagueKey, league]) => {
  league.teams.forEach(team => {
    allTeamConfigs.push({
      displayName: team.name,
      id: String(team.id).toLowerCase(),
      abbreviation: team.abbreviation || team.name,
      statsAliases: team.statsAliases || [],
      leagueKey,
      imagePath: window.siteAssetUrl(team.imagePath || teamLogos[team.name] || teamLogos.default)
    });
  });
});


function getMatchupDetails(title, leagueKey) {
  if (!title) return { selfLogo: teamLogos.default, oppLogo: teamLogos.default, team1Name: null, team2Name: null };

  const lowerTitle = title.toLowerCase();
  const teams = leagueKey
    ? allTeamConfigs.filter(team => team.leagueKey === leagueKey)
    : allTeamConfigs;
  const matches = [];

  teams.forEach(team => {
    const idPattern = team.id
      .split(/\s+/)
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s_-]+');
    const match = new RegExp(`(^|[^a-z0-9])(${idPattern})(?=$|[^a-z0-9])`).exec(lowerTitle);
    const idx = match ? match.index + match[1].length : -1;
    if (idx !== -1) {
      matches.push({
        index: idx,
        displayName: team.displayName,
        logo: team.imagePath
      });
    }
  });

  matches.sort((a, b) => a.index - b.index);

  const t1 = matches[0] || { displayName: null, logo: teamLogos.default };
  const t2 = matches[1] || { displayName: null, logo: teamLogos.default };

  return {
    selfLogo: t1.logo,
    oppLogo: t2.logo,
    team1Name: t1.displayName,
    team2Name: t2.displayName
  };
}


function escapeLeaderHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function decodeLeaderEntities(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value ?? '');
  return textarea.value;
}

function normalizeLeaderTeam(value) {
  return decodeLeaderEntities(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getLeaderTeam(player) {
  const rawValues = [
    player.teamName, player.team_name, player.team, player.Team,
    player.teamId, player.team_id, player.franchise, player.franchiseName,
    player.teamAbbreviation
  ];
  const values = rawValues.flatMap(value => {
    if (value && typeof value === 'object') {
      return [value.name, value.fullName, value.teamName, value.id, value.abbreviation, value.code];
    }
    return [value];
  }).map(normalizeLeaderTeam).filter(Boolean);

  return allTeamConfigs.find(team => {
    const identifiers = [team.displayName, team.id, ...team.statsAliases]
      .map(normalizeLeaderTeam).filter(Boolean);
    return values.some(value => identifiers.some(identifier => value === identifier ||
      (identifier.length >= 5 && value.includes(identifier))));
  });
}

const leaderColors = new Map();
function leaderColor(team) {
  const theme = (window.siteThemeMetadata || []).find(item =>
    item.statsTeamKey === `${team.leagueKey}:${team.id}`);
  if (!theme) return 'var(--primary)';
  if (leaderColors.has(theme.id)) return leaderColors.get(theme.id);
  // Theme palettes are defined on :root, so a child element inherits the
  // current site palette even if it has its own data-site-theme attribute.
  const root = document.documentElement;
  const previousTheme = root.getAttribute('data-site-theme');
  let color;
  try {
    root.setAttribute('data-site-theme', theme.id);
    color = getComputedStyle(root).getPropertyValue('--primary').trim() || 'var(--primary)';
  } finally {
    if (previousTheme === null) root.removeAttribute('data-site-theme');
    else root.setAttribute('data-site-theme', previousTheme);
  }
  leaderColors.set(theme.id, color);
  return color;
}

function renderLeaderComparison(firstTeam, secondTeam, metric, label) {
  const teams = [firstTeam, secondTeam];
  const players = teams.map(team => getTeamLeader(team, metric));
  const values = players.map(player => Number(player?.[metric] || 0));
  const total = values[0] + values[1];
  const playerMarkup = (player, team, side) => `<div class="game-detail-watch-player ${side}">
    <div><strong>${escapeLeaderHtml(player ? decodeLeaderEntities(player.name || 'Player') : 'No stats yet')}</strong>
      <span>${escapeLeaderHtml([player?.number ? '#' + player.number : '', player?.position || player?.pos || ''].filter(Boolean).join(' ? '))}</span></div>
  </div>`;
  return `<div class="game-detail-watch-stat">
    <div class="game-detail-watch-stat-line">
      ${playerMarkup(players[0], teams[0], 'away')}
      <strong class="game-detail-watch-value">${players[0] ? values[0] : '?'}</strong>
      <span class="game-detail-watch-label">${label}</span>
      <strong class="game-detail-watch-value">${players[1] ? values[1] : '?'}</strong>
      ${playerMarkup(players[1], teams[1], 'home')}
    </div>
    <div class="game-detail-stat-bars" aria-hidden="true">
      <span class="game-detail-stat-bar-away" style="--bar-share:${total ? values[0] / total : 0.5};--bar-color:${escapeLeaderHtml(leaderColor(firstTeam))}"></span>
      <span class="game-detail-stat-bar-home" style="--bar-share:${total ? values[1] / total : 0.5};--bar-color:${escapeLeaderHtml(leaderColor(secondTeam))}"></span>
    </div>
  </div>`;
}

async function loadScheduleTeamLeaders() {
  if (!SCHEDULE_STATS_API_URL) return;

  try {
    const response = await fetch(SCHEDULE_STATS_API_URL);
    if (!response.ok) throw new Error(`Stats request failed (${response.status})`);
    const stats = await response.json();
    const playersByTeam = new Map(allTeamConfigs.map(team => [team, []]));

    (stats.skaters || []).forEach(player => {
      const team = getLeaderTeam(player);
      if (team) playersByTeam.get(team).push(player);
    });

    scheduleLeaderPlayersByTeam = playersByTeam;
    onUpdate();
  } catch (error) {
    console.error('Could not load schedule team leaders:', error);
    scheduleLeaderPlayersByTeam = new Map();
  }
}

function getConfiguredTeam(name, leagueKey) {
  const normalizedName = normalizeLeaderTeam(name);
  const eligibleTeams = allTeamConfigs.filter(team => !leagueKey || team.leagueKey === leagueKey);
  const exactMatch = eligibleTeams.find(team => {
    return [team.displayName, team.id, ...team.statsAliases]
      .map(normalizeLeaderTeam).some(identifier => identifier && identifier === normalizedName);
  });
  if (exactMatch) return exactMatch;

  return eligibleTeams.find(team => [team.displayName, team.id, ...team.statsAliases]
    .map(normalizeLeaderTeam)
    .some(identifier => identifier.length >= 5 && normalizedName.includes(identifier)));
}

function getTeamLeader(team, metricKey) {
  const players = scheduleLeaderPlayersByTeam.get(team) || [];
  return [...players].sort((a, b) =>
    Number(b[metricKey] || 0) - Number(a[metricKey] || 0) ||
    String(a.name || '').localeCompare(String(b.name || ''))
  )[0];
}

function getConfiguredStanding(team, rows) {
  return rows.find(row => {
    const rowName = normalizeLeaderTeam(row.Team);
    return [team.displayName, team.id, ...team.statsAliases]
      .map(normalizeLeaderTeam).some(identifier => identifier && (
        rowName === identifier || (identifier.length >= 5 && rowName.includes(identifier))
      ));
  });
}

async function loadScheduleStandings() {
  const divisions = Object.entries(LEAGUE_STRUCTURE);
  const results = await Promise.allSettled(divisions.map(async ([divisionKey, division]) => {
    const response = await fetch(division.standingsUrl);
    if (!response.ok) throw new Error(`Standings request failed (${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Unexpected standings response');
    return { divisionKey, division, rows };
  }));

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      console.error(`Could not load ${divisions[index][1].name} standings for scores:`, result.reason);
      return;
    }
    const { division, rows } = result.value;
    division.teams.forEach(teamConfig => {
      const team = allTeamConfigs.find(candidate => candidate.leagueKey === result.value.divisionKey && candidate.displayName === teamConfig.name);
      if (team) {
        const standing = getConfiguredStanding(team, rows);
        if (standing) scheduleStandingsByTeam.set(team, standing);
      }
    });
  });

  onUpdate();
}

function formatScoreTeam(team) {
  if (!team) return '';
  const standing = scheduleStandingsByTeam.get(team);
  const record = standing
    ? `${standing.W || 0}-${standing.L || 0}-${standing.T || 0}`
    : 'Record unavailable';
  return `<div class="scores-game-team">
    <img src="${escapeLeaderHtml(team.imagePath)}" alt="">
    <div><strong>${escapeLeaderHtml(team.displayName)}</strong><span>${escapeLeaderHtml(record)}</span></div>
  </div>`;
}

function renderScoreCard(event, matchup) {
  const firstTeam = getConfiguredTeam(matchup.team1Name, event.leagueKey);
  const secondTeam = getConfiguredTeam(matchup.team2Name, event.leagueKey);
  const start = new Date(event.start);
  const isPastGame = start < new Date();
  const date = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const cardKey = getScoreCardKey(event);
  const canOpenDetails = Boolean(matchup.team1Name && matchup.team2Name);
  const cardTag = canOpenDetails ? 'a' : 'article';
  const scoreSheetHref = canOpenDetails
    ? ` href="${escapeLeaderHtml(gameDetailHref(event.gameId, getLocalDateKey(start), event, matchup))}" aria-label="View game details for ${escapeLeaderHtml(`${matchup.team1Name || 'Team 1'} at ${matchup.team2Name || 'Team 2'}`)}"`
    : '';
  const leaders = firstTeam && secondTeam && !isPastGame ? [
    renderLeaderComparison(firstTeam, secondTeam, 'g', 'Goals'),
    renderLeaderComparison(firstTeam, secondTeam, 'a', 'Assists')
  ].join('') : '';

  return `<${cardTag} class="scores-game-card${isPastGame ? ' scores-game-card-final' : ''}${canOpenDetails ? ' scores-game-card-link' : ''}"${scoreSheetHref}>
    <div class="scores-game-card-heading">
      <span class="scores-game-time"${isPastGame ? ` id="scores-game-status-${cardKey}"` : ''}>${escapeLeaderHtml(isPastGame ? date : `${time} · ${date}`)}</span>
      <span class="scores-game-location">${escapeLeaderHtml(event.location || 'Location to be announced')}</span>
    </div>
    ${isPastGame
      ? `<div id="scores-game-result-${cardKey}" class="scores-game-result">${event.gameId ? 'Loading final score…' : renderPastGameUnavailable(matchup, 'Final score details could not be loaded.')}</div>
        ${canOpenDetails ? '<span class="scores-game-details-cta">Game Details <span aria-hidden="true">&rarr;</span></span>' : ''}`
      : `<div class="scores-game-teams">
          ${formatScoreTeam(firstTeam) || `<div class="scores-game-team"><img src="${escapeLeaderHtml(matchup.selfLogo)}" alt=""><div><strong>${escapeLeaderHtml(matchup.team1Name || 'Team 1')}</strong><span>Record unavailable</span></div></div>`}
          ${formatScoreTeam(secondTeam) || `<div class="scores-game-team"><img src="${escapeLeaderHtml(matchup.oppLogo)}" alt=""><div><strong>${escapeLeaderHtml(matchup.team2Name || 'Team 2')}</strong><span>Record unavailable</span></div></div>`}
        </div>
        ${leaders ? `<div class="scores-game-leaders"><h3>Team Leaders</h3><div class="scores-game-leader-bars">${leaders}</div></div>` : ''}
        ${canOpenDetails ? '<span class="scores-game-details-cta">Game Details <span aria-hidden="true">&rarr;</span></span>' : ''}`}
  </${cardTag}>`;
}

function getScoreCardKey(event) {
  const raw = `${event.gameId || ''}-${new Date(event.start).getTime()}-${event.leagueKey || ''}`;
  return raw.replace(/[^a-z0-9_-]/gi, '-');
}

function gameDetailHref(gameId, returnDate, event, matchup) {
  const query = new URLSearchParams();
  if (gameId) query.set('id', gameId);
  if (returnDate) query.set('returnDate', returnDate);
  if (event?.start) query.set('date', getLocalDateKey(new Date(event.start)));
  if (event?.leagueKey) query.set('league', event.leagueKey);
  if (matchup?.team1Name) query.set('team1', matchup.team1Name);
  if (matchup?.team2Name) query.set('team2', matchup.team2Name);
  return window.siteAssetUrl(`/game/?${query.toString()}`);
}

function fetchGameSheet(gameId) {
  if (gameSheetResults.has(gameId)) return Promise.resolve(gameSheetResults.get(gameId));
  if (gameSheetRequests.has(gameId)) return gameSheetRequests.get(gameId);

  const request = fetch(`${SCORE_SHEET_API_URL}?id=${encodeURIComponent(gameId)}`)
    .then(async response => {
      if (!response.ok) throw new Error(`Scoresheet request failed (${response.status})`);
      const result = await response.json();
      if (!Array.isArray(result.teams)) throw new Error('Scoresheet response is missing team results');
      gameSheetResults.set(gameId, result);
      return result;
    })
    .finally(() => gameSheetRequests.delete(gameId));
  gameSheetRequests.set(gameId, request);
  return request;
}

function renderPastGameDetails(result, event, matchup) {
  const fallbackTeams = [
    { name: matchup.team1Name, imagePath: matchup.selfLogo, side: 'away' },
    { name: matchup.team2Name, imagePath: matchup.oppLogo, side: 'home' }
  ];
  const teams = (result.teams || []).length ? result.teams : fallbackTeams;
  const teamMarkup = teams.map((team, index) => {
    const configuredTeam = getConfiguredTeam(team.name, event.leagueKey);
    const fallback = fallbackTeams.find(item => item.side === team.side) || fallbackTeams[index];
    const logo = configuredTeam?.imagePath || fallback?.imagePath || teamLogos.default;
    const shotText = team.shotsOnGoal === null || team.shotsOnGoal === undefined
      ? 'SOG: -'
      : `SOG: ${team.shotsOnGoal}`;
    const score = team.score === null || team.score === undefined ? '–' : team.score;
    return `<div class="scores-game-team scores-game-final-team">
      <img src="${escapeLeaderHtml(logo)}" alt="">
      <div><strong>${escapeLeaderHtml(team.name || fallback?.name || 'Team')}</strong><span>${escapeLeaderHtml(shotText)}</span></div>
      <strong class="scores-game-final-score">${escapeLeaderHtml(score)}</strong>
    </div>`;
  }).join('');

  const scorers = (result.goalScorers || []).filter(player =>
    player.name && Number(player.goals) > 0 && String(player.number || '').toLowerCase() !== 'totals:'
  );
  const scorerRows = teams.map(team => {
    const players = scorers.filter(player => String(player.team || '').toLowerCase() === String(team.name || '').toLowerCase());
    if (!players.length) return '';
    const names = players.map(player => `${player.number ? `#${player.number} ` : ''}${player.name}${Number(player.goals) > 1 ? ` (${player.goals})` : ''}`).join(', ');
    return `<div class="scores-game-scorer-team"><strong>${escapeLeaderHtml(team.name)}</strong><span>${escapeLeaderHtml(names || 'No goals recorded')}</span></div>`;
  }).join('');

  return `<div class="scores-game-teams scores-game-final-teams">${teamMarkup}</div>
    <div class="scores-game-goal-scorers">${scorerRows ? `<h3>Goals</h3>${scorerRows}` : '<p>Game statistics unavailable.</p>'}</div>`;
}

function renderPastGameUnavailable(matchup, message) {
  const teams = [
    { name: matchup.team1Name || 'Team 1', imagePath: matchup.selfLogo },
    { name: matchup.team2Name || 'Team 2', imagePath: matchup.oppLogo }
  ];
  const teamRows = teams.map(team => `<div class="scores-game-team scores-game-final-team">
    <img src="${escapeLeaderHtml(team.imagePath)}" alt="">
    <div><strong>${escapeLeaderHtml(team.name)}</strong></div>
  </div>`).join('');
  return `<div class="scores-game-teams scores-game-final-teams">${teamRows}</div><p class="scores-game-load-error">${escapeLeaderHtml(message)}</p>`;
}

function completedGameLabel(status) {
  const normalized = String(status || '').toUpperCase().replace(/\s+/g, '');
  const finalMatch = normalized.match(/^FINAL(?:\/(OT|SO))?/);
  return finalMatch ? `FINAL${finalMatch[1] ? `/${finalMatch[1]}` : ''}` : null;
}

function renderScheduleGameResult(result, event, matchup) {
  const teams = result.teams || [];
  if (teams.length < 2 || teams.some(team => team.score === null || team.score === undefined)) {
    return 'Score unavailable';
  }
  const [first, second] = teams;
  const firstName = getTeamAbbreviation(first.name || matchup.team1Name, event.leagueKey);
  const secondName = getTeamAbbreviation(second.name || matchup.team2Name, event.leagueKey);
  const finalStatus = completedGameLabel(result.status);
  const overtimeSuffix = finalStatus === 'FINAL/OT' ? ' (OT)' : finalStatus === 'FINAL/SO' ? ' (SO)' : '';
  const firstIsWinner = Number(first.score) > Number(second.score);
  const secondIsWinner = Number(second.score) > Number(first.score);
  return `<span class="schedule-result-team${firstIsWinner ? ' winner' : ''}">${escapeLeaderHtml(firstName)} ${escapeLeaderHtml(first.score)}</span>, <span class="schedule-result-team${secondIsWinner ? ' winner' : ''}">${escapeLeaderHtml(secondName)} ${escapeLeaderHtml(second.score)}</span>${overtimeSuffix}`;
}

function getTeamAbbreviation(name, leagueKey) {
  return getConfiguredTeam(name, leagueKey)?.abbreviation || name;
}

function getIcsValue(component, propertyName) {
  const value = component.getFirstPropertyValue(propertyName);
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function extractGameIdFromIcs(vevent) {
  const values = ['url', 'description', 'uid'].map(name => getIcsValue(vevent, name));
  for (const value of values) {
    const decodedValue = decodeIcsUrl(value);
    const linkedId = decodedValue.match(/\/game\/(?:game_sheet|show)\/(\d+)/i)?.[1];
    if (linkedId) return linkedId;
  }
  for (const value of values) {
    const explicitId = decodeIcsUrl(value).match(/[?&](?:game[_-]?id|gameid)=(\d+)/i)?.[1];
    if (explicitId) return explicitId;
  }
  return null;
}

function decodeIcsUrl(value) {
  let decoded = String(value || '');
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (_) {
      break;
    }
  }
  return decoded;
}

function loadPastGameDetails(events) {
  events.filter(event => new Date(event.start) < new Date()).forEach(event => {
    const target = document.getElementById(`scores-game-result-${getScoreCardKey(event)}`);
    if (!target || !event.gameId) return;
    const matchup = getMatchupDetails(event.title, event.leagueKey);
    fetchGameSheet(event.gameId)
      .then(result => {
        const currentTarget = document.getElementById(`scores-game-result-${getScoreCardKey(event)}`);
        if (currentTarget) currentTarget.innerHTML = renderPastGameDetails(result, event, matchup);
        const statusLabel = completedGameLabel(result.status);
        const statusTarget = document.getElementById(`scores-game-status-${getScoreCardKey(event)}`);
        if (statusTarget && statusLabel) {
          const date = new Date(event.start).toLocaleDateString([], { month: 'short', day: 'numeric' });
          statusTarget.textContent = `${statusLabel} · ${date}`;
        }
      })
      .catch(error => {
        console.error(`Could not load scoresheet for game ${event.gameId}:`, error);
        const currentTarget = document.getElementById(`scores-game-result-${getScoreCardKey(event)}`);
        if (currentTarget) currentTarget.innerHTML = renderPastGameUnavailable(matchup, 'Final score details could not be loaded.');
      });
  });
}

function loadPastScheduleResults(events) {
  events.filter(event => new Date(event.start) < new Date()).forEach(event => {
    const targetId = `schedule-result-${getScoreCardKey(event)}`;
    const target = document.getElementById(targetId);
    if (!target) return;
    if (!event.gameId) {
      target.textContent = 'Score unavailable';
      return;
    }

    const matchup = getMatchupDetails(event.title, event.leagueKey);
    fetchGameSheet(event.gameId)
      .then(result => {
        const currentTarget = document.getElementById(targetId);
        if (currentTarget) currentTarget.innerHTML = renderScheduleGameResult(result, event, matchup);
      })
      .catch(error => {
        console.error(`Could not load schedule result for game ${event.gameId}:`, error);
        const currentTarget = document.getElementById(targetId);
        if (currentTarget) currentTarget.textContent = 'Score unavailable';
      });
  });
}


function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


async function fetchDivisionEvents(leagueKey) {
  const response = await fetch(LEAGUE_STRUCTURE[leagueKey].icsUrl);
  if (!response.ok) throw new Error(`Calendar request failed (${response.status})`);
  const comp = new ICAL.Component(ICAL.parse(await response.text()));
  return comp.getAllSubcomponents('vevent').map(vevent => {
    const event = new ICAL.Event(vevent);
    return { title: event.summary, start: event.startDate.toJSDate(), location: event.location || 'TBD', gameId: extractGameIdFromIcs(vevent), leagueKey };
  });
}
function renderScoreGroups(events) {
  const grouped = new Map();
  [...events].sort((a,b) => new Date(a.start) - new Date(b.start)).forEach(event => {
    const key = getLocalDateKey(new Date(event.start));
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  });
  return [...grouped].map(([key, games]) => {
    const date = new Date(`${key}T12:00:00`).toLocaleDateString([], {weekday:'long',month:'long',day:'numeric',year:'numeric'});
    return `<div class="date-group scores-date-group" id="schedule-day-${key}"><h3 class="date-header">${date}</h3><div class="scores-game-grid">${games.map(event => renderScoreCard(event, getMatchupDetails(event.title,event.leagueKey))).join('')}</div></div>`;
  }).join('');
}
return { fetchGameSheet, getConfiguredTeam, completedGameLabel, allTeamConfigs, getMatchupDetails, escapeLeaderHtml, gameDetailHref, getLocalDateKey, getScoreCardKey, renderScoreCard, loadPastGameDetails, loadPastScheduleResults, loadScheduleTeamLeaders, loadScheduleStandings, fetchDivisionEvents, renderScoreGroups };
};
