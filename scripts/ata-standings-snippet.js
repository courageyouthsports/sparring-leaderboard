// Copies ATA state standings (sparring + combat weapons) into an import script for supabase import_standings().
//
// How to use (once a season, or whenever you want fresh head starts):
//   1. Sign in at atamartialarts.com, open MyATA > Tournament Standings > State Standings, and click your state.
//   2. Open the browser console (View > Developer > JavaScript Console), paste this whole file, press Enter.
//   3. Wait for "Ready", click "Copy import script", paste it into Supabase > SQL Editor > New query, and Run.
//
// The standings are ATA's data and include minors' names: keep the result in your own database only.
(async () => {
  const STATE = new URLSearchParams(location.search).get('state')?.toUpperCase() || 'IN';
  const now = new Date();
  const season = now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() > 24)
    ? `${now.getFullYear()}-${String((now.getFullYear() + 1) % 100).padStart(2, '0')}`
    : `${now.getFullYear() - 1}-${String(now.getFullYear() % 100).padStart(2, '0')}`;
  const links = [...new Set([...document.querySelectorAll('a')].filter((a) => /^view$/i.test(a.textContent.trim())).map((a) => a.href))];
  if (!links.length) { alert('Open a state’s standings page first (the one with the VIEW links).'); return; }
  const rows = [];
  let done = 0;
  const one = async (href) => {
    const html = await fetch(href, { credentials: 'include' }).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const t of doc.querySelectorAll('table')) {
      const ul = t.parentElement?.previousElementSibling;
      if (!ul || ul.tagName !== 'UL') continue;
      const [ev, who, rank, age] = [...ul.querySelectorAll('li')].map((li) => li.textContent.trim().replace(/\s+/g, ' '));
      const e = (ev || '').toUpperCase();
      if ((e !== 'SPARRING' && e !== 'COMBAT WEAPONS') || /special abilities/i.test(rank)) continue;
      for (const tr of [...t.rows].slice(1)) {
        const c = [...tr.cells].map((td) => td.textContent.trim().replace(/\s+/g, ' '));
        if (c.length >= 4 && /^\d+$/.test(c[0])) {
          rows.push({ event: e === 'SPARRING' ? 'S' : 'C', gender: who.toUpperCase(), rank, age, place: Number(c[0]), name: c[1], points: Number(c[2]), city: c[3] });
        }
      }
    }
    console.log(`standings: ${++done}/${links.length}`);
  };
  for (let i = 0; i < links.length; i += 4) await Promise.all(links.slice(i, i + 4).map(one));

  const sql = `-- ${STATE} state standings, ${season} season (sparring and combat weapons), copied from MyATA on ${now.toLocaleDateString()}.\n`
    + '-- Run AFTER the latest supabase/schema.sql. Private: keep this in your own database only.\n'
    + `select public.import_standings((select id from public.orgs order by created_at limit 1), '${STATE}', '${season}', $json$${JSON.stringify(rows)}$json$::jsonb);\n`;
  const wrap = document.createElement('main');
  wrap.style.cssText = 'font:16px system-ui;max-width:900px;margin:30px auto;padding:0 16px';
  wrap.innerHTML = `<h1>Ready: ${rows.length} placements</h1><p>Click Copy, then paste into Supabase SQL Editor and Run.</p>`;
  const btn = document.createElement('button');
  btn.textContent = 'Copy import script';
  btn.style.cssText = 'font:600 18px system-ui;padding:12px 20px;background:#C8223A;color:#fff;border:0;border-radius:8px';
  btn.onclick = async () => { await navigator.clipboard.writeText(sql); btn.textContent = 'Copied'; };
  wrap.append(btn);
  document.body.replaceChildren(wrap);
})();
