/**
 * Deep RAG Service - Semantic Chunking, Hybrid Vector + BM25 Retrieval & Grounding
 */
import { calcEmbedding, cosineSimilarity, estimateTokens } from './ai-gateway.service.js';

/**
 * Split markdown/text content into structured semantic chunks with metadata
 */
export function chunkMarkdownDocument(rawText, docTitle = '') {
  const text = String(rawText || '').trim();
  if (!text) return [];

  const chunks = [];
  const lines = text.split('\n');
  let currentSection = docTitle || 'Nội dung chung';
  let currentParagraphs = [];
  let currentTokenCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect section headers (Markdown #, ##, ### or "Điều X:", "Chương Y:")
    if (/^(#{1,4}\s+|Điều\s+\d+|Chương\s+\d+|Phần\s+\d+)/i.test(trimmed)) {
      if (currentParagraphs.length > 0) {
        const chunkContent = currentParagraphs.join('\n').trim();
        if (chunkContent.length > 30) {
          chunks.push({
            section_title: currentSection,
            content: chunkContent,
            token_count: estimateTokens(chunkContent),
          });
        }
        currentParagraphs = [];
        currentTokenCount = 0;
      }
      currentSection = trimmed.replace(/^#{1,4}\s*/, '');
    }

    if (trimmed) {
      currentParagraphs.push(trimmed);
      currentTokenCount += estimateTokens(trimmed);

      // Split if chunk gets too long (~400 tokens)
      if (currentTokenCount >= 400) {
        const chunkContent = currentParagraphs.join('\n').trim();
        chunks.push({
          section_title: currentSection,
          content: chunkContent,
          token_count: estimateTokens(chunkContent),
        });
        currentParagraphs = [];
        currentTokenCount = 0;
      }
    }
  }

  // Flush remaining paragraphs
  if (currentParagraphs.length > 0) {
    const chunkContent = currentParagraphs.join('\n').trim();
    if (chunkContent.length > 20) {
      chunks.push({
        section_title: currentSection,
        content: chunkContent,
        token_count: estimateTokens(chunkContent),
      });
    }
  }

  return chunks;
}

/**
 * Ingest and vector-index a knowledge document
 */
export async function ingestDocument(env, {
  title,
  category = 'hr_policy',
  effectiveDate = null,
  rawContent = '',
  actorId = 1,
  version = '1.0'
}) {
  if (!env || !env.DB) throw new Error('Database not available');
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('Tiêu đề tài liệu không được để trống');

  // Insert document record
  const r = await env.DB.prepare(`
    INSERT INTO knowledge_documents (title, category, version, effective_date, raw_content, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(cleanTitle, category, version, effectiveDate, rawContent, actorId).run();
  const documentId = r.meta.last_row_id;

  // Split into chunks
  const chunks = chunkMarkdownDocument(rawContent, cleanTitle);
  let chunkIndex = 0;

  for (const chunk of chunks) {
    chunkIndex++;
    // Calculate vector embedding
    const vector = await calcEmbedding(env, `${chunk.section_title}: ${chunk.content}`);
    await env.DB.prepare(`
      INSERT INTO knowledge_chunks (document_id, chunk_index, section_title, content, embedding_vector, token_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      documentId,
      chunkIndex,
      chunk.section_title,
      chunk.content,
      JSON.stringify(vector),
      chunk.token_count || estimateTokens(chunk.content)
    ).run();
  }

  // Update chunk count on document
  await env.DB.prepare('UPDATE knowledge_documents SET chunk_count = ? WHERE id = ?')
    .bind(chunkIndex, documentId).run();

  return { documentId, chunkCount: chunkIndex };
}

/**
 * Calculate BM25-like keyword relevance score
 */
function calculateKeywordScore(query, text) {
  const qTokens = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (qTokens.length === 0) return 0;
  const target = text.toLowerCase();
  let matches = 0;
  for (const token of qTokens) {
    if (target.includes(token)) matches++;
  }
  return matches / qTokens.length;
}

/**
 * Hybrid Search: Vector Cosine Similarity + BM25 Keyword Search + Reciprocal Rank Fusion (RRF)
 */
export async function hybridSearch(env, {
  query,
  limit = 4,
  category = null,
  minConfidence = 0.15
}) {
  if (!env || !env.DB || !query) return { results: [], contextText: '', citations: [] };

  const cleanQuery = String(query).trim();
  const queryVector = await calcEmbedding(env, cleanQuery);

  // Fetch candidate chunks from D1
  let sql = `
    SELECT c.id, c.document_id, c.chunk_index, c.section_title, c.content, c.embedding_vector,
           d.title as doc_title, d.category as doc_category, d.effective_date
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
  `;
  const binds = [];
  if (category) {
    sql += ' WHERE d.category = ?';
    binds.push(category);
  }
  sql += ' ORDER BY c.id ASC LIMIT 200';

  const stmt = env.DB.prepare(sql);
  const { results: rawChunks = [] } = await (binds.length ? stmt.bind(...binds) : stmt).all();

  if (rawChunks.length === 0) {
    return { results: [], contextText: '', citations: [] };
  }

  // 1. Vector Scoring
  const vectorRanked = rawChunks.map(chunk => {
    let vec = null;
    try { vec = JSON.parse(chunk.embedding_vector); } catch (_) {}
    const sim = vec ? cosineSimilarity(queryVector, vec) : 0;
    return { chunk, vectorScore: sim };
  }).sort((a, b) => b.vectorScore - a.vectorScore);

  // 2. Keyword Scoring
  const keywordRanked = rawChunks.map(chunk => {
    const kwScore = calculateKeywordScore(cleanQuery, `${chunk.section_title} ${chunk.content}`);
    return { chunk, keywordScore: kwScore };
  }).sort((a, b) => b.keywordScore - a.keywordScore);

  // 3. Reciprocal Rank Fusion (RRF)
  const scoreMap = new Map();
  const k = 60; // Standard RRF constant

  vectorRanked.forEach((item, rank) => {
    const id = item.chunk.id;
    const rrf = 1.0 / (k + rank + 1);
    scoreMap.set(id, {
      chunk: item.chunk,
      vectorScore: item.vectorScore,
      keywordScore: 0,
      rrfScore: rrf * 0.6, // Vector weight 60%
    });
  });

  keywordRanked.forEach((item, rank) => {
    const id = item.chunk.id;
    const rrf = 1.0 / (k + rank + 1);
    const existing = scoreMap.get(id) || { chunk: item.chunk, vectorScore: 0, keywordScore: 0, rrfScore: 0 };
    existing.keywordScore = item.keywordScore;
    existing.rrfScore += rrf * 0.4; // Keyword weight 40%
    scoreMap.set(id, existing);
  });

  // Sort by combined RRF score
  const sortedCandidates = Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .filter(item => (item.vectorScore >= minConfidence || item.keywordScore >= 0.3))
    .slice(0, limit);

  // Build Context Text and Citations for LLM
  const citations = [];
  const contextParts = [];

  sortedCandidates.forEach((item, idx) => {
    const citationIndex = idx + 1;
    const c = item.chunk;
    citations.push({
      index: citationIndex,
      docId: c.document_id,
      docTitle: c.doc_title,
      sectionTitle: c.section_title,
      snippet: c.content.slice(0, 180) + '...',
      confidenceScore: Number((item.vectorScore * 0.7 + item.keywordScore * 0.3).toFixed(3)),
    });

    contextParts.push(`[${citationIndex}] Nguồn: "${c.doc_title}" - ${c.section_title}\nNội dung: ${c.content}`);
  });

  return {
    results: sortedCandidates.map(c => ({
      id: c.chunk.id,
      docTitle: c.chunk.doc_title,
      section: c.chunk.section_title,
      content: c.chunk.content,
      vectorScore: c.vectorScore,
      keywordScore: c.keywordScore,
      combinedScore: c.rrfScore
    })),
    contextText: contextParts.join('\n\n'),
    citations
  };
}

/**
 * Pre-seed standard company regulations into knowledge base if empty
 */
export async function seedInitialKnowledge(env, actorId = 1) {
  if (!env || !env.DB) return { ok: false, message: 'No DB' };

  const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM knowledge_documents').first();
  if (Number(countRow?.c || 0) > 0) {
    return { ok: true, message: 'Already seeded', count: Number(countRow.c) };
  }

  const DOC_1 = `
# QUY CHẾ NỘI QUY LAO ĐỘNG & KỶ LUẬT THỜI GIAN LÀM VIỆC 2026

## Điều 1: Thời gian làm việc tiêu chuẩn
1. Giờ làm việc hành chính từ Thứ 2 đến Thứ 6 hàng tuần:
   - Buổi sáng: 08:30 - 12:00
   - Nghỉ trưa: 12:00 - 13:30
   - Buổi chiều: 13:30 - 17:30
2. Địa điểm làm việc: Trụ sở chính công ty tại Hà Nội và Chi nhánh TP. Hồ Chí Minh.
3. Nhân viên thực hiện chấm công Check-in / Check-out qua định vị GPS Geofence hoặc kết nối mạng WiFi văn phòng được ủy quyền.

## Điều 2: Quy định mốc giờ chấm công và tính đi muộn
1. Mốc thời gian bắt đầu tính muộn: **08:35 sáng**.
2. Nhân viên chấm công check-in từ **08:35 trở về trước** (ví dụ: 08:30, 08:34, 08:35) được tính là **Đúng giờ (On-time)**.
3. Nhân viên chấm công check-in từ **08:36 trở đi** (ví dụ: 08:36, 08:40) được hệ thống tự động ghi nhận là **Đi muộn (Late)**.
4. Tương tự, ca chiều mốc giờ bắt đầu tính muộn là **13:35**.

## Điều 3: Chính sách xử phạt vi phạm đi muộn
1. **Chế độ miễn phạt:** Mỗi nhân viên được miễn phạt tối đa **2 lần đi muộn trong một tháng** (Ghi chú: "Lần 1 - Miễn phạt", "Lần 2 - Miễn phạt").
2. **Mức phạt đi muộn:** Kể từ **lần đi muộn thứ 3 trở đi** trong tháng, áp dụng mức phạt **20.000 VNĐ / lần** (Ghi chú: "Lần X - Phạt: 20.000đ").
3. **Quy trình khấu trừ:** Việc ghi nhận trên hệ thống Chấm công mang tính chất theo dõi vi phạm nội quy. Số tiền phạt sẽ được HCNS tổng hợp và duyệt trừ vào lương thực nhận tại kỳ chốt Bảng lương hàng tháng.

## Điều 4: Quy chế làm việc từ xa (WFH)
1. Nhân viên có nhu cầu làm việc từ xa cần tạo đơn đăng ký WFH trên hệ thống trước ít nhất 12 giờ.
2. Đơn WFH phải được Quản lý trực tiếp phê duyệt trước khi bắt đầu ca làm việc.
3. Khi WFH được duyệt, nhân viên chấm công không bị ràng buộc bởi Geofence GPS của văn phòng.
`;

  const DOC_2 = `
# QUY ĐỊNH CHẾ ĐỘ NGHỈ PHÉP, NGHỈ LỄ & PHÚC LỢI

## Điều 1: Tiêu chuẩn ngày phép năm (Annual Leave)
1. Nhân viên ký hợp đồng lao động chính thức được hưởng **12 ngày nghỉ phép năm có hưởng lương / năm** (tích lũy tỷ lệ 1 ngày phép cho mỗi tháng làm việc thực tế).
2. Nhân viên làm việc đủ 05 năm tại công ty được cộng thêm 01 ngày phép năm theo quy định Bộ luật Lao động.
3. Phép năm chưa sử dụng hết trong năm được bảo lưu chuyển sang quý 1 năm tiếp theo (hạn chót sử dụng là 31/03).

## Điều 2: Quy trình phê duyệt đơn xin nghỉ phép (2-Step Approval)
1. Mọi yêu cầu nghỉ phép (Phép năm, Nghỉ không lương, Nghỉ ốm, Nghỉ bù) đều phải thực hiện gửi đơn qua hệ thống.
2. **Quy trình phê duyệt gồm 2 bước nghiêm ngặt:**
   - **Bước 1:** Quản lý trực tiếp (Direct Manager) xem xét khối lượng công việc và duyệt sơ bộ.
   - **Bước 2:** Phòng Hành chính Nhân sự (HCNS) kiểm tra quỹ phép thực tế và ra quyết định phê duyệt chính thức (Final Approval).
3. Đơn nghỉ chỉ có hiệu lực khi hoàn tất cả 2 bước phê duyệt.

## Điều 3: Nghỉ việc riêng hưởng nguyên lương
1. Kết hôn: Nghỉ 03 ngày.
2. Con đẻ, con nuôi kết hôn: Nghỉ 01 ngày.
3. Cha đẻ, mẹ đẻ, cha nuôi, mẹ nuôi; cha vợ, mẹ vợ (hoặc cha chồng, mẹ chồng); vợ hoặc chồng; con đẻ, con nuôi qua đời: Nghỉ 03 ngày.
`;

  const DOC_3 = `
# QUY ĐỊNH QUẢN LÝ CÔNG VIỆC, DỰ ÁN & BẢO MẬT DỮ LIỆU

## Điều 1: Quản lý Không gian làm việc cá nhân & Dự án
1. Mỗi nhân sự khi gia nhập công ty được hệ thống cấp một Không gian công việc cá nhân.
2. Ban Giám đốc và Trưởng phòng HCNS được cấu hình mặc định là người theo dõi để phối hợp và hỗ trợ công việc.
3. Mọi công việc (Task) cần cập nhật đầy đủ tiêu đề, mô tả, mức độ ưu tiên, hạn hoàn thành (Due date) và phân công người phụ trách (Assignee).

## Điều 2: Bảo mật thông tin & Tài khoản hệ thống
1. Nhân viên có trách nhiệm bảo mật thông tin đăng nhập tài khoản hệ thống nội bộ, không chia sẻ mật khẩu cho người khác.
2. Khi đăng nhập lần đầu hoặc khi được cấp lại mật khẩu tạm thời, nhân viên bắt buộc phải đổi mật khẩu đáp ứng chính sách bảo mật (tối thiểu 8 ký tự).
3. Mọi dữ liệu khách hàng, tài liệu nhân sự và hóa đơn tài chính là tài sản mật của doanh nghiệp.
`;

  await ingestDocument(env, { title: 'Quy chế nội quy lao động & Kỷ luật giờ làm 2026', category: 'hr_policy', rawContent: DOC_1, actorId });
  await ingestDocument(env, { title: 'Quy định chế độ nghỉ phép & Phúc lợi', category: 'hr_policy', rawContent: DOC_2, actorId });
  await ingestDocument(env, { title: 'Quy định quản lý công việc & Bảo mật dữ liệu', category: 'security', rawContent: DOC_3, actorId });

  return { ok: true, message: 'Seeded 3 knowledge documents successfully' };
}
