import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const baseUrl = process.env.PENTEST_BASE_URL || 'https://nexrall-hr-manager-marketing.netviettv-hr-manager.workers.dev';
const password = process.env.PENTEST_PASSWORD;
if (!password) throw new Error('PENTEST_PASSWORD is required.');

const startedAt = new Date().toISOString();
const outputDir = join(process.cwd(), 'outputs');
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, `production-load-${startedAt.replace(/[:.]/g, '-')}.json`);
const report = { startedAt, baseUrl, stopThresholds: { serverErrorRatePercent: 2, p95Ms: 2000 }, phases: [], aborted: false };

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const percentile95 = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};
const save = () => writeFileSync(outputPath, JSON.stringify(report, null, 2));

async function login() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'PENTEST-EMP', password })
  });
  if (!res.ok) throw new Error(`PENTEST login failed: ${res.status}`);
  const json = await res.json();
  if (!json.token) throw new Error('PENTEST login returned no token');
  return json.token;
}

const token = await login();
const authHeaders = { 'X-Auth-Token': token, 'content-type': 'application/json' };
const readPaths = [
  '/api/auth/me',
  '/api/attendance?month=7&year=2026',
  '/api/tasks',
  '/api/invoices?month=7&year=2026',
  '/api/evaluations/dashboard?month=7&year=2026'
];

async function request(path, init = {}) {
  const start = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, init);
    await response.arrayBuffer();
    return { status: response.status, ms: Math.round(performance.now() - start) };
  } catch {
    return { status: 0, ms: Math.round(performance.now() - start) };
  }
}

async function runPhase({ name, durationSeconds, rps, kind }) {
  const phase = { name, durationSeconds, rps, kind, startedAt: new Date().toISOString(), requests: 0, statuses: {}, latencyMs: [], aborted: false };
  const endAt = Date.now() + durationSeconds * 1000;
  let round = 0;
  while (Date.now() < endAt) {
    const roundStarted = Date.now();
    const work = [];
    for (let index = 0; index < rps; index++) {
      if (kind === 'read') {
        work.push(request(readPaths[(round * rps + index) % readPaths.length], { headers: authHeaders }));
      } else if (kind === 'write') {
        work.push(request('/api/attendance/register', {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({ work_type: 'wfh', shift: 'full', note: 'PENTEST load fixture' })
        }));
      } else {
        work.push(request('/api/auth/login', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ login: 'PENTEST-EMP', password })
        }));
      }
    }
    const results = await Promise.all(work);
    for (const result of results) {
      phase.requests++;
      phase.statuses[result.status] = (phase.statuses[result.status] || 0) + 1;
      phase.latencyMs.push(result.ms);
    }
    const fiveXx = Object.entries(phase.statuses).reduce((n, [status, count]) => n + (Number(status) >= 500 || Number(status) === 0 ? count : 0), 0);
    const p95 = percentile95(phase.latencyMs);
    if ((fiveXx / phase.requests) > 0.02 || p95 > 2000) {
      phase.aborted = true;
      phase.stopReason = (fiveXx / phase.requests) > 0.02 ? '5xx_or_network_error_rate_exceeded_2_percent' : 'p95_exceeded_2000ms';
      report.aborted = true;
      report.stopReason = phase.stopReason;
      break;
    }
    round++;
    const remaining = 1000 - (Date.now() - roundStarted);
    if (remaining > 0) await sleep(remaining);
  }
  const fiveXx = Object.entries(phase.statuses).reduce((n, [status, count]) => n + (Number(status) >= 500 || Number(status) === 0 ? count : 0), 0);
  phase.finishedAt = new Date().toISOString();
  phase.p95Ms = percentile95(phase.latencyMs);
  phase.maxMs = phase.latencyMs.length ? Math.max(...phase.latencyMs) : 0;
  phase.serverErrorRatePercent = Number((100 * fiveXx / Math.max(1, phase.requests)).toFixed(3));
  delete phase.latencyMs;
  report.phases.push(phase);
  save();
  return !phase.aborted;
}

const phases = [
  { name: 'normal_10_vu_15m', durationSeconds: 900, rps: 10, kind: 'read' },
  { name: 'read_ramp_25_vu_20rps_5m', durationSeconds: 300, rps: 20, kind: 'read' },
  { name: 'write_cap_5rps_5m', durationSeconds: 300, rps: 5, kind: 'write' },
  { name: 'login_cap_2rps_5m', durationSeconds: 300, rps: 2, kind: 'login' },
  { name: 'read_burst_50rps_60s', durationSeconds: 60, rps: 50, kind: 'read' }
];

for (const phase of phases) {
  if (!(await runPhase(phase))) break;
}
report.finishedAt = new Date().toISOString();
save();
console.log(outputPath);
