
require("dotenv").config();
const express = require("express");
const path = require("path");
const app = express();
const KEY = process.env.API_FOOTBALL_KEY;
const FD = process.env.FOOTBALL_DATA_TOKEN;
const TTL_TODAY = +process.env.TTL_TODAY || 1200;
const TTL_OTHER = +process.env.TTL_OTHER || 21600;
const cache = new Map();
let afDownUntil = 0;

const fmt = (tz, d) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dateIn = (tz, off) => fmt(tz, new Date(Date.now() + off * 864e5));

const AF_LIVE = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"], AF_END = ["FT", "AET", "PEN"], AF_OFF = ["PST", "CANC", "ABD", "AWD", "WO", "SUSP"];
function normAF(f) {
  const s = f.fixture.status.short;
  const status = AF_LIVE.includes(s) ? "live" : AF_END.includes(s) ? "end" : AF_OFF.includes(s) ? "off" : "soon";
  return {
    id: f.fixture.id, time: f.fixture.date, status, minute: f.fixture.status.elapsed,
    league: { id: f.league.id, name: f.league.name, country: f.league.country, logo: f.league.logo },
    home: { name: f.teams.home.name, logo: f.teams.home.logo },
    away: { name: f.teams.away.name, logo: f.teams.away.logo },
    score: [f.goals.home, f.goals.away]
  };
}
async function fetchAF(date, tz) {
  const r = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=${encodeURIComponent(tz)}`, { headers: { "x-apisports-key": KEY } });
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors));
  return j.response.map(normAF);
}

const FD_MAP = { 2021: 39, 2014: 140, 2019: 135, 2002: 78, 2015: 61, 2001: 2 };
const FD_ST = { IN_PLAY: "live", PAUSED: "live", FINISHED: "end", AWARDED: "end", POSTPONED: "off", SUSPENDED: "off", CANCELLED: "off" };
async function fetchFD(date, tz, day) {
  const from = dateIn("UTC", day - 1), to = dateIn("UTC", day + 1);
  const r = await fetch(`https://api.football-data.org/v4/matches?dateFrom=${from}&dateTo=${to}`, { headers: { "X-Auth-Token": FD } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "football-data " + r.status);
  return j.matches.filter(m => fmt(tz, new Date(m.utcDate)) === date).map(m => ({
    id: "fd" + m.id, time: m.utcDate, status: FD_ST[m.status] || "soon", minute: m.minute || null,
    league: { id: FD_MAP[m.competition.id] || m.competition.id, name: m.competition.name, country: m.area.name, logo: m.competition.emblem },
    home: { name: m.homeTeam.shortName || m.homeTeam.name, logo: m.homeTeam.crest },
    away: { name: m.awayTeam.shortName || m.awayTeam.name, logo: m.awayTeam.crest },
    score: [m.score.fullTime.home, m.score.fullTime.away]
  }));
}

app.get("/api/matches", async (req, res) => {
  if (!KEY && !FD) return res.status(500).json({ error: "لا يوجد مفتاح API مضبوط" });
  const day = Math.max(-1, Math.min(1, parseInt(req.query.day, 10) || 0));
  let tz = String(req.query.tz || "UTC");
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { tz = "UTC"; }
  const date = dateIn(tz, day);
  const ck = `${date}|${tz}`;
  const hit = cache.get(ck);
  const ttl = (day === 0 ? TTL_TODAY : TTL_OTHER) * 1000;
  if (hit && Date.now() - hit.t < ttl) return res.json(hit.data);
  const errs = [];
  if (KEY && Date.now() > afDownUntil) {
    try { const matches = await fetchAF(date, tz); const data = { date, matches }; cache.set(ck, { t: Date.now(), data }); return res.json(data); }
    catch (e) { errs.push(String(e.message || e)); afDownUntil = Date.now() + 600000; }
  }
  if (FD) {
    try { const matches = await fetchFD(date, tz, day); const data = { date, matches }; cache.set(ck, { t: Date.now(), data }); return res.json(data); }
    catch (e) { errs.push(String(e.message || e)); }
  }
  if (hit) return res.json(hit.data);
  res.status(502).json({ error: errs.join(" | ") });
});

app.get("/", (q, r) => r.sendFile(path.join(__dirname, "index.html")));
app.get("/streams.json", (q, r) => r.sendFile(path.join(__dirname, "streams.json")));
app.listen(process.env.PORT || 3000, () => console.log("Goal 360 يعمل على المنفذ " + (process.env.PORT || 3000)));
