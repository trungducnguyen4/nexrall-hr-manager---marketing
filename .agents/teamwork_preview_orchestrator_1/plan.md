# Orchestration Plan

## 1. Survey Phase
- Explorer 1: Backend architecture & Real-time Infra (Durable Objects, Worker websocket/SSE handlers, event routing, session management).
- Explorer 2: Frontend architecture & Reactivity (src/api.js, src/app.js, src/views/*, event listeners, state caches, stale state/DOM lifecycle).
- Explorer 3: Feature Domain Inventory & Real-Time Sync Requirements (Tasks, Comments, Chat, Notifications, Attendance, Leave, Payroll, Profiles).

## 2. Synthesis & Project Architecture (PROJECT.md & TEST_INFRA.md)
- Define complete Feature Inventory (R1).
- Define Real-Time Architecture & Protocol specs (R2).
- Define Frontend Reactive Bus & Cache Invalidation architecture (R3).
- Define E2E Two-Client Automated Test Suite requirements (R4).
- Define Deployment & verification requirements (R5).

## 3. Milestone Execution Track & E2E Testing Track
- M1: Backend Real-Time Infrastructure Remediation.
- M2: Frontend Reactive Bus & Client Sync Engine.
- M3: Feature-by-Feature Real-Time Wireup & UI Reactivity.
- M4: Two-Client Sync Automated Test Suite & Comprehensive Audit Report.
- M5: Deployment Verification (sync-to-deploy.ps1).
