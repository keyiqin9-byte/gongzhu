// 电脑喊话核对：模拟很多把（真人座位用普通档电脑或随手出牌代替），每一句气泡都和桌上的真实情况对一遍。
// 用法：node tools/speech_check.js file=index.html n=600
const { load } = require('./extract');
const args = Object.fromEntries(process.argv.slice(2).map(s => s.split('=')));
const E = load(args.file || 'index.html');
const N = Number(args.n || 600);
const { applyMove, legalMoves, botChoose, newMatch, startHand, speechEvents, handNotes, endSay, PIG, SHEEP, BO, PTS, PUBLIC, H, suit } = E;
const BOMBS = [PIG, SHEEP, BO];
const bad = [], count = {};
const fail = (msg, info) => { if (bad.length < 40) bad.push(msg + ' ' + JSON.stringify(info)); };
const heartsHolders = h => h.filter(v => v > 0).length;

// 每墩收完时的累计（按牌谱重算，不用被测的函数）
function trickFacts(st, ti) {
  const pts = [0, 0, 0, 0], hearts = [0, 0, 0, 0], hasbo = [false, false, false, false];
  let hb = null;
  for (let i = 0; i <= ti; i++) {
    const t = st.tricks[i];
    if (i === ti) hb = hearts.slice();
    for (const [, c] of t.cards) {
      if (!PUBLIC.has(c)) continue;
      pts[t.w] += PTS[c];
      if (suit(c) === H) hearts[t.w]++;
      if (c === BO) hasbo[t.w] = true;
    }
  }
  return { pts, hearts, hasbo, heartsBefore: hb };
}

function check(e, prev, next, seats) {
  count[e.k] = (count[e.k] || 0) + 1;
  const s = e.seat, txt = e.text;
  if (!seats[s] || seats[s].kind !== 'bot') fail('非电脑在说话', { s, txt });
  if (!txt) fail('空话', e);
  const T = e.t, A = e.after;
  const who0 = /你0分/.test(txt) ? (e.r && e.r.by) : s;          // "你0分"说的是队友，别的"0分"说的是自己
  if (/0分/.test(txt) && !(A && who0 !== undefined && A.pts[who0] === 0)) fail('说0分但不是0分', { txt, pts: A && A.pts[who0] });
  switch (e.k) {
    case 'ret': {
      const n = e.n;
      if (prev.trick.length) fail('回牌却不是先出', { txt });
      const par = s ^ 2;
      const led = prev.tricks.some(t => t.cards[0][0] === par && suit(t.cards[0][1]) === n.s);
      if (!led) fail('说回牌但队友没先出过这门', { txt, s: n.s });
      break;
    }
    case 'feed': {
      const n = e.n, has = prev.hands[n.to].some(c => suit(c) === n.s);
      if (n.sure && has) fail('说"你没了"但队友还有这门', { txt });
      if (!n.sure && !/[？没有就垫]/.test(txt)) fail('拿不准还说得很肯定', { txt });
      break;
    }
    case 'bomb': {
      const n = e.n, cs = T.cards.map(m => m[1]);
      if (T.w !== n.to || !cs.includes(n.c) || ((n.to ^ s) & 1) !== 1) fail('说送炸弹但没送到对手', { txt, w: T.w, to: n.to });
      const want = n.c === PIG ? '猪' : n.c === SHEEP ? '羊' : '波';
      if (!txt.includes(want)) fail('送的炸弹说错了', { txt, c: n.c });
      break;
    }
    case 'brk': {
      const hb = E.noteHolds ? null : null;
      const before = A.hearts.slice(); before[T.w] -= T.cards.filter(m => suit(m[1]) === H).length;
      if (!(heartsHolders(before) === 1 && heartsHolders(A.hearts) >= 2)) fail('说破满贯但没破', { txt, before, after: A.hearts });
      break;
    }
    case 'sup': {
      if (T.w !== (s ^ 2) || heartsHolders(A.hearts) !== 1) fail('说给队友满贯但不对', { txt, w: T.w, hearts: A.hearts });
      break;
    }
    case 'shield': {
      if (T.w !== s || !T.cards.some(m => m[1] === BO)) fail('说挡波但波不是他收的', { txt });
      break;
    }
    case 'got': {
      const cs = T.cards.map(m => m[1]);
      if (T.w !== s) fail('说吃到炸弹但这墩不是他收的', { txt });
      if (txt.includes('猪') && !cs.includes(PIG)) fail('说吃猪但没有猪', { txt });
      if (txt.includes('羊') && !cs.includes(SHEEP)) fail('说收羊但没有羊', { txt });
      if (txt.includes('波') && !cs.includes(BO)) fail('说吃波但没有波', { txt });
      if (/×8/.test(txt) && !A.hasbo[s]) fail('说×8但没收过波', { txt });
      if (/分和波|连分带波/.test(txt) && !cs.some(c => PTS[c] > 0)) fail('说分和波一起吃但这墩没分', { txt });
      if (!cs.some(c => BOMBS.includes(c))) fail('没炸弹也喊', { txt });
      if (cs.includes(BO) && A.pts[s] > 0 && /不怕/.test(txt)) fail('吃了波有分还说不怕', { txt, pts: A.pts[s] });
      break;
    }
    case 'react': {
      const r = e.r, cs = T.cards.map(m => m[1]);
      if (r.why === 'gift') {
        const played = T.cards.find(m => m[0] === r.by);
        if (!played || played[1] !== r.c || !BOMBS.includes(r.c) || ((T.w ^ r.by) & 1) !== 1 || seats[r.by].kind !== 'human' || s !== (r.by ^ 2)) fail('夸送炸弹不对', { txt, r, w: T.w });
      } else if (r.why === 'brk') {
        const before = A.hearts.slice(); before[T.w] -= T.cards.filter(m => suit(m[1]) === H).length;
        if (!(heartsHolders(before) === 1 && heartsHolders(A.hearts) >= 2)) fail('夸破满贯但没破', { txt });
        if (!T.cards.some(m => m[0] === r.by && suit(m[1]) === H)) fail('夸破满贯但他没出红桃', { txt });
      } else if (r.why === 'shield') {
        if (T.w !== r.by || !cs.includes(BO) || A.pts[r.by] !== 0 || s !== (r.by ^ 2)) fail('夸挡波不对', { txt });
      } else if (r.why === 'tease') {
        if (T.w !== r.to || !cs.includes(PIG) || ((s ^ r.to) & 1) !== 1 || seats[r.to].kind !== 'human') fail('逗吃猪不对', { txt });
      } else fail('不认识的夸法', r);
      break;
    }
    default: fail('不认识的喊话', e.k);
  }
}

function checkNotes(st) {                                // 结算页"这把的配合"
  for (const n of handNotes(st)) {
    count['note:' + n.k] = (count['note:' + n.k] || 0) + 1;
    const t = st.tricks[n.t];
    if (!t) { fail('配合记到了不存在的墩', n); continue; }
    const f = trickFacts(st, n.t), cs = t.cards.map(m => m[1]);
    if (n.k === 'bomb' && (t.w !== n.to || !cs.includes(n.c))) fail('小结：送炸弹不对', n);
    if (n.k === 'shield') {
      if (t.w !== n.p || !cs.includes(BO)) fail('小结：挡波不对', n);
      if (n.zero && f.pts[n.p] !== 0) fail('小结：说0分收波但有分', { n, pts: f.pts[n.p] });
      if (!n.zero && f.pts[n.p] === 0) fail('小结：0分收波却没说0分', n);
    }
    if (n.k === 'brk' && !(heartsHolders(f.heartsBefore) === 1 && heartsHolders(f.hearts) >= 2)) fail('小结：破满贯不对', n);
    if (n.k === 'sup' && !(t.w === n.to && heartsHolders(f.hearts) === 1)) fail('小结：给满贯不对', n);
  }
}

function checkEnd(st) {
  const r = st.result;
  for (let my = 0; my < 4; my++) {
    if (st.seats[my].kind !== 'human') continue;
    const par = my ^ 2, team = my & 1, t = endSay(st, my, st.hand * 7 + my);
    if (st.seats[par].kind !== 'bot') { if (t) fail('队友不是电脑也说话', t); continue; }
    if (!t) { fail('结算没说话', r.kind); continue; }
    count['end'] = (count['end'] || 0) + 1;
    if (/锅|分都在我这/.test(t) && r.loser !== par) fail('乱认错', { t, loser: r.loser, par });
    if (/一分没吃|我0分/.test(t) && !(r.winTeam === team && r.scores[par] === 0)) fail('乱说0分', { t });
    if (/满贯是我收|收齐红桃了/.test(t) && r.slammer !== par) fail('乱说收满贯', { t });
    if (/板扎|收满贯了，漂亮/.test(t) && !((r.kind === 'small' || r.kind === 'grand') && r.winTeam === team)) fail('乱夸满贯', { t });
    if (/让他们收了满贯|满贯没破掉/.test(t) && !((r.kind === 'small' || r.kind === 'grand') && r.winTeam !== team)) fail('乱说对面满贯', { t });
    if (/赢得漂亮|配合得好/.test(t) && r.winTeam !== team) fail('输了还说赢', { t });
    if (/下把赢回来|牌太差/.test(t) && !(r.winTeam !== null && r.winTeam !== team)) fail('没输说输', { t });
    if (/平了|打平/.test(t) && r.winTeam !== null) fail('没平说平', { t });
  }
}

let hands = 0;
for (let g = 0; g < N; g++) {
  // 座位：随机几个真人（用普通档电脑或随手出牌代替他们出牌）
  const kinds = [0, 1, 2, 3].map(() => (Math.random() < 0.4 ? 'human' : 'bot'));
  if (!kinds.includes('human')) kinds[g % 4] = 'human';
  const seats = kinds.map((k, i) => ({ kind: k, uid: k === 'human' ? 'u' + i : null, name: 'p' + i }));
  let st = newMatch(seats);
  if (g % 3) st = startHand(st, g % 4, false);
  const style = [0, 1, 2, 3].map(() => (Math.random() < 0.3 ? 'rand' : 'normal'));
  const mem = {};
  let batch = [], prevForBatch = st;
  while (st.phase === 'play') {
    const p = st.turn;
    let c;
    if (seats[p].kind === 'bot') c = botChoose(st, p, g % 5 === 0 ? 'hard' : 'normal').c;
    else if (style[p] === 'rand') { const L = legalMoves(st, p); c = L[Math.floor(Math.random() * L.length)]; }
    else c = botChoose(st, p, 'normal').c;
    const next = applyMove(st, p, c, seats[p].kind === 'bot' ? 'b' : 'h');
    batch.push(next);
    // 有时一次只来一张，有时一次来几张（联机时可能跳着到）
    const flush = g % 2 === 0 ? true : Math.random() < 0.45 || next.phase !== 'play';
    if (flush) {
      for (const e of speechEvents(prevForBatch, next, mem)) check(e, e.before || prevForBatch, next, seats);   // 出牌时说的话，拿他出牌那一刻的局面核对
      prevForBatch = next; batch = [];
    }
    st = next;
  }
  hands++;
  checkNotes(st);
  checkEnd(st);
}
console.log(JSON.stringify({ hands, said: count }));
if (bad.length) { console.log('问题：\n' + bad.join('\n')); process.exit(1); }
console.log('ALL OK');
