// 把页面里的规则引擎和电脑打法抽出来，给 node 模拟用
const fs = require('fs');
const vm = require('vm');
function load(file) {
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf('/* ================= 牌 ================= */');
  const b = html.indexOf('/* ================= 页面状态 ================= */');
  if (a < 0 || b < 0) throw new Error('markers not found in ' + file);
  const code = html.slice(a, b) + '\n;({ newMatch, startHand, legalMoves, applyMove, winnerOf, scoreOf, botChoose, LEVELS, PTS, PUBLIC, BOMBS, PIG, SHEEP, BO, SP7, suit, rank, nm, clone, ' +
    (html.slice(a, b).includes('function botCtx') ? 'botCtx, ' : '') +
    (html.slice(a, b).includes('function sampleWorld') ? 'sampleWorld, copyWorld, playFast, worldValue, handOutcome, penaltyOf, ' : '') +
    (html.slice(a, b).includes('function surrender') ? 'surrender, ' : '') + 'H, BOMB_OF, BNAME, SUITNAME, })';
  const ctx = vm.createContext({ Math, JSON, Set, Map, Array, Object, Number, String, Error, console });
  return vm.runInContext(code, ctx, { filename: file });
}
module.exports = { load };
