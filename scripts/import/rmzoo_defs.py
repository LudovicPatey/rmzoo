# Definitions of the principles used in Eric Astor's RM Zoo results file.
# Used by import_rmzoo.py. Entries with "todo" have a definition that still
# needs to be checked against the source paper.

N = r'\mathbb{N}'

# ---- Ramsey-like families ---------------------------------------------------
# name -> (TeX head, full name, kind of statement)
FAMILIES = {
    'RT':    (r'\mathsf{RT}', "Ramsey's theorem"),
    'SRT':   (r'\mathsf{SRT}', "Stable Ramsey's theorem"),
    'D':     (r'\mathsf{D}', 'Δ⁰₂ subset principle'),
    'PT':    (r'\mathsf{PT}', 'Polarized Ramsey theorem'),
    'SPT':   (r'\mathsf{SPT}', 'Stable polarized Ramsey theorem'),
    'IPT':   (r'\mathsf{IPT}', 'Increasing polarized Ramsey theorem'),
    'SIPT':  (r'\mathsf{SIPT}', 'Stable increasing polarized Ramsey theorem'),
    'TT':    (r'\mathsf{TT}', 'Tree theorem'),
    'STT':   (r'\mathsf{STT}', 'Stable tree theorem'),
    'PTT':   (r'\mathsf{PTT}', 'Polarized tree theorem'),
    'SPTT':  (r'\mathsf{SPTT}', 'Stable polarized tree theorem'),
    'IPTT':  (r'\mathsf{IPTT}', 'Increasing polarized tree theorem'),
    'SIPTT': (r'\mathsf{SIPTT}', 'Stable increasing polarized tree theorem'),
    'CTT':   (r'\mathsf{CTT}', 'Cohesive tree theorem'),
    'TS':    (r'\mathsf{TS}', 'Thin set theorem'),
    'STS':   (r'\mathsf{STS}', 'Stable thin set theorem'),
    'FS':    (r'\mathsf{FS}', 'Free set theorem'),
    'SFS':   (r'\mathsf{SFS}', 'Stable free set theorem'),
    'RRT':   (r'\mathsf{RRT}', 'Rainbow Ramsey theorem'),
    'SRRT':  (r'\mathsf{SRRT}', 'Stable rainbow Ramsey theorem'),
    'WSRRT': (r'\mathsf{WSRRT}', 'Weakly stable rainbow Ramsey theorem'),
    'GP':    (r'\mathsf{GP}', 'Grouping principle'),
    'SGP':   (r'\mathsf{SGP}', 'Stable grouping principle'),
    'CRT':   (r'\mathsf{CRT}', 'Cohesive Ramsey theorem'),
    'StCRT': (r'\mathsf{StCRT}', 'Cohesive Ramsey theorem for stable-like colorings'),
    'ER':    (r'\mathsf{ER}', 'Erdős–Rado theorem for the rationals'),
    'SER':   (r'\mathsf{SER}', 'Stable Erdős–Rado theorem'),
    'ASRT':  (r'\mathsf{ASRT}', 'Almost stable Ramsey theorem'),
    'psRT':  (r'\mathsf{psRT}', 'Pseudo Ramsey theorem'),
}
# families whose second index is a number of colors
COLORED = {'RT', 'SRT', 'D', 'PT', 'SPT', 'IPT', 'SIPT', 'TT', 'STT', 'PTT', 'SPTT', 'IPTT', 'SIPTT',
           'CTT', 'RRT', 'SRRT', 'WSRRT', 'GP', 'SGP', 'CRT', 'StCRT', 'ER', 'SER', 'ASRT', 'psRT'}
TODO_FAMILIES = {'StCRT', 'ER', 'SER', 'ASRT', 'psRT', 'CTT'}


def family_def(fam, n, k):
    """n: int or None (all exponents); k: int or None (any finite number)."""
    head, name = FAMILIES[fam]
    nn = '' if n is None else str(n)
    if fam in COLORED:
        kk = '' if (n is None) else ('_{<\\infty}' if k is None else f'_{k}')
        label = f'{head}^{{{nn}}}{kk}' if n is not None else head
    else:
        label = f'{head}^{{{nn}}}' if n is not None else head
    tup = f'[{N}]^{{{n}}}' if n is not None else f'[{N}]^n'
    cols = f'{k}' if k is not None else 'k'
    qual = '' if n is not None else ' for every exponent $n$'
    qualk = '' if k is not None or fam not in COLORED else ' for every $k$'
    stable = f' $f : [{N}]^2 \\to {cols}$ is stable if $\\lim_y f(x, y)$ exists for every $x$.'
    d = {}
    if fam == 'RT':
        d['definition'] = f'Every coloring $f : {tup} \\to {cols}$ has an infinite homogeneous set{qual}{qualk}.'
        d['instance'] = f'A coloring $f : {tup} \\to {cols}$.'
        d['solution'] = f'An infinite set $H$ such that $f$ is constant on $[H]^{{{n or "n"}}}$.'
    elif fam == 'SRT':
        d['definition'] = f'Every stable coloring $f : [{N}]^2 \\to {cols}$ has an infinite homogeneous set{qualk}.' + stable
        d['instance'] = f'A stable coloring $f : [{N}]^2 \\to {cols}$.'
        d['solution'] = 'An infinite homogeneous set.'
    elif fam == 'D':
        d['definition'] = (f'For every stable coloring $f : [{N}]^2 \\to {cols}${qualk}, there is an infinite set $H$ and a color $i$ '
                           'with $\\lim_y f(x, y) = i$ for all $x \\in H$.')
        d['instance'] = f'A stable coloring $f : [{N}]^2 \\to {cols}$.'
        d['solution'] = 'An infinite limit-homogeneous set.'
    elif fam in ('PT', 'SPT'):
        st = 'stable ' if fam == 'SPT' else ''
        d['definition'] = (f'For every {st}coloring $f : {tup} \\to {cols}${qualk}, there are infinite sets $H_1, \\dots, H_{{{n or "n"}}}$ '
                           f'such that $f$ is constant on all sets $\\{{x_1, \\dots, x_{{{n or "n"}}}\\}} \\in {tup}$ with $x_i \\in H_i$.')
        d['instance'] = f'A {st}coloring $f : {tup} \\to {cols}$.'
        d['solution'] = 'An infinite homogeneous sequence of sets $(H_1, \\dots, H_n)$.'
    elif fam in ('IPT', 'SIPT'):
        st = 'stable ' if fam == 'SIPT' else ''
        d['definition'] = (f'For every {st}coloring $f : {tup} \\to {cols}${qualk}, there are infinite sets $H_1, \\dots, H_{{{n or "n"}}}$ '
                           f'such that $f$ is constant on all increasing tuples $x_1 < \\dots < x_{{{n or "n"}}}$ with $x_i \\in H_i$.')
        d['instance'] = f'A {st}coloring $f : {tup} \\to {cols}$.'
        d['solution'] = 'An infinite increasing-homogeneous sequence of sets.'
    elif fam in ('TT', 'STT'):
        st = 'stable ' if fam == 'STT' else ''
        d['definition'] = (f'For every {st}coloring $f$ of the $' + (str(n) if n else 'n') + f'$-element chains of $2^{{<{N}}}$ with {cols} colors{qualk}, '
                           'there is a subtree $S \\subseteq 2^{<\\mathbb{N}}$ isomorphic to $2^{<\\mathbb{N}}$ on whose chains $f$ is constant.')
        d['instance'] = f'A {st}coloring of $[2^{{<{N}}}]^{{{n or "n"}}}$ with {cols} colors.'
        d['solution'] = 'A homogeneous subtree isomorphic to $2^{<\\mathbb{N}}$.'
    elif fam in ('PTT', 'SPTT', 'IPTT', 'SIPTT'):
        d['definition'] = (f'Polarized version of the tree theorem $\\mathsf{{TT}}^{{{n}}}_{{{cols}}}$: one asks for a sequence of '
                           'subtrees isomorphic to $2^{<\\mathbb{N}}$, one per coordinate'
                           + (', and only increasing chains are considered' if 'I' in fam else '')
                           + ('; restricted to stable colorings' if fam.startswith('S') else '') + '.')
    elif fam in ('TS', 'STS'):
        st = 'stable ' if fam == 'STS' else ''
        d['definition'] = f'Every {st}function $f : {tup} \\to {N}$ has an infinite thin set $H$, i.e. $f[[H]^{{{n or "n"}}}] \\neq {N}${qual}.'
        d['instance'] = f'A {st}function $f : {tup} \\to {N}$.'
        d['solution'] = f'An infinite set $H$ with $f[[H]^{{{n or "n"}}}] \\neq {N}$.'
    elif fam in ('FS', 'SFS'):
        st = 'stable ' if fam == 'SFS' else ''
        d['definition'] = (f'Every {st}function $f : {tup} \\to {N}$ has an infinite free set $H$: for every $s \\in [H]^{{{n or "n"}}}$, '
                           f'if $f(s) \\in H$ then $f(s) \\in s${qual}.')
        d['instance'] = f'A {st}function $f : {tup} \\to {N}$.'
        d['solution'] = 'An infinite free set.'
    elif fam in ('RRT', 'SRRT', 'WSRRT'):
        st = {'RRT': '', 'SRRT': 'normal ', 'WSRRT': 'weakly stable '}[fam]
        d['definition'] = (f'Every {st}{cols}-bounded function $f : {tup} \\to {N}$ (each color used at most {cols} times) '
                           f'has an infinite rainbow set $H$, i.e. $f$ is injective on $[H]^{{{n or "n"}}}${qual}.')
        d['instance'] = f'A {st}{cols}-bounded function $f : {tup} \\to {N}$.'
        d['solution'] = 'An infinite rainbow set.'
    elif fam in ('GP', 'SGP'):
        st = 'stable ' if fam == 'SGP' else ''
        d['definition'] = (f'For every {st}coloring $f : [{N}]^{n} \\to {cols}$ and every largeness notion, there is an infinite sequence '
                           'of large finite sets $F_0 < F_1 < \\cdots$ and a color $i$ with $f(x, y) = i$ whenever $x \\in F_a$, $y \\in F_b$, $a < b$.')
    elif fam == 'CRT':
        d['definition'] = f'For every coloring $f : [{N}]^2 \\to {cols}$ there is an infinite set $H$ such that $f \\restriction [H]^2$ is stable.'
        d['instance'] = f'A coloring $f : [{N}]^2 \\to {cols}$.'
        d['solution'] = 'An infinite set on which $f$ is stable.'
    else:
        d['definition'] = f'{name} for exponent {n or "n"} and {cols} colors. See the source paper for the precise formulation.'
    return label, name, d


# ---- other principles -------------------------------------------------------
# id: dict(label, name, kind, tags, definition, instance, solution, firstOrder, todo, form)
P = {}
def add(id_, label, name, definition, tags, kind='problem', **kw):
    P[id_] = dict(label=label, name=name, definition=definition, tags=tags, kind=kind, **kw)

add('PA', r'\mathsf{PA}', 'Full first-order induction', 'The induction scheme for all arithmetical formulas.',
    ['induction', 'first-order'], kind='sentence', firstOrder=True)
add('ISig3', r'\mathsf{I}\Sigma^0_3', 'Σ⁰₃ induction', 'The induction scheme restricted to $\\Sigma^0_3$ formulas.',
    ['induction', 'first-order'], kind='sentence', firstOrder=True)
add('BSig3', r'\mathsf{B}\Sigma^0_3', 'Σ⁰₃ collection', 'The collection (bounding) scheme for $\\Sigma^0_3$ formulas.',
    ['induction', 'first-order'], kind='sentence', firstOrder=True)
add('BPi1', r'\mathsf{B}\Pi^0_1', 'Π⁰₁ collection', 'The collection scheme for $\\Pi^0_1$ formulas.',
    ['induction', 'first-order'], kind='sentence', firstOrder=True)
add('BPi2', r'\mathsf{B}\Pi^0_2', 'Π⁰₂ collection', 'The collection scheme for $\\Pi^0_2$ formulas.',
    ['induction', 'first-order'], kind='sentence', firstOrder=True)
add('CSig2', r'\mathsf{C}\Sigma^0_2', 'Σ⁰₂ cardinality scheme',
    'There is no $\\Sigma^0_2$-definable injection from $\\mathbb{N}$ into a finite set $\\{0, \\dots, n-1\\}$.',
    ['induction', 'first-order'], kind='sentence', firstOrder=True)
add('CSig', r'\mathsf{C}\Sigma', 'Cardinality scheme',
    'For every $n$, there is no $\\Sigma^0_n$-definable injection from $\\mathbb{N}$ into a finite set.',
    ['induction', 'first-order'], kind='sentence', firstOrder=True)
add('KL', r'\mathsf{KL}', "König's lemma", 'Every infinite finitely branching subtree of $\\mathbb{N}^{<\\mathbb{N}}$ has an infinite path.',
    ['compactness'], instance='An infinite finitely branching tree.', solution='An infinite path.')
add('WWKL2', r'2\text{-}\mathsf{WWKL}', '2-Weak weak König\'s lemma',
    'WWKL relativized to the jump: every $\\Delta^0_2$-tree of positive measure has a path.',
    ['randomness', 'compactness'], instance='A $\\Delta^0_2$ binary tree of positive measure.', solution='A path through it.')
add('RAN1', r'\mathsf{RAN}_1', 'Existence of Martin-Löf randoms', 'For every $X$ there is a set which is Martin-Löf random relative to $X$.',
    ['randomness'], instance='A set $X$.', solution='A set Martin-Löf random relative to $X$.')
add('RAN2', r'\mathsf{RAN}_2', 'Existence of 2-randoms', 'For every $X$ there is a set which is 2-random relative to $X$.',
    ['randomness'], instance='A set $X$.', solution='A set 2-random relative to $X$.')
add('POS1', r'\mathsf{POS}_1', 'Positive-measure Π⁰₁ classes are inhabited',
    'Every $\\Pi^0_1$ class of positive measure is nonempty (as formalized by Avigad, Dean and Rute).', ['randomness'], todo=True)
add('POS2', r'\mathsf{POS}_2', 'Positive-measure Π⁰₂ classes are inhabited',
    'Every $\\Pi^0_2$ class of positive measure is nonempty (as formalized by Avigad, Dean and Rute).', ['randomness'], todo=True)
add('POS', r'\mathsf{POS}', 'Positive-measure classes are inhabited',
    'Measure-theoretic principle of Dobrinen and Simpson: every $G_\\delta$ class of positive measure has a member (see the source).',
    ['randomness'], todo=True)
add('GdREG', r'G_\delta\text{-}\mathsf{REG}', 'G_δ regularity',
    'Every $G_\\delta$ set is regular for measure: it contains a closed set of the same measure (Dobrinen–Simpson).', ['randomness'], todo=True)
add('DCTp', r"\mathsf{DCT}'", 'Dominated convergence theorem (variant)',
    'A formalization of the dominated convergence theorem studied by Avigad, Dean and Rute.', ['randomness'], todo=True)
add('PHPM', r'\mathsf{PHPM}', 'Pigeonhole principle for measure',
    'For every finite partition of $2^{\\mathbb{N}}$ into Borel pieces, one piece has positive measure (formalized with codes; see Slaman).',
    ['randomness'], kind='sentence', todo=True)
add('SRAM', r'\mathsf{SRAM}', 'Stable Ramsey for measure', 'Measure-theoretic variant of SRT²₂ studied by Dzhafarov (2011).', ['ramsey', 'randomness'], todo=True)
add('ASRAM', r'\mathsf{ASRAM}', 'Almost stable Ramsey for measure', 'Measure-theoretic variant of SRT²₂ studied by Dzhafarov (2011).', ['ramsey', 'randomness'], todo=True)
add('DNR0', r"\mathsf{DNR}[\emptyset']", 'DNR relative to the jump',
    "For every $X$ there is a function $f$ with $f(e) \\neq \\Phi^{X'}_e(e)$ for every $e$.",
    ['computability', 'randomness'], instance='A set $X$.', solution="A function DNC relative to $X'$.")
add('HYP', r'\mathsf{HYP}', 'Hyperimmunity principle', 'For every $X$ there is a function not dominated by any $X$-computable function.',
    ['computability'], instance='A set $X$.', solution='A function which is hyperimmune relative to $X$.')
add('GEN1', r'\mathsf{GEN}_1', 'Existence of 1-generics', 'For every $X$ there is a set which is Cohen 1-generic relative to $X$.',
    ['computability'], instance='A set $X$.', solution='A set 1-generic relative to $X$.')
add('Pi01G', r'\Pi^0_1\mathsf{G}', 'Π⁰₁ genericity',
    'For every uniform sequence of dense $\\Pi^0_1$ sets of strings, there is a set meeting each of them.', ['computability'])
add('AMT', r'\mathsf{AMT}', 'Atomic model theorem', 'Every complete atomic theory has an atomic model.', ['computability'],
    instance='A complete atomic theory $T$.', solution='An atomic model of $T$.')
add('OPT', r'\mathsf{OPT}', 'Omitting partial types',
    'For every complete theory $T$ and every family of partial types, there is a model of $T$ omitting all the nonprincipal ones.',
    ['computability'])
add('AST', r'\mathsf{AST}', 'Atomic model theorem (subenumerable types)',
    'Variant of the atomic model theorem from Hirschfeldt, Shore and Slaman (2009); see the source.', ['computability'], todo=True)
add('FIP', r'\mathsf{FIP}', 'Finite intersection principle',
    'Every nontrivial family of sets has a maximal subfamily with the finite intersection property.', ['computability'],
    instance='A nontrivial family of sets.', solution='A maximal subfamily with the finite intersection property.')
add('D2IP', r'\mathsf{D}_2\mathsf{IP}', '2-disjointness intersection principle',
    'Every nontrivial family of sets has a maximal subfamily whose members pairwise intersect.', ['computability'])
add('nD2IP', r'\overline{\mathsf{D}}_2\mathsf{IP}', 'Nontrivial D₂IP',
    'Variant of $\\mathsf{D}_2\\mathsf{IP}$ from Dzhafarov and Mummert (2013); see the source.', ['computability'], todo=True)
add('PART', r'\mathsf{PART}', 'Partition principle for ω+ω*',
    'Every infinite linear order in which every element has finitely many predecessors or finitely many successors can be partitioned into its $\\omega$ part and its $\\omega^*$ part.',
    ['orders'])
add('CCAC', r'\mathsf{CCAC}', 'Cohesive chain–antichain principle', 'Every infinite partial order has an infinite stable suborder.', ['orders', 'cohesive'])
add('WSCAC', r'\mathsf{WSCAC}', 'Weakly stable chain–antichain principle',
    'CAC restricted to weakly stable partial orders (Patey, "Partial orders and immunity").', ['orders', 'stable'], todo=True)
add('StCOH', r'\mathsf{StCOH}', 'Stable cohesiveness',
    'COH restricted to stable sequences $\\vec R$ (for each $n$, $n \\in R_i$ for almost all $i$ or for almost no $i$).', ['cohesive'])
add('StCADS', r'\mathsf{StCADS}', 'Stable CADS', 'CADS restricted to linear orders of type $\\omega + \\omega^*$-like stability (Hirschfeldt–Shore).', ['orders', 'cohesive'], todo=True)
add('SEM', r'\mathsf{SEM}', 'Stable Erdős–Moser theorem', 'EM restricted to stable tournaments.', ['ramsey', 'stable'])
add('RWKL', r'\mathsf{RWKL}', 'Ramsey-type weak König\'s lemma',
    'For every infinite binary tree $T$ there is an infinite set $H$ which is homogeneous for a path through $T$.', ['ramsey', 'compactness'],
    instance='An infinite binary tree $T$.', solution='An infinite set $H$ such that some path of $T$ is constant on $H$.')
add('RWWKL', r'\mathsf{RWWKL}', 'Ramsey-type weak weak König\'s lemma', 'RWKL restricted to trees of positive measure.', ['ramsey', 'randomness'])
add('RWKL2', r'\mathsf{RWKL}_2', 'Ramsey-type WKL (variant)', 'Variant of RWKL from Flood (2012); see the source.', ['ramsey', 'compactness'], todo=True)
add('RWKLw', r'\mathsf{RWKL}_\omega', 'Ramsey-type WKL (variant)', 'Variant of RWKL from Flood (2012); see the source.', ['ramsey', 'compactness'], todo=True)
add('RWWKL2', r'\mathsf{RWWKL}_2', 'Ramsey-type WWKL (variant)', 'Variant of RWWKL from Bienvenu, Patey and Shafer (2017); see the source.', ['ramsey', 'randomness'], todo=True)
add('Dw2', r'\mathsf{D}^2_\omega', 'Δ⁰₂ subset principle (variant)', 'Variant of the Δ⁰₂ subset principle from Flood (2012); see the source.', ['ramsey'], todo=True)
add('P22', r'\mathsf{P}^2_2', 'Path principle', 'Variant of $\\mathsf{D}^2_2$ from Flood (2012); see the source.', ['ramsey'], todo=True)
add('RSAT', r'\mathsf{RSAT}', 'Ramsey-type satisfiability',
    'For every finitely satisfiable set of propositional clauses, there is an infinite set of variables and a truth value such that the corresponding literals are consistent with the set of clauses (Bienvenu–Patey–Shafer).',
    ['ramsey', 'compactness'], todo=True)
add('RCOLOR2', r'\mathsf{RCOLOR}_2', 'Ramsey-type 2-coloring',
    'For every locally 2-colorable graph, there is an infinite set of vertices $H$ such that every finite subgraph is 2-colorable with $H$ monochromatic (Bienvenu–Patey–Shafer).',
    ['ramsey', 'compactness'], todo=True)
add('RCOLOR3', r'\mathsf{RCOLOR}_3', 'Ramsey-type 3-coloring', 'As $\\mathsf{RCOLOR}_2$ with 3 colors.', ['ramsey', 'compactness'], todo=True)
add('ProdWQO', r'\mathsf{ProdWQO}', 'Products of wqos', 'The product of two well-quasi-orders is a well-quasi-order.', ['orders'])
add('TT1', r'\mathsf{TT}^1_{<\infty}', 'Tree theorem for singletons',
    'For every $k$, every coloring $f : 2^{<\\mathbb{N}} \\to k$ has a homogeneous subtree isomorphic to $2^{<\\mathbb{N}}$.', ['ramsey'])
add('TT12', r'\mathsf{TT}^1_2', 'Tree theorem for singletons (2 colors)',
    'Every coloring $f : 2^{<\\mathbb{N}} \\to 2$ has a homogeneous subtree isomorphic to $2^{<\\mathbb{N}}$.', ['ramsey'])
add('ER1', r'\mathsf{ER}^1', 'Erdős–Rado theorem for singletons (rationals)',
    'Coloring theorem for the rationals from Frittaion and Patey; see the source.', ['ramsey'], todo=True)

# atoms which map onto statements already defined by hand in data/statements
EXISTING = {
    'RCA': 'rca0', 'WKL': 'wkl', 'WWKL': 'wwkl', 'DNR': 'dnr', 'ACA': 'aca', 'ISig2': 'isig2', 'BSig2': 'bsig2',
    'IDelta2': 'idelta2', 'RT12': 'rt12', 'RT1': 'rt1inf', 'RT22': 'rt22', 'RT32': 'rt32', 'SRT22': 'srt22',
    'D22': 'd22', 'COH': 'coh', 'EM': 'em', 'CAC': 'cac', 'SCAC': 'scac', 'ADS': 'ads', 'SADS': 'sads', 'CADS': 'cads',
}
