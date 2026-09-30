import assert from 'node:assert';
import { resolveLatePenaltyNote, LATE_PENALTY_NOTE_EFFECTIVE_MONTH } from '../server/services/attendance.service.js';

console.log('🧪 Testing resolveLatePenaltyNote logic...');

// Mock in-memory DB
function createMockEnv(initialRecords = []) {
  const records = [...initialRecords];
  return {
    records,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT COUNT(*) as count FROM attendance')) {
                  const [userId, monthPattern, dateStr, existingId] = args;
                  const month = monthPattern.replace('%', '');
                  const filtered = records.filter(r => 
                    r.user_id === userId &&
                    r.date.startsWith(month) &&
                    r.date <= dateStr &&
                    (existingId === undefined || r.id !== existingId) &&
                    Number(r.late_minutes || 0) > 0 &&
                    !['cancelled', 'rejected'].includes(r.status)
                  );
                  return { count: filtered.length };
                }
                return { count: 0 };
              }
            };
          }
        };
      }
    }
  };
}

async function runTests() {
  const userId = 101;
  const env = createMockEnv();

  // Test 1: Prior month (e.g. 2026-09) - should NOT add penalty note
  const sepNote = await resolveLatePenaltyNote(env, userId, '2026-09-25', 15, null, 'Ghi chú cũ');
  assert.strictEqual(sepNote, 'Ghi chú cũ', 'Before 2026-10, note must be preserved as-is');
  console.log('  ✓ Preserves original note for dates before 2026-10');

  // Test 2: On-time check-in (lateMinutes <= 0) - should NOT add penalty note
  const onTimeNote = await resolveLatePenaltyNote(env, userId, '2026-10-01', 0, null, 'Đúng giờ');
  assert.strictEqual(onTimeNote, 'Đúng giờ', 'On-time check-in should not have penalty note');
  console.log('  ✓ No penalty note for on-time check-in');

  // Test 3: 1st time late in 2026-10 (Lần 1 - Miễn phạt)
  const note1 = await resolveLatePenaltyNote(env, userId, '2026-10-02', 15, null, '');
  assert.strictEqual(note1, 'Đi muộn 15p (Lần 1 - Miễn phạt)');
  console.log('  ✓ 1st time late in month tagged: Lần 1 - Miễn phạt');
  env.records.push({ id: 1, user_id: userId, date: '2026-10-02', late_minutes: 15, status: 'late' });

  // Test 4: 2nd time late in 2026-10 (Lần 2 - Miễn phạt) with custom note
  const note2 = await resolveLatePenaltyNote(env, userId, '2026-10-05', 20, null, 'Lý do kẹt xe');
  assert.strictEqual(note2, 'Đi muộn 20p (Lần 2 - Miễn phạt) | Lý do kẹt xe');
  console.log('  ✓ 2nd time late tagged: Lần 2 - Miễn phạt and merged with user note');
  env.records.push({ id: 2, user_id: userId, date: '2026-10-05', late_minutes: 20, status: 'late' });

  // Test 5: 3rd time late in 2026-10 (Lần 3 - Phạt: 20.000đ)
  const note3 = await resolveLatePenaltyNote(env, userId, '2026-10-08', 12, null, '');
  assert.strictEqual(note3, 'Đi muộn 12p (Lần 3 - Phạt: 20.000đ)');
  console.log('  ✓ 3rd time late tagged: Lần 3 - Phạt: 20.000đ');
  env.records.push({ id: 3, user_id: userId, date: '2026-10-08', late_minutes: 12, status: 'late' });

  // Test 6: 4th time late in 2026-10 (Lần 4 - Phạt: 20.000đ)
  const note4 = await resolveLatePenaltyNote(env, userId, '2026-10-12', 35, null, '');
  assert.strictEqual(note4, 'Đi muộn 35p (Lần 4 - Phạt: 20.000đ)');
  console.log('  ✓ 4th time late tagged: Lần 4 - Phạt: 20.000đ');
  env.records.push({ id: 4, user_id: userId, date: '2026-10-12', late_minutes: 35, status: 'late' });

  // Test 7: Updating record id: 3 (re-evaluating its note should not count itself twice)
  const reNote3 = await resolveLatePenaltyNote(env, userId, '2026-10-08', 25, 3, note3);
  assert.strictEqual(reNote3, 'Đi muộn 25p (Lần 3 - Phạt: 20.000đ)', 'Editing record 3 should still identify as Lần 3 and clean prior tag');
  console.log('  ✓ Re-evaluating existing record correctly replaces old tag without duplication');

  console.log('🎉 ALL LATE PENALTY NOTE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
