# E2E Test Infra: NetViet HR Real-Time Synchronization

## Test Philosophy
- Requirement-driven, multi-client integration testing.
- Simulation of two distinct authenticated user sessions: Client A (Mutator) and Client B (Observer).
- Verification that when Client A executes a mutation via REST API, Client B receives the real-time event and updates state/DOM in <500ms without calling page reload (F5).

## Feature Inventory
| # | Feature | Source | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|--------|:------:|:------:|:------:|:------:|
| 1 | Tasks & Subtasks CRUD | R1, R4 | 5 | 5 | ✓ | ✓ |
| 2 | Task Comments & Mentions | R1, R4 | 5 | 5 | ✓ | ✓ |
| 3 | Chat Conversations & Messages | R1, R4 | 5 | 5 | ✓ | ✓ |
| 4 | Notifications & Badges | R1, R4 | 5 | 5 | ✓ | ✓ |
| 5 | Attendance Check-in/out | R1, R4 | 5 | 5 | ✓ | ✓ |
| 6 | Leave Requests & Approvals | R1, R4 | 5 | 5 | ✓ | ✓ |
| 7 | Payroll & Overtime Records | R1, R4 | 5 | 5 | ✓ | ✓ |
| 8 | User Profiles & Roles | R1, R4 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Harness: In-memory Node.js test runner (
ode:sqlite + D1 facade + mock WebSocket/SSE channel) exercising server.js and frontend reactive event contracts.
- Two-Client Simulator:
  * Client A signs in as User A (e.g. Employee or Manager).
  * Client B signs in as User B (e.g. Peer or Admin) and registers event listeners / view handlers.
  * Client A issues HTTP mutation requests against server.js.
  * Verify AppSyncHub dispatches event to Client B.
  * Verify Client B event handler updates internal state and cache without F5.
- Test Files Location: 	ests/realtime-sync/
