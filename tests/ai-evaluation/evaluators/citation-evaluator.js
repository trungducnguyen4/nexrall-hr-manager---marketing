/**
 * Citation Evaluator - Evaluates citation precision and citation recall against ground truth
 */

export function evaluateCitations(actualCitationDocIds = [], expectedDocIds = []) {
  if (!expectedDocIds || expectedDocIds.length === 0) {
    return { citationPrecision: 1.0, citationRecall: 1.0 };
  }

  if (!actualCitationDocIds || actualCitationDocIds.length === 0) {
    return { citationPrecision: 0.0, citationRecall: 0.0 };
  }

  const expectedSet = new Set(expectedDocIds);
  const actualSet = new Set(actualCitationDocIds);

  let truePositives = 0;
  for (const id of actualSet) {
    if (expectedSet.has(id)) {
      truePositives++;
    }
  }

  const precision = truePositives / actualSet.size;
  const recall = truePositives / expectedSet.size;

  return {
    citationPrecision: Number(precision.toFixed(4)),
    citationRecall: Number(recall.toFixed(4))
  };
}
