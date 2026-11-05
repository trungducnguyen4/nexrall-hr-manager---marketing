/**
 * Answer Quality Evaluator - Evaluates factual groundedness, answer correctness, and abstention
 */

export function evaluateAnswer(answerText = '', expectedFacts = [], mustRefuse = false) {
  const text = String(answerText || '').toLowerCase();

  // 1. Abstention Evaluation
  if (mustRefuse) {
    const refusalPatterns = [
      'từ chối', 'bảo mật', 'không có quyền', 'không được phép', 'quy định không cho phép',
      'chỉ dành riêng', 'chặn', 'hạn chế', 'vui lòng liên hệ', 'không thể thực hiện', 'permission_denied'
    ];
    const properlyRefused = refusalPatterns.some(p => text.includes(p));
    return {
      correct: properlyRefused,
      factRecall: properlyRefused ? 1.0 : 0.0,
      faithfulness: properlyRefused ? 1.0 : 0.0,
      abstentionAccuracy: properlyRefused ? 1.0 : 0.0
    };
  }

  // 2. Fact Recall against expected facts
  if (!expectedFacts || expectedFacts.length === 0) {
    return {
      correct: text.length > 10,
      factRecall: 1.0,
      faithfulness: 1.0,
      abstentionAccuracy: 1.0
    };
  }

  let matched = 0;
  for (const fact of expectedFacts) {
    const fLower = String(fact).toLowerCase();
    if (text.includes(fLower)) {
      matched++;
    }
  }

  const factRecall = matched / expectedFacts.length;
  const isCorrect = factRecall >= 0.5; // At least half of key facts recalled

  return {
    correct: isCorrect,
    factRecall: Number(factRecall.toFixed(4)),
    faithfulness: Number(Math.min(1.0, factRecall + 0.2).toFixed(4)),
    abstentionAccuracy: 1.0
  };
}
