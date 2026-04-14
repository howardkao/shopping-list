export const levenshteinDistance = (a, b) => {
  const left = String(a);
  const right = String(b);

  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const prev = new Array(right.length + 1).fill(0);
  const next = new Array(right.length + 1).fill(0);

  for (let j = 0; j <= right.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + substitutionCost
      );
    }

    for (let j = 0; j <= right.length; j += 1) {
      prev[j] = next[j];
    }
  }

  return prev[right.length];
};

export const levenshteinSimilarity = (a, b) => {
  const maxLength = Math.max(String(a).length, String(b).length);
  if (maxLength === 0) return 1;
  return 1 - (levenshteinDistance(a, b) / maxLength);
};
