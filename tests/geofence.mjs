// ════════════════════════════════════════════════
//  Geofence / GPS attendance tests (node, mock D1).
//
//  Covers (requirement #26):
//    · geofence math (distance 20/100/101 m vs radius 100)
//    · backend never trusts client inside_geofence/distance
//    · invalid coordinates rejected
//    · office check-in missing GPS handled per policy
//    · WFH is NOT blocked by the office geofence
//    · persistence: lat/lng/accuracy/location_id/distance/geofence status saved
//    · authorization: admin sees all markers, employee only their own,
//      manager only their department
//    · legacy rows without GPS are excluded from the map
// ════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import assert from 'assert';

const TOKEN = 'a'.repeat(64);
const SERVER_URL = 'https://x.local';
const TODAY = '2026-08-16';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const { geoDistanceMeters, geofenceDecision, handle } = mod;

let passed = 0;
function ok(name) { passed++; console.log(`  ok  ${name}`); }

// ── 1. Pure geofence math ───────────────────────
console.log('Geofence math');
// Same point = 0
assert.strictEqual(geoDistanceMeters(10.8, 106.5, 10.8, 106.5), 0);
ok('same point distance = 0');
// 0.001° latitude ≈ 111.2 m
const dLat1deg = geoDistanceMeters(10.8, 106.5, 10.801, 106.5);
assert.ok(dLat1deg > 108 && dLat1deg < 114, `0.001deg lat should be ~111m, got ${dLat1deg}`);
ok('0.001° latitude ≈ 111 m');
// Boundary rule: distance <= radius → inside (inclusive)
assert.strictEqual(geofenceDecision(20, 100).inside, true);
assert.strictEqual(geofenceDecision(100, 100).inside, true);
assert.strictEqual(geofenceDecision(101, 100).inside, false);
assert.strictEqual(geofenceDecision(101, 100).outside_meters, 1);
ok('inside for 20m & 100m (boundary), outside for 101m, radius 100m');

// ── Mock D1 ─────────────────────────────────────
function makeDB({
  session = null,
  attendanceRows = [],
  attendanceLocations = [],
  gpsRows = [],           // full marker dataset (scoped by SQL below)
  gpsConstraint = '1',
} = {}) {
  const updates = [];
  const queries = [];
  const db = {
    async exec() {},
    prepare(sql) {
      const stmt = {
        sql, args: [],
        bind(...args) { stmt.args = args; return stmt; },
        async all() {
          queries.push({ sql, args: [...stmt.args] });
          // Map markers query — apply the same scope + no-GPS filter the real SQL enforces.
          if (sql.includes('checkin_lat IS NOT NULL')) {
            let rows = gpsRows.filter(r => r.checkin_lat != null && r.checkin_lng != null);
            if (/a\.user_id=\?/.test(sql)) rows = rows.filter(r => String(r.user_id) === String(stmt.args[1]));
            else if (/u\.department=\?/.test(sql)) rows = rows.filter(r => r.department === stmt.args[1]);
            return { results: rows };
          }
          if (sql.includes('FROM wifi_whitelist')) return { results: [] };
          if (sql.includes('attendance_locations')) return { results: attendanceLocations };
          if (sql.includes('FROM attendance ') || sql.includes('FROM users')) return { results: attendanceRows };
          return { results: [] };
        },
        async run() {
          queries.push({ sql, args: [...stmt.args], type: 'run' });
          const t = sql.trim().startsWith('UPDATE attendance') || sql.trim().startsWith('INSERT INTO attendance');
          if (t) updates.push({ sql, args: [...stmt.args] });
          return { meta: { last_row_id: 1 } };
        },
        async first() {
          queries.push({ sql, args: [...stmt.args] });
          if (sql.includes('FROM sessions')) return session;
          if (sql.includes('attendance_gps_constraint')) return gpsConstraint === '0' ? { setting_value: '0' } : { setting_value: '1' };
          if (sql.includes("setting_key='schema_version'")) return null;
          if (sql.includes("setting_key='seed_version'")) return null;
          if (/SELECT \* FROM attendance WHERE user_id=\? AND date=\?/.test(sql)) {
            return attendanceRows.find(r => String(r.user_id) === String(stmt.args[0])) || null;
          }
          if (sql.includes('checkin_location_id, checkin_lat, checkin_lng')) {
            const mine = attendanceRows.find(r => String(r.user_id) === String(session?.uid ?? ''));
            return (mine && mine.checkin_lat != null) ? mine : null;
          }
          if (sql.includes('GROUP BY checkin_location_id')) return null;
          if (/FROM attendance_locations WHERE id=\?/.test(sql)) return attendanceLocations.find(l => String(l.id) === String(stmt.args[0])) || null;
          return null;
        },
      };
      return stmt;
    },
    async batch(items) { for (const item of items) await item.run(); },
  };
  return { db, updates, queries };
}

function makeSession({ role = 'employee', department = '', id = 1, full_name = 'NV' } = {}) {
  return {
    uid: id, full_name, email: `${id}@x.com`, role, department,
    position: 'Nhân viên', avatar_color: '#4F46E5', avatar_initials: 'NV',
    avatar_url: null, employee_code: `NV-${id}`, salary: 0, phone: '',
    bank_account: null, bank_name: null, is_active: 1,
    lifecycle_status: null, must_change_password: 0,
  };
}

function HCMOffice() {
  return { id: 1, name: 'Văn phòng HCM', code: 'HCM', address: 'TP.HCM', latitude: 10.762538, longitude: 106.682336, radius_meters: 100, max_accuracy_meters: 100, is_active: 1 };
}

async function call(method, path, body, { db }) {
  const req = new Request(SERVER_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handle(req, { DB: db });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// ── 2. Check-in persistence + server validation ──
console.log('Backend validation & persistence');
{
  const office = HCMOffice();
  const existing = { id: 10, user_id: 1, date: TODAY, work_type: 'office', shift: 'full', registered: 1, checkin_time: null, status: 'registered', note: null, expected_start: null, expected_end: null };
  const { db, updates } = makeDB({ session: makeSession({ role: 'employee', id: 1 }), attendanceRows: [existing], attendanceLocations: [office] });

  // inside (~33 m)
  const insideLat = office.latitude + 0.0003;
  let r = await call('POST', '/api/attendance/checkin', { latitude: insideLat, longitude: office.longitude, accuracy: 18 }, { db });
  assert.strictEqual(r.status, 200, `inside checkin should succeed, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.inside_geofence, true);
  const up = updates.find(u => u.args && String(u.args[12]) === '10');
  assert.ok(up, 'UPDATE attendance captured');
  // order: time,ip,status,late,locId,distance,accuracy,method,lat,lng,geofenceStatus,note,id
  assert.strictEqual(up.args[8], insideLat, 'checkin_lat persisted');
  assert.strictEqual(up.args[9], office.longitude, 'checkin_lng persisted');
  assert.strictEqual(up.args[10], 'inside', 'checkin_geofence_status persisted');
  assert.strictEqual(Math.round(Number(up.args[5])), 33, `distance persisted (~33m), got ${up.args[5]}`);
  assert.strictEqual(up.args[6], 18, 'accuracy persisted');
  assert.strictEqual(up.args[4], 1, 'checkin_location_id persisted');
  ok('inside check-in: lat/lng/accuracy/location/distance/geofence persisted (server-computed)');

  // client fake flag ignored → outside is still blocked
  await new Promise(res => setTimeout(res, 1)); // reset rate? not used here
  const outsideLat = office.latitude + 0.002; // ~222 m
  r = await call('POST', '/api/attendance/checkin', { latitude: outsideLat, longitude: office.longitude, accuracy: 18, inside_geofence: true, distance_meters: 5 }, { db });
  assert.strictEqual(r.status, 403, `faked inside should still be blocked, got ${r.status}`);
  assert.strictEqual(r.body.geofence.inside_geofence, false, 'server must recompute inside_geofence');
  ok('client cannot fake inside_geofence=true (outside payload blocked)');
}

{
  // invalid coordinates → 400
  const office = HCMOffice();
  const existing = { id: 11, user_id: 2, date: TODAY, work_type: 'office', shift: 'full', registered: 1, checkin_time: null, status: 'registered', note: null };
  let r = await call('POST', '/api/attendance/checkin', { latitude: 95, longitude: 106, accuracy: 10 }, { db: makeDB({ session: makeSession({ id: 2 }), attendanceRows: [existing], attendanceLocations: [office] }).db });
  assert.strictEqual(r.status, 400, `invalid latitude should reject, got ${r.status}: ${JSON.stringify(r.body)}`);
  ok('invalid coordinates → 400');
}

{
  // office check-in missing GPS (constraint on) → blocked by policy
  const office = HCMOffice();
  const existing = { id: 12, user_id: 3, date: TODAY, work_type: 'office', shift: 'full', registered: 1, checkin_time: null, status: 'registered', note: null };
  const r = await call('POST', '/api/attendance/checkin', { note: 'no gps' }, { db: makeDB({ session: makeSession({ id: 3 }), attendanceRows: [existing], attendanceLocations: [office] }).db });
  assert.strictEqual(r.status, 403, 'office check-in missing GPS should be blocked when constraint on');
  ok('office check-in missing GPS → 403 (policy)');
}

{
  // WFH not blocked by office geofence, even outside
  const office = HCMOffice();
  const existing = { id: 13, user_id: 4, date: TODAY, work_type: 'wfh', shift: 'full', registered: 1, checkin_time: null, status: 'registered', note: null };
  const { db, updates } = makeDB({ session: makeSession({ id: 4 }), attendanceRows: [existing], attendanceLocations: [office] });
  const outsideLat = office.latitude + 0.002;
  const r = await call('POST', '/api/attendance/checkin', { latitude: outsideLat, longitude: office.longitude, accuracy: 10 }, { db });
  assert.strictEqual(r.status, 200, `WFH outside geofence should succeed, got ${r.status}: ${JSON.stringify(r.body)}`);
  const up = updates.find(u => u.args && String(u.args[12]) === '13');
  assert.ok(up, 'WFH UPDATE captured');
  assert.strictEqual(up.args[10], null, 'WFH check-in must NOT store office geofence status');
  ok('WFH is not blocked by office geofence (status left null)');
}

// ── 3. check-in-points authorization + legacy ───
console.log('Check-in-points authorization');
function rgbColorRow(id, name, dept, lat, lng, distance, inside) {
  return { user_id: id, checkin_time: '08:31', checkin_lat: lat, checkin_lng: lng, checkin_accuracy_meters: 18, checkin_location_id: 1, checkin_distance_meters: distance, full_name: name, employee_code: `NV-${id}`, department: dept, inside_geofence: inside, is_current_user: id === 1 };
}
const office = HCMOffice();
const markers = [
  rgbColorRow(1, 'Hậu', 'Phòng Kinh Doanh', office.latitude + 0.0003, office.longitude, 33, true),
  rgbColorRow(2, 'Linh', 'Phòng Kinh Doanh', office.latitude + 0.0005, office.longitude, 55, true),
  rgbColorRow(3, 'Trang', 'Phòng Marketing', office.latitude + 0.002, office.longitude, 222, false),
];
// legacy row with NO GPS (checkin_lat null) — must be excluded at the query level
const legacyRow = { user_id: 9, checkin_time: '08:40', checkin_lat: null, checkin_lng: null, checkin_accuracy_meters: null, checkin_location_id: null, checkin_distance_meters: null, full_name: 'Legacy', employee_code: 'NV-9', department: 'Phòng Marketing' };
const allGps = [...markers, legacyRow];

{
  // admin → all markers with GPS
  const { db, queries } = makeDB({ session: makeSession({ role: 'admin', id: 1 }), gpsRows: allGps, attendanceLocations: [office] });
  const r = await call('GET', `/api/attendance/checkin-points?date=${TODAY}`, undefined, { db });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.viewer.can_view_all_markers, true);
  assert.strictEqual(r.body.viewer.scope, 'company');
  assert.strictEqual(r.body.markers.length, 3, 'legacy row without GPS must be excluded');
  assert.strictEqual(r.body.office.id, 1);
  const markerQuery = queries.find(q => q.sql.includes('checkin_lat IS NOT NULL'));
  assert.ok(markerQuery && markerQuery.sql.includes('checkin_lat IS NOT NULL'), 'markers query must exclude legacy no-GPS rows');
  ok('admin sees 3 markers (legacy no-GPS excluded); can_view_all_markers');
}

{
  // employee → only their own marker
  const { db } = makeDB({ session: makeSession({ role: 'employee', id: 1, department: 'Phòng Kinh Doanh' }), gpsRows: allGps, attendanceLocations: [office] });
  const r = await call('GET', `/api/attendance/checkin-points?date=${TODAY}`, undefined, { db });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.viewer.scope, 'self');
  assert.strictEqual(r.body.viewer.can_view_all_markers, false);
  assert.strictEqual(r.body.markers.length, 1, 'regular employee sees only their own marker');
  assert.strictEqual(r.body.markers[0].is_current_user, true, 'marker is flagged as current user');
  assert.ok(r.body.markers[0].distance_m != null, 'server computes distance per marker');
  assert.strictEqual(r.body.markers[0].inside_geofence, true);
  ok('employee sees only own marker (permission enforced server-side)');
}

{
  // manager → only their department
  const { db } = makeDB({ session: makeSession({ role: 'manager', id: 9, department: 'Phòng Kinh Doanh' }), gpsRows: allGps, attendanceLocations: [office] });
  const r = await call('GET', `/api/attendance/checkin-points?date=${TODAY}`, undefined, { db });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.viewer.scope, 'department');
  assert.strictEqual(r.body.markers.length, 2, 'manager sees only their department markers');
  ok('manager sees only department markers');
}

console.log(`\nPASS: ${passed} assertions passed`);