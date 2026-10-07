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
  // Strict vector dimension integrity check (P0.5)
  // Vectors with mismatched dimensions belong to different latent spaces and cannot be meaningfully compared.
  if (vecA.length !== vecB.length) {
    return 0;
  }
  const len = vecA.length;
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
  const rawGeminiKey = env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || '';
  const geminiKey = typeof rawGeminiKey === 'string' ? rawGeminiKey.trim() : '';
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
 * Production Circuit Breaker for Multi-Provider AI Gateway (P0.6)
 * Prevents cascading latency spikes when an upstream provider experiences outages or degradation.
 * States:
 *   CLOSED (healthy) -> OPEN (tripped after N consecutive failures) -> HALF_OPEN (probe request after cooldown)
 */
export class ProviderCircuitBreaker {
  constructor(failureThreshold = 3, cooldownMs = 30_000) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.states = new Map(); // provider -> { state: 'CLOSED'|'OPEN'|'HALF_OPEN', failures: 0, nextAttemptAt: 0 }
  }

  getState(provider) {
    let entry = this.states.get(provider);
    if (!entry) {
      entry = { state: 'CLOSED', failures: 0, nextAttemptAt: 0 };
      this.states.set(provider, entry);
    }
    const now = Date.now();
    if (entry.state === 'OPEN' && now >= entry.nextAttemptAt) {
      entry.state = 'HALF_OPEN';
    }
    return entry;
  }

  canAttempt(provider) {
    const entry = this.getState(provider);
    return entry.state === 'CLOSED' || entry.state === 'HALF_OPEN';
  }

  recordSuccess(provider) {
    const entry = this.getState(provider);
    entry.state = 'CLOSED';
    entry.failures = 0;
    entry.nextAttemptAt = 0;
  }

  recordFailure(provider, reason = '') {
    const entry = this.getState(provider);
    entry.failures += 1;
    if (entry.failures >= this.failureThreshold || entry.state === 'HALF_OPEN') {
      entry.state = 'OPEN';
      entry.nextAttemptAt = Date.now() + this.cooldownMs;
      console.warn(`[CircuitBreaker] Provider "${provider}" tripped to OPEN for ${this.cooldownMs / 1000}s. Reason: ${reason}`);
    }
  }

  getStatusReport() {
    const report = {};
    for (const [p, val] of this.states.entries()) {
      report[p] = { state: val.state, failures: val.failures };
    }
    return report;
  }
}

export const circuitBreaker = new ProviderCircuitBreaker(3, 30_000);

/**
 * Multi-Provider Chat Completion with Circuit Breaker & Fallback
 */
export async function chatCompletion(env, {
  messages = [],
  tools = null,
  temperature = 0.3,
  maxTokens = 1500,
  systemPrompt = '',
  toolData = null
}) {
  const startTime = Date.now();
  let selectedProvider = 'edge-local';
  let selectedModel = 'local-rule-agent';
  let responseText = '';
  let toolCalls = null;
  let promptTokens = estimateTokens(JSON.stringify(messages) + systemPrompt);
  let completionTokens = 0;
  const allErrors = [];

  // Prepare normalized messages
  const fullMessages = [];
  if (systemPrompt) fullMessages.push({ role: 'system', content: systemPrompt });
  fullMessages.push(...messages);
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';

  // 1. Try Google Gemini (Primary high-performance LLM)
  const rawKey = env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || '';
  const geminiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (geminiKey && circuitBreaker.canAttempt('gemini')) {
    const candidateModels = [
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.8-flash',
      'gemma-4-31b-it',
      'gemma-4-26b-a4b-it'
    ];

    const validMessages = messages
      .filter(m => m && m.content && String(m.content).trim())
      .map(m => ({
        role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(m.content).trim() }]
      }));

    if (validMessages.length > 0 && validMessages[0].role === 'model') {
      validMessages.shift();
    }

    const contents = validMessages.length > 0
      ? validMessages
      : [{ role: 'user', parts: [{ text: 'Xin chào' }] }];

    for (const candidateModel of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${geminiKey}`;

        const body = {
          contents,
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        };
        if (tools && tools.length > 0) {
          body.tools = [{
            functionDeclarations: tools.map(t => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }))
          }];
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000)
        });

        if (res.ok) {
          const data = await res.json();
          const candidate = data?.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          const funcCallPart = parts.find(p => p.functionCall);
          const textPart = parts.find(p => p.text);

          if (funcCallPart || textPart) {
            circuitBreaker.recordSuccess('gemini');
            selectedProvider = 'gemini';
            selectedModel = candidateModel;
            responseText = textPart ? textPart.text : '';
            let toolCalls = null;
            if (funcCallPart?.functionCall) {
              toolCalls = [{
                name: funcCallPart.functionCall.name,
                args: funcCallPart.functionCall.args || {}
              }];
            }
            completionTokens = estimateTokens(responseText || JSON.stringify(toolCalls));
            const totalLatency = Date.now() - startTime;
            const cost = calculateCost(selectedProvider, selectedModel, promptTokens, completionTokens);
            return {
              provider: selectedProvider,
              model: selectedModel,
              content: responseText,
              toolCalls,
              tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
              cost,
              latencyMs: totalLatency,
              debugErrors: allErrors
            };
          } else {
            allErrors.push(`${candidateModel}: no content`);
          }
        } else {
          const errText = await res.text().catch(() => '');
          allErrors.push(`${candidateModel} HTTP ${res.status}: ${errText.slice(0, 100)}`);
          if (res.status >= 500 || res.status === 429) {
            circuitBreaker.recordFailure('gemini', `HTTP ${res.status}`);
          }
          console.warn(`[AI Gateway] Gemini (${candidateModel}) HTTP ${res.status}:`, errText.slice(0, 120));
          if (res.status === 429) {
            // Quota applies account-wide; fast-fail loop to avoid latency spike
            break;
          }
        }
      } catch (err) {
        circuitBreaker.recordFailure('gemini', err?.message);
        allErrors.push(`${candidateModel} ERR: ${err?.message}`);
        console.warn(`[AI Gateway] Gemini (${candidateModel}) failed:`, err?.message);
      }
    }
  } else if (geminiKey) {
    allErrors.push('gemini: circuit breaker OPEN (skipping)');
  }

  // 2. Try OpenAI
  const openaiKey = env?.OPENAI_API_KEY;
  if (openaiKey && circuitBreaker.canAttempt('openai')) {
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
        }),
        signal: AbortSignal.timeout(15_000)
      });

      if (res.ok) {
        circuitBreaker.recordSuccess('openai');
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
    const cfCandidates = [
      '@cf/meta/llama-3.2-3b-instruct',
      '@cf/meta/llama-3.2-1b-instruct',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      '@cf/meta/llama-3.1-8b-instruct-awq',
      '@cf/qwen/qwen2.5-7b-instruct',
      '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      '@cf/mistral/mistral-7b-instruct-v0.2',
      '@cf/google/gemma-7b-it'
    ];
    for (const cfModel of cfCandidates) {
      try {
        const res = await env.AI.run(cfModel, {
          messages: fullMessages,
          max_tokens: maxTokens,
          temperature
        });
        if (res && (res.response || typeof res === 'string')) {
          responseText = typeof res === 'string' ? res : res.response;

          // Anti-Hallucination Interception Guardrail:
          // Check if response contains typical hallucinated placeholder names not present in toolData
          const isHallucinated = /(?:Nguyễn Văn A|NV001|NV-001)/i.test(responseText) && !JSON.stringify(toolData || {}).includes('Nguyễn Văn A');
          if (toolData && isHallucinated) {
            console.warn(`[AI Gateway] Intercepted hallucination in "${cfModel}" with placeholder names. Overriding with grounded heuristic truth.`);
            responseText = buildHeuristicResponse(lastUserMsg, systemPrompt, toolData);
            selectedProvider = 'edge-local';
            selectedModel = 'grounded-truth-interceptor';
          } else {
            selectedProvider = 'cloudflare';
            selectedModel = cfModel.replace('@cf/', '');
          }

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
            latencyMs: totalLatency,
            debugErrors: allErrors
          };
        } else {
          allErrors.push(`CF AI (${cfModel}): empty response, keys=${Object.keys(res || {})}`);
        }
      } catch (err) {
        allErrors.push(`CF AI (${cfModel}) ERR: ${err?.message}`);
        console.warn(`[AI Gateway] Cloudflare Workers AI (${cfModel}) failed:`, err?.message);
      }
    }
  } else {
    allErrors.push(`CF AI not available: env.AI=${!!(env && env.AI)}, type=${typeof env?.AI?.run}`);
  }

  // 4. Edge Rule-based Fallback (Generates structured grounded output)
  selectedProvider = 'edge-local';
  selectedModel = 'edge-heuristic-v1';
  responseText = buildHeuristicResponse(lastUserMsg, systemPrompt, toolData);
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
    latencyMs: totalLatency,
    debugErrors: allErrors
  };
}

/**
 * Heuristic response generator when no external AI API key is configured or offline
 */
export function buildHeuristicResponse(query, contextPrompt = '', toolData = null) {
  const q = String(query).toLowerCase();

  // If tool returned specific data, format it into rich Markdown directly
  if (toolData) {
    if (toolData.error) {
      return `⚠️ **Thông báo hệ thống:** ${toolData.message || toolData.error}`;
    }

    if (toolData.financialSummary) {
      const f = toolData.financialSummary;
      const statusBadge = toolData.isOfficial 
        ? '✅ **Chính thức** (Đã phát hành)' 
        : '⏳ **Tạm tính (Draft)** - Đang được HCNS xử lý';

      return `### 💵 Bảng Lương Cá Nhân - Tháng ${toolData.month}
- **Nhân viên:** ${toolData.employeeName} (${toolData.employeeCode})
- **Phòng ban:** ${toolData.department}
- **Trạng thái:** ${statusBadge}

#### 📊 Chi tiết thu nhập & khấu trừ:
| Hạng mục | Số tiền / Chi tiết |
| :--- | :--- |
| **Lương cơ bản** | ${f.baseSalaryVnd.toLocaleString('vi-VN')} đ |
| **Ngày công thực tế** | ${f.workDays} ngày |
| **Thưởng KPI / Dự án** | ${f.kpiBonusVnd.toLocaleString('vi-VN')} đ |
| **Phụ cấp** | ${f.allowanceVnd.toLocaleString('vi-VN')} đ |
| **Lương làm thêm (OT)** | ${f.overtimePayVnd.toLocaleString('vi-VN')} đ |
| **Giảm trừ / Phạt đi muộn** | -${f.deductionVnd.toLocaleString('vi-VN')} đ |
| **Bảo hiểm người LĐ đóng** | -${f.insuranceVnd.toLocaleString('vi-VN')} đ |
| **Thuế TNCN tạm khấu trừ** | -${f.taxVnd.toLocaleString('vi-VN')} đ |
| **LƯƠNG THỰC NHẬN (NET)** | **${f.netSalaryVnd.toLocaleString('vi-VN')} đ** |

> ℹ️ **Ghi chú từ HCNS:** ${toolData.statusNote}
*Trạng thái chi trả:* **${f.transferStatus}**`;
    }

    if (toolData.anomalies) {
      let out = `### 🔍 Báo Cáo Kiểm Toán Bất Thường Bảng Lương - Kỳ ${toolData.month}\n\n`;
      out += `**Tổng số nhân viên kiểm tra:** ${toolData.totalAudited} nhân sự.\n`;
      out += `**Số vấn đề phát hiện:** ${toolData.anomalyCount} trường hợp (trong đó có ${toolData.highRiskCount} mức độ cảnh báo cao).\n\n`;
      if (toolData.anomalies.length === 0) {
        out += `✅ *Không phát hiện sai lệch bất thường nào giữa dữ liệu chấm công và bảng lương tháng ${toolData.month}.*`;
      } else {
        out += `#### 📋 Danh sách chi tiết các điểm bất thường:\n`;
        toolData.anomalies.forEach((a, idx) => {
          const badge = a.severity === 'HIGH' ? '🔴 **[CAO]**' : a.severity === 'MEDIUM' ? '🟡 **[TRUNG BÌNH]**' : '🔵 **[THẤP]**';
          out += `${idx + 1}. ${badge} **${a.employeeName}** (${a.employeeCode}):\n   - *Vấn đề:* ${a.issue}\n   - *Khuyến nghị:* ${a.recommendation}\n`;
        });
      }
      return out;
    }

    if (toolData.found === false) {
      return `ℹ️ **Thông báo bảng lương:** ${toolData.message || `Không tìm thấy bảng lương tháng ${toolData.month} của bạn trên hệ thống.`}`;
    }

    if (toolData.totalDaysWorked !== undefined) {
      return `### 📊 Thống Kê Chấm Công & Đi Muộn - Tháng ${toolData.month}
- **Tổng số ngày làm việc ghi nhận:** ${toolData.totalDaysWorked} ngày.
- **Số lần check-in muộn (sau 08:35):** ${toolData.lateCount} lần.
- **Hạn mức miễn phạt đã dùng:** ${toolData.lateFreeCount}/2 lần.
- **Số lần bị tính phạt tiền:** ${toolData.penaltyCount} lần.
- **Tổng tiền phạt đi muộn (20.000đ/lần từ lần 3):** **${toolData.totalPenaltyVnd.toLocaleString('vi-VN')} đ** [1].

${toolData.lateDetails && toolData.lateDetails.length > 0 ? `#### Chi tiết các lần đi muộn:\n` + toolData.lateDetails.map(d => `- **${d.date}**: Check-in lúc \`${d.checkIn || '--:--'}\` (Trễ ${d.lateMinutes || 0} phút) ${d.note ? `*(${d.note})*` : ''}`).join('\n') : '✅ *Bạn chấp hành tốt nội quy giờ giấc, không có vi phạm trong tháng!*'}`;
    }

    if (toolData.tasks) {
      return `### 📋 Danh Sách Công Việc Được Giao (${toolData.count} tasks)
${toolData.tasks.map(t => `- **[${t.priority.toUpperCase()}]** ${t.title} - *Trạng thái:* \`${t.status}\` ${t.due_date ? `*(Hạn: ${t.due_date})*` : ''}`).join('\n')}`;
    }

    if (toolData.categories && (toolData.totalCount !== undefined || toolData.requests)) {
      const isTopQuery = /(?:ai|người nào|nhân viên nào).*(?:xin nghỉ|nghỉ phép|nghỉ).*nhiều nhất|top.*(?:nghỉ phép|xin nghỉ)|ai xin nghỉ nhiều nhất|ai là người xin nghỉ/i.test(query);

      if (isTopQuery && toolData.topLeaveEmployees && toolData.topLeaveEmployees.length > 0) {
        const monthLabel = toolData.month && toolData.month !== 'all' ? `Tháng ${toolData.month}` : 'Toàn thời gian';
        let out = `### 📊 Thống Kê Nhân Sự Xin Nghỉ Phép - ${monthLabel}\n\n`;
        if (toolData.summary) {
          out += `${toolData.summary}\n\n`;
        }
        out += `#### 🏆 Danh Sách Nhân Sự Nghỉ Nhiều Nhất:\n`;
        out += `| Xếp hạng | Mã NV | Họ và tên | Phòng ban | Số ngày nghỉ | Số đơn | Lý do tiêu biểu |\n`;
        out += `| :---: | :--- | :--- | :--- | :---: | :---: | :--- |\n`;
        toolData.topLeaveEmployees.forEach(e => {
          out += `| #${e.rank} | **${e.employeeCode}** | **${e.name}** | ${e.department} | **${e.totalDays} ngày** | ${e.leaveCount} đơn | ${e.reasonsSummary || 'Nghỉ phép'} |\n`;
        });
        out += `\n`;

        if (toolData.categoriesCount) {
          out += `> 📌 **Phân loại lý do:** Việc riêng/gia đình: ${toolData.categoriesCount.familyAndPersonal || 0} đơn | Nghỉ ốm/khám: ${toolData.categoriesCount.sickAndHealth || 0} đơn | Du lịch/về quê: ${toolData.categoriesCount.travelAndHomecoming || 0} đơn | Phép năm/khác: ${toolData.categoriesCount.annualAndOther || 0} đơn\n`;
        }
        return out;
      }

      let out = `### 📋 Tổng Quan Đơn Xin Nghỉ Phép (${toolData.totalCount} đơn)\n\n`;
      out += `${toolData.summary}\n\n`;

      if (toolData.topLeaveEmployees && toolData.topLeaveEmployees.length > 0) {
        out += `#### 🏆 Top Nhân Sự Nghỉ Nhiều Nhất:\n`;
        out += `| Xếp hạng | Mã NV | Họ và tên | Phòng ban | Số ngày nghỉ | Số đơn |\n`;
        out += `| :---: | :--- | :--- | :--- | :---: | :---: |\n`;
        toolData.topLeaveEmployees.slice(0, 5).forEach(e => {
          out += `| #${e.rank} | **${e.employeeCode}** | **${e.name}** | ${e.department} | **${e.totalDays} ngày** | ${e.leaveCount} đơn |\n`;
        });
        out += `\n`;
      }

      for (const [cat, list] of Object.entries(toolData.categories)) {
        if (list.length > 0) {
          out += `#### 📌 ${cat} (${list.length} đơn):\n`;
          list.forEach(item => {
            out += `- **${item.employee}** (${item.department}): ${item.dates} - *Lý do:* "${item.reason}" [${item.status}]\n`;
          });
        }
      }
      return out;
    }
  }

  // Fallback multi-module & general knowledge matching
  if (q.includes('kiến thức bên ngoài') || q.includes('hỏi ngoài') || q.includes('ngoài công việc') || q.includes('bên ngoài được k') || q.includes('bên ngoài được không') || q.includes('hỏi gì cũng được') || q.includes('hỏi linh tinh') || q.includes('chuyện ngoài')) {
    return `Trợ lý ảo HR NetViet tiếp nhận và hỗ trợ giải đáp cả kiến thức chuyên môn, công nghệ, kỹ năng làm việc lẫn các câu hỏi bên ngoài công việc, bên cạnh nghiệp vụ 12 phân hệ của hệ thống NetViet HR.`;
  }

  if (q.includes('dashboard') || q.includes('tổng quan') || q.includes('trang chủ')) {
    return `### Phân hệ Dashboard (Tổng quan)
- Vị trí: Menu **Dashboard**.
- Chức năng: Thống kê quân số, tỷ lệ đúng giờ/muộn, việc khẩn cấp cần xử lý và lịch sự kiện công ty.`;
  }

  if (q.includes('thông báo') || q.includes('announcement') || q.includes('tin tức')) {
    return `### Phân hệ Thông báo
- Vị trí: Menu **Thông báo**.
- Chức năng: Tiếp nhận thông tư, quyết định từ ban giám đốc, tải tài liệu đính kèm và ghi nhận trạng thái đã đọc.`;
  }

  if (q.includes('chat') || q.includes('nhắn tin') || q.includes('trò chuyện') || q.includes('kênh')) {
    return `### Phân hệ Chat nội bộ
- Vị trí: Menu **Chat**.
- Chức năng: Thảo luận realtime qua WebSocket theo phòng ban và toàn công ty, bình chọn (poll), ghim tin nhắn, nhắc tên (@mention).`;
  }

  if (q.includes('bàn giao') || q.includes('handover') || q.includes('chuyển giao') || q.includes('nghỉ việc') || q.includes('offboarding')) {
    return `### Phân hệ Bàn giao dự án & tài khoản
- Vị trí: Menu **Bàn giao dự án & tài khoản**.
- Chức năng: Bàn giao thiết bị, tài sản, quyền quản trị tài khoản và tiến độ công việc/dự án khi luân chuyển hoặc thôi việc.`;
  }

  if (q.includes('nhân viên') || q.includes('danh bạ') || q.includes('hồ sơ') || q.includes('mã nhân viên')) {
    return `### Phân hệ Quản lý Nhân viên
- Vị trí: Menu **Nhân viên**.
- Chức năng: Quản lý danh bạ, hợp đồng lao động, CCCD, BHXH. Quyền đổi Mã nhân viên (employee_code) thuộc về Admin.`;
  }

  if (q.includes('bảng lương') && (q.includes('quản lý') || q.includes('admin') || q.includes('tính lương') || q.includes('chốt') || q.includes('import') || q.includes('toàn công ty') || q.includes('batch'))) {
    return `### Phân hệ Bảng lương (Quản trị)
- Vị trí: Menu **Bảng lương**.
- Chức năng: Tổng hợp công và phạt đi muộn, nhập/xuất Excel, chốt bảng lương kỳ và kiểm toán sai lệch AI (AI Anomaly Audit).`;
  }

  if (q.includes('địa điểm') || q.includes('geofence') || q.includes('tọa độ') || q.includes('wifi') || q.includes('bssid')) {
    return `### Phân hệ Địa điểm chấm công & WiFi
- Vị trí: Menu **Địa điểm chấm công**.
- Chức năng: Thiết lập tọa độ GPS, bán kính geofence văn phòng và danh sách WiFi Whitelist hợp lệ để chấm công.`;
  }

  if (q.includes('cài đặt') || q.includes('database') || q.includes('sao lưu') || q.includes('backup') || q.includes('hệ thống')) {
    return `### Phân hệ Cài đặt & Quản trị Hệ thống
- Vị trí: Menu **Cài đặt**.
- Chức năng: Cấu hình khung giờ làm việc chuẩn (08:30 - 17:00), mốc phạt đi muộn và quản trị dữ liệu Cloudflare D1.`;
  }

  if (q.includes('phiếu lương') || q.includes('lương') || q.includes('thu nhập') || q.includes('thực nhận')) {
    return `### Phân hệ Phiếu lương cá nhân
- Vị trí: Menu **Phiếu lương**.
- Chức năng: Tra cứu lương cơ bản, ngày công, thưởng KPI, phụ cấp, giảm trừ phạt đi muộn, BHXH, thuế TNCN và thực nhận (Net). Cho phép gửi yêu cầu xem lại nếu phát hiện sai lệch.`;
  }

  if (q.includes('chấm công') || q.includes('check-in') || q.includes('check in') || q.includes('check-out') || q.includes('muộn') || q.includes('trễ') || q.includes('phạt') || q.includes('giờ làm')) {
    return `### Quy chế chấm công [1]
- Giờ làm việc: 08:30 - 17:00.
- Check-in trước hoặc đúng 08:35: Đúng giờ. Từ 08:36: Tính đi muộn.
- Chế tài: Miễn phạt 2 lần đầu trong tháng; từ lần thứ 3 tính phạt 20.000đ/lần vào bảng lương [1].
- Yêu cầu: Xác thực GPS văn phòng hoặc WiFi Whitelist. Hệ thống tự động checkout lúc 17:05 UTC.`;
  }

  if (q.includes('nghỉ phép') || q.includes('phép năm') || q.includes('nghỉ ốm') || q.includes('đơn xin nghỉ')) {
    return `### Quy định nghỉ phép [2]
- Quỹ phép năm: 12 ngày/năm (1 ngày/tháng làm việc).
- Quy trình duyệt 2 bước: Bước 1 (Quản lý trực tiếp) -> Bước 2 (Phòng HCNS phê duyệt cuối) [2].
- Yêu cầu: Nộp đơn trước tối thiểu 1 ngày làm việc đối với phép thông thường.`;
  }

  if (q.includes('task') || q.includes('công việc') || q.includes('tiến độ') || q.includes('kanban') || q.includes('giao việc')) {
    return `### Phân hệ Quản lý Công việc (Tasks)
- Vị trí: Menu **Công việc**.
- Chức năng: Quản lý theo bảng Kanban/Danh sách, phân loại ưu tiên (Urgent, High, Medium, Low), đặt hạn chót, phân công và theo dõi tiến độ.`;
  }

  if (/(?:^|\b)(?:xin\s*)?(?:chào|hi|hello|hey|good\s*(?:morning|afternoon|evening))\b/i.test(q)) {
    return `Chào bạn. Tôi là Trợ lý AI NetViet, sẵn sàng hỗ trợ bạn tra cứu chấm công, bảng lương, nghỉ phép, công việc và các quy chế công ty.`;
  }

  if (/(?:bạn\s*là\s*ai|giới\s*thiệu\s*bản\s*thân|chức\s*năng\s*của\s*bạn|bạn\s*làm\s*được\s*gì|hướng\s*dẫn\s*sử\s*dụng)/i.test(q)) {
    return `Tôi là Trợ lý AI NetViet, hỗ trợ bạn tra cứu:
- **Chấm công & Đi muộn**: Check-in/out, số lần trễ và tiền phạt.
- **Phiếu lương**: Lương cơ bản, ngày công, KPI, khấu trừ và thực nhận.
- **Nghỉ phép & Công việc**: Quỹ phép năm, tạo đơn nghỉ, danh sách task.
- **Nội quy & Chính sách**: Tra cứu các quy chế vận hành doanh nghiệp.`;
  }

  return `Yêu cầu của bạn chưa có trong dữ liệu mẫu. Bạn có thể hỏi tôi về: chấm công, phiếu lương, quỹ phép năm, danh sách công việc hoặc nội quy công ty.`;
}

/**
 * Enterprise PII Masker for Privacy Protection
 */
export function maskPII(text) {
  if (!text || typeof text !== 'string') return text;
  // Mask 9-12 digit Citizen ID / CCCD numbers (preserve first 3 and last 3 digits)
  let masked = text.replace(/\b(\d{3})\d{4,6}(\d{3})\b/g, '$1******$2');
  // Mask bank account numbers
  masked = masked.replace(/(STK|số tài khoản|tài khoản|TK)\s*[:=]?\s*([0-9]{2,4})[0-9]{4,10}([0-9]{2,4})/gi, '$1: $2******$3');
  return masked;
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

/**
 * Stream text chunks with paced delay for smooth typewriter UX
 */
export async function* streamPacedText(text, delayMs = 15) {
  const str = String(text || '');
  if (!str) return;
  const tokens = str.split(/(\s+)/);
  for (const tok of tokens) {
    if (tok) {
      yield tok;
      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
}

/**
 * Multi-Provider Streaming Chat Completion
 * Yields `{ type: 'delta', text: string }` and finishes with `{ type: 'done', ...metadata }`
 */
export async function* chatCompletionStream(env, {
  messages = [],
  tools = null,
  temperature = 0.3,
  maxTokens = 1500,
  systemPrompt = '',
  toolData = null
}) {
  const startTime = Date.now();
  let selectedProvider = 'edge-local';
  let selectedModel = 'local-rule-agent';
  let promptTokens = estimateTokens(JSON.stringify(messages) + systemPrompt);
  let completionTokens = 0;
  const allErrors = [];

  // Prepare normalized messages
  const fullMessages = [];
  if (systemPrompt) fullMessages.push({ role: 'system', content: systemPrompt });
  fullMessages.push(...messages);
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';

  // 1. Try Google Gemini Streaming
  const rawKey = env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || '';
  const geminiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (geminiKey && circuitBreaker.canAttempt('gemini')) {
    const candidateModels = [
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.8-flash',
      'gemma-4-31b-it',
      'gemma-4-26b-a4b-it'
    ];

    const validMessages = messages
      .filter(m => m && m.content && String(m.content).trim())
      .map(m => ({
        role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(m.content).trim() }]
      }));

    if (validMessages.length > 0 && validMessages[0].role === 'model') {
      validMessages.shift();
    }

    const contents = validMessages.length > 0
      ? validMessages
      : [{ role: 'user', parts: [{ text: 'Xin chào' }] }];

    for (const candidateModel of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:streamGenerateContent?alt=sse&key=${geminiKey}`;
        const body = {
          contents,
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        };
        if (tools && tools.length > 0) {
          body.tools = [{
            functionDeclarations: tools.map(t => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }))
          }];
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000)
        });

        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let streamText = '';
          let hasOutput = false;
          let streamedToolCalls = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const dataStr = trimmed.slice(5).trim();
              if (!dataStr || dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                const candidate = parsed?.candidates?.[0];
                const parts = candidate?.content?.parts || [];
                for (const part of parts) {
                  if (part.functionCall) {
                    hasOutput = true;
                    const tc = {
                      name: part.functionCall.name,
                      args: part.functionCall.args || {}
                    };
                    streamedToolCalls.push(tc);
                    yield { type: 'tool_call', ...tc };
                  } else if (part.text) {
                    hasOutput = true;
                    streamText += part.text;
                    yield { type: 'delta', text: part.text };
                  }
                }
              } catch (_) {}
            }
          }

          if (hasOutput && streamText) {
            circuitBreaker.recordSuccess('gemini');
            selectedProvider = 'gemini';
            selectedModel = candidateModel;
            completionTokens = estimateTokens(streamText);
            const totalLatency = Date.now() - startTime;
            const cost = calculateCost(selectedProvider, selectedModel, promptTokens, completionTokens);
            yield {
              type: 'done',
              provider: selectedProvider,
              model: selectedModel,
              content: streamText,
              tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
              cost,
              latencyMs: totalLatency,
              debugErrors: allErrors
            };
            return;
          }
        } else {
          const errText = await res.text().catch(() => '');
          allErrors.push(`${candidateModel} HTTP ${res.status}: ${errText.slice(0, 100)}`);
          if (res.status >= 500 || res.status === 429) {
            circuitBreaker.recordFailure('gemini', `HTTP ${res.status}`);
          }
          if (res.status === 429) {
            break;
          }
        }
      } catch (err) {
        circuitBreaker.recordFailure('gemini', err?.message);
        allErrors.push(`${candidateModel} ERR: ${err?.message}`);
      }
    }
  } else if (geminiKey) {
    allErrors.push('gemini: circuit breaker OPEN (skipping)');
  }

  // 2. Try Cloudflare Workers AI (Edge Llama 3.3 / Llama 3.1)
  if (env && env.AI && typeof env.AI.run === 'function') {
    const cfCandidates = [
      '@cf/meta/llama-3.3-70b-instruct',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/meta/llama-3.2-3b-instruct',
      '@cf/qwen/qwen2.5-7b-instruct'
    ];
    for (const cfModel of cfCandidates) {
      try {
        const cfRes = await env.AI.run(cfModel, {
          messages: fullMessages,
          max_tokens: maxTokens,
          temperature
        });
        const cfText = typeof cfRes === 'string' ? cfRes : cfRes?.response;
        if (cfText && cfText.trim()) {
          // Anti-Hallucination Interception Guardrail:
          const isHallucinated = /(?:Nguyễn Văn A|NV001|NV-001)/i.test(cfText) && !JSON.stringify(toolData || {}).includes('Nguyễn Văn A');
          let outputText = cfText;
          if (toolData && isHallucinated) {
            console.warn(`[AI Gateway Stream] Intercepted hallucination in "${cfModel}" with placeholder names. Overriding with grounded heuristic truth.`);
            outputText = buildHeuristicResponse(lastUserMsg, systemPrompt, toolData);
            selectedProvider = 'edge-local';
            selectedModel = 'grounded-truth-interceptor';
          } else {
            selectedProvider = 'cloudflare';
            selectedModel = cfModel.replace('@cf/', '');
          }

          completionTokens = estimateTokens(outputText);
          const totalLatency = Date.now() - startTime;
          const cost = calculateCost(selectedProvider, selectedModel, promptTokens, completionTokens);
          for await (const chunk of streamPacedText(outputText, 12)) {
            yield { type: 'delta', text: chunk };
          }
          yield {
            type: 'done',
            provider: selectedProvider,
            model: selectedModel,
            content: outputText,
            tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
            cost,
            latencyMs: totalLatency,
            debugErrors: allErrors
          };
          return;
        }
      } catch (cfErr) {
        allErrors.push(`CF AI (${cfModel}) ERR: ${cfErr?.message}`);
      }
    }
  }

  // 3. Fallback: Edge Rule-based Fallback with smooth pacing
  selectedProvider = 'edge-local';
  selectedModel = 'edge-heuristic-v1';
  const responseText = buildHeuristicResponse(lastUserMsg, systemPrompt, toolData);

  // Yield word by word with ~15ms delay
  for await (const chunk of streamPacedText(responseText, 15)) {
    yield { type: 'delta', text: chunk };
  }

  completionTokens = estimateTokens(responseText);
  const totalLatency = Date.now() - startTime;
  const cost = calculateCost(selectedProvider, selectedModel, promptTokens, completionTokens);

  yield {
    type: 'done',
    provider: selectedProvider,
    model: selectedModel,
    content: responseText,
    tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
    cost,
    latencyMs: totalLatency,
    debugErrors: allErrors
  };
}
