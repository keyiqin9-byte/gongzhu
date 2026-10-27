#!/usr/bin/env python3
"""把几个文件打包成在 GitHub 上传页面（github.com/<仓库>/upload/main/<目录>）里分几次执行的 JS。
浏览器工具一次传的代码不能太长，所以切成 ~9KB 一段：

    python3 tools/upload_chunks.py --out 目录 --msg "提交说明" 本地文件[=上传后的名字] ...
    python3 tools/upload_chunks.py --out 目录 --msg "…" --base 线上旧版.html --raw <仓库里的路径> 新版.html=名字
        # 只传和线上旧版的差别（小很多）：页面里先从 raw.githubusercontent.com 取回旧版，核对后再拼出新版

生成 目录/c00.js、c01.js…（依次执行，每段把一块数据放进 window.__P）、目录/fill.js（拼好、校验、
放进上传框、填提交说明，返回文件名和大小）、目录/commit.js（点"Commit changes"）。
"""
import argparse
import base64
import gzip
import hashlib
import json
import os

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--msg', required=True)
ap.add_argument('--size', type=int, default=9000)
ap.add_argument('--base', action='append', default=[], help='和后面的文件一一对应：线上现在的版本（本地副本）')
ap.add_argument('--raw', action='append', default=[], help='和 --base 一一对应：它在仓库 main 分支里的路径')
ap.add_argument('--repo', default='keyiqin9-byte/gongzhu')
ap.add_argument('files', nargs='+')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
import difflib
files = []
for k, x in enumerate(a.files):
    src, _, name = x.partition('=')
    data = open(src, 'rb').read()
    f = {'name': name or os.path.basename(src), 'sha': hashlib.sha256(data).hexdigest(), 'size': len(data)}
    if k < len(a.base):                                # 只传差别：行级的增删改
        old = open(a.base[k], encoding='utf-8').read().split('\n')
        new = data.decode('utf-8').split('\n')
        ops = [[i1, i2, new[j1:j2]] for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes() if tag != 'equal']
        base_bytes = open(a.base[k], 'rb').read()
        f.update({'raw': 'https://raw.githubusercontent.com/%s/main/%s' % (a.repo, a.raw[k]), 'baseSha': hashlib.sha256(base_bytes).hexdigest(),
                  'ops': base64.b64encode(gzip.compress(json.dumps(ops, ensure_ascii=False).encode('utf-8'), 9)).decode()})
    else:
        f['gz'] = base64.b64encode(gzip.compress(data, 9)).decode()
    files.append(f)
blob = json.dumps(files)                               # 只含 base64 和十六进制，放进单引号里不用转义
parts = [blob[i:i + a.size] for i in range(0, len(blob), a.size)]
for i, p in enumerate(parts):
    with open(os.path.join(a.out, 'c%02d.js' % i), 'w') as f:
        f.write("(window.__P = window.__P || [])[%d] = '%s'; '%d/%d ' + window.__P.filter(Boolean).length" % (i, p, i + 1, len(parts)))
fill = '''(async () => {
const N = %d, MSG = %s;
if (!window.__P || window.__P.filter(Boolean).length !== N) throw new Error('chunks missing: ' + (window.__P || []).filter(Boolean).length + '/' + N);
const F = JSON.parse(window.__P.join(''));
const out = [];
const gunzip = async b64 => new Uint8Array(await new Response(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
const sha = async b => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('');
for (const f of F) {
  let buf;
  if (f.ops) {                                       // 只传了差别：取回线上旧版，核对，再拼出新版
    const old = new Uint8Array(await (await fetch((window.__RAW_BASE__ ? window.__RAW_BASE__ + f.name : f.raw) + '?t=' + Date.now(), { cache: 'no-store' })).arrayBuffer());
    if (await sha(old) !== f.baseSha) throw new Error('线上旧版对不上 ' + f.name);
    const L = new TextDecoder().decode(old).split('\\n');
    const ops = JSON.parse(new TextDecoder().decode(await gunzip(f.ops)));
    for (const [i1, i2, rep] of ops.slice().reverse()) L.splice(i1, i2 - i1, ...rep);
    buf = new TextEncoder().encode(L.join('\\n'));
  } else buf = await gunzip(f.gz);
  if (await sha(buf) !== f.sha) throw new Error('sha mismatch ' + f.name);
  out.push(new File([buf], f.name, { type: 'application/octet-stream' }));
}
const dt = new DataTransfer(); out.forEach(f => dt.items.add(f));
const inp = document.querySelector('#upload-manifest-files-input');
inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
const ci = document.querySelector('#commit-summary-input');
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(ci, MSG);
ci.dispatchEvent(new Event('input', { bubbles: true }));
window.__P = null;
return out.map(f => f.name + ' ' + f.size).join(', ');
})()''' % (len(parts), json.dumps(a.msg, ensure_ascii=False))
open(os.path.join(a.out, 'fill.js'), 'w').write(fill)
open(os.path.join(a.out, 'commit.js'), 'w').write("setTimeout(() => document.querySelector('button.js-blob-submit').click(), 50); 'clicked'")
print(json.dumps({'chunks': len(parts), 'files': [(f['name'], f['size']) for f in files]}, ensure_ascii=False))
