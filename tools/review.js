// 牌谱复盘：把记下来的人打的牌一手一手重放，每一手都让电脑（高手档）也想一遍，
// 再用同一批随机发牌往后推演，比较"人出的这张"和"电脑会出的那张"平均差几份。
// 用法: node review.js 牌谱.json [k=32] [max=200] [out=report.md] [json=detail.json] [file=对战版.html]
const fs = require('fs');
const { load } = require('./extract');
const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter(s => s.includes('=')).map(s => s.split('=')));
const files = argv.filter(s => !s.includes('='));
const E = load(args.file || require('path').join(__dirname, '..', 'index.html'));
const K = Number(args.k || 32), MAX = Number(args.max || 200);
const cfg = E.LEVELS.hard;
const nm = E.nm, suit = E.suit;

function readRecs(f) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (Array.isArray(j)) return j.flatMap(x => (x && x.recs ? x.recs : [x]));
  if (j.recs) return j.recs;
  return [j];
}
let recs = files.flatMap(readRecs).filter(r => r && r.deal && r.plays);
const seenIds = new Set();
recs = recs.filter(r => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true))).sort((a, b) => a.t - b.t).slice(-MAX);

function startState(r) {
  const seats = r.seats.map(s => ({ kind: s.k === 'h' ? 'human' : s.k === 'b' ? 'bot' : 'empty', uid: s.u || null }));
  return { v: 1, seats, hand: r.hand || 1, wins: [0, 0], pen: [0, 0], log: [], hands: r.deal.map(h => h.slice()), trick: [], turn: r.leader, leader0: r.leader,
    tricks: [], pts: [0, 0, 0, 0], hasbo: [false, false, false, false], hearts: [0, 0, 0, 0], got: [[], [], [], []], phase: 'play', result: null, first7: !!r.first7, surrBy: null };
}
// 同一批发牌，比较每张能出的牌
function evalCards(st, p, cards) {
  const x = E.botCtx(st, p, cfg);
  const sum = new Map(cards.map(c => [c, 0]));
  let n = 0;
  for (let k = 0; k < K; k++) {
    const w0 = E.sampleWorld(st, p, x, cfg);
    if (!w0) break;
    for (const c of cards) {
      const w = E.copyWorld(w0);
      E.playFast(w, p, c);
      while (w.phase === 'play') { const q = w.turn; E.playFast(w, q, E.botChoose(w, q, 'roll').c); }
      sum.set(c, sum.get(c) + E.worldValue(w, p, cfg));
    }
    n++;
  }
  const ev = new Map();
  for (const [c, s] of sum) ev.set(c, n ? s / n : 0);
  return ev;
}
const REL = ['自己', '下家', '对家', '上家'];
const fmt = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
const handStr = h => h.slice().sort((a, b) => a - b).map(nm).join(' ');

const players = new Map();          // 名字 → 统计
const moments = [];                 // 每一手人出的牌
const conv = { cashSeen: 0, cashRet: 0, riskSeen: 0, riskBrk: 0, humanCash: 0, botAnswered: 0, botCould: 0 };
let teamStats = { hands: 0, humanTeamWon: 0, humanTeamLost: 0, ties: 0, units: 0 };
let bad = 0;
const t0 = Date.now();
for (const r of recs) {
  let st = startState(r);
  const name = i => (r.seats[i].n || (r.seats[i].k === 'h' ? '玩家' : '电脑')) + (r.seats[i].u ? '' : '');
  const key = i => r.seats[i].u || r.seats[i].n || ('座位' + i);
  let ok = true;
  for (let i = 0; i < r.plays.length; i++) {
    const [p, c] = r.plays[i];
    const by = (r.by || '')[i] || (r.seats[p].k === 'h' ? 'h' : 'b');
    if (st.phase !== 'play' || st.turn !== p) { ok = false; break; }
    const legal = E.legalMoves(st, p);
    if (!legal.includes(c)) { ok = false; break; }
    const x = E.botCtx(st, p, cfg);
    // 约定：队友主动吃过、炸弹还在外面，轮到人出牌
    if (by === 'h' && !st.trick.length) {
      const par = p ^ 2;
      const ss = [...x.cash[par]].filter(s => x.U.has(E.BOMB_OF[s]) && !x.hand.has(E.BOMB_OF[s]) && legal.some(cc => suit(cc) === s));
      if (ss.length) { conv.cashSeen++; if (ss.includes(suit(c))) conv.cashRet++; }
    }
    if (by === 'h' && st.trick.length && suit(c) !== suit(st.trick[0][1])) {
      const h = st.hearts, hp = h[0] + h[1] + h[2] + h[3];
      const q = hp >= 3 ? [0, 1, 2, 3].find(z => h[z] === hp) : undefined;
      const [wp] = E.winnerOf(st.trick);
      if (q !== undefined && ((q ^ p) & 1) === 1 && wp !== q && legal.some(cc => suit(cc) === E.H)) { conv.riskSeen++; if (suit(c) === E.H) conv.riskBrk++; }
    }
    if (by === 'b' && !st.trick.length) {
      const par = p ^ 2;
      if (r.seats[par].k === 'h') {
        const ss = [...x.cash[par]].filter(s => x.U.has(E.BOMB_OF[s]) && !x.hand.has(E.BOMB_OF[s]) && legal.some(cc => suit(cc) === s));
        if (ss.length) { conv.botCould++; if (ss.includes(suit(c))) conv.botAnswered++; }
      }
    }
    if (by === 'h' && legal.length > 1) {
      const bot = E.botChoose(st, p, 'hard');
      const cands = [...new Set([...legal])];
      const ev = evalCards(st, p, cands);
      const best = Math.max(...ev.values());
      const m = { rec: r.id, hand: r.hand, trick: st.tricks.length + 1, pos: st.trick.length, p, who: name(p), key: key(p), c, bot: bot.c, why: bot.why,
        evH: ev.get(c), evB: ev.get(bot.c), best, cards: handStr(st.hands[p]), table: st.trick.map(([q, cc]) => `${REL[(q - p + 4) % 4]}${nm(cc)}`).join(' '),
        lead: !st.trick.length };
      moments.push(m);
      const ps = players.get(m.key) || { who: m.who, n: 0, same: 0, d: 0, bad: 0, good: 0 };
      ps.n++; if (c === bot.c) ps.same++; ps.d += m.evH - m.evB;
      if (m.evH - m.evB < -0.3) ps.bad++;
      if (m.evH - m.evB > 0.3) ps.good++;
      players.set(m.key, ps);
    }
    st = E.applyMove(st, p, c);
    if (st.trick.length === 0 && st.tricks.length) {
      const t = st.tricks[st.tricks.length - 1];
      const [lp, lc] = t.cards[0], b = E.BOMB_OF[suit(lc)];
      if (b !== null && r.seats[lp].k === 'h' && t.w === lp && E.rank(lc) > E.rank(b)) conv.humanCash++;
    }
  }
  if (r.surr !== null && r.surr !== undefined && st.phase === 'play') st = E.surrender(st, r.surr);
  if (!ok || st.phase !== 'end') { bad++; continue; }
  const res = st.result;
  if (JSON.stringify(res.scores) !== JSON.stringify(r.res.sc)) bad++;
  const hs = r.seats.map((s, i) => (s.k === 'h' ? i : -1)).filter(i => i >= 0);
  const teams = new Set(hs.map(i => i & 1));
  if (teams.size === 1) {
    const ht = [...teams][0];
    teamStats.hands++;
    if (res.winTeam === null) teamStats.ties++;
    else if (res.winTeam === ht) { teamStats.humanTeamWon++; teamStats.units += res.pen; }
    else { teamStats.humanTeamLost++; teamStats.units -= res.pen; }
  }
}

const out = [];
out.push(`# 牌谱复盘：${recs.length} 把，人出牌 ${moments.length} 手${bad ? `（${bad} 把对不上，跳过）` : ''}`);
out.push(`推演：每手 ${K} 种发牌，四家按电脑的打法打到底，"份"是按罚份数算的平均输赢（+ 是对方挨罚）。用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒。\n`);
if (teamStats.hands) out.push(`人这队（只算人都在一队的把）：${teamStats.hands} 把，赢 ${teamStats.humanTeamWon}、输 ${teamStats.humanTeamLost}、平 ${teamStats.ties}，净 ${teamStats.units >= 0 ? '+' : ''}${teamStats.units} 份。\n`);
out.push('## 每个人');
out.push('| 玩家 | 出牌 | 和电脑一样 | 平均差（份/手） | 明显吃亏 | 比电脑好 |');
out.push('|---|---|---|---|---|---|');
for (const ps of [...players.values()].sort((a, b) => b.n - a.n)) {
  out.push(`| ${ps.who} | ${ps.n} | ${(100 * ps.same / ps.n).toFixed(0)}% | ${fmt(ps.d / ps.n)} | ${ps.bad} | ${ps.good} |`);
}
const line = m => `- 第${m.hand}把第${m.trick}墩 ${m.who}${m.lead ? '先出' : `跟（桌上 ${m.table}）`}：出了 **${nm(m.c)}**（${fmt(m.evH)} 份），电脑会出 **${nm(m.bot)}**（${fmt(m.evB)} 份）。电脑的想法：${m.why}。手牌：${m.cards}`;
const diffs = moments.filter(m => m.c !== m.bot).map(m => Object.assign(m, { d: m.evH - m.evB }));
out.push('\n## 人吃亏最多的几手（失误）');
diffs.filter(m => m.d < -0.15).sort((a, b) => a.d - b.d).slice(0, 12).forEach(m => out.push(line(m)));
out.push('\n## 人比电脑出得好的几手（电脑要学的）');
diffs.filter(m => m.d > 0.15).sort((a, b) => b.d - a.d).slice(0, 12).forEach(m => out.push(line(m)));
out.push('\n## 配合的约定');
out.push(`- 人主动拿大牌吃（领出比炸弹大的牌收下）：${conv.humanCash} 次；之后电脑队友该回这门的时候回了 ${conv.botAnswered}/${conv.botCould} 次`);
out.push(`- 队友主动吃过、人自己出牌时回这门：${conv.cashRet}/${conv.cashSeen} 次`);
out.push(`- 对方在收红桃、人缺门垫牌时垫了红桃（不给收的那个人）：${conv.riskBrk}/${conv.riskSeen} 次`);
const report = out.join('\n') + '\n';
if (args.out) fs.writeFileSync(args.out, report);
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ moments, players: [...players.values()], conv, teamStats }, null, 1));
console.log(report);
