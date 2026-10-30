import fs from 'node:fs'; import path from 'node:path'; import YAML from 'yaml';
process.chdir(process.argv[2]);
const files = fs.readdirSync('data/statements').map((f) => 'data/statements/' + f);
const docs = new Map(files.map((f) => [f, YAML.parseDocument(fs.readFileSync(f, 'utf8'))]));
const find = (id) => { for (const d of docs.values()) { const n = d.contents.items.find((it) => it.get('id') === id); if (n) return n; } throw new Error(id); };
const F = {
  art22: ['A coloring $c : [\\mathbb{N}]^2 \\to S$ into a finite semigroup with $c(i,k) = c(i,j) \\cdot c(j,k)$.', 'An infinite homogeneous set.'],
  ttall: ['Numbers $n, k$ and a coloring of the $n$-element chains of $2^{<\\mathbb{N}}$ with $k$ colors.', 'A homogeneous subtree isomorphic to $2^{<\\mathbb{N}}$.'],
  rspo3: ['An infinite partial order of width at most 3.', 'An infinite chain $C$ such that every element is comparable with no element or with infinitely many elements of $C$.'],
  rspo2c: ['An infinite partial order which is a union of two chains.', 'An infinite chain $C$ such that every element is comparable with no element or with infinitely many elements of $C$.'],
  fincoh: ['A finite sequence of sets $R_0, \\dots, R_{n-1}$.', 'An infinite set $C$ with $C \\subseteq^* R_i$ or $C \\subseteq^* \\overline{R_i}$ for each $i < n$.'],
  ccac: ['An infinite partial order.', 'An infinite stable suborder.'],
  sem: ['An infinite stable tournament.', 'An infinite transitive subtournament.'],
  stcoh: ['A stable sequence of sets $\\vec R$.', 'An infinite $\\vec R$-cohesive set.'],
  tt1: ['A number $k$ and a coloring $f : 2^{<\\mathbb{N}} \\to k$.', 'A homogeneous subtree isomorphic to $2^{<\\mathbb{N}}$.'],
  tt12: ['A coloring $f : 2^{<\\mathbb{N}} \\to 2$.', 'A homogeneous subtree isomorphic to $2^{<\\mathbb{N}}$.'],
  part: ['An infinite linear order in which every element has finitely many predecessors or finitely many successors.', 'The set of elements with finitely many predecessors.'],
  rwwkl: ['A binary tree of positive measure.', 'An infinite set homogeneous for a path through the tree.'],
  opt: ['A complete theory $T$ and a family of partial types.', 'A model of $T$ omitting all the nonprincipal types of the family.'],
  pi01g: ['A uniform sequence of dense $\\Pi^0_1$ sets of strings.', 'A set meeting every set of the sequence.'],
  ovw: ['A finite alphabet $A$ and a finite coloring of $A^{<\\mathbb{N}}$.', 'A word $c_0$ and an infinite sequence of left-variable words as in the statement.'],
  gowers: ['A number $k$ and a finite coloring of $\\mathrm{FIN}_k$.', 'An infinite block sequence whose generated combinatorial subspace is monochromatic.'],
  aht: ['A finite coloring of $\\mathbb{N}$.', 'An infinite set whose finite sums of adjacent elements are monochromatic.'],
  gp22: ['A coloring $f : [\\mathbb{N}]^2 \\to 2$ and a largeness notion.', 'An infinite sequence of large finite sets $F_0 < F_1 < \\cdots$ grouping homogeneously.'],
  sgp22: ['A stable coloring $f : [\\mathbb{N}]^2 \\to 2$ and a largeness notion.', 'An infinite sequence of large finite sets $F_0 < F_1 < \\cdots$ grouping homogeneously.'],
};
for (const id of ['ptt2', 'ptt22', 'ptt3', 'ptt32', 'iptt2', 'iptt22', 'iptt3', 'iptt32', 'sptt2', 'sptt22', 'siptt2', 'siptt22']) {
  const n = id.match(/(\d)/)[1];
  F[id] = [`A coloring of the ${n}-element chains of $2^{<\\mathbb{N}}$.`, `A sequence of ${n} subtrees isomorphic to $2^{<\\mathbb{N}}$ which is homogeneous in the polarized sense.`];
}
let n = 0;
for (const [id, [i, s]] of Object.entries(F)) { const node = find(id); if (!node.get('instance')) { node.set('instance', i); node.set('solution', s); n++; } }
for (const [f, d] of docs) fs.writeFileSync(f, d.toString({ lineWidth: 0 }));
console.log('filled', n);
