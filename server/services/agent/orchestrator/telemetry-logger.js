/**
 * LLMOps Telemetry Logger
 * Persists token usage, latency, cost, and provider execution details into D1.
 */
import { logAiInteraction } from '../../ai-gateway.service.js';

export { logAiInteraction };

/**
 * Helper to record AI telemetry with standard schema
 */
export async function recordAiTelemetry(env, data) {
  try {
    await logAiInteraction(env, data);
  } catch (err) {
    console.error('[recordAiTelemetry] Failed to record interaction:', err?.message);
  }
}
