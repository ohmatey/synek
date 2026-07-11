import { toolRegistry } from './registry'

// The /api/mcp endpoint speaks MCP over authenticated POST (JSON-RPC). Humans and
// agents who hit it with a GET have nothing to act on — so this module answers the
// GET with a guide instead of the blank SPA shell:
//   • MCP client opening a GET SSE stream  → 405 (this transport is POST-only)
//   • browser (Accept: text/html)          → a full, branded setup/use guide page
//   • agent / curl / JSON client           → a machine-readable JSON descriptor
// `?format=json` / `?format=html` force a representation regardless of Accept.

// Canonical public home — used for the "Docs" button and the JSON descriptor.
const REPO_URL = 'https://github.com/ohmatey/synek'

type ToolInfo = { name: string; title: string; description: string }

const TOOLS: ToolInfo[] = toolRegistry.map((t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
}))

const TITLE_BY_NAME = new Map(TOOLS.map((t) => [t.name, t.title]))

// Curated groups for the human page. Names not listed here fall into "More".
const GROUPS: { label: string; names: string[] }[] = [
  { label: 'Projects & series', names: ['create_project', 'list_projects', 'get_project', 'create_series', 'get_series', 'set_series_public', 'set_series_review_mode'] },
  { label: 'Timelines', names: ['list_timelines', 'create_timeline', 'get_timeline', 'query_timeline', 'get_node', 'list_entities', 'get_layout_report'] },
  { label: 'Editing', names: ['apply_patch', 'undo', 'redo'] },
  { label: 'Stories', names: ['write_story', 'patch_story', 'undo_story', 'redo_story'] },
  { label: 'Theme & view', names: ['set_timeline_view', 'set_timeline_theme', 'set_story_theme'] },
  { label: 'Brand', names: ['list_brands', 'set_story_brand', 'set_series_brand'] },
  { label: 'Sources', names: ['register_artifact', 'search_artifacts'] },
]

function originOf(request: Request): string {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  return `${proto}://${host}`
}

function descriptor(endpoint: string, origin: string) {
  return {
    name: 'Synek MCP server',
    product: 'Chronograph',
    summary:
      'A temporally-anchored knowledge canvas driven from outside via MCP. Connect your MCP client and its model builds a visual mesh of typed nodes, stories, and relationships along a timeline.',
    endpoint,
    transport: 'streamable-http',
    protocol: 'mcp',
    methods: {
      POST: 'MCP JSON-RPC 2.0 requests — requires auth. This is the only functional method.',
      GET: 'This descriptor (JSON) or the human guide (HTML), by Accept header.',
    },
    authentication: {
      scheme: 'bearer',
      header: 'Authorization: Bearer <token>',
      oauth: `${origin}/.well-known/oauth-protected-resource`,
      obtainKey: `Sign in at ${origin}, then open Settings → API keys to mint a token (or run \`bun run issue:key\` on a local install).`,
      apiKeysUrl: `${origin}/api-keys`,
    },
    docs: REPO_URL,
    quickstart: {
      claudeCode: `claude mcp add --transport http synek ${endpoint} --header "Authorization: Bearer YOUR_TOKEN"`,
      mcpJson: {
        mcpServers: {
          synek: { type: 'http', url: endpoint, headers: { Authorization: 'Bearer YOUR_TOKEN' } },
        },
      },
      verify: `curl -s -X POST ${endpoint} -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    },
    app: origin,
    tools: TOOLS,
  }
}

function jsonResponse(request: Request): Response {
  const origin = originOf(request)
  const endpoint = `${origin}/api/mcp`
  return new Response(JSON.stringify(descriptor(endpoint, origin), null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  })
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function toolGrid(): string {
  const used = new Set<string>()
  const blocks = GROUPS.map((g) => {
    const items = g.names
      .filter((n) => TITLE_BY_NAME.has(n))
      .map((n) => {
        used.add(n)
        return `<li><code>${esc(n)}</code><span>${esc(TITLE_BY_NAME.get(n)!)}</span></li>`
      })
      .join('')
    return items ? `<div class="grp"><h4>${esc(g.label)}</h4><ul>${items}</ul></div>` : ''
  })
  const more = TOOLS.filter((t) => !used.has(t.name))
  if (more.length) {
    const items = more.map((t) => `<li><code>${esc(t.name)}</code><span>${esc(t.title)}</span></li>`).join('')
    blocks.push(`<div class="grp"><h4>More</h4><ul>${items}</ul></div>`)
  }
  return blocks.join('')
}

function htmlResponse(request: Request): Response {
  const origin = originOf(request)
  const endpoint = `${origin}/api/mcp`
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    name: 'Synek MCP server',
    description: descriptor(endpoint, origin).summary,
    documentation: `${endpoint}?format=json`,
    url: endpoint,
    provider: { '@type': 'Organization', name: 'Synek' },
  })

  const ccCmd = `claude mcp add --transport http synek ${endpoint} \\\n  --header "Authorization: Bearer YOUR_TOKEN"`
  const desktopCfg = `{
  "mcpServers": {
    "synek": {
      "command": "npx",
      "args": ["mcp-remote", "${endpoint}",
        "--header", "Authorization: Bearer YOUR_TOKEN"]
    }
  }
}`
  const mcpJsonCfg = `{
  "mcpServers": {
    "synek": {
      "type": "http",
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}`
  const verifyCmd = `curl -s -X POST ${endpoint} \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

  // Tabbed connection methods — Claude Code leads, but it's open to any MCP client.
  // intro/tip are trusted literals (contain <code>); only labels + code are escaped.
  const METHODS = [
    {
      id: 'cc',
      label: 'Claude Code',
      rec: true,
      intro: 'Add the server from your terminal — Claude Code speaks HTTP MCP natively. Swap in the token you minted.',
      code: ccCmd,
      tip: 'Prefer a one-click browser sign-in? Install the <code>synek</code> plugin and it runs the OAuth authorize flow for you — no token to paste.',
    },
    {
      id: 'desktop',
      label: 'Claude Desktop',
      intro: 'Desktop bridges the HTTP server through <code>mcp-remote</code>. Drop this into <code>claude_desktop_config.json</code> and restart the app.',
      code: desktopCfg,
      tip: '',
    },
    {
      id: 'other',
      label: 'Cursor &amp; others',
      intro: 'Any MCP client with HTTP support — paste this into its MCP config (Cursor, Windsurf, VS Code, Zed, …).',
      code: mcpJsonCfg,
      tip: 'Client only speaks stdio? Use the <code>mcp-remote</code> bridge shown under Claude Desktop.',
    },
    {
      id: 'curl',
      label: 'Verify',
      intro: 'Sanity-check a token. A valid one lists the tools; no token returns <code>401</code> — which means the server is up and the guard is working.',
      code: verifyCmd,
      tip: '',
    },
  ]
  const tabs = METHODS.map(
    (m, i) =>
      `<button class="tab" role="tab" id="tab-${m.id}" aria-controls="panel-${m.id}" data-panel="${m.id}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${m.label}${m.rec ? '<span class="rec">Recommended</span>' : ''}</button>`,
  ).join('')
  const panels = METHODS.map(
    (m, i) =>
      `<div class="panel" role="tabpanel" id="panel-${m.id}" aria-labelledby="tab-${m.id}" data-panel="${m.id}"${i === 0 ? '' : ' hidden'}>
      <p class="intro">${m.intro}</p>
      <pre><button class="copy">Copy</button><code>${esc(m.code)}</code></pre>
      ${m.tip ? `<p class="tip">${m.tip}</p>` : ''}
    </div>`,
  ).join('')

  const keySvg =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 8-8"/><path d="m16 7 2.5 2.5"/></svg>'
  const bookSvg =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2z"/><path d="M4 21h15"/></svg>'

  const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Synek MCP server — connect a client</title>
<meta name="description" content="This is the Synek (Chronograph) MCP server endpoint — a machine-to-machine MCP endpoint, not a web page. Here's how to connect your MCP client and start building timelines.">
<meta name="robots" content="noindex, follow">
<meta property="og:title" content="Synek MCP server">
<meta property="og:description" content="Connect your MCP client to build a temporally-anchored knowledge canvas.">
<meta property="og:type" content="website">
<meta name="theme-color" content="#08090c">
<link rel="canonical" href="${esc(endpoint)}">
<script type="application/ld+json">${jsonLd}</script>
<style>
  :root{
    --bg:#08090c; --surface:#0e0f13; --elevated:#16181e; --overlay:#1c1f28;
    --fg:#f4f5f7; --fg2:#c3c7d1; --muted:#878d9c; --subtle:#6a7081;
    --border:#23262f; --border-faint:#1a1c23;
    --primary:#3a6df0; --primary-2:#6aa9ff; --story:#e0a458; --era:#45b8ac; --influence:#9b8cff;
    --ok:#52c41a;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);
    font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  body::before{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;
    background:
      radial-gradient(820px 460px at 14% -6%, rgba(58,109,240,.22), transparent 62%),
      radial-gradient(720px 420px at 90% 2%, rgba(69,184,172,.14), transparent 58%),
      radial-gradient(680px 520px at 58% 118%, rgba(155,140,255,.12), transparent 60%)}
  body::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.6;
    background-image:linear-gradient(rgba(122,162,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(122,162,255,.045) 1px,transparent 1px);
    background-size:46px 46px;
    -webkit-mask-image:radial-gradient(120% 80% at 50% -10%, #000 0%, transparent 72%);
    mask-image:radial-gradient(120% 80% at 50% -10%, #000 0%, transparent 72%)}
  a{color:var(--primary-2);text-decoration:none}
  a:hover{text-decoration:underline}
  code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .wrap{max-width:880px;margin:0 auto;padding:56px 24px 96px}

  .hero{position:relative;overflow:hidden;border-radius:22px;padding:36px 34px;
    background:linear-gradient(180deg,rgba(22,24,30,.74),rgba(12,13,17,.66));
    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    border:1px solid var(--border);
    box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 30px 80px -40px rgba(58,109,240,.55)}
  .hero::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;
    background:linear-gradient(120deg,rgba(106,169,255,.7),rgba(69,184,172,.35) 40%,transparent 70%);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
    -webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
    mask-composite:exclude;pointer-events:none}
  .hero::after{content:"";position:absolute;width:340px;height:340px;right:-90px;top:-140px;border-radius:50%;
    background:radial-gradient(circle,rgba(58,109,240,.5),transparent 65%);filter:blur(20px);
    opacity:.5;pointer-events:none;animation:float 9s ease-in-out infinite}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(22px)}}
  .eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:12px;font-weight:700;
    letter-spacing:.16em;text-transform:uppercase;color:var(--primary-2);margin:0 0 16px}
  .eyebrow .pulse{width:7px;height:7px;border-radius:50%;background:var(--era);
    box-shadow:0 0 0 0 rgba(69,184,172,.6);animation:pulse 2.4s ease-out infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(69,184,172,.55)}70%{box-shadow:0 0 0 9px rgba(69,184,172,0)}100%{box-shadow:0 0 0 0 rgba(69,184,172,0)}}
  h1{font-size:clamp(30px,5.4vw,46px);line-height:1.08;letter-spacing:-.025em;margin:0 0 14px;font-weight:720;
    background:linear-gradient(98deg,#fff 8%,var(--primary-2) 52%,var(--era) 96%);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .lede{font-size:17.5px;color:var(--fg2);margin:0 0 26px;max-width:60ch}
  .cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .btn{display:inline-flex;align-items:center;gap:9px;font-weight:600;font-size:15px;
    border-radius:12px;padding:12px 20px;cursor:pointer;border:1px solid transparent;
    transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease,background .15s ease;white-space:nowrap}
  .btn svg{flex:none}
  .btn-primary{color:#fff;background:linear-gradient(180deg,#4d7af5,#3158d8);
    box-shadow:0 10px 26px -10px rgba(58,109,240,.8),0 0 0 1px rgba(122,162,255,.35) inset}
  .btn-primary:hover{transform:translateY(-1px);text-decoration:none;
    box-shadow:0 16px 34px -10px rgba(58,109,240,.95),0 0 0 1px rgba(122,162,255,.5) inset}
  .btn-ghost{color:var(--fg);background:rgba(255,255,255,.035);border-color:var(--border)}
  .btn-ghost:hover{text-decoration:none;border-color:var(--subtle);background:rgba(255,255,255,.07);transform:translateY(-1px)}
  .btn-link{color:var(--muted);font-size:13.5px;padding:12px 6px}
  .btn-link:hover{color:var(--fg2)}

  h2{font-size:12.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);
    font-weight:700;margin:46px 0 14px}
  .endpoint{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
    background:linear-gradient(180deg,var(--elevated),#101218);
    border:1px solid var(--border);border-radius:13px;padding:14px 16px;position:relative}
  .endpoint .m{font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--ok);
    border:1px solid color-mix(in srgb,var(--ok) 45%,var(--border));border-radius:6px;padding:3px 8px}
  .endpoint code{font-size:14.5px;color:var(--fg);word-break:break-all;flex:1;min-width:0}
  .endpoint .copy{position:static}
  .tip{color:var(--muted);font-size:13.5px;margin:10px 0 0;max-width:70ch}
  .tip code{color:var(--fg2)}

  .tabs{display:inline-flex;gap:4px;padding:4px;margin:0 0 16px;flex-wrap:wrap;
    background:rgba(8,9,12,.65);border:1px solid var(--border);border-radius:13px}
  .tab{position:relative;display:inline-flex;align-items:center;gap:8px;font:inherit;
    font-size:13.5px;font-weight:600;color:var(--muted);background:transparent;border:0;
    border-radius:9px;padding:8px 14px;cursor:pointer;transition:color .15s,background .15s}
  .tab:hover{color:var(--fg2)}
  .tab[aria-selected="true"]{color:#fff;
    background:linear-gradient(180deg,rgba(58,109,240,.38),rgba(58,109,240,.16));
    box-shadow:0 0 0 1px rgba(122,162,255,.4) inset,0 6px 18px -8px rgba(58,109,240,.7)}
  .tab .rec{font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;
    color:var(--era);border:1px solid color-mix(in srgb,var(--era) 45%,transparent);
    border-radius:5px;padding:1px 5px}
  .panel .intro{color:var(--fg2);font-size:14.5px;margin:0 0 12px;max-width:70ch}
  .panel .intro code{color:var(--fg)}

  pre{background:linear-gradient(180deg,#0c0d11,#0a0b0f);border:1px solid var(--border);
    border-radius:13px;padding:16px 18px;overflow-x:auto;margin:0 0 12px;position:relative;
    box-shadow:0 1px 0 rgba(255,255,255,.03) inset}
  pre code{font-size:13.5px;color:var(--fg2);white-space:pre}
  .copy{position:absolute;top:10px;right:10px;font-size:12px;color:var(--fg2);
    background:var(--overlay);border:1px solid var(--border);border-radius:7px;padding:4px 10px;cursor:pointer}
  .copy:hover{color:var(--fg);border-color:var(--subtle)}
  .copy.done{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,var(--border))}

  .tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
  .grp{background:linear-gradient(180deg,rgba(14,15,19,.7),rgba(10,11,15,.7));
    border:1px solid var(--border-faint);border-radius:13px;padding:15px 16px;
    transition:border-color .15s,transform .15s}
  .grp:hover{border-color:var(--border);transform:translateY(-2px)}
  .grp h4{margin:0 0 9px;font-size:13px;color:var(--story);font-weight:700}
  .grp ul{list-style:none;margin:0;padding:0}
  .grp li{display:flex;flex-direction:column;margin:0 0 8px}
  .grp li code{font-size:12.5px;color:var(--primary-2)}
  .grp li span{font-size:12px;color:var(--muted);line-height:1.35}

  footer{margin-top:56px;padding-top:22px;border-top:1px solid var(--border-faint);
    color:var(--subtle);font-size:13.5px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}

  @media (prefers-reduced-motion:reduce){.hero::after,.eyebrow .pulse{animation:none}.btn,.grp{transition:none}}
</style>
</head>
<body>
<main class="wrap">
  <section class="hero">
    <p class="eyebrow"><span class="pulse"></span>Synek · MCP server</p>
    <h1>Connect a client.<br>Build a timeline.</h1>
    <p class="lede">You've reached a <strong>machine-to-machine MCP endpoint</strong> — not a page. Point your MCP client (Claude&nbsp;Code, Claude&nbsp;Desktop, or any client) at it, and the model on the other end builds a temporally-anchored knowledge canvas for you.</p>
    <div class="cta">
      <a class="btn btn-primary" href="${esc(origin)}/api-keys">${keySvg}Get an API key</a>
      <a class="btn btn-ghost" href="${REPO_URL}" target="_blank" rel="noopener">${bookSvg}Docs</a>
      <a class="btn btn-link" href="?format=json">JSON for agents →</a>
    </div>
  </section>

  <h2>Endpoint</h2>
  <div class="endpoint"><span class="m">POST</span><code>${esc(endpoint)}</code><button class="copy">Copy</button></div>
  <p class="tip">Auth: <code>Authorization: Bearer YOUR_TOKEN</code> · Transport: stateless Streamable&nbsp;HTTP · OAuth-capable clients are pointed at the protected-resource metadata automatically.</p>

  <h2>Connect a client</h2>
  <div class="tabs" role="tablist" aria-label="Connection method">${tabs}</div>
  ${panels}

  <h2>What your model can do here</h2>
  <div class="tools">${toolGrid()}</div>

  <footer>
    <span>Synek · the Chronograph knowledge canvas</span>
    <span><a href="${esc(origin)}">Open the app →</a> · <a href="${REPO_URL}" target="_blank" rel="noopener">Docs</a> · <a href="?format=json">JSON</a></span>
  </footer>
</main>
<script>
document.querySelectorAll('.copy').forEach(function(b){
  b.addEventListener('click',function(){
    var t=b.parentElement.querySelector('code').innerText;
    navigator.clipboard.writeText(t).then(function(){
      b.textContent='Copied';b.classList.add('done');
      setTimeout(function(){b.textContent='Copy';b.classList.remove('done')},1600);
    });
  });
});
(function(){
  var tabs=[].slice.call(document.querySelectorAll('.tab'));
  function select(t){
    tabs.forEach(function(x){
      var on=x===t;
      x.setAttribute('aria-selected',on?'true':'false');
      x.tabIndex=on?0:-1;
    });
    document.querySelectorAll('.panel').forEach(function(p){p.hidden=p.dataset.panel!==t.dataset.panel});
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(){select(t)});
    t.addEventListener('keydown',function(e){
      var n;
      if(e.key==='ArrowRight'||e.key==='ArrowDown')n=tabs[(i+1)%tabs.length];
      else if(e.key==='ArrowLeft'||e.key==='ArrowUp')n=tabs[(i-1+tabs.length)%tabs.length];
      if(n){e.preventDefault();select(n);n.focus();}
    });
  });
})();
</script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
  })
}

export function mcpLandingResponse(request: Request): Response {
  const url = new URL(request.url)
  const accept = request.headers.get('accept') ?? ''
  const format = url.searchParams.get('format')

  // An MCP client opening a GET SSE stream. This stateless transport is POST-only,
  // so answer per spec with 405 + Allow, not the HTML page.
  if (accept.includes('text/event-stream')) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'This MCP server uses stateless Streamable HTTP. Send JSON-RPC over POST; GET SSE streams are not supported.',
        },
      }),
      { status: 405, headers: { 'content-type': 'application/json', allow: 'POST' } },
    )
  }

  if (format === 'html') return htmlResponse(request)
  if (format === 'json') return jsonResponse(request)
  // Default: HTML only for clients that actually asked for it (browsers); agents,
  // curl (Accept: */*), and JSON clients get the descriptor.
  return accept.includes('text/html') ? htmlResponse(request) : jsonResponse(request)
}
