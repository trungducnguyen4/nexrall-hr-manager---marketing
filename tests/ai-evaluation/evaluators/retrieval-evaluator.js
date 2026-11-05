/**
 * Retrieval Evaluator - Computes Recall@K, MRR@K, and nDCG@K
 */

export function evaluateRetrieval(retrievedDocIds = [], expectedDocIds = []) {
  if (!expectedDocIds || expectedDocIds.length === 0) {
    return { recallAt5: 1.0, recallAt10: 1.0, mrrAt10: 1.0, ndcgAt10: 1.0 };
  }

  const expectedSet = new Set(expectedDocIds);

  // Deduplicate retrieved doc IDs per position to calculate document-level recall
  const uniqueTop5 = [];
  const seen5 = new Set();
  for (const id of retrievedDocIds.slice(0, 5)) {
    if (!seen5.has(id)) {
      seen5.add(id);
      uniqueTop5.push(id);
    }
  }

  const hits5 = uniqueTop5.filter(id => expectedSet.has(id)).length;
  const recallAt5 = Math.min(1.0, hits5 / expectedDocIds.length);

  const uniqueTop10 = [];
  const seen10 = new Set();
  for (const id of retrievedDocIds.slice(0, 10)) {
    if (!seen10.has(id)) {
      seen10.add(id);
      uniqueTop10.push(id);
    }
  }

  const hits10 = uniqueTop10.filter(id => expectedSet.has(id)).length;
  const recallAt10 = Math.min(1.0, hits10 / expectedDocIds.length);

  // 3. MRR@10 (Mean Reciprocal Rank) of first unique relevant document
  let mrrAt10 = 0;
  for (let rank = 0; rank < uniqueTop10.length; rank++) {
    if (expectedSet.has(uniqueTop10[rank])) {
      mrrAt10 = 1.0 / (rank + 1);
      break;
    }
  }

  // 4. nDCG@10 (Normalized Discounted Cumulative Gain)
  let dcg = 0;
  for (let rank = 0; rank < uniqueTop10.length; rank++) {
    const isRel = expectedSet.has(uniqueTop10[rank]) ? 1 : 0;
    if (isRel) {
      dcg += 1.0 / Math.log2(rank + 2); // rank 0 -> log2(2) = 1
    }
  }

  let idcg = 0;
  const idealHits = Math.min(expectedDocIds.length, 10);
  for (let rank = 0; rank < idealHits; rank++) {
    idcg += 1.0 / Math.log2(rank + 2);
  }

  const ndcgAt10 = idcg > 0 ? (dcg / idcg) : 0;

  return {
    recallAt5: Number(recallAt5.toFixed(4)),
    recallAt10: Number(recallAt10.toFixed(4)),
    mrrAt10: Number(mrrAt10.toFixed(4)),
    ndcgAt10: Number(ndcgAt10.toFixed(4))
  };
}
