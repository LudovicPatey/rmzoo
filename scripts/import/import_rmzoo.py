"""One-off import of Eric Astor's RM Zoo results file (github.com/ericastor/rmzoo).

    python3 scripts/import/import_rmzoo.py <results.txt> <arxiv_rel.json>

Writes data/references/rmzoo.yaml, data/statements/rmzoo.yaml and one file
per paper in data/results/rmzoo/. The generated files are plain YAML meant to
be edited by hand afterwards; this script is kept for provenance.
"""
import difflib, json, os, re, sys, unicodedata

sys.path.insert(0, os.path.dirname(__file__))
from rmzoo_defs import FAMILIES, COLORED, TODO_FAMILIES, P, EXISTING, family_def

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
results_path, arxiv_path = sys.argv[1], sys.argv[2]
arxiv = json.load(open(arxiv_path))

q = json.dumps  # JSON strings are valid YAML scalars


def ascii_low(s):
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()


def norm_title(t):
    return re.sub(r'[^a-z0-9]', '', ascii_low(re.sub(r'\$[^$]*\$', '', t)))


# ---- statements -------------------------------------------------------------
fam_re = re.compile(r'^(' + '|'.join(sorted(FAMILIES, key=len, reverse=True)) + r')(\d)?(\d)?$')
statements = {}   # id -> yaml dict


def atom_id(a):
    if a in EXISTING:
        return EXISTING[a]
    sid = a.lower()
    if sid not in statements:
        if a in P:
            d = dict(P[a])
            statements[sid] = dict(id=sid, **d)
        else:
            m = fam_re.match(a)
            if not m:
                raise SystemExit(f'Unknown principle {a}')
            fam, n, k = m.group(1), m.group(2), m.group(3)
            n = int(n) if n else None
            k = int(k) if k else None
            if fam not in COLORED and k is not None:
                raise SystemExit(f'Unexpected colors in {a}')
            label, name, d = family_def(fam, n, k)
            full = name
            if n is not None:
                full += {1: ' for singletons', 2: ' for pairs', 3: ' for triples'}.get(n, f' for {n}-tuples')
            if fam in COLORED and n is not None:
                full += f' ({k} colors)' if k else ' (finitely many colors)'
            tags = ['ramsey']
            if fam.startswith('S') and fam not in ('SER',):
                tags.append('stable')
            st = dict(id=sid, label=label, name=full, kind='problem', tags=tags, **d)
            if fam in TODO_FAMILIES:
                st['todo'] = True
            statements[sid] = st
    return sid


def stmt_id(expr):
    parts = expr.split('+')
    ids = [atom_id(p) for p in parts]
    if len(ids) == 1:
        return ids[0]
    cid = '-'.join(sorted(ids))
    if cid not in statements:
        statements[cid] = dict(id=cid, conjunction=sorted(ids), kind='sentence', tags=[], _parts=parts)
    return cid


# ---- references ---------------------------------------------------------------
refs = {}          # key -> dict
cite_index = []    # (authors-lastnames tuple, yeartoken, key)
header_re = re.compile(r'^#\s?([A-Z][^"(]*?)\s*\(([^)]*)\)\s*-\s*(.+)$')


def split_authors(s):
    s = s.replace(', and ', ', ').replace(' and ', ', ')
    return [a.strip() for a in s.split(',') if a.strip()]


def make_key(lastnames, year):
    base = ''.join(re.sub(r'[^a-z]', '', ascii_low(n)) for n in lastnames[:3]) if len(lastnames) <= 3 \
        else re.sub(r'[^a-z]', '', ascii_low(lastnames[0])) + 'etal'
    key = f'{base}{year}'
    suffix = 'b'
    while key in refs:
        key = f'{base}{year}{suffix}'
        suffix = chr(ord(suffix) + 1)
    return key


def find_arxiv(title, lastnames):
    nt = norm_title(title)
    best, score = None, 0
    for p in arxiv:
        s = difflib.SequenceMatcher(None, nt, norm_title(p['title'])).ratio()
        if s > score:
            best, score = p, s
    if score > 0.86:
        return best
    return None


lines = open(results_path, encoding='utf-8').read().split('\n')
facts = []          # (refkey|None, dict)
primaries = []
cur = None
i = 0
while i < len(lines):
    raw = lines[i]
    line = raw.strip()
    i += 1
    m = header_re.match(raw)
    if m and not raw.startswith('#    ') and not raw.startswith('#Generic'):
        authors_s, yeartok, rest = m.groups()
        title = rest.strip()
        tm = re.match(r'^"(.*)"\s*(\((.*)\))?$', title)
        note = None
        if tm:
            title, note = tm.group(1), tm.group(3)
        title = title.strip('"')
        lastnames = [a.split()[-1] for a in split_authors(authors_s)]
        meta = []
        while i < len(lines) and lines[i].startswith('#    '):
            meta.append(lines[i][5:].strip())
            i += 1
        url = next((x for x in meta if x.startswith('http')), None)
        venue = next((x for x in meta if not x.startswith('http')), note)
        doi = None
        if venue and 'doi:' in venue:
            doi = venue.split('doi:')[1].strip().rstrip('.')
            venue = venue.split(', doi:')[0].split(' doi:')[0].strip().rstrip(',')
        ym = re.match(r'(\d{4})', yeartok)
        year = int(ym.group(1)) if ym else None
        ax = find_arxiv(title, lastnames)
        if ax:
            if not year:
                year = ax['year']
            if not doi and ax.get('doi'):
                doi = ax['doi']
            if (not venue or venue == note) and ax.get('journal'):
                venue = ax['journal']
        status = None if ym else yeartok
        key = make_key(lastnames, year or 'xxxx')
        r = dict(authors=[a for a in split_authors(authors_s)], title=title, year=year or 0)
        if venue:
            r['venue'] = venue
        elif status:
            r['venue'] = status
        if doi:
            r['doi'] = doi
        if ax:
            r['arxiv'] = ax['arxiv']
        elif url and 'arxiv.org' in url:
            r['arxiv'] = url.rsplit('/', 1)[-1]
        if url and not doi and 'arxiv' not in url:
            r['url'] = url
        refs[key] = r
        cite_index.append((tuple(lastnames), yeartok.split(',')[0].strip(), key))
        cur = key
        continue
    if line.startswith('#Slaman CiE11'):
        refs['slaman2011cie'] = dict(authors=['Theodore A. Slaman'], title='Σ₂-bounding and Δ₂-induction (talk slides)',
                                     year=2011, venue='Computability in Europe (CiE) 2011, invited talk')
        cite_index.append((('Slaman',), 'CiE11', 'slaman2011cie'))
        cur = 'slaman2011cie'
        continue
    if not line or line.startswith('#'):
        continue
    mm = re.match(r'^(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$', line)
    if not mm:
        print('skip', line)
        continue
    a, op, b, just = mm.groups()
    if op == 'is':
        primaries.append(stmt_id(a))
        continue
    facts.append((cur, a, op, b, (just or '').strip()))


def resolve_cite(just, cur):
    """Return (refkey|None, loc, note, folklore)."""
    j = just.strip()
    if j.startswith('"""'):
        j = j.strip('"')
    else:
        j = j.strip('"')
    if not j:
        return cur, None, None, cur is None
    m = re.match(r'^(.*?)\s*\(([^)]*)\)\s*(?:\[(.*)\])?\s*(.*)$', j)
    if j.startswith('by definition'):
        return None, None, 'By definition.', True
    if m and m.group(1) and m.group(1)[0].isupper() and len(m.group(1)) < 80 and not j.startswith(('follows', 'due', 'corollary', 'Infinite', 'Full')):
        names = tuple(a.split()[-1] for a in split_authors(m.group(1)))
        ytok = m.group(2).split(',')[0].strip()
        cands = [k for (ln, yt, k) in cite_index if ln == names and yt == ytok]
        if cands:
            key = cur if cur in cands else cands[0]
            loc = m.group(3)
            extra = m.group(4).strip() or None
            return key, loc, extra, False
    if j.startswith('Slaman CiE11'):
        return 'slaman2011cie', re.search(r'\[(.*)\]', j).group(1), None, False
    # free-text justification: keep it as a note
    return None, None, j, True


OPS = {
    '->': ('implication', 'rca0', False), 'w->': ('implication', 'omega', False),
    '-|>': ('separation', 'rca0', False), 'w-|>': ('separation', 'omega', False),
    '<->': ('equivalence', 'rca0', False),
}
by_paper = {}
order = []
forms = {}
unresolved = 0
for cur, a, op, b, just in facts:
    if op == 'form':
        forms[stmt_id(a)] = b
        continue
    key, loc, note, folk = resolve_cite(just, cur)
    if key is None and not folk:
        unresolved += 1
    res = {}
    if op in OPS:
        t, over, _ = OPS[op]
        res = dict(type=t, **{'from': stmt_id(a)}, to=stmt_id(b), over=over)
    elif op.startswith('<=_') or op.startswith('</=_'):
        red = op.split('_')[1]
        red = {'c': 'c', 'sc': 'sc', 'W': 'w', 'sW': 'sw', 'gW': 'gw'}[red]
        # A <=_r B : B implies A over r
        res = dict(type='implication' if op.startswith('<=') else 'separation', **{'from': stmt_id(b)}, to=stmt_id(a), over=red)
    elif op.endswith('c') and re.match(r'^n?(Pi|Sig|uPi|rPi)\d+c$', op):
        neg = op.startswith('n')
        cls = op[1:-1] if neg else op[:-1]
        res = dict(type='conservation', statement=stmt_id(a), base=stmt_id(b), **{'class': cls}, value=not neg)
    else:
        print('unknown op', op)
        continue
    if key:
        res['refs'] = [dict(ref=key, **({'loc': loc} if loc else {}))]
    if folk:
        res['folklore'] = True
    if note:
        res['note'] = note
    pk = cur or 'general'
    if pk not in by_paper:
        by_paper[pk] = []
        order.append(pk)
    by_paper[pk].append(res)

# ---- write ---------------------------------------------------------------------
os.makedirs(os.path.join(ROOT, 'data', 'results', 'rmzoo'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'data', 'references'), exist_ok=True)


def flow(d):
    parts = []
    for k, v in d.items():
        if k.startswith('_'):
            continue
        if isinstance(v, list) and v and isinstance(v[0], dict):
            v = '[' + ', '.join(flow(x) for x in v) + ']'
        elif isinstance(v, (str, bool, int, float, list)):
            v = q(v, ensure_ascii=False)
        parts.append(f'{k}: {v}')
    return '{' + ', '.join(parts) + '}'


HEAD = '# Imported from Eric Astor\'s RM Zoo results file (github.com/ericastor/rmzoo, 2024).\n'
for n, pk in enumerate(order):
    r = refs.get(pk)
    title = f'# {", ".join(r["authors"])} ({r["year"]}) — {r["title"]}\n' if r else '# General facts\n'
    with open(os.path.join(ROOT, 'data', 'results', 'rmzoo', f'{n:03d}-{pk}.yaml'), 'w') as f:
        f.write(HEAD + title + '\n')
        for res in by_paper[pk]:
            f.write('- ' + flow(res) + '\n')

with open(os.path.join(ROOT, 'data', 'references', 'rmzoo.yaml'), 'w') as f:
    f.write(HEAD + '\n')
    for k, r in refs.items():
        f.write(f'{k}:\n')
        for kk, v in r.items():
            f.write(f'  {kk}: {q(v, ensure_ascii=False)}\n')

prim = {s: i for i, s in enumerate(primaries)}
with open(os.path.join(ROOT, 'data', 'statements', 'rmzoo.yaml'), 'w') as f:
    f.write(HEAD + '# Entries with todo: true need their definition checked against the source.\n\n')
    for sid, s in sorted(statements.items()):
        if s.get('conjunction'):
            labels = []
            for pid in s['conjunction']:
                labels.append(statements[pid]['label'] if pid in statements else None)
            s['label'] = None  # filled by the build from the conjuncts
        out = {k: v for k, v in s.items() if v is not None and not k.startswith('_')}
        if sid in forms:
            out['form'] = forms.pop(sid)
        if sid in prim:
            out['priority'] = -10
        f.write('- ' + flow(out) + '\n')

json.dump(dict(forms=forms, primaries=primaries), open(os.path.join(os.path.dirname(results_path), 'import_extra.json'), 'w'), indent=1)
print(f'{len(refs)} references, {len(statements)} new statements, {sum(len(v) for v in by_paper.values())} results, '
      f'{len(order)} files, {unresolved} unresolved citations; forms on existing statements: {forms}')
