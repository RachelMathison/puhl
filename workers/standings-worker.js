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

export default {
  async fetch(request, env, ctx) {
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

    corsHeaders['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
    corsHeaders['Cache-Control'] = 'no-store';

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const params = new URL(request.url).searchParams;
    const team = params.get("team")?.trim();
    const subseason = params.get("subseason")?.trim();
    if (!team || !subseason || !/^\d+$/.test(team) || !/^\d+$/.test(subseason)) {
      return new Response(JSON.stringify({ error: "Provide numeric team and subseason IDs." }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json;charset=UTF-8"
        }
      });
    }

    const targetUrl = new URL(`https://wicadulthockey.sportngin.com/standings/show/${team}`);
    targetUrl.searchParams.set("subseason", subseason);
    
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch: ${response.status}` }), {
        status: 502,
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json;charset=UTF-8" 
        }
      });
    }

    const htmlText = await response.text();
    const match = htmlText.match(/<table[^>]*class="[^"]*statTable[^"]*"[\s\S]*?<\/table>/i);
    
    if (!match) {
      return new Response(JSON.stringify({ error: "Could not find the standings table on the page." }), {
        status: 404,
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json;charset=UTF-8" 
        }
      });
    }

    const tableHtml = match[0];

    // Extract headers (skipping condensedView columns)
    const headerMatch = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i);
    const headers = [];
    if (headerMatch) {
      const thRegex = /<th([^>]*)>([\s\S]*?)<\/th>/gi;
      let th;
      while ((th = thRegex.exec(headerMatch[1])) !== null) {
        const attributes = th[1];
        if (/class="[^"]*condensedView[^"]*"/i.test(attributes)) {
          continue; // Ignore condensed headers
        }
        headers.push(th[2].replace(/<[^>]*>/g, "").trim());
      }
    }

    // Extract row cells (skipping condensedView cells)
    const tbodyMatch = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    const rows = [];
    
    if (tbodyMatch) {
      const trRegex = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi;
      let tr;
      while ((tr = trRegex.exec(tbodyMatch[1])) !== null) {
        const rowHtml = tr[1];
        const tdRegex = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
        let td;
        const rowCells = [];
        
        while ((td = tdRegex.exec(rowHtml)) !== null) {
          const attributes = td[1];
          const cellContent = td[2];

          if (/class="[^"]*condensedView[^"]*"/i.test(attributes)) {
            continue; // Ignore condensed cells
          }

          const teamNameMatch = cellContent.match(/class="teamName"[^>]*>([\s\S]*?)<\/a>/i);
          if (teamNameMatch) {
            rowCells.push(teamNameMatch[1].replace(/<[^>]*>/g, "").trim());
          } else {
            rowCells.push(cellContent.replace(/<[^>]*>/g, "").trim());
          }
        }
        
        if (rowCells.length > 0) {
          rows.push(rowCells);
        }
      }
    }

    // Map headers to row values
    const standingsData = rows.map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        const key = header || `col_${index}`;
        obj[key] = row[index] !== undefined ? row[index] : "";
      });
      return obj;
    });

    return new Response(JSON.stringify(standingsData, null, 2), {
      headers: { 
        ...corsHeaders,
        "Cache-Control": "public, max-age=900",
        "Content-Type": "application/json;charset=UTF-8" 
      }
    });
  }
};
