# Checks two CSS folders (tokens.css, base.css, cards.css) resolve to the same values: python3 css-equiv.py <old_css_dir> <new_css_dir>
import re,sys
def toks(path):
    t=open(path).read()
    root=re.search(r':root\s*\{(.*?)\n\}',t,re.S).group(1)
    root=re.sub(r'/\*.*?\*/','',root,flags=re.S)
    d=dict(re.findall(r'(--[\w-]+)\s*:\s*([^;]+);',root))
    for m in re.finditer(r':root\s*\{([^}]*)\}',t): d.update(re.findall(r'(--[\w-]+)\s*:\s*([^;]+);',re.sub(r'/\*.*?\*/','',m.group(1),flags=re.S)))
    return d
def resolve(v,T,depth=0):
    for _ in range(10):
        n=re.sub(r'var\((--[\w-]+)(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)',lambda m:T.get(m.group(1),m.group(0)).strip() if m.group(1)!='--s' else 'S',v)
        if n==v: break
        v=n
    return v
def hexrgb(m):
    h=m.group(1)
    if len(h)==3: h=''.join(c*2 for c in h)
    return 'rgba(%d, %d, %d, 1)'%tuple(int(h[i:i+2],16) for i in (0,2,4))
def norm(v):
    v=re.sub(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b',hexrgb,v)
    v=re.sub(r'rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)',r'rgba(\1, \2, \3, 1)',v)
    v=re.sub(r'(?<![\d.])\.(\d)',r'0.\1',v)
    v=re.sub(r'\s+',' ',v).strip()
    return v
def decls(path,T):
    t=re.sub(r'/\*.*?\*/','',open(path).read(),flags=re.S)
    out=[]
    for m in re.finditer(r'([^{}]*)\{([^{}]*)\}',t):
        sel=re.sub(r'\s+',' ',m.group(1)).strip()
        for p,v in re.findall(r'(?:^|(?<=[;{]))\s*([a-z-]+)\s*:([^;]*)',m.group(2)):
            out.append((sel,p,norm(resolve(v,T))))
    return out
O,N=sys.argv[1],sys.argv[2]
TO,TN=toks(O+'/tokens.css'),toks(N+'/tokens.css')
for k in TO:
    if norm(resolve(TO[k],TO))!=norm(resolve(TN.get(k,'MISSING'),TN)): print('TOKEN CHANGED',k)
bad=0
for fn in ['base.css','cards.css']:
    a,b=decls(f'{O}/{fn}',TO),decls(f'{N}/{fn}',TN)
    print(fn,len(a),len(b))
    for x,y in zip(a,b):
        if x!=y: bad+=1; print('DIFF',fn,x[0][-50:],'|',x[1],'|',x[2],'=>',y[2])
print('total diffs',bad)
