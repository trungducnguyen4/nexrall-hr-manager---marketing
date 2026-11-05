# NetViet HR Enterprise AI Copilot Architecture

## 1. Overview & System Mission

The NetViet HR Enterprise AI Copilot is an edge-first, multi-role intelligent assistant designed for human resources, payroll, task management, internal communication, and knowledge retrieval. 

Operating on Cloudflare Workers, Cloudflare D1 (SQLite), Cloudflare R2, and Durable Objects, the system guarantees high throughput, low latency (< 1.5ms P95 edge retrieval), deterministic enterprise privacy, and strict separation of duties.

---

## 2. System Diagrams

### Diagram 1: AI Request Lifecycle & Guardrails

```mermaid
flowchart TD
    Client(["User Client (Web / Mobile PWA)"]) -->|"POST /api/ai/chat (SSE / JSON)"| EdgeWorker["Cloudflare Edge Worker"]
    EdgeWorker --> AuthMiddleware["Auth Middleware (JWT & Session Token)"]
    AuthMiddleware -->|"401 / 403"| AuthReject(["Unauthorized"])
    AuthMiddleware --> Cleanse["History Sanitization (Strip system/developer/tool msgs)"]
    Cleanse --> Guardrail["Enterprise Privacy & PII Guardrail"]
    
    Guardrail -->|"Salary of other employee requested (Unauthorized)"| PrivacyReject["403 PII Shield Rejection + Telemetry"]
    Guardrail -->|"Compliant / Authorized"| PersonaResolver["Persona Resolver (Employee / HR / Director)"]
    
    PersonaResolver --> Orchestrator["Agent Orchestrator (Turn / Stream)"]
    Orchestrator --> RAGPipeline["Document ACL Filtered RAG"]
    Orchestrator --> ToolRegistry["Role-Filtered Tool Registry"]
    Orchestrator --> AIGateway["Multi-Provider AI Gateway"]
```

---

### Diagram 2: RAG Retrieval Pipeline (Document ACL -> BM25 + Vector -> RRF)

```mermaid
flowchart LR
    Query["User Query"] --> DocACL["Document ACL Filter\n(visibility, allowed_roles, department)"]
    DocACL --> D1Candidates["D1 Candidate Pool\n(1,000 chunks)"]
    
    D1Candidates --> BranchVector["Vector Search\n(Cosine Similarity / Embeddings)"]
    D1Candidates --> BranchBM25["Vietnamese BM25\n(k1=1.5, b=0.75, compound n-grams)"]
    
    BranchVector --> VectorRanks["Vector Rankings"]
    BranchBM25 --> BM25Ranks["BM25 Rankings"]
    
    VectorRanks & BM25Ranks --> RRF["Reciprocal Rank Fusion\nRRF Score = sum(1 / (k + rank))"]
    RRF --> CitationFilter["Citation Grounding & Anti-Hallucination"]
    CitationFilter --> AugmentedContext["Augmented Context for LLM"]
```

---

### Diagram 3: Tool Execution, Authorization & HITL Action Confirmation

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Employee
    participant Orch as Agent Orchestrator
    participant Auth as Tool Authorizer
    participant Exec as Tool Executor
    participant D1 as Cloudflare D1 DB
    
    User->>Orch: "Đổi hạn task #101 sang 15/11"
    Orch->>Auth: verifyToolAuthorization("task_update_details", {taskId: 101, dueDate})
    alt Unauthorized / Non-owner
        Auth-->>Orch: { allowed: false, message: "Forbidden" }
        Orch-->>User: 403 Forbidden Response
    else Authorized
        Auth-->>Orch: { allowed: true }
        alt Destructive / State mutation
            Orch-->>User: Emits HITL Action Card (pending confirmation)
            User->>Orch: POST /api/ai/actions/confirm { actionType, payload }
            Orch->>Auth: Re-verify confirmation authorization & state
            Orch->>Exec: executeAction(payload)
            Exec->>D1: UPDATE tasks SET due_date = ? WHERE id = ?
            Exec-->>User: 200 Success + Undo Card
        else Read / Autonomous execution
            Orch->>Exec: executeTool(...)
            Exec->>D1: SELECT query
            Exec-->>Orch: Raw data
            Orch-->>User: Synthesized markdown answer
        end
    end
```

---

### Diagram 4: Streaming Agent Orchestration & Parity Loop

```mermaid
flowchart TD
    Start(["Client Opens SSE Stream"]) --> PromptInit["Build Persona System Prompt & Bind Tools"]
    PromptInit --> LoopStart{"Agent Iteration\n(Iteration < 5?)"}
    
    LoopStart -->|"Yes"| ModelInference["Stream Model Inference\n(Gemini / OpenAI / CF AI / Edge Local)"]
    ModelInference --> StreamCheck{"Emitted Tool Call or Delta?"}
    
    StreamCheck -->|"Delta Text"| EmitSSE["Emit SSE Delta to Client"]
    EmitSSE --> StreamCheck
    
    StreamCheck -->|"Tool Call"| ToolAuth["Verify Tool Authorization"]
    ToolAuth -->|"Denied"| ToolDeniedMsg["Append Denial to Context"]
    ToolAuth -->|"Allowed"| ExecTool["Execute Tool"]
    
    ExecTool --> ToolResultCheck{"Is Action Card or Data?"}
    ToolResultCheck -->|"Action Card (HITL)"| EmitCard["Emit Action Card & Terminate Loop"]
    ToolResultCheck -->|"Data"| FeedBack["Append Tool Output into Messages"]
    
    ToolDeniedMsg --> LoopStart
    FeedBack --> LoopStart
    
    StreamCheck -->|"Done Event"| PostClean["Clean Citations & PII Masking"]
    LoopStart -->|"No (>= 5 iterations)"| PostClean
    EmitCard --> PostClean
    
    PostClean --> Telemetry["Log LLMOps Telemetry to D1"]
    Telemetry --> Finish(["Emit Done Event & Close Stream"])
```

---

### Diagram 5: Multi-Provider AI Gateway & Resilience Circuit Breaker

```mermaid
flowchart TD
    GatewayReq["Gateway Completion Request"] --> CBCheck{"Circuit Breaker Open?"}
    
    CBCheck -->|"Gemini Available"| CallGemini["Call Google Gemini API\n(Flash / Flash-Lite / Pro)"]
    CallGemini -->|"200 OK"| ReturnSuccess["Return Result + Record Success"]
    CallGemini -->|"429 / 5xx / Timeout"| TripGemini["Trip Gemini Circuit Breaker"]
    
    TripGemini --> FallbackOpenAI["Fallback: Call OpenAI GPT-4o-mini"]
    FallbackOpenAI -->|"200 OK"| ReturnSuccess
    FallbackOpenAI -->|"Error / No Key"| FallbackCFAI["Fallback: Cloudflare Workers AI (@cf/meta/llama)"]
    
    FallbackCFAI -->|"200 OK"| ReturnSuccess
    FallbackCFAI -->|"Offline / Exhausted"| EdgeLocal["Deterministic Edge Rule Engine\n(Zero-latency local fallback)"]
    EdgeLocal --> ReturnSuccess
```

---

### Diagram 6: Security Trust Boundaries & Defense-in-Depth

```mermaid
graph TD
    subgraph Untrusted_Zone ["Untrusted Zone"]
        ClientBrowser["Browser / Client Input"]
        InjectedHistory["Manipulated History (system/tool tags)"]
    end

    subgraph Trust_Boundary_1 ["Trust Boundary 1: Edge Perimeter"]
        EdgeAuth["JWT & Role Identification"]
        SanitizeHistory["History Sanitizer (Strip injected roles)"]
    end

    subgraph Trust_Boundary_2 ["Trust Boundary 2: Application Core"]
        PIIShield["Enterprise PII Guardrail (Salary/Cross-user)"]
        PersonaEnforcer["Persona Enforcer (Tool whitelisting)"]
    end

    subgraph Trust_Boundary_3 ["Trust Boundary 3: Data & Storage"]
        DocACL["Document-Level SQL ACL"]
        TwoStepApproval["Leave 2-Step State Machine"]
        ActionVerifier["HITL Action Confirm & Undo Authorizer"]
        D1Store[("Cloudflare D1 Database")]
    end

    ClientBrowser --> EdgeAuth
    InjectedHistory --> SanitizeHistory
    EdgeAuth & SanitizeHistory --> PIIShield
    PIIShield --> PersonaEnforcer
    PersonaEnforcer --> DocACL
    PersonaEnforcer --> TwoStepApproval
    PersonaEnforcer --> ActionVerifier
    DocACL & TwoStepApproval & ActionVerifier --> D1Store
```

---

## 3. Key Architectural Decisions & Trade-Offs

| Decision | Chosen Approach | Alternative Considered | Justification |
| :--- | :--- | :--- | :--- |
| **Edge RAG Engine** | Hybrid Okapi BM25 + Vector on Cloudflare D1 | External Vector DB (Pinecone, Qdrant) | Cloudflare D1 provides native co-location with workers, zero egress costs, deterministic SQL ACL filtering, and sub-1.5ms query time without external network hops. |
| **Separation of Duties** | Enforced 2-Step Approval State Machine in DB layer | LLM-prompted approval logic | Prevents prompt injection or API tampering from bypassing administrative hierarchy. State machine rules are immutable. |
| **Action Execution** | Human-in-the-Loop (HITL) Action Cards with Signed Server Confirmation | Fully autonomous background execution | High-risk operational changes (deleting tasks, approving leaves, modifying employee records) require explicit human consent and verification. |
| **Streaming Parity** | Multi-iteration bounded agent loop ($N \le 5$) with typewriter pacing | Single-turn streaming | Ensures users receive streamed synthetic answers even after complex multi-step tool calls, preserving identical behavior between JSON and SSE endpoints. |
| **Multi-Provider Resilience** | Tiered fallback (Gemini $\rightarrow$ OpenAI $\rightarrow$ Workers AI $\rightarrow$ Edge Heuristic) with Circuit Breakers | Single LLM dependency | Guarantees 99.99% availability even during external API outages, rate limits, or offline test suites. |
