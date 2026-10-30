// Add one SportsEngine stats/print URL for each team or division to combine.
const STATS_URLS = [
  'https://wicadulthockey.sportngin.com/stats/print/10598435?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598436?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598437?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598438?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598442?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598440?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598441?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598443?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598446?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598445?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598447?subseason=964738&tab=team_instance_player_stats',
  'https://wicadulthockey.sportngin.com/stats/print/10598444?subseason=964738&tab=team_instance_player_stats'
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cellText(html) {
  return decodeHtml(html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function normalizeHeader(header) {
  const normalized = header.toLowerCase().replace(/[^a-z%#]/g, '');
  const aliases = {
    '#': 'number',
    player: 'name',
    name: 'name',
    'sv%': 'svPct',
    avgpts: 'avgPts'
  };
  return aliases[normalized] || normalized;
}

function parseStatTables(html, sourceUrl) {
  const parsed = { skaters: [], goalies: [] };
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];

  tables.forEach(table => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => {
      const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(cell => ({ html: cell[1], text: cellText(cell[1]) }));
      return cells;
    }).filter(row => row.length);

    const headerIndex = rows.findIndex(row => {
      const headers = row.map(cell => normalizeHeader(cell.text));
      return headers.includes('name') && headers.includes('gp') &&
        (headers.includes('pts') || headers.includes('gaa'));
    });
    if (headerIndex === -1) return;

    const headers = rows[headerIndex].map(cell => normalizeHeader(cell.text));
    const isGoalieTable = headers.includes('gaa');
    const outputKey = isGoalieTable ? 'goalies' : 'skaters';

    rows.slice(headerIndex + 1).forEach(row => {
      const values = {};
      headers.forEach((key, index) => {
        if (key && row[index]) values[key] = row[index].text;
      });

      const playerName = values.name;
      if (!playerName || /^(team totals|unattributed)$/i.test(playerName)) return;

      const nameCell = row[headers.indexOf('name')];
      const href = nameCell?.html.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
      if (href) values.profileUrl = new URL(href, sourceUrl).href;

      const numericKeys = isGoalieTable
        ? ['gp', 'w', 'l', 't', 'sol', 'sog', 'ga', 'sv', 'gaa', 'svPct', 'so']
        : ['gp', 'g', 'a', 'pts', 'ppg', 'ppa', 'sh', 'sha', 'pen', 'pim', 'gw', 'avgPts'];
      numericKeys.forEach(key => {
        if (values[key] === undefined) return;
        const number = Number(String(values[key]).replace('%', ''));
        if (Number.isFinite(number)) values[key] = number;
      });

      parsed[outputKey].push(values);
    });
  });

  return parsed;
}

async function fetchStatsPage(url) {
  const response = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return parseStatTables(await response.text(), url);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed. Use GET.' }, 405);
    }

    const results = await Promise.allSettled(STATS_URLS.map(fetchStatsPage));
    const combined = { skaters: [], goalies: [], errors: [] };

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        combined.skaters.push(...result.value.skaters);
        combined.goalies.push(...result.value.goalies);
      } else {
        combined.errors.push({
          url: STATS_URLS[index],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    });

    return jsonResponse(combined);
  }
};
