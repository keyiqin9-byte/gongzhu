// 情景测试：队友主动吃→回这门；对方收红桃→垫小红桃给队友；队友收满贯→红桃给他
const { load } = require('./extract');
const args = Object.fromEntries(process.argv.slice(2).map(s => s.split('=')));
const E = load(args.file || require('path').join(__dirname, '..', 'index.html'));
const LVL = args.lvl || 'hard', N = Number(args.n || 40);
const C = (s, r) => s * 13 + r;                       // s: 0黑桃 1红桃 2方块 3梅花; r: 0='2' … 12='A'
function build(spec, script, leader) {
  // spec: {seat: [cards]} 固定的牌；其余随机发，但 avoid[seat] 里的牌不发给他
  for (let tries = 0; tries < 500; tries++) {
    const fixed = new Set(Object.values(spec.fix).flat());
    const rest = [...Array(52).keys()].filter(c => !fixed.has(c)).sort(() => Math.random() - 0.5);
    const hands = [0, 1, 2, 3].map(p => (spec.fix[p] || []).slice());
    let ok = true;
    for (const c of rest) {
      const cand = [0, 1, 2, 3].filter(p => hands[p].length < 13 && !(spec.avoid && spec.avoid[p] && spec.avoid[p](c)));
      if (!cand.length) { ok = false; break; }
      hands[cand[Math.floor(Math.random() * cand.length)]].push(c);
    }
    if (!ok) continue;
    hands.forEach(h => h.sort((a, b) => a - b));
    let st = { v: 1, seats: [0, 1, 2, 3].map(p => ({ kind: (p === 2 && spec.humanPartner) || (p === 1 && spec.humanOpp) ? 'human' : 'bot', uid: null })), hand: 1, wins: [0, 0], pen: [0, 0], log: [],
      hands, trick: [], turn: leader, leader0: leader, tricks: [], pts: [0, 0, 0, 0], hasbo: [false, false, false, false], hearts: [0, 0, 0, 0], got: [[], [], [], []], phase: 'play', result: null, first7: false };
    try { for (const [p, c] of script) st = E.applyMove(st, p, c); } catch (e) { continue; }
    if (st.phase !== 'play') continue;
    return st;
  }
  throw new Error('cannot build');
}
function run(name, spec, script, leader, me, check) {
  let hit = 0, n = 0, whys = new Map();
  for (let i = 0; i < N; i++) {
    const st = build(spec, script, leader);
    if (st.turn !== me) throw new Error(name + ': not my turn');
    const r = E.botChoose(st, me, LVL);
    n++;
    if (check(r.c, st)) hit++;
    if (args.v) console.log('   ', st.hands[me].map(E.nm).join(' '), '->', E.nm(r.c), r.why.slice(0, 70));
    const k = (check(r.c, st) ? '✓ ' : '✗ ') + r.why;
    whys.set(k, (whys.get(k) || 0) + 1);
  }
  console.log(`${name}: ${hit}/${n}`);
  [...whys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([k, v]) => console.log(`   ${v}× ${k}`));
}
const S = 0, Hh = 1, D = 2, K = 3;
// 1) 对家（2）开局拿♠A 主动吃，后来我（0）拿到出牌权：该回黑桃（小的）
run('队友主动吃黑桃 → 回黑桃', {
  fix: { 2: [C(S, 12), C(S, 2), C(K, 0)], 0: [C(S, 1), C(S, 4), C(K, 12)], 1: [C(S, 10), C(S, 0), C(K, 1)], 3: [C(S, 3), C(K, 3)] },
  avoid: { 0: c => c === 10 || c === 11 || (Math.floor(c / 13) === 1 && false), 2: c => c === 10 },
  humanPartner: true,
}, [[2, C(S, 12)], [3, C(S, 3)], [0, C(S, 4)], [1, C(S, 0)], [2, C(K, 0)], [3, C(K, 3)], [0, C(K, 12)], [1, C(K, 1)]], 2, 0,
  c => Math.floor(c / 13) === S);
// 2) 对方（1）第一墩主动出♥A 收了 4 张红桃；他出梅花，对家（2）♣A 赢着，我没梅花：垫不带分的小红桃（♥2-4）给队友
run('对方在收红桃 → 垫小红桃给队友', {
  fix: { 1: [C(Hh, 12), C(K, 0)], 2: [C(Hh, 4), C(K, 12)], 3: [C(Hh, 5), C(K, 1)], 0: [C(Hh, 6), C(Hh, 0)] },
  avoid: { 0: c => Math.floor(c / 13) === K }, humanOpp: true,
}, [[1, C(Hh, 12)], [2, C(Hh, 4)], [3, C(Hh, 5)], [0, C(Hh, 6)], [1, C(K, 0)], [2, C(K, 12)], [3, C(K, 1)]], 1, 0,
  c => Math.floor(c / 13) === Hh);
// 3a) 对家（2）连出♥A ♥K 收了 8 张红桃（在收满贯）；他出♦2，下家♦A 赢着，我没方块：别把红桃垫给对手
const slamFix = (x2, x3) => ({ fix: { 2: [C(Hh, 12), C(Hh, 11), x2], 3: [C(Hh, 3), C(Hh, 6), x3], 0: [C(Hh, 4), C(Hh, 7), C(Hh, 10)], 1: [C(Hh, 5), C(Hh, 8)] },
  avoid: { 0: c => Math.floor(c / 13) === D, 1: c => Math.floor(c / 13) === Hh, 3: c => Math.floor(c / 13) === Hh }, humanPartner: true });
const slamScript = (x2, x3) => [[2, C(Hh, 12)], [3, C(Hh, 3)], [0, C(Hh, 4)], [1, C(Hh, 5)], [2, C(Hh, 11)], [3, C(Hh, 6)], [0, C(Hh, 7)], [1, C(Hh, 8)], [2, x2], [3, x3]];
run('队友在收满贯，对手赢着 → 不垫红桃', slamFix(C(D, 0), C(D, 12)), slamScript(C(D, 0), C(D, 12)), 2, 0, c => Math.floor(c / 13) !== Hh);
// 3b) 同上，但对家出♦A 自己赢着：把红桃垫给他
run('队友在收满贯，队友赢着 → 垫红桃给他', slamFix(C(D, 12), C(D, 0)), slamScript(C(D, 12), C(D, 0)), 2, 0, c => Math.floor(c / 13) === Hh);
