#!/usr/bin/env python3
"""收牌谱：把网页传到公共 MQTT 服务器上的牌谱和"今天打开过"收下来，去掉名字、加密后存进 data 分支。

牌谱只有发的牌、每一手出了什么、输赢和随机编号，不带名字（网页从第九版起就不传名字，这里再保险删一遍）。

GitHub Actions 每小时跑一次（.github/workflows/collect.yml），也可以在本机跑：

    python3 tools/collect.py fetch --store store --cert tools/rec-cert.pem --out archived.json
    python3 tools/collect.py clear --list archived.json      # 存好、推上去以后，再从服务器上删掉
    python3 tools/collect.py open --store store --key 私钥.pem --out all.json   # 解开所有存下来的，合成一份

存下来的是加密过的 .cms 文件，只有拿着私钥的人能解开：

    openssl cms -decrypt -binary -inform DER -in x.cms -inkey 私钥.pem | gunzip
"""
import argparse
import gzip
import hashlib
import json
import os
import random
import socket
import ssl
import string
import struct
import subprocess
import sys
import time

PREFIX = os.environ.get('GZ_PREFIX', 'mangshi-gongzhu/v1/')
# 网页先连国内节点，连不上才用国际节点，所以两个都要收。每个先试 TLS，不行再试明文端口。
BROKERS = os.environ.get('GZ_BROKERS', 'broker-cn.emqx.io,broker.emqx.io').split(',')
PORTS = [(int(p), t == '1') for p, t in (x.split(':') for x in os.environ.get('GZ_PORTS', '8883:1,1883:0').split(','))]
TOPICS = ['rec/#', 'visit/#']


def vlen(n):
    out = bytearray()
    while True:
        b = n % 128
        n //= 128
        if n:
            b |= 128
        out.append(b)
        if not n:
            return bytes(out)


def mstr(s):
    b = s.encode('utf-8')
    return struct.pack('>H', len(b)) + b


class Client:
    """极简 MQTT 3.1.1 客户端，只用 QoS 0。"""

    def __init__(self, host, port, tls, timeout=15):
        raw = socket.create_connection((host, port), timeout=timeout)
        if tls:
            ctx = ssl.create_default_context()
            raw = ctx.wrap_socket(raw, server_hostname=host)
        self.s = raw
        self.buf = b''
        self.pid = 0

    def send(self, head, body=b''):
        self.s.sendall(bytes([head]) + vlen(len(body)) + body)

    def _fill(self, n, deadline):
        while len(self.buf) < n:
            left = deadline - time.time()
            if left <= 0:
                raise socket.timeout()
            self.s.settimeout(left)
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError('closed')
            self.buf += chunk

    def read(self, timeout):
        """读一个包；timeout 秒内没有完整的包就返回 None。"""
        deadline = time.time() + timeout
        try:
            self._fill(2, deadline)
            mul, n, i = 1, 0, 1
            while True:
                self._fill(i + 1, deadline)
                b = self.buf[i]
                n += (b & 127) * mul
                mul *= 128
                i += 1
                if not b & 128:
                    break
            self._fill(i + n, deadline + 10)        # 包头到了，正文多等一会儿
        except socket.timeout:
            return None
        head, body = self.buf[0], self.buf[i:i + n]
        self.buf = self.buf[i + n:]
        return head, body

    def connect(self, keepalive=60):
        cid = 'gzc-' + ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(10))
        self.send(0x10, mstr('MQTT') + bytes([4, 2]) + struct.pack('>H', keepalive) + mstr(cid))
        pkt = self.read(15)
        if not pkt or pkt[0] >> 4 != 2 or pkt[1][1] != 0:
            raise ConnectionError('connack failed: %r' % (pkt,))

    def subscribe(self, topic):
        self.pid = self.pid % 65000 + 1
        self.send(0x82, struct.pack('>H', self.pid) + mstr(topic) + b'\x00')

    def publish(self, topic, payload=b'', retain=False):
        self.send(0x30 | (1 if retain else 0), mstr(topic) + payload)

    def ping(self):
        self.send(0xC0)

    def close(self):
        try:
            self.send(0xE0)
            self.s.close()
        except OSError:
            pass


def open_client(host):
    err = None
    for port, tls in PORTS:
        try:
            c = Client(host, port, tls)
            c.connect()
            return c
        except (OSError, ConnectionError) as e:
            err = e
    raise ConnectionError('%s: %s' % (host, err))


def fetch_broker(host, quiet=5.0, total=90.0):
    """订阅牌谱和打开记录，收下所有保留消息；安静 quiet 秒就当收完了。"""
    c = open_client(host)
    for t in TOPICS:
        c.subscribe(PREFIX + t)
    msgs, start, last = {}, time.time(), time.time()
    while time.time() - start < total:
        pkt = c.read(0.5)
        if pkt is None:
            if time.time() - last > quiet:
                break
            continue
        head, body = pkt
        kind = head >> 4
        if kind == 3:
            qos = (head >> 1) & 3
            tl = struct.unpack('>H', body[:2])[0]
            topic = body[2:2 + tl].decode('utf-8', 'replace')
            p = 2 + tl + (2 if qos else 0)
            msgs[topic] = body[p:]
            last = time.time()
        elif kind == 9:
            last = time.time()
    c.close()
    return msgs


def scrub(d):
    """不留名字：座位上只留 k（人/电脑/空）和 u（随机编号）"""
    d.pop('name', None)
    d.pop('n', None)
    seats = d.get('seats')
    if isinstance(seats, list):
        d['seats'] = [{'k': x.get('k'), 'u': x.get('u')} if isinstance(x, dict) else None for x in seats]
    return d


def key_of(topic, d):
    stamp = d.get('last') or d.get('t') or ''
    return hashlib.sha256(('%s|%s|%s' % (topic, d.get('id') or '', stamp)).encode()).hexdigest()[:24]


def cmd_fetch(a):
    os.makedirs(a.store, exist_ok=True)
    seen_path = os.path.join(a.store, 'seen.txt')
    seen = set(open(seen_path).read().split()) if os.path.exists(seen_path) else set()
    recs, visits, clear, report = [], [], [], {}
    for host in BROKERS:
        try:
            msgs = fetch_broker(host)
        except Exception as e:                     # 一个服务器连不上，另一个照样收
            report[host] = 'error: %s' % e
            continue
        n_new = 0
        for topic, payload in msgs.items():
            if not payload:
                continue
            try:
                d = json.loads(payload.decode('utf-8'))
            except ValueError:
                clear.append([host, topic])        # 坏数据也清掉
                continue
            if not isinstance(d, dict):
                clear.append([host, topic])
                continue
            k = key_of(topic, d)
            clear.append([host, topic])
            if k in seen:
                continue
            seen.add(k)
            n_new += 1
            scrub(d)
            d['_topic'] = topic[len(PREFIX):] if topic.startswith(PREFIX) else topic
            d['_broker'] = host
            (recs if topic.startswith(PREFIX + 'rec/') else visits).append(d)
        report[host] = '%d on server, %d new' % (len(msgs), n_new)
    if recs or visits:
        bundle = {'v': 1, 'at': int(time.time() * 1000), 'recs': recs, 'visits': visits}
        raw = gzip.compress(json.dumps(bundle, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        rel = time.strftime('%Y/%m/%d-%H%M%S', time.gmtime()) + '.cms'
        out = os.path.join(a.store, 'b', rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-aes256', '-outform', 'DER', '-out', out, a.cert],
                       input=raw, check=True)
        with open(seen_path, 'w') as f:
            f.write('\n'.join(sorted(seen)) + '\n')
    if a.out:
        with open(a.out, 'w') as f:
            json.dump(clear, f)
    print(json.dumps({'recs': len(recs), 'visits': len(visits), 'brokers': report}, ensure_ascii=False))


def cmd_clear(a):
    items = json.load(open(a.list))
    by_host = {}
    for host, topic in items:
        by_host.setdefault(host, []).append(topic)
    for host, topics in by_host.items():
        try:
            c = open_client(host)
            for i, t in enumerate(topics):
                c.publish(t, b'', retain=True)     # 空的保留消息 = 删掉
                if i % 200 == 199:
                    time.sleep(0.2)
            c.ping()
            c.read(5)                              # 等 PINGRESP，确认前面的都发出去了
            c.close()
            print(host, 'cleared', len(topics))
        except Exception as e:
            print(host, 'clear failed:', e)


def cmd_open(a):
    """解开 store/b 下所有的包，合成一份：牌谱按 id 去重，打开记录按（哪天、谁）留次数最多的那条"""
    import glob
    recs, visits = {}, {}
    files = sorted(glob.glob(os.path.join(a.store, 'b', '**', '*.cms'), recursive=True))
    for f in files:
        raw = subprocess.run(['openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER', '-in', f, '-inkey', a.key],
                             capture_output=True, check=True).stdout
        b = json.loads(gzip.decompress(raw))
        for r in b.get('recs', []):
            if isinstance(r, dict) and r.get('id'):
                recs[r['id']] = scrub(r)
        for v in b.get('visits', []):
            if not isinstance(v, dict) or not v.get('uid') or not v.get('day'):
                continue
            k = (v['day'], v['uid'])
            if k not in visits or (v.get('opens') or 0) >= (visits[k].get('opens') or 0):
                visits[k] = scrub(v)
    out = {'v': 1, 'files': len(files), 'recs': sorted(recs.values(), key=lambda r: r.get('t') or 0),
           'visits': sorted(visits.values(), key=lambda v: (v['day'], v.get('last') or 0))}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(json.dumps({'files': len(files), 'recs': len(out['recs']), 'visits': len(out['visits'])}))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    f = sub.add_parser('fetch')
    f.add_argument('--store', required=True)
    f.add_argument('--cert', required=True)
    f.add_argument('--out')
    c = sub.add_parser('clear')
    c.add_argument('--list', required=True)
    o = sub.add_parser('open')
    o.add_argument('--store', required=True)
    o.add_argument('--key', required=True)
    o.add_argument('--out', required=True)
    a = ap.parse_args()
    {'fetch': cmd_fetch, 'clear': cmd_clear, 'open': cmd_open}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
