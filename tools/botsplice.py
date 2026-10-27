#!/usr/bin/env python3
"""电脑打法那一段（"/* ===== 电脑 ===== */" 到下一个分隔线）在用到它的每个页面里是一模一样的。

    python3 tools/botsplice.py get index.html > bot.js     # 取出来改
    python3 tools/botsplice.py put bot.js a.html b.html     # 改好了放回去，可以一次给几个页面
    python3 tools/botsplice.py check a.html b.html          # 几个页面里这段一样吗
"""
import sys

START = '/* ================= 电脑 ================= */'


def span(s):
    i = s.index(START)
    j = s.index('/* ================= ', i + len(START))
    return i, j


def main():
    cmd, *args = sys.argv[1:]
    if cmd == 'get':
        s = open(args[0], encoding='utf-8').read()
        i, j = span(s)
        sys.stdout.write(s[i:j])
    elif cmd == 'put':
        bot = open(args[0], encoding='utf-8').read()
        assert bot.startswith(START), 'bot.js 要从"电脑"那条分隔线开始'
        for f in args[1:]:
            s = open(f, encoding='utf-8').read()
            i, j = span(s)
            open(f, 'w', encoding='utf-8').write(s[:i] + bot + s[j:])
            print('updated', f)
    elif cmd == 'check':
        parts = []
        for f in args:
            s = open(f, encoding='utf-8').read()
            i, j = span(s)
            parts.append(s[i:j])
        same = all(p == parts[0] for p in parts)
        print('same' if same else 'DIFFERENT', [len(p) for p in parts])
        return 0 if same else 1
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
