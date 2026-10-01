import assert from 'node:assert';
import {
  ATT_STANDARD_SHIFTS,
  attShiftBounds,
  attManualTimingMetrics,
  getDynamicShiftBounds,
  syncTodayLateRecords,
  resolveLatePenaltyNote,
} from '../server/services/attendance.service.js';

console.log('🧪 Testing 8h35 late rule and dynamic shift bounds...');

async function runTests() {
  // 1. Check default ATT_STANDARD_SHIFTS
  assert.strictEqual(ATT_STANDARD_SHIFTS.full.start, '08:30');
  assert.strictEqual(ATT_STANDARD_SHIFTS.full.lateAfter, '08:35');
  assert.strictEqual(ATT_STANDARD_SHIFTS.morning.lateAfter, '08:35');
  assert.strictEqual(ATT_STANDARD_SHIFTS.afternoon.lateAfter, '13:35');
  console.log('  ✓ Standard shift bounds default to 08:35 / 13:35 late threshold');

  // 2. Timing metrics calculations
  const record = { work_type: 'office', shift: 'full' };
  
  const m830 = attManualTimingMetrics(record, '08:30', '17:00');
  assert.strictEqual(m830.lateMinutes, 0, '08:30 is on time');
  
  const m835 = attManualTimingMetrics(record, '08:35', '17:00');
  assert.strictEqual(m835.lateMinutes, 0, '08:35 is on time (threshold)');
  
  const m836 = attManualTimingMetrics(record, '08:36', '17:00');
  assert.strictEqual(m836.lateMinutes, 1, '08:36 is 1 minute late');
  
  const m840 = attManualTimingMetrics(record, '08:40', '17:00');
  assert.strictEqual(m840.lateMinutes, 5, '08:40 is 5 minutes late (sau 8h35 là trễ)');
  
  const m845 = attManualTimingMetrics(record, '08:45', '17:00');
  assert.strictEqual(m845.lateMinutes, 10, '08:45 is 10 minutes late');
  console.log('  ✓ 8h35 timing metrics calculated correctly: 8h35 on time, 8h40 is 5m late');

  // 3. Dynamic shift bounds from DB
  const mockEnv = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async all() {
                return {
                  results: [
                    { setting_key: 'work_start', setting_value: '08:30' },
                    { setting_key: 'work_end', setting_value: '17:00' },
                    { setting_key: 'late_threshold', setting_value: '5' },
                  ]
                };
              }
            };
          },
          async all() {
            return {
              results: [
                { setting_key: 'work_start', setting_value: '08:30' },
                { setting_key: 'work_end', setting_value: '17:00' },
                { setting_key: 'late_threshold', setting_value: '5' },
              ]
            };
          }
        };
      }
    }
  };

  const dynamicBounds = await getDynamicShiftBounds(mockEnv, 'office', 'full', null, null);
  assert.strictEqual(dynamicBounds.start, '08:30');
  assert.strictEqual(dynamicBounds.lateAfter, '08:35');
  console.log('  ✓ Dynamic shift bounds correctly reads work_start (08:30) + late_threshold (5) -> 08:35');

  // 4. Test syncTodayLateRecords: auto fix records created today at 08:40
  const rows = [
    {
      id: 501,
      user_id: 12,
      date: '2026-10-01',
      checkin_time: '08:40',
      checkout_time: null,
      work_type: 'office',
      shift: 'full',
      status: 'present', // previously marked present before fix
      late_minutes: 0,
      note: 'Đi làm bình thường',
    },
    {
      id: 502,
      user_id: 15,
      date: '2026-10-01',
      checkin_time: '08:30',
      checkout_time: null,
      work_type: 'office',
      shift: 'full',
      status: 'present',
      late_minutes: 0,
      note: '',
    }
  ];

  const syncEnv = {
    DB: {
      prepare(sql) {
        const stmt = {
          bind(...args) {
            return {
              async all() {
                if (sql.includes('FROM attendance') && sql.includes('WHERE date = ?')) {
                  return { results: rows.filter(r => r.date === args[0]) };
                }
                return { results: [] };
              },
              async first() {
                if (sql.includes('COUNT(*) as count FROM attendance')) {
                  return { count: 0 };
                }
                return null;
              },
              async run() {
                if (sql.includes('UPDATE attendance SET late_minutes = ?')) {
                  const [lateMin, status, note, id] = args;
                  const row = rows.find(r => r.id === id);
                  if (row) {
                    row.late_minutes = lateMin;
                    row.status = status;
                    row.note = note;
                  }
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
            };
          },
          async all() {
            if (sql.includes('SELECT setting_key, setting_value FROM settings')) {
              return {
                results: [
                  { setting_key: 'work_start', setting_value: '08:30' },
                  { setting_key: 'late_threshold', setting_value: '5' },
                ]
              };
            }
            return { results: [] };
          }
        };
        return stmt;
      }
    }
  };

  const syncResult = await syncTodayLateRecords(syncEnv, '2026-10-01');
  assert.strictEqual(syncResult.updated, 1, 'Should have updated exactly 1 record');
  
  const updatedRow = rows.find(r => r.id === 501);
  assert.strictEqual(updatedRow.status, 'late');
  assert.strictEqual(updatedRow.late_minutes, 5);
  assert.strictEqual(updatedRow.note, 'Đi muộn 5p (Lần 1 - Miễn phạt) | Đi làm bình thường');
  console.log('  ✓ syncTodayLateRecords successfully updated 08:40 check-in to late (5m) and attached penalty tag note');

  console.log('🎉 ALL 8H35 LATE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
