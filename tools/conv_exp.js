// 暗号（配合约定）有没有用：一队按某种改法打、另一队按原样打，同一副牌换座位各打一遍，看改的那队平均每把净赚几份。
// 用的是不往后推演的那套打法（快，能打很多把）；结论再用 duel.js（高手档）复核。
// 用法：node tools/conv_exp.js file=index.html n=2000 seed=1 exp=noRet,noSig2   （exp 不写就全跑）
const { load } = require('./extract');
const args = Object.fromEntries(process.argv.slice(2).map(s => s.split('=')));
const E = load(args.file || 'index.html');
const N = Number(args.n || 2000), SEED = Number(args.seed || 1);
const BASE = Object.assign({}, E.LEVELS.roll);
// 每种改法：在原样打法上改哪些开关
const EXPS = {
  noRet: { ret: false },                                   // 不回队友先出的那门
  noSig2: { sig2: false },                                 // 不把 2 留到最后当"这门没了"，也不按 2 去读
  noCash: { cashRet: false, cashFollow: false, cashBias: 0, cashHigh: 0 },   // 队友拿大牌吃了也不回
  noFeed: { feed: false },                                 // 不专门出队友没有的那门
  noBrk: { slamIns: 0 },                                   // 对手刚开始收红桃时不提早破（快收齐时照样抢）
  noSup: { slamSup: false },                               // 队友收满贯时不帮
  noShield: { boShield: false, eatbo: false },             // 0 分不替队友挡波
  noAvoid: { avoidOpp: false },                            // 对手先出的那门照样回
  plusSelfCash: { selfCash: true },                        // 自己主动拿大牌吃（让队友回）
  plusSplit: { split: true },                              // 队友稳赢时把大红桃给他分掉
};
let s = (SEED * 2654435761) >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function deal() { const d = [...Array(52).keys()]; for (let i = 51; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return [0, 1, 2, 3].map(i => d.slice(i * 13, i * 13 + 13).sort((a, b) => a - b)); }
const tier = v => (v >= 9000 ? 4 : v >= 6000 ? 3 : v >= 3000 ? 2 : 1);
function play(hands, leader, first7, lv) {
  let st = { v: 1, seats: [0, 1, 2, 3].map(() => ({ kind: 'bot', uid: null })), hand: 1, wins: [0, 0], log: [], hands: hands.map(h => h.slice()), trick: [], turn: leader, leader0: leader,
    tricks: [], pts: [0, 0, 0, 0], hasbo: [false, false, false, false], hearts: [0, 0, 0, 0], got: [[], [], [], []], phase: 'play', result: null, first7, deal: hands.map(h => h.slice()), by: '' };
  while (st.phase === 'play') { const p = st.turn; st = E.applyMove(st, p, E.botChoose(st, p, lv[p]).c, 'b'); }
  return st.result;
}
const deals = [];
for (let i = 0; i < N; i++) { const h = deal(), first7 = i % 2 === 0; deals.push([h, first7 ? h.findIndex(x => x.includes(E.SP7)) : Math.floor(rnd() * 4), first7]); }
const names = args.exp ? args.exp.split(',') : Object.keys(EXPS);
const out = {};
for (const name of names) {
  E.LEVELS.x_new = Object.assign({}, BASE, EXPS[name]);
  E.LEVELS.x_old = Object.assign({}, BASE);
  let net = 0, sq = 0, wins = 0, losses = 0;
  const t0 = Date.now();
  for (const [h, leader, first7] of deals) {
    let d = 0;
    for (const nt of [0, 1]) {
      const lv = [0, 1, 2, 3].map(p => ((p & 1) === nt ? 'x_new' : 'x_old'));
      const r = play(h, leader, first7, lv);
      if (r.winTeam === null) continue;
      const lt = 1 - r.winTeam, pu = tier(Math.max(r.scores[lt], r.scores[lt + 2])) * (r.kind === 'grand' ? 2 : 1);
      if (r.winTeam === nt) { d += pu; wins++; } else { d -= pu; losses++; }
    }
    net += d; sq += d * d;                                // 一副牌（换座位两遍）算一个样本
  }
  const mean = net / N, sd = Math.sqrt(Math.max(0, sq / N - mean * mean)), se = sd / Math.sqrt(N);
  out[name] = { perDeal: +(mean / 2).toFixed(3), se: +(se / 2).toFixed(3), wins, losses, sec: (Date.now() - t0) / 1000 };
  console.log(name, JSON.stringify(out[name]));
}
console.log(JSON.stringify({ n: N, seed: SEED, results: out }));
