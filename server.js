require("dotenv").config();
const express = require("express");
const path = require("path");
const app = express();
const KEY = process.env.API_FOOTBALL_KEY;
const TTL_TODAY = +process.env.TTL_TODAY || 1200;
const TTL_OTHER = +process.env.TTL_OTHER || 21600;
const cache = new Map();

function dateIn(tz, offset) {
  const d = new Date(Date.now() + offset * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const STATUS = {
  live: ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"],
  end: ["FT", "AET", "PEN"],
  off: ["PST", "CANC", "ABD", "AWD", "WO", "SUSP"]
};
function norm(f) {
  const s = f.fixture.status.short;
  const status = STATUS.live.includes(s) ? "live" : STATUS.end.includes(s) ? "end" : STATUS.off.includes(s) ? "off" : "soon";
  return {
    id: f.fixture.id, time: f.fixture.date, status, minute: f.fixture.status.elapsed,
    league: { id: f.league.id, name: f.league.name, country: f.league.country, logo: f.league.logo },
    home: { name: f.teams.home.name, logo: f.teams.home.logo },
    away: { name: f.teams.away.name, logo: f.teams.away.logo },
    score: [f.goals.home, f.goals.away]
  };
}

app.get("/api/matches", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "API_FOOTBALL_KEY غير مضبوط في ملف .env" });
  const day = Math.max(-1, Math.min(1, parseInt(req.query.day, 10) || 0));
  let tz = String(req.query.tz || "UTC");
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { tz = "UTC"; }
  const date = dateIn(tz, day);
  const ck = `${date}|${tz}`;
  const hit = cache.get(ck);
  const ttl = (day === 0 ? TTL_TODAY : TTL_OTHER) * 1000;
  if (hit && Date.now() - hit.t < ttl) return res.json(hit.data);
  try {
    const r = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=${encodeURIComponent(tz)}`, { headers: { "x-apisports-key": KEY } });
    const j = await r.json();
    if (j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors));
    const data = { date, matches: j.response.map(norm) };
    cache.set(ck, { t: Date.now(), data });
    res.json(data);
  } catch (e) {
    if (hit) return res.json(hit.data); // أعد آخر نسخة عند الفشل
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/", (q, r) => r.sendFile(path.join(__dirname, "index.html")));
app.get("/streams.json", (q, r) => r.sendFile(path.join(__dirname, "streams.json")));
app.listen(process.env.PORT || 3000, () => console.log("Goal 360 يعمل على المنفذ " + (process.env.PORT || 3000)));
