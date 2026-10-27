#!/usr/bin/env python3
"""每日战报：按天数一数有没有人玩、几把、几个人、几个房间、人这队输赢。

    python3 tools/daily.py all.json [--me 编号1,编号2] [--me-apps 页面名,...] [--skip 编号,...] [--out stats.json]
                           [--dash 目录 --fill-from 2026-10-27 --fill-to 2026-10-28]   # 给战报页的 days.json、players.json

all.json 是 `collect.py open` 合成的那份（也认浏览器里 getRecs 拿到的牌谱数组）。
人只用随机编号区分，报告里写成"你""玩家A""玩家B"……（--me 给的编号，和 --me-apps 列出的页面上打牌的编号，算"你"）。
--skip 给的编号（比如 Claude 自己测试用的）不算。
"""
import argparse
import json
import sys
from collections import defaultdict


def load(path):
    j = json.load(open(path, encoding='utf-8'))
    if isinstance(j, list):
        return j, []
    return j.get('recs', []), j.get('visits', [])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--me', default='')
    ap.add_argument('--me-apps', default='')
    ap.add_argument('--skip', default='')
    ap.add_argument('--out')
    ap.add_argument('--dash')
    ap.add_argument('--fill-from')
    ap.add_argument('--fill-to')
    a = ap.parse_args()
    me = {x for x in a.me.split(',') if x}
    me_apps = {x for x in a.me_apps.split(',') if x}
    skip = {x for x in a.skip.split(',') if x}
    recs, visits = load(a.file)
    recs = [r for r in recs if r.get('dev') not in skip and not any((s or {}).get('u') in skip for s in r.get('seats', []))]
    visits = [v for v in visits if v.get('uid') not in skip]
    for r in recs:
        if r.get('app') in me_apps:
            for s in r.get('seats', []):
                if (s or {}).get('k') == 'h' and s.get('u'):
                    me.add(s['u'])
            if r.get('dev'):
                me.add(r['dev'])
    for v in visits:
        if v.get('app') in me_apps and v.get('uid'):
            me.add(v['uid'])

    # 名字：你 / 玩家A / 玩家B …（按第一次出现的先后）
    order = []
    for r in sorted(recs, key=lambda r: r.get('t') or 0):
        for s in r.get('seats', []):
            u = (s or {}).get('u')
            if (s or {}).get('k') == 'h' and u and u not in order:
                order.append(u)
    for v in sorted(visits, key=lambda v: (v.get('day'), v.get('last') or 0)):
        if v.get('uid') and v['uid'] not in order:
            order.append(v['uid'])
    label, k = {}, 0
    for u in order:
        if u in me:
            label[u] = '你'
        else:
            label[u] = '玩家' + (chr(65 + k) if k < 26 else str(k + 1))
            k += 1

    days = defaultdict(lambda: {'hands': 0, 'mp': 0, 'rooms': set(), 'players': set(), 'opened': set(), 'apps': defaultdict(int),
                                'win': 0, 'lose': 0, 'tie': 0, 'penOut': 0, 'penIn': 0, 'slams': 0, 'per': defaultdict(lambda: [0, 0, 0])})
    for r in recs:
        day = str(r.get('id', ''))[:8]
        if not day.isdigit():
            continue
        D = days[day]
        D['hands'] += 1
        D['apps'][r.get('app') or '?'] += 1
        if r.get('mode') == 'mp':
            D['mp'] += 1
            if r.get('room'):
                D['rooms'].add(r['room'])
        seats = r.get('seats', [])
        humans = [i for i, s in enumerate(seats) if (s or {}).get('k') == 'h']
        for i in humans:
            u = seats[i].get('u')
            if u:
                D['players'].add(u)
        res = r.get('res') or {}
        w, pen = res.get('w'), res.get('pen') or 0
        if res.get('k') in ('small', 'grand'):
            D['slams'] += 1
        teams = {i & 1 for i in humans}
        if len(teams) == 1 and humans:                 # 人都在一队（和电脑打）：算人这队输赢
            t = teams.pop()
            if w is None:
                D['tie'] += 1
            elif w == t:
                D['win'] += 1
                D['penIn'] += pen
            else:
                D['lose'] += 1
                D['penOut'] += pen
        for i in humans:                               # 每个人：赢、输、平
            u = seats[i].get('u')
            if not u:
                continue
            c = D['per'][u]
            c[2 if w is None else 0 if w == (i & 1) else 1] += 1
    for v in visits:
        if v.get('day') and v.get('uid'):
            days[v['day']]['opened'].add(v['uid'])

    out = []
    for day in sorted(days):
        D = days[day]
        out.append({
            'day': day, 'hands': D['hands'], 'players': len(D['players']), 'opened': len(D['opened'] | D['players']),
            'rooms': len(D['rooms']), 'mpHands': D['mp'], 'apps': dict(D['apps']), 'slams': D['slams'],
            'humanTeam': {'win': D['win'], 'lose': D['lose'], 'tie': D['tie'], 'penPaid': D['penOut'], 'penWon': D['penIn']},
            'per': [{'who': label.get(u, u), 'win': c[0], 'lose': c[1], 'tie': c[2]} for u, c in sorted(D['per'].items(), key=lambda x: -sum(x[1]))],
        })
    total = {'hands': sum(d['hands'] for d in out), 'days': len([d for d in out if d['hands']]), 'players': len({u for u in order if any(u in days[d]['players'] for d in days)})}
    res = {'days': out, 'total': total, 'labels': {label[u]: u for u in order}}
    if a.out:
        json.dump(res, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if a.dash:
        write_dash(a, out)
    for d in out[-10:]:
        ht = d['humanTeam']
        who = '、'.join(f"{p['who']} {p['win'] + p['lose'] + p['tie']} 把" for p in d['per'])
        print(f"{d['day']}: 打开 {d['opened']} 人，打完 {d['hands']} 把（{d['players']} 人：{who or '—'}）"
              f"{'，联机 %d 个房间 %d 把' % (d['rooms'], d['mpHands']) if d['mpHands'] else ''}"
              f"{'，和电脑打 赢 %d 输 %d 平 %d（赢来 %d 份、被罚 %d 份）' % (ht['win'], ht['lose'], ht['tie'], ht['penWon'], ht['penPaid']) if ht['win'] + ht['lose'] + ht['tie'] else ''}")
    print('合计', json.dumps(total, ensure_ascii=False))


def write_dash(a, out):
    """战报页的两份数据：每天一行、每人每天一行。

    有记录的日子都有一行。--fill-from 到 --fill-to 是一直在收记录的日子，这中间没人玩的日子也写一行 0；
    这段以外没有记录的日子不写（不知道有没有人玩，不能当成 0）。--fill-to 以后的日子还没过完，不写。
    """
    import datetime
    import os
    os.makedirs(a.dash, exist_ok=True)
    by = {d['day']: d for d in out}
    keys = set(by)
    if a.fill_from and a.fill_to:
        cur = datetime.date.fromisoformat(a.fill_from)
        last = datetime.date.fromisoformat(a.fill_to)
        while cur <= last:
            keys.add(cur.strftime('%Y%m%d'))
            cur += datetime.timedelta(days=1)
    if a.fill_to:
        keys = {k for k in keys if k <= a.fill_to.replace('-', '')}
    rows, prows = [], []
    for k in sorted(keys):
        day = f'{k[:4]}-{k[4:6]}-{k[6:]}'
        d = by.get(k)
        ht = (d or {}).get('humanTeam', {})
        rows.append({'day': day, 'opened': (d or {}).get('opened', 0), 'players': (d or {}).get('players', 0),
                     'hands': (d or {}).get('hands', 0), 'rooms': (d or {}).get('rooms', 0), 'mp_hands': (d or {}).get('mpHands', 0),
                     'bot_win': ht.get('win', 0), 'bot_lose': ht.get('lose', 0), 'bot_tie': ht.get('tie', 0),
                     'pen_won': ht.get('penWon', 0), 'pen_paid': ht.get('penPaid', 0), 'slams': (d or {}).get('slams', 0)})
        for p in (d or {}).get('per', []):
            prows.append({'day': day, 'who': p['who'], 'hands': p['win'] + p['lose'] + p['tie'], 'win': p['win'], 'lose': p['lose'], 'tie': p['tie']})
    json.dump(rows, open(os.path.join(a.dash, 'days.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(prows, open(os.path.join(a.dash, 'players.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print('dash', len(rows), 'days,', len(prows), 'player rows ->', a.dash)


if __name__ == '__main__':
    sys.exit(main())
