/**
 * AI Agent Service - Facade Barrel
 * 
 * Re-exports all submodules from `server/services/agent/` for backward compatibility:
 * - directory/       : Smart NLP employee search, directory matching & RBAC privacy guardrail
 * - personas/        : Role-aware persona resolution (Employee, HR, Director) & prompt builders
 * - postprocessing/  : Citation verification & hallucination / chatty cleanup
 * - tools/           : Colocated domain plugins, tool registry, O(1) execution dispatcher
 * - orchestrator/    : Non-streaming & SSE streaming chat turns, LLMOps telemetry logger
 */

// 1. Directory & Smart Matching
export {
  stripVietnameseAccents,
  levenshteinDistance,
  extractEmployeeLookupTarget,
  isSelfLookup,
  extractEmployeeLookupIntent,
  findEmployeesByNameGroup,
  findEmployeeSmart
} from './agent/directory/employee-matcher.js';

export {
  executeDeepEmployeeLookup
} from './agent/directory/directory-lookup.service.js';

// 2. Personas & Prompt Strategy
export {
  resolveUserPersona,
  checkRolePermissions
} from './agent/personas/persona-resolver.js';

export {
  buildPersonaSystemPrompt
} from './agent/personas/index.js';

// 3. Post-processing & Cleanup
export {
  verifyAndCleanCitations,
  stripFollowUpSuggestions
} from './agent/postprocessing/text-cleaner.js';

// 4. Tools Registry & Execution
export {
  COPILOT_TOOLS,
  getToolsForPersona
} from './agent/tools/tool-registry.js';

export {
  verifyToolAuthorization,
  executeTool
} from './agent/tools/tools.executor.js';

export {
  safeBroadcast,
  parseRelativeDate,
  resolveUser,
  resolveTask
} from './agent/tools/tool-helpers.js';

// 5. Orchestrators & Streaming
export {
  runCopilotTurn
} from './agent/orchestrator/turn-orchestrator.js';

export {
  runCopilotTurnStream
} from './agent/orchestrator/stream-orchestrator.js';
