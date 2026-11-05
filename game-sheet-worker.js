const UPSTREAM_ORIGIN = 'https://wicadulthockey.sportngin.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders }
  });
}

function decodeHtml(value = '') {
  const named = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“'
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
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function normalizeCell(value = '') {
  const normalized = textContent(value).toLowerCase().replace(/[^a-z0-9%#+/-]/g, '');
  const aliases = {
    player: 'name',
    playername: 'name',
    goals: 'g',
    goal: 'g',
    assists: 'a',
    assist: 'a',
    no: 'number'
  };
  return aliases[normalized] || normalized;
}

function numericValue(value) {
  const cleaned = textContent(value).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const number = Number(cleaned.replace(/%$/, ''));
  return Number.isFinite(number) ? number : null;
}

function attributeValue(attributes = '', name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

function parseTables(html) {
  const tables = [];
  const tablePattern = /<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi;
  let match;

  while ((match = tablePattern.exec(html)) !== null) {
    const tableAttributes = match[1];
    const tableHtml = match[0];
    const rows = [...match[2].matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/gi)]
      .map(rowMatch => ({
        className: attributeValue(rowMatch[1], 'class'),
        cells: [...rowMatch[2].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]\s*>/gi)]
          .map(cellMatch => ({
            html: cellMatch[2],
            text: textContent(cellMatch[2]),
            id: attributeValue(cellMatch[1], 'id'),
            className: attributeValue(cellMatch[1], 'class')
          }))
      }))
      .filter(row => row.cells.length);
    const before = html.slice(Math.max(0, match.index - 1800), match.index);
    const headings = [...before.matchAll(/<(?:h[1-6]|strong|b)\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)\s*>/gi)];
    const label = headings.length ? textContent(headings[headings.length - 1][1]) : '';
    const teamNameHeader = [...before.matchAll(/<h3\b[^>]*id=["']player_stats_(?:away|home)_team_name["'][^>]*>([\s\S]*?)<\/h3\s*>/gi)];
    tables.push({
      id: attributeValue(tableAttributes, 'id'),
      className: attributeValue(tableAttributes, 'class'),
      rows,
      label,
      teamName: teamNameHeader.length ? textContent(teamNameHeader[teamNameHeader.length - 1][1]) : null,
      context: textContent(before.slice(-900)),
      html: tableHtml
    });
  }

  return tables;
}

function findHeaderRow(table, requiredHeaders) {
  return table.rows.findIndex(row => {
    const headers = row.cells.map(cell => normalizeCell(cell.text));
    return requiredHeaders.every(header => headers.includes(header));
  });
}

function parsePeriodTable(table) {
  const headerIndex = table.rows.findIndex(row => {
    const headers = row.cells.map(cell => normalizeCell(cell.text));
    const hasTotal = headers.some(value => ['t', 'total', 'final'].includes(value));
    const hasPeriods = headers.some(value => /^\d+$/.test(value) || /^(ot\d*|so)$/.test(value));
    return hasTotal && hasPeriods && row.cells.length >= 3;
  });
  if (headerIndex < 0) return null;

  const headers = table.rows[headerIndex].cells.map(cell => textContent(cell.text));
  const periodLabels = headers.slice(1).filter((_, index) => index < headers.length - 1);
  const rows = table.rows.slice(headerIndex + 1).map(row => {
    const name = textContent(row.cells[0]?.text || '');
    if (!name || /^(team|totals?|scoring|shots?)$/i.test(name)) return null;
    const values = row.cells.slice(1).map(cell => numericValue(cell.text));
    if (!values.length || values.every(value => value === null)) return null;
    const total = values[values.length - 1];
    return {
      team: name,
      periods: Object.fromEntries(periodLabels.map((label, index) => [label || String(index + 1), values[index]])),
      total
    };
  }).filter(Boolean);

  return rows.length ? { periodLabels, rows } : null;
}

function parseSkaterTable(table) {
  const headerIndex = findHeaderRow(table, ['name', 'g']);
  if (headerIndex < 0) return null;

  const headers = table.rows[headerIndex].cells.map(cell => normalizeCell(cell.text));
  const nameIndex = headers.indexOf('name');
  const goalsIndex = headers.indexOf('g');
  const assistsIndex = headers.indexOf('a');
  const numberIndex = headers.findIndex(header => ['#', 'number', 'no'].includes(header));
  const players = table.rows.slice(headerIndex + 1).map(row => {
    const name = textContent(row.cells[nameIndex]?.text || '');
    const goals = numericValue(row.cells[goalsIndex]?.text);
    if (!name || /^(totals?|team totals)$/i.test(name) || goals === null || goals <= 0) return null;
    return {
      name,
      number: numberIndex >= 0 ? textContent(row.cells[numberIndex]?.text || '') || null : null,
      goals,
      assists: assistsIndex >= 0 ? numericValue(row.cells[assistsIndex]?.text) : null
    };
  }).filter(Boolean);

  return { team: table.teamName, players };
}

function elementTextById(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bid=["']${escapedId}["'])[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, 'i'));
  return match ? textContent(match[2]) : null;
}

function parseBoxScore(table, html) {
  if (!table) return [];
  return ['away', 'home'].map(side => {
    const row = table.rows.find(candidate => candidate.className.split(/\s+/).includes(side));
    if (!row) return null;
    const nameCell = row.cells.find(cell => cell.id === `score_${side}_team_name`) ||
      row.cells.find(cell => /teamname/i.test(cell.className));
    const numericCells = row.cells
      .filter(cell => !/score-final/i.test(cell.className))
      .map(cell => numericValue(cell.text))
      .filter(value => value !== null);
    const scoreCell = row.cells.find(cell => /score-final/i.test(cell.className));
    const score = numericValue(scoreCell?.text) ?? numericValue(elementTextById(html, `${side}_team_score`));
    const header = table.rows[0]?.cells.map(cell => textContent(cell.text)) || [];
    const periodLabels = header.filter(value => /^\d+$/.test(value) || /^(OT\d*|SO)$/i.test(value));
    const periodScores = numericCells.slice(0, periodLabels.length);

    return {
      side,
      name: textContent(nameCell?.text || elementTextById(html, `${side}_team_name`) || ''),
      score,
      periods: Object.fromEntries(periodLabels.map((period, index) => [period, periodScores[index] ?? null]))
    };
  }).filter(team => team && team.name);
}

function parseScoreSheet(html, gameId, sourceUrl) {
  const tables = parseTables(html);
  const scoreTable = tables.find(table => table.id === 'box_score');
  const shotTable = tables
    .filter(table => /shots?\s*(on\s*)?goal|\bsog\b/i.test(`${table.label} ${table.context}`))
    .map(table => ({ table, parsed: parsePeriodTable(table) }))
    .find(candidate => candidate.parsed);
  const skaterTables = tables
    .map(table => ({ table, parsed: parseSkaterTable(table) }))
    .filter(item => item.parsed)
    .filter((item, index, all) => !item.parsed.team || all.findIndex(candidate =>
      sameTeam(candidate.parsed.team, item.parsed.team)) === index);

  const scores = parseBoxScore(scoreTable, html);
  const shots = shotTable?.parsed.rows || [];
  const teamNames = Array.from(new Set([
    ...scores.map(row => row.name),
    ...shots.map(row => row.team)
  ]));
  const goalScorers = skaterTables.flatMap(({ table, parsed }) => parsed.players.map(player => ({
    ...player,
    team: parsed.team || inferTeamForTable(table, teamNames)
  })));

  return {
    gameId,
    sourceUrl,
    status: extractStatus(html),
    date: elementTextById(html, 'game_date'),
    time: elementTextById(html, 'game_time')?.trim() || null,
    location: elementTextById(html, 'game_location'),
    teams: scores.map(team => ({
      name: team.name,
      side: team.side,
      score: team.score,
      shotsOnGoal: shots.find(row => sameTeam(row.team, team.name))?.total ?? null,
      periods: team.periods
    })),
    goalScorers,
    available: {
      score: scores.some(team => team.score !== null),
      shotsOnGoal: shots.length > 0,
      goalScorers: skaterTables.length > 0
    }
  };
}

function sameTeam(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function inferTeamForTable(table, teamNames) {
  const context = `${table.label} ${table.context}`.toLowerCase();
  return teamNames.find(team => context.includes(String(team.name || team).toLowerCase())) || null;
}

function extractStatus(html) {
  const explicitStatus = elementTextById(html, 'game_status');
  if (explicitStatus) return explicitStatus;
  const text = textContent(html);
  const match = text.match(/\b(FINAL(?:\/(?:OT|SO))?|IN PROGRESS|LIVE|SCHEDULED)\b/i);
  return match ? match[1].toUpperCase() : null;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed. Use GET.' }, 405);

    const requestUrl = new URL(request.url);
    const pathId = requestUrl.pathname.match(/\/(\d+)\/?$/)?.[1];
    const gameId = requestUrl.searchParams.get('id') || pathId;
    if (!gameId || !/^\d+$/.test(gameId)) {
      return jsonResponse({ error: 'Provide a numeric game ID using ?id=GAME_ID or /GAME_ID.' }, 400);
    }

    const sourceUrl = `${UPSTREAM_ORIGIN}/game/game_sheet/${gameId}`;
    try {
      const upstream = await fetch(sourceUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; PUHLGameSheetWorker/1.0)'
        },
        redirect: 'follow'
      });

      if (!upstream.ok) {
        return jsonResponse({ error: `SportsEngine returned HTTP ${upstream.status}.`, gameId }, 502);
      }

      const html = await upstream.text();
      if (!/<html|<table/i.test(html)) {
        return jsonResponse({ error: 'The response did not contain a readable game sheet.', gameId }, 502);
      }

      const result = parseScoreSheet(html, gameId, sourceUrl);
      if (!result.teams.length && !result.goalScorers.length) {
        return jsonResponse({
          error: 'The page loaded, but the game sheet structure was not recognized.',
          gameId,
          sourceUrl
        }, 422);
      }

      return jsonResponse(result, 200, { 'Cache-Control': 'public, max-age=60' });
    } catch (error) {
      return jsonResponse({
        error: 'Could not fetch the SportsEngine game sheet.',
        gameId,
        details: error instanceof Error ? error.message : String(error)
      }, 502);
    }
  }
};
