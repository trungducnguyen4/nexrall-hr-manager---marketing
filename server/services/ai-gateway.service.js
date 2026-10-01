/**
 * AI Gateway Service - Multi-Provider Resilience & Inference Layer
 * Supports Cloudflare Workers AI, Google Gemini, OpenAI & Edge Rule-based Fallback.
 */

// Model Pricing (per 1,000,000 tokens in USD)
const MODEL_PRICING = {
  'llama-3.3-70b': { input: 0.15, output: 0.60 },
  'llama-3.1-8b': { input: 0.05, output: 0.15 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'edge-local': { input: 0.0, output: 0.0 },
};

const USD_TO_VND = 25400;

/**
 * Ensure database schema for Knowledge Base and LLMOps telemetry
 */
export async function ensureAiSchema(env) {
  if (!env || !env.DB) return;
  try {
    // 1. Quản lý tài liệu tri thức nội quy & chính sách
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT DEFAULT 'hr_policy',
        version TEXT DEFAULT '1.0',
        effective_date TEXT,
        file_url TEXT,
        raw_content TEXT,
        chunk_count INTEGER DEFAULT 0,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `);

    // 2. Quản lý các vector chunks đã bóc tách
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        section_title TEXT,
        content TEXT NOT NULL,
        embedding_vector TEXT,
        token_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
      );
    `);
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(document_id)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_section ON knowledge_chunks(section_title)');

    // 3. Telemetry & Observability Logs (LLMOps)
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS ai_generation_logs (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        conversation_id TEXT,
        session_role TEXT DEFAULT 'employee',
        query_text TEXT NOT NULL,
        response_text TEXT,
        provider TEXT NOT NULL,
        model_name TEXT NOT NULL,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        estimated_cost_usd REAL DEFAULT 0.0,
        ttft_ms INTEGER DEFAULT 0,
        total_latency_ms INTEGER DEFAULT 0,
        retrieved_chunks_json TEXT,
        tools_called_json TEXT,
        user_rating INTEGER DEFAULT 0,
        feedback_comment TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `);
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_ai_logs_user_created ON ai_generation_logs(user_id, created_at DESC)');
  } catch (err) {
    console.error('ensureAiSchema failed', err);
  }
}

/**
 * Cosine Similarity calculation between two vectors
 */
export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) return 0;
  const len = Math.min(vecA.length, vecB.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Deterministic character-ngram embedding generator (offline / unit-test / fallback)
 */
export function generateDeterministicEmbedding(text, dim = 384) {
  const clean = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const vector = new Array(dim).fill(0);
  if (!clean.trim()) return vector;

  // Hash n-grams (1-gram to 3-gram)
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i <= clean.length - n; i++) {
      const gram = clean.substring(i, i + n);
      let hash = 0;
      for (let j = 0; j < gram.length; j++) {
        hash = (hash * 31 + gram.charCodeAt(j)) & 0xffffffff;
      }
      const idx = Math.abs(hash) % dim;
      vector[idx] += 1.0 / n;
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vector[i] = Number((vector[i] / norm).toFixed(6));
  }
  return vector;
}

/**
 * Calculate embedding for text using Cloudflare Workers AI, Gemini, OpenAI, or local deterministic fallback
 */
export async function calcEmbedding(env, text) {
  const content = String(text || '').trim();
  if (!content) return generateDeterministicEmbedding('', 384);

  // 1. Cloudflare Workers AI
  if (env && env.AI && typeof env.AI.run === 'function') {
    try {
      const res = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [content] });
      if (res && res.data && res.data[0]) {
        return res.data[0];
      }
    } catch (e) {
      console.warn('Cloudflare Workers AI embedding failed, trying fallback', e?.message);
    }
  }

  // 2. Google Gemini Embeddings
  const geminiKey = env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY;
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: content }] }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.embedding?.values) {
          return data.embedding.values;
        }
      }
    } catch (e) {
      console.warn('Gemini embedding failed, trying fallback', e?.message);
    }
  }

  // 3. OpenAI Embeddings
  const openaiKey = env?.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: content
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.data?.[0]?.embedding) {
          return data.data[0].embedding;
        }
      }
    } catch (e) {
      console.warn('OpenAI embedding failed, trying fallback', e?.message);
    }
  }

  // 4. Deterministic Edge Fallback
  return generateDeterministicEmbedding(content, 384);
}

/**
 * Estimate token count
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 3.8);
}

/**
 * Calculate cost in USD and VND
 */
export function calculateCost(provider, modelName, promptTokens, completionTokens) {
  let key = 'edge-local';
  if (modelName.includes('llama-3.3')) key = 'llama-3.3-70b';
  else if (modelName.includes('llama-3.1')) key = 'llama-3.1-8b';
  else if (modelName.includes('gemini-2.0')) key = 'gemini-2.0-flash';
  else if (modelName.includes('gemini-1.5')) key = 'gemini-1.5-flash';
  else if (modelName.includes('gpt-4o-mini')) key = 'gpt-4o-mini';
  else if (modelName.includes('gpt-4o')) key = 'gpt-4o';

  const pricing = MODEL_PRICING[key] || MODEL_PRICING['edge-local'];
  const costUsd = (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
  const costVnd = costUsd * USD_TO_VND;

  return {
    costUsd: Number(costUsd.toFixed(6)),
    costVnd: Math.round(costVnd),
    pricingKey: key,
  };
}

/**
 * Multi-Provider Chat Completion with Circuit Breaker & Fallback
 */
export async function chatCompletion(env, {
  messages = [],
  tools = null,
  temperature = 0.3,
  maxTokens = 1500,
  systemPrompt = ''
}) {
  const startTime = Date.now();
  let selectedProvider = 'edge-local';
  let selectedModel = 'local-rule-agent';
  let responseText = '';
  let toolCalls = null;
  let promptTokens = estimateTokens(JSON.stringify(messages) + systemPrompt);
  let completionTokens = 0;

  // Prepare normalized messages
  const fullMessages = [];
  if (systemPrompt) fullMessages.push({ role: 'system', content: systemPrompt });
  fullMessages.push(...messages);

  // 1. Try Google Gemini
  const geminiKey = env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY;
  if (geminiKey) {
    const candidateModels = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    for (const candidateModel of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${geminiKey}`;
        const contents = messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content || '' }]
        }));

        const body = {
          contents,
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        };
        if (systemPrompt) {
          body.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (res.ok) {
          const data = await res.json();
          const candidate = data?.candidates?.[0];
          if (candidate?.content?.parts?.[0]?.text) {
            selectedProvider = 'gemini';
            selectedModel = candidateModel;
            responseText = candidate.content.parts[0].text;
            completionTokens = estimateTokens(responseText);
            const totalLatency = Date.now() - startTime;
            const cost = calculateCost(selectedProvider, selectedModel, promptTokens, completionTokens);
            return {
              provider: selectedProvider,
              model: selectedModel,
              content: responseText,
              toolCalls: null,
              tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
              cost,
              latencyMs: totalLatency
            };
          }
        }
      } catch (err) {
        console.warn(`Gemini (${candidateModel}) chat completion failed, trying next`, err?.message);
      }
    }
  }

  // 2. Try OpenAI
  const openaiKey = env?.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: fullMessages,
          temperature,
          max_tokens: maxTokens,
          tools: tools ? tools.map(t => ({ type: 'function', function: t })) : undefined
        })
      });

      if (res.ok) {
        const data = await res.json();
        const choice = data?.choices?.[0];
        if (choice?.message) {
          selectedProvider = 'openai';
          selectedModel = 'gpt-4o-mini';
          responseText = choice.message.content || '';
          if (choice.message.tool_calls) {
            toolCalls = choice.message.tool_calls.map(tc => ({
              id: tc.id,
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}')
            }));
          }
          promptTokens = data.usage?.prompt_tokens || promptTokens;
          completionTokens = data.usage?.completion_tokens || estimateTokens(responseText);
          const totalLatency = Date.now() - startTime;
          const cost = calculateCost(selectedProvider, selectedModel, promptTokens, completionTokens);
          return {
            provider: selectedProvider,
            model: selectedModel,
            content: responseText,
            toolCalls,
            tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
            cost,
            latencyMs: totalLatency
          };
        }
      }
    } catch (err) {
      console.warn('OpenAI chat completion failed, attempting fallback', err?.message);
    }
  }

  // 3. Try Cloudflare Workers AI
  if (env && env.AI && typeof env.AI.run === 'function') {
    try {
      const res = await env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
        messages: fullMessages,
        max_tokens: maxTokens,
        temperature
      });
      if (res && res.response) {
        selectedProvider = 'cloudflare';
        selectedModel = 'llama-3.3-70b-instruct';
        responseText = res.response;
        completionTokens = estimateTokens(responseText);
        const totalLatency = Date.now() - startTime;
        const cost = calculateCost(selectedProvider, selectedModel, promptTokens, completionTokens);
        return {
          provider: selectedProvider,
          model: selectedModel,
          content: responseText,
          toolCalls: null,
          tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
          cost,
          latencyMs: totalLatency
        };
      }
    } catch (err) {
      console.warn('Cloudflare Workers AI Llama failed, fallback to local engine', err?.message);
    }
  }

  // 4. Edge Rule-based Fallback (Generates structured grounded output)
  selectedProvider = 'edge-local';
  selectedModel = 'edge-heuristic-v1';
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
  responseText = buildHeuristicResponse(lastUserMsg, systemPrompt);
  completionTokens = estimateTokens(responseText);
  const totalLatency = Date.now() - startTime;
  const cost = calculateCost(selectedProvider, selectedModel, promptTokens, completionTokens);

  return {
    provider: selectedProvider,
    model: selectedModel,
    content: responseText,
    toolCalls,
    tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
    cost,
    latencyMs: totalLatency
  };
}

/**
 * Heuristic response generator when no external AI API key is configured
 */
function buildHeuristicResponse(query, contextPrompt = '') {
  const q = String(query).toLowerCase();
  
  if (q.includes('muộn') || q.includes('trễ') || q.includes('phạt') || q.includes('giờ làm')) {
    return `Theo Quy chế nội quy lao động công ty [1]:\n- **Giờ bắt đầu làm việc:** 08:30 sáng (Được tính có mặt đúng giờ nếu chấm công trước hoặc đúng **08:35**).\n- **Chính sách đi muộn:**\n  + Check-in từ **08:36** trở đi tính là đi muộn.\n  + Nhân viên được miễn phạt **2 lần/tháng** đầu tiên.\n  + Từ lần đi muộn thứ 3 trong tháng trở đi: Áp dụng mức phạt **20.000đ/lần** (ghi nhận vào phiếu chấm công và duyệt trừ lương khi chốt bảng lương) [1].`;
  }
  if (q.includes('nghỉ phép') || q.includes('phép năm') || q.includes('nghỉ ốm')) {
    return `Theo Quy định chế độ nghỉ phép [2]:\n- Nhân viên chính thức có **12 ngày phép năm/năm** (tích lũy 1 ngày/tháng làm việc).\n- **Quy trình xin nghỉ phép (2 bước):**\n  1. Nhân viên gửi đơn qua hệ thống.\n  2. Quản lý trực tiếp phê duyệt Bước 1.\n  3. Phòng HCNS xem xét phê duyệt Bước 2 (Duyệt cuối) [2].\n- Cần gửi đơn trước ít nhất 1 ngày đối với nghỉ phép thông thường.`;
  }
  if (q.includes('task') || q.includes('công việc') || q.includes('tiến độ')) {
    return `Để quản lý công việc hiệu quả trên hệ thống Nexrall:\n- Mọi nhân viên đều có Không gian cá nhân riêng tại tab **Công việc**.\n- Các task được phân loại theo trạng thái (*Cần làm, Đang làm, Hoàn thành*) và mức độ ưu tiên.\n- Ban giám đốc và Trưởng phòng HCNS tự động theo dõi tiến độ để hỗ trợ kịp thời.`;
  }

  return `Chào bạn! Tôi là Trợ lý AI Nexrall Copilot. Tôi có thể hỗ trợ bạn:\n1. 📖 Tra cứu nội quy công ty, quy định đi muộn (mốc 8h35, phạt 20k sau 2 lần miễn phạt).\n2. 🏖️ Hướng dẫn quy trình xin nghỉ phép 2 bước, kiểm tra quỹ phép năm.\n3. 📋 Thống kê tiến độ công việc và tra cứu bảng chấm công cá nhân.\n\nBạn cần tôi hỗ trợ thông tin gì hôm nay?`;
}

/**
 * Log LLMOps interaction to database
 */
export async function logAiInteraction(env, logData) {
  if (!env || !env.DB) return;
  try {
    const id = logData.id || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await env.DB.prepare(`
      INSERT INTO ai_generation_logs (
        id, user_id, conversation_id, session_role, query_text, response_text,
        provider, model_name, prompt_tokens, completion_tokens, estimated_cost_usd,
        ttft_ms, total_latency_ms, retrieved_chunks_json, tools_called_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      Number(logData.userId || 1),
      logData.conversationId || 'default',
      logData.sessionRole || 'employee',
      String(logData.queryText || ''),
      String(logData.responseText || ''),
      logData.provider || 'edge-local',
      logData.modelName || 'default',
      Number(logData.promptTokens || 0),
      Number(logData.completionTokens || 0),
      Number(logData.estimatedCostUsd || 0.0),
      Number(logData.ttftMs || 0),
      Number(logData.totalLatencyMs || 0),
      logData.retrievedChunksJson ? JSON.stringify(logData.retrievedChunksJson) : null,
      logData.toolsCalledJson ? JSON.stringify(logData.toolsCalledJson) : null
    ).run();
    return id;
  } catch (err) {
    console.error('logAiInteraction failed', err);
    return null;
  }
}
