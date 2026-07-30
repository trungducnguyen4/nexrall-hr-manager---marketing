import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8791';
const parsedBase = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedBase.hostname)) {
  throw new Error('Smoke test này tạo dữ liệu thử và chỉ được phép chạy trên localhost.');
}

async function request(path, { method = 'GET', token, body, expected = 200 } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('json') ? await response.json() : await response.arrayBuffer();
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return { response, payload };
}

async function login(loginName, password) {
  const { payload } = await request('/api/auth/login', {
    method: 'POST',
    body: { login: loginName, password },
  });
  assert.match(payload.token, /^[0-9a-f]{64}$/);
  return payload;
}

function employeePayload(overrides = {}) {
  return {
    employee_type: 'NV',
    full_name: 'Nhân viên thử nghiệm',
    email: 'employee@example.test',
    phone: '0912345678',
    birth_date: '1998-05-20',
    national_id: '001098123456',
    home_address: 'Hà Nội',
    department: 'Phòng Marketing',
    position: 'Chuyên viên',
    direct_manager_id: 1,
    work_location: 'Văn phòng chính',
    contract_type: 'HĐCT',
    hire_date: '2026-07-01',
    contract_start_date: '2026-07-01',
    contract_end_date: '2027-06-30',
    ...overrides,
  };
}

function documentForm(name, type, category = 'cv') {
  const form = new FormData();
  form.set('category', category);
  form.set('title', `Tài liệu ${name}`);
  form.set('expires_on', '2026-08-15');
  form.set('file', new Blob(['%PDF-1.4\n% employee profile smoke test'], { type }), name);
  return form;
}

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const admin = await login('admin@company.com', 'Admin@123');
const adminToken = admin.token;

const directory = await request('/api/users/directory?page=1&page_size=5', { token: adminToken });
assert.ok(directory.payload.pagination.total >= 1);
const adminProfile = await request('/api/users/1/profile', { token: adminToken });
assert.equal(adminProfile.payload.user.employee_code, 'ADMIN001');

const managerEmail = `manager-${suffix}@example.test`;
const managerCreated = await request('/api/users', {
  method: 'POST',
  token: adminToken,
  body: employeePayload({
    full_name: 'Quản lý thử nghiệm',
    email: managerEmail,
    national_id: `002${String(Date.now()).slice(-9)}`,
    role: 'manager',
    position: 'Trưởng phòng',
  }),
});
const managerId = managerCreated.payload.id;

const employeeEmail = `employee-${suffix}@example.test`;
const employeeCreated = await request('/api/users', {
  method: 'POST',
  token: adminToken,
  body: employeePayload({
    email: employeeEmail,
    national_id: `003${String(Date.now() + 1).slice(-9)}`,
    direct_manager_id: managerId,
  }),
});
const employeeId = employeeCreated.payload.id;
assert.ok(employeeCreated.payload.employee_code);

const profile = await request(`/api/users/${employeeId}/profile`, { token: adminToken });
assert.equal(profile.payload.permissions.can_edit_compensation, true);
assert.equal(profile.payload.user.phone, '0912345678');

await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: adminToken,
  body: { salary: 18000000, allowance: 1200000, dependent_count: 2 },
});
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: adminToken,
  body: { dependent_count: -1 },
  expected: 400,
});
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: adminToken,
  body: { phone: '09-abcd' },
  expected: 400,
});
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: adminToken,
  body: { contract_start_date: '2027-07-01', contract_end_date: '2027-06-30' },
  expected: 400,
});
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: adminToken,
  body: { termination_date: '2026-07-30' },
  expected: 400,
});
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: adminToken,
  body: { direct_manager_id: employeeId },
  expected: 400,
});
await request('/api/users', {
  method: 'POST',
  token: adminToken,
  body: employeePayload({
    email: employeeEmail,
    national_id: `004${String(Date.now() + 2).slice(-9)}`,
    direct_manager_id: managerId,
  }),
  expected: 400,
});

const audit = await request(`/api/users/${employeeId}/audit`, { token: adminToken });
assert.ok(audit.payload.audit.some(entry => entry.field_name === 'salary'));

const invalidUpload = await request(`/api/users/${employeeId}/documents`, {
  method: 'POST',
  token: adminToken,
  body: documentForm('invalid.txt', 'text/plain'),
  expected: 400,
});
assert.match(invalidUpload.payload.error, /PDF|JPG|PNG|WebP/);

const spoofedPdf = new FormData();
spoofedPdf.set('category', 'cv');
spoofedPdf.set('file', new Blob(['not really a pdf'], { type: 'application/pdf' }), 'spoofed.pdf');
await request(`/api/users/${employeeId}/documents`, {
  method: 'POST',
  token: adminToken,
  body: spoofedPdf,
  expected: 400,
});

const oversizedPdf = new FormData();
const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 1);
oversizedBytes.set(new TextEncoder().encode('%PDF-'));
oversizedPdf.set('category', 'cv');
oversizedPdf.set('file', new Blob([oversizedBytes], { type: 'application/pdf' }), 'oversized.pdf');
await request(`/api/users/${employeeId}/documents`, {
  method: 'POST',
  token: adminToken,
  body: oversizedPdf,
  expected: 400,
});

await request(`/api/users/${employeeId}/documents`, {
  method: 'POST',
  token: adminToken,
  body: documentForm('cv-one.pdf', 'application/pdf'),
});
await request(`/api/users/${employeeId}/documents`, {
  method: 'POST',
  token: adminToken,
  body: documentForm('cv-two.pdf', 'application/pdf'),
});
const documents = await request(`/api/users/${employeeId}/documents`, { token: adminToken });
const cvDocuments = documents.payload.documents.filter(document => document.category === 'cv');
assert.equal(cvDocuments.length, 2);

const preview = await request(`/api/users/${employeeId}/documents/${cvDocuments[0].id}?disposition=inline`, {
  token: adminToken,
});
assert.match(preview.response.headers.get('content-disposition') || '', /^inline/);
const download = await request(`/api/users/${employeeId}/documents/${cvDocuments[0].id}?disposition=attachment`, {
  token: adminToken,
});
assert.match(download.response.headers.get('content-disposition') || '', /^attachment/);

const manager = await login(managerEmail, 'Pass@123');
const managerProfile = await request(`/api/users/${employeeId}/profile`, { token: manager.token });
assert.equal(managerProfile.payload.permissions.can_edit_compensation, false);
assert.equal(Object.hasOwn(managerProfile.payload.user, 'salary'), false);
assert.equal(Object.hasOwn(managerProfile.payload.user, 'national_id'), false);
await request('/api/users/1/profile', { token: manager.token, expected: 403 });
await request(`/api/users/${employeeId}/audit`, { token: manager.token, expected: 403 });
await request('/api/users/export.xls', { token: manager.token, expected: 403 });
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: manager.token,
  body: { home_address: 'Không được phép' },
  expected: 403,
});
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: manager.token,
  body: { work_location: 'Đà Nẵng' },
});

const employee = await login(employeeEmail, 'Pass@123');
const employeeProfile = await request(`/api/users/${employeeId}/profile`, { token: employee.token });
assert.equal(employeeProfile.payload.user.salary, 18000000);
assert.equal(employeeProfile.payload.permissions.can_edit_compensation, false);
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: employee.token,
  body: { salary: 1 },
  expected: 403,
});
await request('/api/attendance/register', {
  method: 'POST',
  token: employee.token,
  body: { work_type: 'business', shift: 'full', expected_start: '00:01', expected_end: '00:02', note: '' },
});
await request('/api/attendance/checkin', { method: 'POST', token: employee.token, body: {} });
await request('/api/attendance/checkout', { method: 'POST', token: employee.token, body: {} });
const todayAttendance = await request('/api/attendance/today', { token: employee.token });
const attendanceRow = todayAttendance.payload.attendance[0];
assert.ok(attendanceRow?.id);
await request(`/api/attendance/${attendanceRow.id}`, {
  method: 'PUT',
  token: adminToken,
  body: {
    checkin_time: attendanceRow.checkin_time,
    checkout_time: attendanceRow.checkout_time,
    status: 'absent',
    work_hours: attendanceRow.work_hours,
    note: '',
  },
});
await request(`/api/users/${employeeId}/documents`, { token: employee.token });
await request(`/api/users/${employeeId}/documents/${cvDocuments[0].id}`, {
  method: 'DELETE',
  token: employee.token,
  expected: 403,
});

await request(`/api/users/${employeeId}/documents/${cvDocuments[0].id}`, {
  method: 'DELETE',
  token: adminToken,
});
const remainingDocuments = await request(`/api/users/${employeeId}/documents`, { token: adminToken });
assert.equal(remainingDocuments.payload.documents.filter(document => document.category === 'cv').length, 1);

await request(`/api/users/${employeeId}/lifecycle`, {
  method: 'PUT',
  token: adminToken,
  body: { status: 'Đã nghỉ', reason: 'Kiểm thử vòng đời nhân sự' },
});
await request(`/api/users/${employeeId}/profile`, {
  method: 'PATCH',
  token: adminToken,
  body: { termination_date: '2026-07-30' },
});

const timeline = await request(`/api/users/${employeeId}/timeline`, { token: adminToken });
assert.ok(timeline.payload.timeline.some(event => event.type === 'salary'));
assert.ok(timeline.payload.timeline.some(event => event.type === 'document'));
assert.ok(timeline.payload.timeline.some(event => event.type === 'termination'));

const filtered = await request(`/api/users/directory?search=${encodeURIComponent(employeeCreated.payload.employee_code)}&department=${encodeURIComponent('Phòng Marketing')}`, {
  token: adminToken,
});
assert.equal(filtered.payload.pagination.total, 1);

const exported = await request('/api/users/export.xls?department=Ph%C3%B2ng%20Marketing', { token: adminToken });
assert.match(exported.response.headers.get('content-type') || '', /application\/vnd\.ms-excel/);
assert.ok(exported.payload.byteLength > 200);
assert.match(new TextDecoder().decode(exported.payload), /Nhân viên thử nghiệm/);

const alerts = await request('/api/users/alerts?window=30', { token: adminToken });
assert.ok(Array.isArray(alerts.payload.alerts));
const notifications = await request('/api/notifications?window=30&page=1&page_size=100', { token: adminToken });
const employeeNotifications = notifications.payload.notifications.filter(item => Number(item.employee_id) === employeeId);
assert.ok(employeeNotifications.some(item => item.type === 'attendance_late'));
assert.ok(employeeNotifications.some(item => item.type === 'attendance_checkout_late'));
assert.ok(employeeNotifications.some(item => item.type === 'attendance_unexcused_absence'));
assert.ok(employeeNotifications.filter(item => item.module === 'attendance').every(item => item.action_url.includes(`#/attendance/`)));
const attendanceSummary = await request(
  `/api/attendance/employees/${employeeId}/summary?from=${encodeURIComponent(attendanceRow.date)}&to=${encodeURIComponent(attendanceRow.date)}`,
  { token: adminToken },
);
assert.equal(attendanceSummary.payload.summary.absentDays, 1);
const managerNotifications = await request('/api/notifications?window=30&page=1&page_size=100', { token: manager.token });
assert.ok(managerNotifications.payload.notifications.some(item => Number(item.employee_id) === employeeId && item.module === 'attendance'));
assert.equal(managerNotifications.payload.notifications.some(item => item.module === 'employee_profile'), false);
const selfNotifications = await request('/api/notifications?window=30&page=1&page_size=100', { token: employee.token });
assert.ok(selfNotifications.payload.notifications.some(item => Number(item.employee_id) === employeeId && item.module === 'attendance'));
assert.equal(selfNotifications.payload.notifications.some(item => item.module === 'employee_profile'), false);
await request('/api/users/basic', { token: adminToken });
await request(`/api/users/${employeeId}`, { method: 'DELETE', token: adminToken, expected: 409 });

console.log(JSON.stringify({
  ok: true,
  manager_id: managerId,
  employee_id: employeeId,
  audit_entries: audit.payload.pagination.total,
  timeline_events: timeline.payload.timeline.length,
  alert_count: alerts.payload.total,
  notification_count: notifications.payload.total,
}, null, 2));
