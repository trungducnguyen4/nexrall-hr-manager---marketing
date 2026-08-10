// Quick unit test for the nightly auto-checkout logic (runAutoCheckout).
// It mocks the D1 binding, captures UPDATE statements, and verifies the
// checkout is closed at the shift end with the "Quên checkout" tag.
import { pathToFileURL } from 'url';

const attendanceRows = [
  // Full-day office, check-in 08:31, forgot checkout → close at 17:00, work = 08:31→17:00 minus lunch.
  { id: 1, user_id: 1, date: '2026-08-09', shift: 'full', work_type: 'office', checkin_time: '08:31', checkout_time: null, status: 'present', note: 'test', work_hours: 0, expected_start: null, expected_end: null },
  // Morning shift → closes at 12:00.
  { id: 2, user_id: 2, date: '2026-08-09', shift: 'morning', work_type: 'office', checkin_time: '08:30', checkout_time: null, status: 'present', note: null, work_hours: 0, expected_start: null, expected_end: null },
  // Already checked out → untouched.
  { id: 3, user_id: 3, date: '2026-08-09', shift: 'full', work_type: 'office', checkin_time: '08:30', checkout_time: '17:00', status: 'present', note: null, work_hours: 8, expected_start: null, expected_end: null },
  // Absent (no check-in) → untouched.
  { id: 4, user_id: 4, date: '2026-08-09', shift: 'full', work_type: 'office', checkin_time: null, checkout_time: null, status: 'absent', note: null, work_hours: 0, expected_start: null, expected_end: null },
];

const updates = [];
const mockDB = {
  prepare(sql) {
    return {
      bind(...args) {
        if (sql.includes('UPDATE attendance')) {
          updates.push({ sql, args });
        }
        return {
          async all() {
            if (sql.includes('checkout_time IS NULL')) {
              return { results: attendanceRows.filter(r => r.checkin_time && !r.checkout_time && !['absent', 'cancelled', 'rejected', 'leave'].includes(r.status)) };
            }
            return { results: [] };
          },
          async run() {},
          async first() { return null; },
        };
      },
    };
  },
};

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const result = await mod.runAutoCheckout({ DB: mockDB });

console.log('auto-checkout result:', JSON.stringify(result));
console.log('captured updates:', updates.length);

const expectedClosed = attendanceRows.filter(r => r.checkin_time && !r.checkout_time && !['absent', 'cancelled', 'rejected', 'leave'].includes(r.status)).length;
if (result.closed !== expectedClosed) {
  console.error(`FAIL: expected ${expectedClosed} closed, got ${result.closed}`);
  process.exit(1);
}
if (updates.length !== expectedClosed) {
  console.error(`FAIL: expected ${expectedClosed} UPDATE statements, got ${updates.length}`);
  process.exit(1);
}

// Detail checks
const fullUpdate = updates.find(u => u.args && u.args[3] === 1); // WHERE id=1
if (!fullUpdate) { console.error('FAIL: no update for id=1'); process.exit(1); }
// SQL binds: checkout_time=?, work_hours=?, note=?, WHERE id=?  (checkout_ip='auto' is literal)
const [coTime, workHours, note, id] = fullUpdate.args;
console.log(`id=1 → checkout=${coTime}, work_hours=${workHours}, note=${note}`);
if (coTime !== '17:00') { console.error(`FAIL: full-day should close at 17:00, got ${coTime}`); process.exit(1); }
if (!/auto/i.test(fullUpdate.sql)) { console.error('FAIL: SQL should set checkout_ip=auto'); process.exit(1); }
if (note !== 'test [Quên checkout]') { console.error(`FAIL: note should contain tag, got "${note}"`); process.exit(1); }
// 08:31→17:00 = 509 min; minus lunch overlap (12:00-13:30=90) = 419 min = 6.98h
if (Math.abs(Number(workHours) - 6.98) > 0.02) { console.error(`FAIL: work_hours for id=1 expected ~6.98, got ${workHours}`); process.exit(1); }

const morningUpdate = updates.find(u => u.args && u.args[3] === 2);
const [mCo] = morningUpdate.args;
if (mCo !== '12:00') { console.error(`FAIL: morning shift should close at 12:00, got ${mCo}`); process.exit(1); }

console.log('PASS: all assertions passed');