// 新旧电脑对打：同一副牌打两遍（换座位），看新电脑那队赢几成
const { load } = require('./extract');
const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map(s => s.split('=')));
const N = Number(args.n || 500), SEED = Number(args.seed || 1), PART = Number(args.part || 0), OF = Number(args.of || 1);
const OLD = load(args.old || require('path').join(__dirname, '..', 'index.html'));
const NEW = load(args.new || require('path').join(__dirname, '..', 'index.html'));
const LVL_OLD = args.lvlold || 'hard', LVL_NEW = args.lvlnew || 'hard';
// 可复现的随机数（发牌用）；电脑内部的小随机仍用 Math.random
let s = (SEED * 2654435761 + PART * 97) >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function deal() { const d = [...Array(52).keys()]; for (let i = 51; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return [0, 1, 2, 3].map(i => d.slice(i * 13, i * 13 + 13).sort((a, b) => a - b)); }
function playHand(eng, lvls, hands, leader, first7) {
  let st = { v: 1, seats: [0, 1, 2, 3].map(() => ({ kind: 'bot', uid: null })), hand: 1, wins: [0, 0], log: [], hands: hands.map(h => h.slice()), trick: [], turn: leader, leader0: leader,
    tricks: [], pts: [0, 0, 0, 0], hasbo: [false, false, false, false], hearts: [0, 0, 0, 0], got: [[], [], [], []], phase: 'play', result: null, first7 };
  while (st.phase === 'play') {
    const p = st.turn;
    const r = eng[p].botChoose(st, p, lvls[p]);
    st = OLD.applyMove(st, p, r.c);
  }
  return st;
}
let score = 0, games = 0, slams = 0, ties = 0, newMax = 0, oldMax = 0, net = 0, penLost = 0, penWon = 0, nLost = 0, nWon = 0;
const tier = s => (s >= 9000 ? 4 : s >= 6000 ? 3 : s >= 3000 ? 2 : 1);
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const hands = deal();
  const first7 = i % 2 === 0;
  const leader = first7 ? hands.findIndex(h => h.includes(OLD.SP7)) : Math.floor(rnd() * 4);
  for (const newTeam of [0, 1]) {
    const eng = [0, 1, 2, 3].map(p => ((p & 1) === newTeam ? NEW : OLD));
    const lv = [0, 1, 2, 3].map(p => ((p & 1) === newTeam ? LVL_NEW : LVL_OLD));
    const st = playHand(eng, lv, hands, leader, first7);
    const r = st.result;
    games++;
    if (r.winTeam === null) { score += 0.5; ties++; }
    else if (r.winTeam === newTeam) score += 1;
    if (r.winTeam !== null) {
      const lt = 1 - r.winTeam, pu = tier(Math.max(r.scores[lt], r.scores[lt + 2])) * (r.kind === 'grand' ? 2 : 1);
      if (r.winTeam === newTeam) { net += pu; penWon += pu; nWon++; } else { net -= pu; penLost += pu; nLost++; }
    }
    if (r.kind === 'small' || r.kind === 'grand') slams++;
    const sc = r.scores;
    newMax += Math.max(sc[newTeam], sc[newTeam + 2]); oldMax += Math.max(sc[1 - newTeam], sc[3 - newTeam]);
  }
}
console.log(JSON.stringify({ part: PART, games, score, ties, slams, newMaxAvg: newMax / games, oldMaxAvg: oldMax / games, net, penWon, penLost, nWon, nLost, sec: (Date.now() - t0) / 1000 }));
