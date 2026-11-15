// Uses Starhop in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Add a word to run only the checks whose names contain it:  node test/e2e.mjs offline
// The sky depends on the place and the date, so the checks pin both: a saved location and Playwright's clock.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// The server answers the way GitHub Pages does: a browser may keep each file for ten minutes, and asks again by its
// ETag. `net` is the connection: 'up', 'down' (the server drops every connection) or 'stalled' (a dark site with one
// bar of signal, a captive wifi: it takes each request and holds on to it). With `release` set it serves the next
// release, in which every file has changed (see the first check).
let net = 'up', release = false;
const held = [];
const server = createServer((req, res) => {
  if (net === 'down') { req.socket.destroy(); return; }
  if (net === 'stalled') { held.push([req, res]); return; }
  serve(req, res);
}).listen(0);
const letGo = () => { net = 'up'; for (const [req, res] of held.splice(0)) serve(req, res); };
async function fileFor(path) {
  if (path.endsWith('/')) path += 'index.html';
  let body = await readFile(join(root, path));
  if (release) {
    if (path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
    else if (path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
    else body = Buffer.concat([body, Buffer.from('\n')]);
  }
  return { body, etag: `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"` };
}
async function serve(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  try { file = await fileFor(path); } catch { res.writeHead(404); res.end(); return; }
  const head = { etag: file.etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
  if (req.headers['if-none-match'] === file.etag) { res.writeHead(304, head); res.end(); return; }
  res.writeHead(200, head);
  res.end(file.body);
}
const base = `http://localhost:${server.address().port}/`;

const AUSTIN = { name: 'Austin, TX', lat: 30.27, lon: -97.74, tz: 'America/Chicago' };
const browser = await pw.chromium.launch();

// Opens Starhop at phone size (or desktop) with a saved location, or a raw save, and the clock set to `time`.
// Anything the page asks of another site is refused and listed in `outside`.
async function open({ loc = AUSTIN, save, time, tz, phone = true, sw = false, reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale: 'en-US',
    timezoneId: tz || (loc && loc.tz) || 'America/Chicago', serviceWorkers: sw ? 'allow' : 'block', reducedMotion,
  });
  const problems = [], outside = [];
  await ctx.route(url => !url.href.startsWith(base), route => { outside.push(route.request().url()); route.abort(); });
  const value = save !== undefined ? save : loc ? JSON.stringify({ loc }) : null;
  if (value !== null) {
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, ['starhop.v1', value]);
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(e.message));
  // A refused request to another site shows up as a console error too; `outside` already has those.
  page.on('console', m => { if (m.type() === 'error' && (m.location().url || base).startsWith(base)) problems.push(m.text()); });
  if (time) await page.clock.install({ time: new Date(time) });
  await page.goto(base);
  await ready(page);
  return { ctx, page, problems, outside };
}
const ready = page => page.waitForFunction(() => document.querySelector('#keys').children.length > 0 || /couldn|wrong/.test(document.querySelector('#tonightSec').textContent), null, { timeout: 90000 });
const text = (page, sel) => page.$eval(sel, el => el.innerText.replace(/\s+/g, ' ').trim());
const sheetOpen = page => page.$eval('#sheet', el => !el.hidden);
const fontsLoaded = page => page.evaluate(async () => { await document.fonts.ready; return [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')))].sort(); });
const FONTS = ['Atkinson Hyperlegible', 'DM Mono', 'IM Fell English'];
// Waits until an element's text matches, since the map redraws on the next frame.
const until = (page, sel, re) => page.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s).innerText.replace(/\s+/g, ' ').trim()), [sel, re.source], { timeout: 15000 }).catch(() => {});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('opens on tonight, lists targets, opens a card and fits a phone', async () => {
  const { ctx, page, problems, outside } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    assert.match(await text(page, '#nightTitle'), /^Tonight · Tue, Oct 13$/);
    assert.deepEqual(await fontsLoaded(page), FONTS, 'its own fonts load');
    assert.match(await text(page, '#keys'), /Sunset \d+:\d\d pm/);
    assert.equal(await page.$eval('#tonightSec h2', h => h.textContent), 'Tonight Austin, TX');
    assert.ok(await page.$$eval('#targetSec .row', r => r.length) >= 10, 'the target list fills in');
    await page.click('#targetSec .row');
    assert.ok(await sheetOpen(page), 'a tap on a target opens its card');
    assert.ok((await text(page, '#sheet .hd h2')).length > 2, 'the card has a name');
    assert.match(await text(page, '#sheet'), /In your telescope/i);
    await page.click('#sheet [data-close]');
    assert.equal(await sheetOpen(page), false, 'Done closes the card');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');
    assert.deepEqual(problems, [], 'no errors');
    assert.deepEqual(outside, [], 'nothing loads from another site');
  } finally { await ctx.close(); }
});

// The server goes down as well as the browser: in some Chromium builds the browser's offline switch alone doesn't stop
// the service worker's own requests, and an offline check passed with no copy at all.
check('the installed copy opens with the server down, opens quickly on a stalled connection, and takes a release whole', async () => {
  const { ctx, page, problems, outside } = await open({ time: '2026-10-13T21:00:00-05:00', sw: true });
  try {
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
    net = 'down';
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    assert.match(await text(page, '#keys'), /Sunset/, 'it works offline once it has loaded');
    assert.deepEqual(await fontsLoaded(page), FONTS, 'with its fonts');
    await openCard(page, 'M13');
    assert.match(await text(page, '#sheet'), /In your telescope/i, 'a card opens offline');
    await page.click('#sheet [data-close]');
    await page.click('#scopeBtn');
    assert.ok(await page.$('#scAp'), 'the telescope sheet opens offline');
    await page.keyboard.press('Escape');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await page.waitForFunction(() => /Tucson/.test(document.getElementById('lres').textContent), null, { timeout: 10000 })
      .catch(() => assert.fail('a town search finds Tucson offline'));
    await page.keyboard.press('Escape');
    await ctx.setOffline(false);

    // On a connection that's up but not answering, it opens from the copy after the worker's few seconds' wait for
    // the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't open).
    net = 'stalled';
    const t0 = Date.now();
    await page.reload({ timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('#keys')?.children.length > 0, null, { timeout: 10000 - (Date.now() - t0) }).catch(() => {});
    const took = Date.now() - t0;
    assert.ok(took < 8000, `the page took ${took} ms to open on a stalled connection`);
    assert.match(await text(page, '#keys'), /Sunset/, 'it opens on a stalled connection');
    letGo();

    // A new release: every file in the new copy comes from the server, though the browser still has its own copies of
    // the old ones for ten minutes. (Every file changes, and so FILES in sw.js, as in a real release.)
    release = true;
    const shell = await shellList();
    const want = {};
    for (const f of shell) want[f] = (await fileFor('/' + (f === './' ? '' : f))).etag;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const stale = () => page.evaluate(async want => {
      const out = [];
      for (const f in want) { const r = await caches.match(f); if (!r || r.headers.get('etag') !== want[f]) out.push(f); }
      return out;
    }, want);
    for (const end = Date.now() + 15000; (await stale()).length && Date.now() < end;) await page.waitForTimeout(200);
    assert.deepEqual(await stale(), [], "the new release's offline copy kept these files from the old one");
    release = false;
    assert.deepEqual(problems, [], 'no errors offline');
    assert.deepEqual(outside, []);
  } finally { letGo(); release = false; await ctx.close(); }
});

// The files sw.js keeps for offline, as its SHELL lists them.
const shellList = async () => [...(await readFile(join(root, 'sw.js'), 'utf8')).match(/const SHELL = \[([\s\S]*?)\];/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);

check('the offline copy lists files that exist, fonts included', async () => {
  const list = (await shellList()).filter(f => f !== './');
  for (const f of list) await readFile(join(root, f)).catch(() => assert.fail(`sw.js keeps ${f}, which doesn't exist`));
  const fonts = (await readFile(join(root, 'index.html'), 'utf8')).match(/fonts\/[\w-]+\.woff2/g) || [];
  assert.ok(fonts.length, 'the page uses fonts from fonts/');
  for (const f of fonts) assert.ok(list.includes(f), `sw.js doesn't keep ${f} for offline use`);
});

// An installed copy is downloaded whole again only when sw.js changes, so sw.js changes whenever a file it keeps does:
// FILES in sw.js is a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read
// as its index.html; the first 8 hex of the sha1 of those).
check('sw.js changes whenever a file it keeps for offline does', async () => {
  const all = createHash('sha1');
  for (const f of await shellList()) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
  const files = all.digest('hex').slice(0, 8);
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
});

// Austin, Wednesday Oct 14 2026: sunrise is 7:32 am, so the night that is ending runs until 8:22 am.
check('a morning moves on to the coming night, and stays on it past noon', async () => {
  let { ctx, page, problems } = await open({ time: '2026-10-14T08:15:00-05:00' });
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Tue, Oct 13', 'the night is still going on at 8:15');
    assert.equal(await page.$eval('#nowBtn', b => b.classList.contains('on')), true);
    await page.clock.fastForward('10:00'); // the 30-second clock passes 8:22
    await until(page, '#when', /pm Wed, Oct 14$/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    assert.match(await text(page, '#when'), /pm Wed, Oct 14$/, 'the map moves to tonight once it is dark');
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-14T08:30:00-05:00' }));
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    assert.equal(await page.$eval('#tonightSec h2', h => h.firstChild.textContent.trim()), 'Tonight');
    assert.match(await text(page, '#when'), /pm Wed, Oct 14$/);
    await page.click('#nowBtn');
    await until(page, '#when', /Now/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14', 'Now keeps tonight');
    assert.equal(await text(page, '#when'), '8:30 am Now · Wed, Oct 14');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-14T11:59:00-05:00' }));
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    await page.clock.fastForward('02:30');
    await page.waitForTimeout(300);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14', 'still tonight after noon');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The times under the timeline, by name: { Sunset: '7:01 pm', Dark: '8:21 pm', ... }
const keys = page => page.$$eval('#keys span', s => Object.fromEntries(s.map(x => [x.firstChild.textContent.trim(), x.querySelector('b').textContent])));
const TROMSO = { name: 'Tromsø, NO', lat: 69.65, lon: 18.96, tz: 'Europe/Oslo' };

check('fully dark and the verdict use the same twilight and moonset times as the keys', async () => {
  for (const [loc, time] of [[AUSTIN, '2026-10-13T21:00:00-05:00'], [TROMSO, '2026-10-13T21:00:00+02:00'], [TROMSO, '2026-12-15T21:00:00+01:00']]) {
    const { ctx, page } = await open({ loc, time });
    try {
      const k = await keys(page), where = loc.name + ' ' + time;
      assert.equal(await text(page, '#tonightSec .fact.wide b'), k.Dark + ' – ' + k.Dawn, 'fully dark, ' + where);
      const lede = await text(page, '#tonightSec .lede');
      if (k.Moonset && /Moon down/.test(lede)) assert.match(lede, new RegExp('from ' + k.Moonset + ' to ' + k.Dawn), 'moonless hours, ' + where);
    } finally { await ctx.close(); }
  }
});

// At Tromsø the Sun doesn't set from late May to late July, and doesn't rise from late November to mid January.
check('under the midnight sun the banner and the verdict say the Sun doesn’t set', async () => {
  let { ctx, page, problems } = await open({ loc: TROMSO, time: '2026-06-21T23:30:00+02:00' });
  try {
    await until(page, '#banner', /Sun/);
    assert.equal(await page.$eval('#banner', b => b.hidden), false);
    assert.equal(await text(page, '#banner'), 'The Sun doesn’t set tonight', 'no hint to drag along a night that isn’t there');
    assert.match(await text(page, '#tonightSec .lede'), /^The Sun doesn’t set tonight/);
    assert.equal(await text(page, '#tonightSec .fact.wide em'), 'The Sun doesn’t set tonight');
    assert.doesNotMatch(await text(page, '#tonightSec'), /18°/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ loc: TROMSO, time: '2026-12-15T21:00:00+01:00' }));
  try {
    assert.doesNotMatch(await text(page, '#tonightSec'), /doesn’t set/, 'polar night has no sunset either');
    assert.equal(await page.$eval('#banner', b => b.hidden), true);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Austin, Oct 13 2026: the Sun sets at 7:01 pm and is 6° down by 7:28.
check('stars come out steadily through dusk', async () => {
  const dusk = Date.parse('2026-10-13T19:00:00-05:00');
  const { ctx, page } = await open({ time: dusk });
  try {
    const counts = [];
    for (let m = 5; m <= 40; m += 5) {
      await page.clock.pauseAt(new Date(dusk + m * 60e3));
      await page.click('#nowBtn');
      await page.clock.runFor(100); // the map redraws on the next frame
      counts.push(await page.evaluate(() => document.getElementById('sky').__hits().filter(h => h.obj.k === 'star').length));
    }
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], 'stars drawn every 5 minutes from 7:05 pm: ' + counts.join(', '));
  } finally { await ctx.close(); }
});

const DOB8 = { name: '8″ Dobsonian', ap: 203, fl: 1200, eps: [{ f: 25, a: 52 }, { f: 6, a: 52 }], set: true };
const openCard = async (page, id) => {
  if (!await page.$(`#targetSec .row[data-id="${id}"]`) && await page.$('#moreT')) await page.click('#moreT');
  await page.click(`#targetSec .row[data-id="${id}"]`);
  await page.waitForFunction(() => !document.getElementById('sheet').hidden);
};

// At 6 am on Oct 14 2026 PyEphem, with its own moon theory, puts Io 0.70′ east of Jupiter and Europa 0.50′.
check("Jupiter's moons are drawn where they're seen, allowing for light time", async () => {
  const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: DOB8 }), time: '2026-10-14T06:00:00-05:00' });
  try {
    await openCard(page, 'Jupiter');
    await page.waitForFunction(() => document.getElementById('eyepiece').__moons, null, { timeout: 10000 });
    const m = await page.$eval('#eyepiece', c => c.__moons), ref = { io: 0.70, europa: 0.50, ganymede: -2.11, callisto: 0.79 };
    for (const k in ref) assert.ok(Math.abs(m[k].east - ref[k]) < 0.05, `${k} is drawn ${m[k].east.toFixed(2)}′ east of Jupiter; it's ${ref[k]}′`);
    // Io, Europa and Callisto are within 0.3′ of each other, so their letters have to make room.
    const tags = Object.keys(ref).map(k => [k, m[k].tag]);
    for (const [k, t] of tags) assert.ok(t, `${k} has its letter`);
    tags.forEach(([a, ta], i) => tags.slice(i + 1).forEach(([b, tb]) => assert.ok(!overlaps(ta, tb), `the letters of ${a} and ${b} overlap`)));
  } finally { await ctx.close(); }
});

// Every label on a chart is inside it, apart from the others, and off the boxes kept clear.
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const checkLabels = (labels, w, h, keep, where) => {
  assert.ok(labels.length > 3, where + ': labels are drawn');
  for (const l of labels) assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= w && l.y + l.h <= h, `${where}: "${l.t}" runs off the edge`);
  labels.forEach((a, i) => labels.slice(i + 1).forEach(b => assert.ok(!overlaps(a, b), `${where}: "${a.t}" and "${b.t}" overlap`)));
  for (const l of labels) for (const k of keep) assert.ok(!overlaps(l, k), `${where}: "${l.t}" is under ${k.what}`);
};
// The map's labels and compass letters, and the time, banner and buttons over it, which they keep 2px clear of.
const mapLabels = page => page.evaluate(() => {
  const c = document.getElementById('sky'), r = c.getBoundingClientRect();
  const keep = ['when', 'nowBtn', 'banner', 'layBtn', 'dirSeg', 'ptBtn', 'zOut', 'zIn'].map(id => [id, document.getElementById(id).getBoundingClientRect()]).filter(([, b]) => b.width).map(([id, b]) => ({ what: '#' + id, x: b.left - r.left - 2, y: b.top - r.top - 2, w: b.width + 4, h: b.height + 4 }));
  return { labels: c.__labels(), w: r.width, h: r.height, keep };
});
const finderLabels = page => page.$eval('#finder', c => { const r = c.getBoundingClientRect(); return { labels: c.__labels, w: r.width, h: r.height, keep: [Object.assign({ what: 'the stamp' }, c.__stamp)] }; });

check('chart labels stay inside, keep apart, keep off the map’s buttons and the finder’s stamp, and go over the ground', async () => {
  // On a phone at 7:10 pm on Oct 13, facing west puts M11 under the time, M17 under Now and the Cat's Eye under Show,
  // and facing north puts M13 under the time. At 8:50 Capella sits under the time in the whole-sky view.
  let { ctx, page, problems } = await open({ time: '2026-10-13T19:10:00-05:00' });
  try {
    for (const [d, at] of [['270', '7:10'], ['0', '7:10'], ['up', '8:50']]) {
      if (at === '8:50') { await page.clock.pauseAt(new Date('2026-10-13T20:50:00-05:00')); await page.click('#nowBtn'); await page.clock.runFor(100); }
      await page.click(`#dirSeg button[data-d="${d}"]`);
      await page.waitForTimeout(150);
      const { labels, w, h, keep } = await mapLabels(page);
      checkLabels(labels, w, h, keep, `phone map at ${at} facing ${d}`);
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // From Chicago at 9:15 pm on Oct 16 the NE on the horizon falls against the Now button.
  ({ ctx, page, problems } = await open({ loc: { name: 'Chicago, IL', lat: 41.85, lon: -87.65, tz: 'America/Chicago' }, time: '2026-10-16T21:15:00-05:00' }));
  try {
    await page.waitForFunction(() => document.getElementById('sky').__labels().length > 3);
    const { labels, w, h, keep } = await mapLabels(page);
    assert.ok(['N', 'E', 'S', 'W'].some(d => labels.some(l => l.t === d)), 'the compass letters are counted with the labels');
    checkLabels(labels, w, h, keep, 'phone map from Chicago');
    // Italic constellation names lean past their width, so ARIES and ANDROMEDA used to run together into one word.
    for (const c of labels.filter(l => /\u200a/.test(l.t))) for (const l of labels) if (l !== c && c.y < l.y + l.h && l.y < c.y + c.h) {
      const gap = Math.max(l.x - (c.x + c.w), c.x - (l.x + l.w));
      assert.ok(gap >= 6, `"${c.t}" and "${l.t}" are only ${gap.toFixed(1)}px apart`);
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false }));
  try {
    await page.waitForFunction(() => document.getElementById('sky').__labels().length > 3);
    const { labels, w, h, keep } = await mapLabels(page);
    checkLabels(labels, w, h, keep, 'desktop map');
    // Arcturus is just above the western horizon, and its label used to vanish under the ground
    const lit = await page.evaluate(() => {
      const c = document.getElementById('sky'), l = c.__labels().find(x => x.t === 'Arcturus'), k = c.width / c.getBoundingClientRect().width;
      if (!l) return -1;
      const d = c.getContext('2d').getImageData(Math.round(l.x * k), Math.round(l.y * k), Math.round(l.w * k), Math.round(l.h * k)).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 420) n++;
      return n;
    });
    assert.ok(lit > 10, 'Arcturus’s label shows over the ground (' + lit + ' bright pixels)');
    await openCard(page, 'M13');
    await page.waitForFunction(() => document.getElementById('finder').__labels);
    const f = await finderLabels(page);
    checkLabels(f.labels, f.w, f.h, f.keep, 'M13’s finder chart');
    const rut = f.labels.find(l => l.t === 'Rutilicus');
    assert.ok(rut, 'Rutilicus, where the star-hop starts, keeps its label beside the target’s ring');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // From Sydney, Omega Centauri's chart has Rigil Kentaurus near its right edge and two stars by the stamp.
  ({ ctx, page, problems } = await open({ loc: { name: 'Sydney, AU', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' }, time: '2026-04-15T22:00:00+10:00' }));
  try {
    await openCard(page, 'NGC 5139');
    await page.waitForFunction(() => document.getElementById('finder').__labels);
    const f = await finderLabels(page);
    checkLabels(f.labels, f.w, f.h, f.keep, 'Omega Centauri’s finder chart');
    const rk = f.labels.find(l => l.t === 'Rigil Kentaurus');
    assert.ok(rk && rk.x + rk.w <= rk.ax, 'Rigil Kentaurus is labelled on the left of its star, near the right edge');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// How much of a small patch of the map, centred at a fraction of its width and height, is the ground's colour.
// Night vision's ground is (18, 2, 1) and its sky (11, 1, 1) to (22, 0, 0) by the Milky Way, so it's matched more closely.
const GROUND = [10, 15, 11], GROUND_RED = [18, 2, 1];
const groundAt = (page, fx, fy, rgb = GROUND) => page.$eval('#sky', (c, [fx, fy, rgb]) => {
  const tol = rgb[1] < 5 ? 1 : 3;
  const x = Math.round(c.width * fx), y = Math.round(c.height * fy), d = c.getContext('2d').getImageData(x - 4, y - 4, 9, 9).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) n++;
  return n / (d.length / 4);
}, [fx, fy, rgb]);

// Facing a direction on a phone, the corner of the map is less than 73° from its centre, and the points the horizon was
// drawn through were 73° away, so they were all dropped and neither the ground nor the horizon line was drawn.
check('the ground shows when a phone faces south', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await page.click('#dirSeg button[data-d="180"]');
    await page.waitForTimeout(150);
    assert.ok(await groundAt(page, 0.5, 0.97) > 0.8, 'the foot of the map facing south is the ground');
    assert.ok(await groundAt(page, 0.5, 0.2) < 0.2, 'and the top of it is sky');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // Zoomed in to about 44° near the horizon on a desktop
  ({ ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false }));
  try {
    await page.click('#dirSeg button[data-d="180"]');
    for (let i = 0; i < 3; i++) await page.click('#zIn');
    await page.focus('#sky');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    assert.ok(await groundAt(page, 0.5, 0.97) > 0.8, 'the foot of a zoomed-in map is the ground');
    assert.ok(await groundAt(page, 0.5, 0.2) < 0.2, 'and the top of it is sky');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Point lets the view go 40° below the horizon. With the back of the phone 10° below it, the nadir was past the edge
// of the view and dropped, which read as "the ground is outside the horizon" and painted the whole sky as ground.
check('pointing a little below the horizon keeps the ground below and the stars above', async () => {
  for (const red of [false, true]) {
    const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, red }), time: '2026-11-15T21:00:00-06:00' });
    try {
      await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
      await page.click('#ptBtn');
      await page.waitForFunction(() => document.documentElement.classList.contains('pointing'));
      // alpha 90, beta 80: the back of the phone faces west, 10° below the horizon
      await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 90, beta: 80, gamma: 0, absolute: true })));
      await page.waitForTimeout(150);
      const rgb = red ? GROUND_RED : GROUND, mode = red ? ' in night vision' : '';
      assert.ok(await groundAt(page, 0.5, 0.25, rgb) < 0.2, 'above the horizon is sky' + mode);
      assert.ok(await groundAt(page, 0.5, 0.8, rgb) > 0.8, 'below the horizon is the ground' + mode);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

check('on a desktop an open card covers only the side panel', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#targetSec .row');
    assert.ok(await sheetOpen(page));
    const box = await page.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect(); return { s: [s.left, s.top, s.width], p: [p.left, p.top, p.width] }; });
    assert.deepEqual(box.s, box.p, 'the card sits exactly over the panel');
    for (const id of ['zIn', 'nextN', 'layBtn', 'nowBtn', 'redBtn', 'scopeBtn', 'locBtn']) {
      const onTop = await page.$eval('#' + id, el => { const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el.contains(hit); });
      assert.ok(onTop, `#${id} is under the card`);
    }
    await page.click('#scopeBtn');
    assert.match(await text(page, '#sheet .hd h2'), /^Your telescope/, 'the Telescope button still works with a card open');
  } finally { await ctx.close(); }
});

// On Android the installed app has only Back to close a card, and Back used to leave Starhop instead.
check('Back closes an open card or sheet, and closing one another way leaves no extra step behind', async () => {
  let { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForFunction(() => document.getElementById('sheet').hidden, null, { timeout: 5000 }).catch(() => {}); };
  const settled = () => page.waitForFunction(() => !history.state, null, { timeout: 5000 }).catch(() => {});
  try {
    const start = page.url(), steps = await page.evaluate(() => history.length);
    await page.click('#targetSec .row');
    await back();
    assert.equal(await sheetOpen(page), false, 'Back closes the card');
    assert.equal(page.url(), start, 'and stays in Starhop');
    assert.match(await text(page, '#keys'), /Sunset/);
    for (const how of ['Done', 'the backdrop', 'Escape', 'Back']) {
      await page.click('#targetSec .row');
      if (how === 'Done') await page.click('#sheet [data-close]');
      else if (how === 'the backdrop') await page.mouse.click(195, 20); // above the card
      else if (how === 'Escape') await page.keyboard.press('Escape');
      else await back();
      await settled();
      assert.equal(await sheetOpen(page), false, how + ' closes the card');
      assert.equal(await page.evaluate(() => history.length), steps + 1, 'closing with ' + how + ' takes the card’s step off again');
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false }));
  try {
    const steps = await page.evaluate(() => history.length);
    await openCard(page, 'M13');
    await page.click('#scopeBtn');
    await page.click('#sheet .hd [data-close]'); // the telescope sheet took the card's place, on the same step
    await settled();
    assert.equal(await sheetOpen(page), false);
    assert.equal(await page.evaluate(() => history.length), steps + 1, 'one step for the card and the sheet that replaced it');
    await openCard(page, 'M13');
    await page.click('#locBtn');
    await back();
    assert.equal(await sheetOpen(page), false, 'Back closes the sheet that replaced a card');
    await page.click('#scopeBtn');
    await page.click('#scSave');
    await settled();
    assert.equal(await page.evaluate(() => history.length), steps + 1, 'Save takes the step off too');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// On a desktop a click beside the sheet doesn't close it, so it needs a way out that doesn't save.
check('the telescope sheet closes with Cancel, which drops the changes', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#scopeBtn');
    await page.fill('#scAp', '254');
    await page.click('#nightTitle');
    assert.ok(await sheetOpen(page), 'a click beside the sheet leaves it open');
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await sheetOpen(page), false, 'Cancel closes the sheet');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).scope), undefined, 'nothing is saved');
    assert.match(await text(page, '#targetSec .note'), /^Ratings assume an example 130 mm reflector/, 'the example telescope is still the one rated for');
    assert.equal(await text(page, '#scopeName'), 'Telescope');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('an open card follows the time shown, and other sheets stay as they are', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  const cardAt = () => page.$eval('#sheet .card h3', h => h.textContent);
  const riseSet = () => page.$eval('#sheet .card p:not(.big)', p => p.textContent);
  try {
    const tl = await page.locator('#tlc').boundingBox(), at = f => page.mouse.click(tl.x + tl.width * f, tl.y + tl.height / 2);
    await openCard(page, 'M13');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await at(0.3);
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'Where you observe', 'a click on the timeline leaves the location sheet open');
    assert.equal(await page.inputValue('#lq'), 'Tucs');
    await page.keyboard.press('Escape');

    await openCard(page, 'M13');
    await at(0.55);
    assert.notEqual(await cardAt(page), 'At 9:00 pm');
    await page.click('#nowBtn');
    assert.equal(await cardAt(page), 'At 9:00 pm', 'the card follows Now');
    await page.focus('#tlc');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#sheet .card h3').textContent === 'At 10:00 pm', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await cardAt(page), 'At 10:00 pm', 'the card follows the timeline keys');
    const before = await riseSet();
    await page.click('#prevN');
    assert.notEqual(await riseSet(), before, 'the card follows the night shown');
  } finally { await ctx.close(); }
});

check("typed coordinates take a decimal comma and a real minus sign, and refuse what they can't read", async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const use = async (lat, lon) => { if (!await sheetOpen(page)) await page.click('#locBtn'); await page.fill('#lLat', lat); await page.fill('#lLon', lon); await page.click('#lUse'); };
    const saved = async () => { const l = await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).loc); return [l.lat, l.lon]; };
    await use('45,76', '4,84');
    assert.deepEqual(await saved(), [45.76, 4.84], 'decimal commas');
    await use('30.27', '−97.74');
    assert.deepEqual(await saved(), [30.27, -97.74], 'a real minus sign');
    await use('30.27', '97.74 W');
    assert.ok(await sheetOpen(page), '"97.74 W" is refused, not read as 97.74° east');
    assert.deepEqual(await saved(), [30.27, -97.74]);
  } finally { await ctx.close(); }
});

check('the location sheet can close before its list of places arrives', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    let release; const held = new Promise(r => { release = r; });
    await page.route('**/data/cities.json', async route => { await held; await route.continue(); });
    await page.click('#locBtn');
    await page.keyboard.press('Escape');
    const arrived = page.waitForResponse(r => r.url().endsWith('data/cities.json'));
    release();
    await arrived;
    await page.waitForTimeout(300);
    assert.equal(await sheetOpen(page), false);
    assert.deepEqual(problems, [], 'no errors once the places arrive');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await page.waitForFunction(() => /Tucson/.test(document.getElementById('lres').textContent), null, { timeout: 10000 });
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Chromium reports some zones by older names (Asia/Calcutta, America/Indianapolis, Europe/Kiev).
check('a first visit guesses the place from the time zone, older zone names too', async () => {
  for (const [zone, place] of [['Asia/Kolkata', 'Mumbai, IN'], ['America/Indiana/Indianapolis', 'Indianapolis, IN'], ['Europe/Kyiv', 'Kyiv, UA'], ['America/Phoenix', 'Phoenix, AZ']]) {
    const { ctx, page, problems } = await open({ loc: null, tz: zone, time: '2026-10-13T12:00:00Z' });
    try {
      assert.equal(await text(page, '#locName'), place, zone);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

check('a damaged or partial save still opens, keeps what makes sense, and is left as it was', async () => {
  const saves = [
    '{"loc":{"name":"Home"}}', '{"loc":{"name":"Home","lat":30.27,"lon":-97.74,"tz":"Mars/Olympus"}}',
    '{"loc":{"name":"Home","lat":"30.27","lon":"-97.74","tz":"America/Chicago"}}',
    '{"scope":null}', '{"seen":null}', '{"layers":"all"}', '{"sky":"moon"}', '{"ptOff":"x"}', '[1,2]', 'not json',
  ];
  for (const save of saves) {
    const { ctx, page, problems } = await open({ save, time: '2026-10-13T21:00:00-05:00' });
    try {
      assert.match(await text(page, '#keys'), /Sunset/, 'opens with ' + save);
      if (save.includes('"30.27"')) assert.equal(await text(page, '#locName'), 'Home', 'numbers written as text still count');
      await page.click('#targetSec .row');
      assert.ok(await sheetOpen(page), 'a card opens with ' + save);
      await page.click('#sheet [data-close]');
      await page.click('#scopeBtn');
      assert.ok(await sheetOpen(page), 'the telescope sheet opens with ' + save);
      assert.deepEqual(problems, [], save);
      assert.equal(await page.evaluate(() => localStorage.getItem('starhop.v1')), save, 'the save is left as it was');
    } finally { await ctx.close(); }
  }
  const noEyepieces = JSON.stringify({ loc: AUSTIN, scope: { name: 'Old', ap: 130, fl: 650, set: true } });
  const { ctx, page, problems } = await open({ save: noEyepieces, time: '2026-10-13T21:00:00-05:00' });
  try {
    await page.click('#targetSec .row');
    assert.match(await text(page, '#sheet'), /Add your eyepieces/, 'a telescope saved without eyepieces asks for them');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Where the lit pixels sit around the middle of the eyepiece view: mean offset in CSS pixels, + is west (right).
const litSide = page => page.$eval('#eyepiece', c => {
  const g = c.getContext('2d'), k = c.width / c.getBoundingClientRect().width, R = Math.round(14 * k), d = g.getImageData(c.width / 2 - R, c.height / 2 - R, 2 * R, 2 * R).data;
  let sx = 0, n = 0;
  for (let y = 0; y < 2 * R; y++) for (let x = 0; x < 2 * R; x++) { const i = (y * 2 * R + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { sx += x - R; n++; } }
  return n ? sx / n / k : 0;
});

// Oct 1 2026, 7:20 pm: Venus is a 14% crescent in the evening sky, so its lit side faces the Sun in the west.
check('Venus in the eyepiece is lit on the side facing the Sun', async () => {
  const scope = { name: '130 mm reflector', ap: 130, fl: 650, eps: [{ f: 25, a: 52 }, { f: 4, a: 52 }], set: true };
  const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope }), time: '2026-10-01T19:20:00-05:00' });
  try {
    await openCard(page, 'Venus');
    await page.waitForFunction(() => /163×/.test(document.getElementById('epCap').textContent));
    assert.ok(await litSide(page) > 1, 'the crescent is lit on its west side, toward the Sun');
  } finally { await ctx.close(); }
});

// Oct 1 2026 in Austin, by PyEphem: the Sun sets at 7:16 pm with Venus 10.4° up; by the end of civil twilight at
// 7:40 Venus is down to 5.9°, and it sets at 8:13.
check('an evening planet that only sinks is highest at sunset, not at the end of twilight', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-01T19:20:00-05:00' });
  try {
    await openCard(page, 'Venus');
    assert.match(await text(page, '#sheet .card .big'), /^10° up in the southwest/);
    assert.match(await page.$eval('#sheet .card p:not(.big)', p => p.textContent), /^Up at dusk · Sets 8:1\d pm · Highest at sunset \(10°\)$/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Oct 16 2026 in Austin, by PyEphem: the Sun sets at 6:58 pm with M13 58.9° up, civil twilight ends at 7:22 with M13
// at 54.0°, and at 11:55 pm M13 is 2.8° up, so its finder chart shows it at a better time.
check('a finder chart for something low shows it at nightfall, not in the sunset glow', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-16T23:55:00-05:00' });
  try {
    await openCard(page, 'M13');
    assert.match(await page.$eval('#sheet .card p:not(.big)', p => p.textContent), /Highest at sunset \(59°\)$/, 'the card counts its height from sunset');
    await page.waitForFunction(() => document.getElementById('finder').__stamp);
    assert.equal(await page.$eval('#finder', c => c.__stamp.t), 'Naked-eye view · 7:22 pm', 'the chart waits for the end of civil twilight');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The finder chart's caption, and the star names in its star-hop ("from η Her to Rutilicus", "beside Ankaa, on the way to …").
const hopCap = page => page.$eval('#finder', c => c.parentElement.querySelector('.cap').textContent);
const hopStars = cap => { const m = /(?:from|beside) (.+?)(?: to |, on the way to )(.+?)(?: \(a little off the line\))?\./.exec(cap) || /° from (.+?) —/.exec(cap); return m ? m.slice(1).filter(Boolean) : []; };
const CHICAGO = { name: 'Chicago, IL', lat: 41.85, lon: -87.65, tz: 'America/Chicago' };

// Of the 411 stars a star-hop can start or end at, 148 have only a Bayer or Flamsteed label, and the chart labelled only
// stars with a proper name, so M13's "from η Her" started at an unlabelled star.
check('the stars a star-hop names are labelled on its chart', async () => {
  for (const [loc, time, id, want] of [[CHICAGO, '2026-10-16T21:15:00-05:00', 'M13', ['η Her', 'Rutilicus']], [AUSTIN, '2026-10-13T21:00:00-05:00', 'albireo', ['γ Sge']]]) {
    const { ctx, page, problems } = await open({ loc, time });
    try {
      await openCard(page, id);
      await page.waitForFunction(() => document.getElementById('finder').__labels);
      const cap = await hopCap(page), names = hopStars(cap), labels = (await finderLabels(page)).labels.map(l => l.t);
      if (id === 'M13') assert.match(cap, /^Star-hop: About a third of the way from η Her to Rutilicus\./);
      for (const n of want) assert.ok(names.includes(n), `${id}'s star-hop names ${n}: ${cap}`);
      for (const n of names) assert.ok(labels.includes(n), `${id}'s chart labels ${n}, which its star-hop names (it has ${labels.join(', ')})`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// The Pleiades' hop started "Just beside Electra", a Pleiad 0.48° from the cluster's centre, and Vega's hopped to the
// fifth brightest star in the sky from Sheliak, at magnitude 3.5.
check('a cluster’s star-hop doesn’t start inside the cluster, and Vega needs no hop', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await openCard(page, 'M45');
    const cap = await hopCap(page);
    assert.match(cap, /^Star-hop: /);
    assert.doesNotMatch(cap, /Alcyone|Atlas|Electra|Maia|Merope|Taygeta|Pleione|Celaeno|Asterope/, 'the Pleiades’ star-hop names a Pleiad');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' }));
  try {
    await tapMap(page, 'star', await starIndex('Vega'));
    const cap = await hopCap(page);
    assert.doesNotMatch(cap, /Star-hop/, 'Vega’s card has a star-hop');
    assert.match(cap, /^One of the brightest stars in the sky/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// From Kamensk-Uralsky at 10 pm on Feb 1 2002, M3 is 10° up in the northeast and Arcturus is 2° below the horizon.
check('a star-hop starts from stars that are up', async () => {
  const { ctx, page, problems } = await open({ loc: { name: 'Kamensk-Uralsky, RU', lat: 56.42, lon: 61.94, tz: 'Asia/Yekaterinburg' }, time: '2002-02-01T22:00:00+05:00' });
  try {
    await openCard(page, 'M3');
    const cap = await hopCap(page);
    assert.match(cap, /^Star-hop: /);
    assert.doesNotMatch(cap, /Arcturus/, 'M3’s star-hop starts from Arcturus, below the horizon');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Each 5-minute sample of the Moon band was filled on its own, overlapping the next by 0.6 px, so the overlaps doubled up
// into stripes every few pixels.
check('the Moon’s band on the timeline is one even bar', async () => {
  const { ctx, page } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const row = await page.$eval('#tlc', c => { const k = c.width / c.getBoundingClientRect().width, d = c.getContext('2d').getImageData(0, Math.round(43 * k), c.width, 1).data, v = []; for (let i = 0; i < d.length; i += 4) v.push(d[i] + d[i + 1] + d[i + 2]); return v; });
    const lit = row.map((v, i) => [v, i]).filter(([v]) => v > 60), a = lit[0][1], b = lit[lit.length - 1][1];
    assert.ok(b - a > 100, 'the Moon is up for a while at the start of the night');
    const mid = row.slice(a + 4, b - 4);
    assert.ok(Math.max(...mid) - Math.min(...mid) <= 3, `the band runs from ${Math.min(...mid)} to ${Math.max(...mid)}`);
  } finally { await ctx.close(); }
});

// The finder chart's stamp had nothing behind it, so lines and markers ran through it. From New York at 8:30 pm on Nov 15
// a line of Andromeda crosses M31's stamp.
check('the finder chart’s stamp sits on a plate', async () => {
  const { ctx, page } = await open({ loc: { name: 'New York, NY', lat: 40.71, lon: -74.01, tz: 'America/New_York' }, time: '2026-11-15T20:30:00-05:00' });
  try {
    await openCard(page, 'M31');
    await page.waitForFunction(() => document.getElementById('finder').__stamp);
    const top = await page.$eval('#finder', c => {
      const k = c.width / c.getBoundingClientRect().width, s = c.__stamp, d = c.getContext('2d').getImageData(Math.round((s.x + 8) * k), Math.round((s.y + 1) * k), Math.round((s.w - 14) * k), Math.round(3 * k)).data;
      let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i] + d[i + 1] + d[i + 2]); return m;
    });
    // Under the plate even a white star comes out below 200 (r + g + b); without it the strip reaches 477.
    assert.ok(top < 200, `the strip above the stamp's words is dimmed (brightest ${top})`);
  } finally { await ctx.close(); }
});

// Seen from south of the equator the Moon is upside down to a northern observer, so a waxing Moon is lit on its left,
// as the sky map (which lights it from the Sun's direction) already drew it. The Tonight icon lit it on the right.
check('the Moon icon is lit on the left from Sydney when waxing', async () => {
  const { ctx, page } = await open({ loc: { name: 'Sydney, AU', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' }, time: '2026-11-19T21:30:00+11:00' });
  try {
    assert.match(await text(page, '#tonightSec .moonrow b'), /^Waxing gibbous/);
    const [left, right] = await page.$eval('#moonIc', c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = [0, 0];
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 500) n[(i / 4) % c.width < c.width / 2 ? 0 : 1]++;
      return n;
    });
    assert.ok(left > right, `lit pixels: ${left} on the left, ${right} on the right`);
  } finally { await ctx.close(); }
});

// Earth crossed Saturn's ring plane in March 2025 and has seen the rings' south face since, so the near arm crosses the
// northern half of the globe. Astronomy Engine 2.1.19's ring_tilt is +6.28° on Nov 15 2026, the opposite sign to the
// ring-plane latitude B worked out from the IAU pole (RA 40.589°, Dec 83.537°; Archinal et al. 2018), −6.27°. In Oct
// 2017 B was +27°, the north face.
check('Saturn’s rings show their south face in 2026', async () => {
  for (const [time, face] of [['2026-11-15T21:00:00-06:00', 'south'], ['2017-10-16T20:00:00-05:00', 'north']]) {
    const { ctx, page, problems } = await open({ time });
    try {
      await openCard(page, 'Saturn');
      await page.waitForFunction(() => document.getElementById('eyepiece').__ring, null, { timeout: 10000 }).catch(() => {});
      assert.equal(await page.$eval('#eyepiece', c => c.__ring), face, `the face of Saturn's rings shown on ${time.slice(0, 10)}`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

const advice = page => page.$$eval('#sheet .card', cs => cs.find(c => c.querySelector('h3').textContent === 'In your telescope').querySelector('p').textContent);

check('a card says an object is wider than the field only when it is', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const say = async id => { await openCard(page, id); const a = await advice(page); await page.click('#sheet [data-close]'); return a; };
    assert.equal(await say('M45'), 'At 1.8° across, it fills most of your lowest-power field (2.0°). Use the 25 mm, or try binoculars.');
    assert.match(await say('M31'), /^At 3\.2° across, it’s wider than your lowest-power field \(2\.0°\)\./);
    assert.match(await say('M57'), /^It spans 1′\. Find it with the 25 mm \(2\.0° field\), then try the 10 mm \(65×\) for a closer look\.$/);
  } finally { await ctx.close(); }
});

// Izar's stars are 3″ apart, which takes 80×. The example telescope's eyepieces reach 65×; the 8″ Dobsonian's reach 200×.
check('a double star is rated, advised and sketched by the same power, the one your eyepieces reach', async () => {
  for (const [save, label] of [[{ loc: AUSTIN }, 'Needs 80×'], [{ loc: AUSTIN, scope: DOB8 }, 'Easy split']]) {
    const { ctx, page, problems } = await open({ save: JSON.stringify(save), time: '2026-06-15T22:00:00-05:00' });
    try {
      const split = label === 'Easy split', who = save.scope ? 'the 8″ Dobsonian' : 'the example telescope';
      await page.click('#targetSec .filters [data-f="double"]');
      assert.equal(await page.$eval('#targetSec .row[data-id="izar"] .rate', el => el.textContent), label, 'the list, ' + who);
      await openCard(page, 'izar');
      assert.match(await advice(page), split ? /about 80× splits them, so start with the 6 mm \(200×\)\.$/ : /takes about 80×; your highest power is 65×\./, 'the card, ' + who);
      await page.waitForFunction(() => document.getElementById('epCap').textContent);
      (split ? assert.doesNotMatch : assert.match)(await text(page, '#epCap'), /not split at this power/, 'the eyepiece sketch, ' + who);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// Separate lit blobs within r px of the eyepiece view's centre.
const blobsNearCentre = (page, r) => page.$eval('#eyepiece', (c, r) => {
  const k = c.width / c.getBoundingClientRect().width, R = Math.round(r * k), x0 = Math.round(c.width / 2) - R, y0 = Math.round(c.height / 2) - R, n = 2 * R;
  const d = c.getContext('2d').getImageData(x0, y0, n, n).data, lit = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) lit[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] > 420 ? 1 : 0;
  let blobs = 0;
  for (let i = 0; i < n * n; i++) if (lit[i]) { blobs++; const st = [i]; lit[i] = 0; while (st.length) { const j = st.pop(), x = j % n, y = (j - x) / n; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy, q = yy * n + xx; if (xx >= 0 && yy >= 0 && xx < n && yy < n && lit[q]) { lit[q] = 0; st.push(q); } } } }
  return blobs;
}, r);

// The sketch draws a double's two stars wider apart than they look, 6 px either side of the centre at 26×, and the
// catalogue's own stars for the pair were drawn too, at their true 34″ (under 2 px), so Albireo showed a third dot
// between the two, touching the gold one.
check('Albireo’s eyepiece sketch shows two stars', async () => {
  const scope = { name: '130 mm reflector', ap: 130, fl: 650, eps: [{ f: 25, a: 52 }], set: true };
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope }), time: '2026-10-13T21:00:00-05:00' });
  try {
    await openCard(page, 'albireo');
    await page.waitForFunction(() => /25 mm/.test(document.getElementById('epCap').textContent));
    assert.equal(await blobsNearCentre(page, 20), 2, 'stars drawn at the centre of Albireo’s eyepiece view');
    assert.equal(await blobsNearCentre(page, 2), 0, 'a star drawn between the pair, where the catalogue has Albireo');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Taps an object on the sky map: a planet by name, or a star by its index in data/stars.json.
const tapMap = async (page, k, id) => {
  // The map draws a moment after the page is ready, so wait for the object to be on it.
  const hit = await page.waitForFunction(([k, id]) => document.getElementById('sky').__hits().find(h => h.obj.k === k && (h.obj.id === id || h.obj.i === id)), [k, id], { timeout: 10000 })
    .then(h => h.jsonValue(), () => null);
  assert.ok(hit, `${k} ${id} is on the map`);
  const box = await page.locator('#sky').boundingBox();
  await page.mouse.click(box.x + hit.x, box.y + hit.y);
  await page.waitForFunction(() => !document.getElementById('sheet').hidden);
};
// Taps the middle of a label on the sky map and returns the title of the card it opens.
const tapLabel = async (page, t) => {
  const l = await page.waitForFunction(t => document.getElementById('sky').__labels().find(l => l.t === t), t, { timeout: 10000 }).then(h => h.jsonValue(), () => null);
  assert.ok(l, `"${t}" is labelled on the map`);
  const box = await page.locator('#sky').boundingBox();
  await page.mouse.click(box.x + l.x + l.w / 2, box.y + l.y + l.h / 2);
  await page.waitForFunction(() => !document.getElementById('sheet').hidden);
  const title = await page.$eval('#sheet .hd h2', h => h.firstChild.textContent);
  await page.click('#sheet [data-close]');
  return title;
};

// Labels weren't tap targets, and a tap was scored only by distance, so the middle of "Saturn" opened γ Psc and "Vega"
// ν Her. A tap 10 px below Capella opened Almaaz, and an unnamed star's card was titled just "Star".
check('tapping a name on the map opens that object', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' }), { n, s: cat } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8'));
  try {
    for (const t of ['Saturn', 'Vega', 'Capella', 'Altair', 'Deneb', 'Moon']) assert.equal(await tapLabel(page, t), t === 'Moon' ? 'The Moon' : t, `tapping the label "${t}"`);
    // A tap between a bright star and a faint one 9 to 16 px away, a little nearer the faint one but not on it, picks the bright one.
    const box = await page.locator('#sky').boundingBox(), hits = await page.$eval('#sky', c => c.__hits());
    const stars = hits.filter(h => h.obj.k === 'star').map(h => Object.assign(h, { mag: cat[h.obj.i * 4 + 2] })), pairs = [];
    for (const a of stars.filter(h => h.mag < 1.5)) for (const b of stars.filter(h => h.mag > 3.5)) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 9 && d < 16) pairs.push([a, b, d]); }
    assert.ok(pairs.length >= 3, 'bright stars with faint neighbours on the map');
    for (const [a, b, d] of pairs.slice(0, 5)) {
      const f = Math.min(0.6, (d - 4.5) / d), x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      if (stars.some(h => h !== a && Math.hypot(h.x - x, h.y - y) < Math.max(4.5, h.r - 5))) continue; // right on another star
      await page.mouse.click(box.x + x, box.y + y);
      await page.waitForFunction(() => !document.getElementById('sheet').hidden);
      assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), n[a.obj.i][0], `a tap ${(d * f).toFixed(1)} px from ${n[a.obj.i][0]} toward a fainter star`);
      await page.click('#sheet [data-close]');
    }
    // deep-sky objects beside bright stars still open with a tap on their marks
    for (const id of ['M57', 'M45']) {
      await tapMap(page, 'dso', id);
      assert.match(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), new RegExp(id + '$'), 'a tap on ' + id);
      await page.click('#sheet [data-close]');
    }
    // a star with no name or label in the data
    const bare = hits.find(h => h.obj.k === 'star' && !(n[h.obj.i] && (n[h.obj.i][0] || n[h.obj.i][1])));
    assert.ok(bare, 'a star with no name is on the map');
    await page.mouse.click(box.x + bare.x, box.y + bare.y);
    await page.waitForFunction(() => !document.getElementById('sheet').hidden);
    assert.match(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), /^A magnitude \d\.\d star$/, 'an unnamed star’s card');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

const starIndex = async name => { const n = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')).n; return +Object.keys(n).find(i => n[i][0] === name); };
const starAt = async (ra, dec) => { const s = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')).s; for (let i = 0; i < s.length / 4; i++) if (s[i * 4] === ra && s[i * 4 + 1] === dec) return i; };

check('a star card says a star stays a point, not how wide it is', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    await tapMap(page, 'star', await starIndex('Vega'));
    assert.match(await text(page, '#sheet .hd h2'), /^Vega/);
    assert.equal(await advice(page), 'A star stays a point at any power. The 25 mm (2.0° field) shows it with the stars around it.');
  } finally { await ctx.close(); }
});

// d3-celestial calls ξ Sco only "Grafias", a name it also gives ζ2 Sco, so dropping that name left its card saying just "Star".
check('ξ Sco’s card names it', async () => {
  const { ctx, page, problems } = await open({ time: '2026-06-15T23:00:00-05:00' });
  try {
    await tapMap(page, 'star', await starAt(241.09, -11.37));
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'ξ Sco');
    assert.equal(await text(page, '#sheet .hd h2 small'), 'Star · ξ Sco · in Scorpius');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('the Moon card says the whole Moon fits only when it does', async () => {
  const c11 = { name: 'C11', ap: 280, fl: 2800, eps: [{ f: 25, a: 52 }, { f: 12, a: 52 }], set: true };
  let { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: c11 }), time: '2026-10-18T20:00:00-05:00' });
  try {
    await openCard(page, 'Moon');
    assert.match(await advice(page), /^The Moon \(30\.0′ across\) is wider than your lowest-power field \(28′\), so even the 25 mm shows part of it at a time\. At 233× with the 12 mm,/);
  } finally { await ctx.close(); }
  ({ ctx, page } = await open({ time: '2026-10-18T20:00:00-05:00' }));
  try {
    await openCard(page, 'Moon');
    assert.match(await advice(page), /^The whole Moon fits in the 25 mm eyepiece \(2\.0° field\)\./);
  } finally { await ctx.close(); }
});

check('a sheet takes the keyboard focus, has a name, and gives the focus back', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  const focusIn = sel => page.evaluate(s => document.querySelector(s).contains(document.activeElement), sel);
  try {
    const row = page.locator('#targetSec .row').first(), id = await row.getAttribute('data-id');
    await row.focus();
    await page.keyboard.press('Enter');
    assert.ok(await sheetOpen(page));
    assert.ok(await focusIn('#sheet'), 'the focus moves into the card');
    const title = await page.$eval('#sheet .hd h2', h => h.firstChild.textContent);
    assert.equal(await page.getByRole('dialog', { name: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).count(), 1, 'the card is named by its title');
    await page.keyboard.press('Tab');
    assert.ok(await focusIn('#sheet'), 'Tab stays in the card');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), id, 'closing gives the focus back to the row');
    assert.equal(await page.getByRole('button', { name: 'Location: Austin, TX' }).count(), 1, 'the location button is named with the place it shows');
  } finally { await ctx.close(); }
});

// Austin, Oct 13 2026, by the USNO convention (PyEphem): Saturn rises 6:37 pm and sets 6:48 am, Jupiter rises 2:58 am, Mars 1:58 am.
check('planet rise and set times match the standard ones', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    const times = async id => { await openCard(page, id); const t = await page.$eval('#sheet .card p:not(.big)', p => p.textContent); await page.keyboard.press('Escape'); return t; };
    assert.match(await times('Saturn'), /Rises 6:37 pm · Sets 6:48 am/);
    assert.match(await times('Jupiter'), /Rises 2:58 am/);
    assert.match(await times('Mars'), /Rises 1:58 am/);
  } finally { await ctx.close(); }
});

check('M40 and M73, which have no size, get no made-up size or cluster sketch', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    for (const id of ['M40', 'M73']) {
      await openCard(page, id);
      const size = await page.$$eval('#sheet .kv div', ds => ds.find(d => d.querySelector('span').textContent === 'Size').querySelector('b').textContent);
      assert.equal(size, '—', id + ' size');
      assert.equal(await advice(page), 'Find it with the 25 mm (2.0° field), then try the 10 mm (65×) for a closer look.', id + ' advice');
      await page.waitForFunction(() => document.getElementById('epCap').textContent);
      assert.doesNotMatch(await text(page, '#epCap'), /sketch/, id + ' has no cluster sketch');
      await page.keyboard.press('Escape');
    }
  } finally { await ctx.close(); }
});

// A star brighter than 4.6 can be tapped, and its card goes by its name or label, or "A magnitude 4.5 star" with neither. The build
// gives Bayer letters down to 4.5 and Flamsteed numbers down to 4.0, which leaves 126 tappable stars with no label (16 of
// them have neither in d3-celestial), so one more is a star that lost its only label, as ξ Sco did with "Grafias".
check('star labels in the data are all real designations, and no tappable star loses its label', async () => {
  const { s, n } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8'));
  assert.deepEqual(Object.entries(n).filter(([, v]) => v.some(x => /undefined/.test(x))), [], 'labels with "undefined" in them');
  const bare = [];
  for (let i = 0; i < s.length / 4; i++) if (s[i * 4 + 2] < 4.6 && !(n[i] && (n[i][0] || n[i][1]))) bare.push(i);
  assert.equal(bare.length, 126, 'tappable stars with no label');
  assert.deepEqual(n[await starAt(241.09, -11.37)], ['', 'ξ Sco', 'Sco'], 'ξ Sco (HIP 78727)');
});

// d3-celestial gave some traditional names to several stars: Markab to α Peg and κ1 Pup, Tarazed to γ and η Aql,
// Alnair to α Gru and ζ Cen, which put "Alnair" in Omega Centauri's star-hop.
check('each star name is on one star only, the one the IAU gives it to, and the stars keep their order', async () => {
  const { s, n } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')), on = {};
  for (const [i, v] of Object.entries(n)) if (v[0]) (on[v[0]] = on[v[0]] || []).push(v[1] || '#' + i);
  assert.deepEqual(Object.entries(on).filter(([, stars]) => stars.length > 1), [], 'names on more than one star');
  const named = des => Object.values(n).find(v => v[1] === des)[0];
  for (const [des, name] of [['α Peg', 'Markab'], ['κ1 Pup', ''], ['γ Aql', 'Tarazed'], ['η Aql', ''], ['α Gru', 'Alnair'], ['ζ Cen', ''], ['ζ Her', 'Rutilicus']]) assert.equal(named(des), name, des);
  // Stars marked as seen are kept by their place in this list, so a rebuild that reorders it needs to move those marks.
  assert.equal(createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0, 16), 'a010c8abcddc38b6', 'the star list changed order or content');
});

check('Show in the sky view jumps straight up when motion is reduced', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', reducedMotion: 'reduce' });
  try {
    await page.click('#moreT');
    await page.locator('#targetSec .row').last().click();
    assert.ok(await page.evaluate(() => scrollY) > 1000, 'the card was opened from far down the list');
    await page.click('#ctr');
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => scrollY), 0, 'no animated scroll');
  } finally { await ctx.close(); }
});

// The muted labels (--ink3) are 10.5 to 12 px, so they need 4.5:1 on every surface they sit on.
check('small muted labels have 4.5:1 contrast on the page and its panels', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const ratios = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement), lum = name => {
        const h = css.getPropertyValue(name).trim().slice(1), c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      return Object.fromEntries(['--bg', '--panel', '--panel2', '--raise'].map(b => [b, +((lum('--ink3') + 0.05) / (lum(b) + 0.05)).toFixed(2)]));
    });
    for (const b in ratios) assert.ok(ratios[b] >= 4.5, `--ink3 on ${b} is ${ratios[b]}:1`);
  } finally { await ctx.close(); }
});

check('without JavaScript it says what it needs, and GitHub Pages serves it as it is', async () => {
  await readFile(join(root, '.nojekyll')).catch(() => assert.fail('.nojekyll is missing'));
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage();
    await page.goto(base);
    const note = page.locator('noscript p'); // Playwright's text search skips <noscript>, so look at it directly
    assert.ok(await note.isVisible(), 'the no-JavaScript note shows');
    assert.equal(await note.textContent(), 'Starhop needs JavaScript to draw the sky.');
  } finally { await ctx.close(); }
});

const only = process.argv[2];
let failed = 0, ran = 0;
for (const [name, fn] of checks) {
  if (only && !name.includes(only)) continue;
  ran++;
  try { await fn(); console.log('ok    ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n').join('\n      ')); }
}
await browser.close();
server.close();
if (!ran) { console.log('no check matches ' + JSON.stringify(only)); process.exit(1); }
if (failed) { console.log(`${failed} of ${ran} failed`); process.exit(1); }
console.log(`all good (${ran} check${ran === 1 ? "" : "s"})`);
