const allowedOrigins = [
  'https://portland.hockey',
  'http://portland.hockey',
  'https://www.portland.hockey',
  'http://www.portland.hockey',
  'https://puhl.portland.hockey',
  'http://puhl.portland.hockey',
  'https://darkknightshockey.com',
  'http://darkknightshockey.com',
  'https://www.darkknightshockey.com',
  'http://www.darkknightshockey.com',
];

// One SportsEngine team-stats URL per team. Keep this list in sync with stats-worker.js.
const TEAM_STATS_URLS = [
  'https://wicadulthockey.sportngin.com/stats/print/10598435?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598436?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598437?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598438?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598442?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598440?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598441?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598443?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598446?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598445?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598447?tab=team_instance_team_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598444?tab=team_instance_team_stats'
];

function decodeHtml(value = '') {
  const named = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—'
  };
  return String(value)
    .replace(/&([a-z]+);/gi, (whole, name) => named[name.toLowerCase()] ?? whole)
    .replace(/&#(\d+);/g, (whole, code) => {
      const point = Number(code);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    })
    .replace(/&#x([\da-f]+);/gi, (whole, code) => {
      const point = parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    });
}

function textContent(html = '') {
  return decodeHtml(String(html)
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function attributeValue(attributes = '', name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

function normalizeHeader(header, index) {
  const value = textContent(header).toLowerCase().replace(/\s+/g, ' ').trim();
  if (index === 0 || value === 'team') return 'team';
  if (/^\d+$/.test(value)) return value;
  const aliases = {
    'total': 'total', 'gp': 'gp', 'gpg': 'gpg', 'gapg': 'gapg',
    'pp': 'pp', 'pp %': 'ppPct', 'pk': 'pk', 'ppga': 'ppga',
    'pk %': 'pkPct', 'sv %': 'svPct', 'min': 'minutes', 'sog': 'sog',
    'ga': 'ga', 'sv': 'saves', 'gaa': 'gaa', 'so': 'shutouts',
    'g': 'goals', 'a': 'assists', 'pts': 'points', 'sh': 'sh',
    'sha': 'sha', 'pen': 'penalties', 'pim': 'pim'
  };
  return aliases[value] || value.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `column${index + 1}`;
}

function parseValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '-') return null;
  if (/^\d+:\d{2}$/.test(trimmed)) return trimmed;
  const numeric = Number(trimmed.replace(/%$/, ''));
  return Number.isFinite(numeric) ? numeric : trimmed;
}

function parseStatsPage(html, sourceUrl) {
  const team = { name: null, url: null, stats: {} };
  const league = textContent(html.match(/<h2\b[^>]*class=["'][^"']*\bleague\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
  const season = textContent(html.match(/<h2\b[^>]*class=["'][^"']*\bseason\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
  const tablePattern = /<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi;
  let match;

  while ((match = tablePattern.exec(html)) !== null) {
    const beforeTable = html.slice(Math.max(0, match.index - 1300), match.index);
    const headings = [...beforeTable.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/gi)];
    const category = textContent(headings[headings.length - 1]?.[1] || '');
    const tableHtml = match[2];
    const rowMatches = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
    const headerRow = rowMatches.find(row => /<th\b/i.test(row[1]));
    if (!headerRow) continue;

    // SportsEngine's period table omits closing </th> tags, so stop each header
    // cell at the next <th> or the end of the captured row contents.
    const headers = [...headerRow[1].matchAll(/<th\b[^>]*>([\s\S]*?)(?=<th\b|$)/gi)]
      .map((cell, index) => normalizeHeader(cell[1], index));
    const dataRows = rowMatches.filter(row => row.index > headerRow.index);
    const currentTeamRow = dataRows.find(row => {
      const firstCell = row[1].match(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/i)?.[1] || '';
      return /class=["'][^"']*\bteamName\b/i.test(firstCell) && !/>\s*Opponent\s*</i.test(firstCell);
    });
    if (!currentTeamRow) continue;

    const cells = [...currentTeamRow[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td\s*>/gi)];
    const firstCellHtml = cells[0]?.[2] || '';
    const teamLink = firstCellHtml.match(/<a\b([^>]*\bclass=["'][^"']*\bteamName\b[^"']*["'][^>]*)>([\s\S]*?)<\/a\s*>/i);
    const name = textContent(teamLink?.[2] || firstCellHtml);
    if (!team.name) {
      team.name = name;
      team.url = teamLink ? attributeValue(teamLink[1], 'href') || sourceUrl : sourceUrl;
    }
    if (name !== team.name) continue;

    const stats = {};
    headers.forEach((key, index) => {
      if (key === 'team' || !cells[index]) return;
      stats[key] = parseValue(textContent(cells[index][2]));
    });
    const key = category.toLowerCase().includes('score by period')
      ? 'scoreByPeriod'
      : category.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `table_${Object.keys(team.stats).length + 1}`;
    team.stats[key] = stats;
  }

  return { league, season, team: team.name ? team : null, sourceUrl };
}

async function fetchTeamStats(url) {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; PUHLTeamStatsWorker/1.0)' },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`SportsEngine returned HTTP ${response.status}`);
  return parseStatsPage(await response.text(), url);
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const isLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || '');
    const isXarriaWorker = /^https:\/\/[a-z0-9-]+\.xarria\.workers\.dev$/.test(origin || '');
    const isAllowed = allowedOrigins.includes(origin) || isLocalhost || isXarriaWorker;
    const corsOrigin = isAllowed ? origin : allowedOrigins[0];
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin'
    };

    function jsonResponse(body, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': status === 200 && !body.errors?.length ? 'public, max-age=900' : 'no-store'
        }
      });
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed. Use GET.' }, 405);

    const subseason = new URL(request.url).searchParams.get('subseason');
    if (!subseason || !/^\d+$/.test(subseason)) {
      return jsonResponse({ error: 'A numeric subseason query parameter is required.' }, 400);
    }
    const urls = TEAM_STATS_URLS.map(source => {
      const url = new URL(source);
      url.searchParams.set('subseason', subseason);
      return url.toString();
    });
    const results = await Promise.allSettled(urls.map(fetchTeamStats));
    const response = { league: null, season: null, teams: [], errors: [] };

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        response.league ||= result.value.league;
        response.season ||= result.value.season;
        if (result.value.team) response.teams.push(result.value.team);
        else response.errors.push({ url: urls[index], error: 'No team stats tables were recognized.' });
      } else {
        response.errors.push({
          url: urls[index],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    });

    return jsonResponse(response, response.teams.length ? 200 : 502);
  }
};
