// BibTeX export of references (entries keyed by the zoo's citation keys).
// Venues are free text in the database, so the entry type and the
// journal/volume/number/pages fields are recovered heuristically; the full
// venue string is kept in `note` whenever it could not be parsed.

const ACCENT = { '́': "'", '̀': '`', '̈': '"', '̂': '^', '̃': '~', '̄': '=', '̇': '.',
  '̧': 'c', '̌': 'v', '̆': 'u', '̋': 'H', '̨': 'k', '̊': 'r' };
const SPECIAL = { 'ø': '{\\o}', 'Ø': '{\\O}', 'ł': '{\\l}', 'Ł': '{\\L}', 'ß': '{\\ss}', 'æ': '{\\ae}', 'Æ': '{\\AE}', 'œ': '{\\oe}',
  'å': '{\\aa}', 'Å': '{\\AA}', 'ı': '{\\i}', '–': '--', '—': '---', '’': "'", '‘': '`', '“': '``', '”': "''", '′': "'", '…': '\\ldots{}',
  '&': '\\&', '%': '\\%', '#': '\\#' };
const MATH = { 'Σ': '\\Sigma', 'Π': '\\Pi', 'Δ': '\\Delta', 'Ω': '\\Omega', 'ω': '\\omega', 'α': '\\alpha', 'ε': '\\varepsilon', '∑': '\\Sigma',
  '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4', '₀': '_0', '₁': '_1', '₂': '_2', '₃': '_3', '₄': '_4' };

// Unicode → LaTeX, leaving $…$ math untouched; runs of math symbols (Π⁰₁) become one $…$.
export function latex(s) {
  return String(s ?? '').split(/(\$[^$]+\$)/g).map((part) => {
    if (part.length > 1 && part.startsWith('$') && part.endsWith('$')) return part.replace(/[ΣΠΔΩωαε∑]/g, (c) => MATH[c] + ' ');
    return part.normalize('NFD')
      .replace(/[ΣΠΔΩωαε∑⁰¹²³⁴₀₁₂₃₄]+/g, (m) => '$' + [...m].map((c) => MATH[c]).join('').replace(/([\^_])(\d)\1(\d)/g, '$1{$2$3}') + '$')
      .replace(/([A-Za-z])([̀-ͯ])/g, (m, c, a) => (ACCENT[a] ? `{\\${ACCENT[a]}${/[a-z]/.test(ACCENT[a]) ? ' ' : ''}${c === 'i' ? '\\i' : c}}` : c))
      .replace(/[̀-ͯ]/g, '')
      .replace(/[øØłŁßæÆœåÅı–—’‘“”′…&%#]/g, (c) => SPECIAL[c])
      .normalize('NFC');
  }).join('');
}

const pagesOf = (s) => {
  const m = s.match(/(?:pages?\s*)?\b(\d+(?::\d+)?)\s*(?:–|--|-|—)\s*(\d+(?::\d+)?)\b/);
  return m ? `${m[1]}--${m[2]}` : null;
};

// Parse a free-text venue into BibTeX fields.
export function venueFields(r) {
  const v = String(r.venue || '').replace(/;?\s*https?:\S+/g, '').replace(/,?\s*ISBN[-\d: X]*/g, '').trim();
  if (!v) return { type: 'misc', fields: r.arxiv ? { howpublished: 'arXiv preprint' } : {} };
  if (/^arXiv\b/i.test(v)) {
    const m = v.match(/\(([^)]+)\)/); // "arXiv preprint (Transactions of the AMS)" = accepted there
    return { type: 'misc', fields: { howpublished: 'arXiv preprint', ...(m ? { note: `To appear in ${m[1]}` } : {}) } };
  }
  if (/\bthesis\b|\bMSc\b|habilitation/i.test(v)) {
    const school = v.replace(/^.*?thesis,?\s*/i, '').replace(/^MSc in [^,]* at /i, '') || v;
    return { type: /master|MSc|diplom/i.test(v) ? 'mastersthesis' : 'phdthesis', fields: { school } };
  }
  const journalProc = /^Proceedings of the (American|London|Edinburgh) Mathematical Society|^Proceedings of the Royal Society/i.test(v);
  if (!journalProc && /proceedings|conference|symposium|workshop|lecture notes|contemporary mathematics|\bLNCS\b|\bCCA\b|essays|dedicated|festschrift|in honou?r|crossroads|, (?:1\d{4}|[3-9]\d{3}), \d|^in: |\([A-Z]+'\d\d\)/i.test(v)) {
    const pages = pagesOf(v);
    return { type: 'inproceedings', fields: { booktitle: v.replace(/^in: /, '').replace(/,?\s*(?:pages?\s*|pp\.\s*)?\d+(?::\d+)?\s*(?:–|--|-)\s*\d+(?::\d+)?\s*$/, ''), ...(pages ? { pages } : {}) } };
  }
  if (/Press|Springer|Birkh|World Scientific|Cambridge University|Oxford|Elsevier|North-Holland|Association for Symbolic Logic|A K Peters/i.test(v) && !/\d+\s*\(\d/.test(v))
    return { type: 'book', fields: { publisher: v } };
  if (/^(?:Department|Faculty|Fachbereich|Institute|Mathematical Institute)\b|^Universit|University\b[^\d]*$/i.test(v))
    return { type: 'techreport', fields: { institution: v } };
  // Journal: "Name[,] [Volume[:]] 12[(3)][ (year)][, no. 4][, pages] …"
  const m = v.replace(/,\s*(?:19|20)\d\d(?=,)/, '').match(/^(.*?[A-Za-z.)])[,.]?\s+(?:Volume:?\s*|vol\.\s*)?(\d+)\b(?!\s*(?:–|--|-)\s*\d)\s*(?:\((?!\d{4}\))([^)]+)\)|,?\s*(?:Issue:?|no\.)\s*(\d+))?(.*)$/);
  if (m && !/^\d/.test(m[1])) {
    const rest = m[5] || '';
    const f = { journal: m[1].trim(), volume: m[2] };
    const num = m[3] || m[4] || (rest.match(/(?:Issue:?|no\.)\s*(\d+)/) || [])[1];
    if (num && !/Supplement/i.test(num)) f.number = num;
    const pages = pagesOf(rest);
    if (pages) f.pages = pages;
    else {
      const art = rest.match(/(?:Paper No\.|article|Art\.)\s*(\d+)/i) || rest.match(/^,\s*(\d{4,})\s*$/);
      if (art) f.pages = art[1];
    }
    return { type: 'article', fields: f };
  }
  return { type: 'misc', fields: { howpublished: v } };
}

export function bibEntry(key, r) {
  const { type, fields } = venueFields(r);
  const f = {
    author: r.authors.map(latex).join(' and '),
    title: `{${latex(r.title)}}`,
    ...Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, latex(x)])),
    year: String(r.year || ''),
  };
  if (r.doi) f.doi = r.doi;
  if (r.arxiv) Object.assign(f, { eprint: r.arxiv, archiveprefix: 'arXiv' });
  if (r.url && !r.doi) f.url = r.url;
  const w = Math.max(...Object.keys(f).map((k) => k.length));
  const body = Object.entries(f).filter(([, x]) => x)
    .map(([k, x]) => `  ${k.padEnd(w)} = {${String(x).replace(/^\{(.*)\}$/s, '{$1}')}}`).join(',\n');
  return `@${type}{${key},\n${body}\n}`;
}

export function bibtex(refs, keys) {
  return keys.filter((k) => refs[k]).map((k) => bibEntry(k, refs[k])).join('\n\n') + '\n';
}
