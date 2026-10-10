/**
 * Text Cleaner & Citation Grounding Post-processing
 */

/**
 * Citation Grounding & Anti-Hallucination Verification (P1.4)
 * Ensures any citation tag [1], [2] in LLM output actually maps to an authentic retrieved chunk.
 */
export function verifyAndCleanCitations(text, validCitations = []) {
  if (!text) return '';
  const validIndices = new Set((validCitations || []).map(c => c.index));
  return text.replace(/\[(\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10);
    return validIndices.has(idx) ? match : '';
  });
}

/**
 * Strip redundant conversational follow-up suggestions from LLM output
 */
export function stripFollowUpSuggestions(text) {
  if (!text || typeof text !== 'string') return text;

  const patterns = [
    /\n+\s*(?:bạn|anh|chị|em)?\s*(?:có\s+)?(?:muốn|cần)\s+(?:tôi\s+)?(?:hỗ\s*trợ|giúp|tư\s*vấn|giải\s*đáp|làm\s*gì|tìm\s*hiểu|kiểm\s*tra)[\s\S]*$/i,
    /\n+\s*(?:bạn|anh|chị|em)?\s*(?:có\s+)?(?:câu\s*hỏi|thắc\s*mắc)[\s\S]*$/i,
    /\n+\s*(?:hãy|vui\s+lòng|đừng\s+ngần\s+ngại)[\s\S]*$/i,
    /\n+\s*(?:nếu|khi)\s+(?:(?:bạn|anh|chị|em)\s+)?(?:có|cần|muốn)[\s\S]*$/i,
    /\n+\s*(?:tôi\s+có\s+thể|có\s+thể)\s+giúp\s+gì[\s\S]*$/i,
    /\n+\s*(?:bạn|anh|chị)?\s*đang\s+quan\s+tâm[\s\S]*$/i,
    /\n+\s*(?:bạn|anh|chị)?\s*muốn\s+tra\s+cứu[\s\S]*$/i,
    /\n+\s*bạn\s+cần\s+tôi[\s\S]*$/i,
    /\n+\s*hy\s+vọng[\s\S]*$/i,
    /\n+\s*(?:chúc\s+bạn|chúc\s+anh|chúc\s+chị)[\s\S]*$/i
  ];

  let cleaned = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of patterns) {
      if (pat.test(cleaned)) {
        cleaned = cleaned.replace(pat, '').trimEnd();
        changed = true;
      }
    }
  }
  return cleaned;
}
