const WORD_ALIASES = new Map([
  ['&', 'and'],
  ['plus', 'and'],
  ['percent', 'percent'],
  ['%', 'percent']
]);

const PHRASE_ALIASES = new Map([
  ['2%', '2 percent'],
  ['2 %', '2 percent'],
  ['whole-milk', 'whole milk'],
  ['ground-pork', 'ground pork']
]);

const IRREGULAR_SINGULARS = new Map([
  ['berries', 'berry'],
  ['bananas', 'banana'],
  ['apples', 'apple'],
  ['grapes', 'grape'],
  ['eggs', 'egg']
]);

const stripDiacritics = (value) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

const normalizePhrases = (value) => {
  let next = value;
  for (const [from, to] of PHRASE_ALIASES.entries()) {
    next = next.replaceAll(from, to);
  }
  return next;
};

const normalizeWord = (word) => WORD_ALIASES.get(word) || word;

export const normalizeItemName = (value) => {
  const normalized = normalizePhrases(stripDiacritics(String(value || '').toLowerCase()))
    .replace(/[,/]/g, ' ')
    .replace(/[^a-z0-9\s%&-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeWord)
    .join(' ')
    .trim();

  return normalized.replace(/\s+/g, ' ');
};

export const singularizeWord = (word) => {
  if (IRREGULAR_SINGULARS.has(word)) {
    return IRREGULAR_SINGULARS.get(word);
  }

  if (word.endsWith('ies') && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }

  if (word.endsWith('oes') && word.length > 4) {
    return word.slice(0, -2);
  }

  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    return word.slice(0, -1);
  }

  return word;
};

export const normalizeForSingularComparison = (value) => {
  return normalizeItemName(value)
    .split(' ')
    .filter(Boolean)
    .map(singularizeWord)
    .join(' ');
};

export const toTokenSet = (value) => new Set(normalizeItemName(value).split(' ').filter(Boolean));

export const toSortedTokenSignature = (value) => {
  return normalizeItemName(value)
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
};
