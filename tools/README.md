# 牌谱和电脑打法的工具

这几个脚本用来把真人打的牌局拿来复盘，迭代改进电脑的打法。只在电脑上用 Python / Node.js 跑，网页本身不需要它们。

## 牌谱存在哪里

每打完一把，页面都会记一份牌谱，记下这些内容：

- 发的牌
- 每一手谁出了什么
- 这手是人出的、电脑出的，还是超时后系统代出的
- 结果和罚几份

**不记名字**：座位上只有"人 / 电脑"和一个随机编号（每台手机自己随机生成的）。网页首页也写了这一句。

牌谱存在这几个地方：

- **这台手机里**：浏览器的 `localStorage`，键名是 `gz-recs`，最多存 400 把。同一个网站下的页面共用这一份。
- **公共 MQTT 服务器**：每把一条保留消息。
  - 服务器是 `broker-cn.emqx.io`（网页先连它）或 `broker.emqx.io`。
  - 主题是 `mangshi-gongzhu/v1/rec/<牌谱 id>`。
  - 另外每台手机每天一条"今天打开过"：`mangshi-gongzhu/v1/visit/<日期>/<随机编号>`，内容只有打开次数和时间。
- **本仓库的 `data` 分支**：GitHub Actions（`.github/workflows/collect.yml`）每小时把服务器上的牌谱和打开记录收下来（公共服务器上的保留消息过一天左右会被清掉，所以要勤收），
  去掉名字（旧版本传过名字的也删掉），用 `tools/rec-cert.pem` 加密成 `.cms` 文件存进 `data` 分支，再从服务器上删掉。
  只有拿着私钥的人能解开。

## 牌谱格式（v1）

```
{ id, app: 页面名（比如 'duel'）, bot, t, mode: 'sp'|'mp', room, dev, me, lvl, timer, hand, leader, first7,
  seats: [{k: 'h'|'b'|'e', u: 随机编号}] ×4,
  deal: [[13 张] ×4],            // 牌 = 花色*13 + 点数；花色 0♠ 1♥ 2♦ 3♣，点数 0='2' … 12='A'
  plays: [[座位, 牌], …],         // 出牌顺序（投降时没打完的那墩也在里面）
  by: 'hbba…',                    // 每一手：h 人、b 电脑、a 超时代出；对不上时为空
  surr: 投降的座位或 null,
  res: { w: 赢的队, k: normal|tie|small|grand|surrender, sc: [四家得分], pen: 罚几份 } }
```

## 收牌谱、解开、每天的统计

```
python3 tools/collect.py fetch --store store --cert tools/rec-cert.pem --out archived.json   # Actions 里跑的
python3 tools/collect.py open  --store store --key 私钥.pem --out all.json                   # 解开 data 分支里所有的包
python3 tools/daily.py all.json --me 你的编号 --out stats.json                               # 每天几个人、几把、输赢（--me-apps 可以把某个页面上打的都算成你）
```

## 复盘

```
node tools/review.js all.json k=32 out=report.md json=detail.json file=index.html
```

- 每一手人出的牌，都让高手档电脑也想一遍。
- 再用同一批随机发牌往后推演，算出"人出的这张"和"电脑会出的那张"平均差几份。

输出的报告包括：

- 每个人和电脑出得一样的比例
- 吃亏最多的几手（失误）
- 人比电脑出得好的几手（电脑该学的地方）
- 配合约定的使用情况

## 改电脑、对打检验

电脑打法是单独的一段代码，用 `botsplice.py` 取出来改、再放回去：

```
python3 tools/botsplice.py get index.html > bot.js
python3 tools/botsplice.py put bot.js 新/index.html
python3 tools/botsplice.py check 新/index.html index.html        # 两份里这段一样吗
node tools/scen.js file=新/index.html n=40                       # 配合情景
node tools/duel.js n=400 new=新/index.html old=index.html        # 同一副牌换座位各打一遍
```

`scen.js` 测这几个配合情景：队友主动吃以后回这门；对方在收红桃时，垫红桃给队友破满贯；队友在收满贯时，把红桃给他。
`duel.js` 的结果：新电脑那队赢几成、平均每把净赚几份。

## 上线

没有 GitHub 账号授权时，用浏览器打开 `https://github.com/keyiqin9-byte/gongzhu/upload/main`，按
`tools/upload_chunks.py` 生成的几段 JS 依次执行，把文件放进上传框，再点提交。
