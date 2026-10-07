import assert from 'node:assert/strict';
import { parseProofList, serializeProofList } from '../src/views/attendance.js';

console.log('Testing Multi-proof WFH & Overtime logic...');

// Test 1: parseProofList edge cases
assert.deepEqual(parseProofList(null), []);
assert.deepEqual(parseProofList(''), []);
assert.deepEqual(parseProofList(undefined), []);

// Test 2: Legacy single file backward compatibility
const legacyUrl = '/api/attendance/wfh-proof/12345678-1234-1234-1234-123456789abc';
const parsedLegacy = parseProofList(legacyUrl, 'bao-cao.pdf');
assert.equal(parsedLegacy.length, 1);
assert.equal(parsedLegacy[0].url, legacyUrl);
assert.equal(parsedLegacy[0].filename, 'bao-cao.pdf');
assert.equal(parsedLegacy[0].isLink, false);

// Test 3: External single link
const externalLink = 'https://docs.google.com/document/d/12345';
const parsedExternal = parseProofList(externalLink);
assert.equal(parsedExternal.length, 1);
assert.equal(parsedExternal[0].url, externalLink);
assert.equal(parsedExternal[0].isLink, true);

// Test 4: JSON serialized multi-proof list (up to 5 files)
const sampleProofs = [
  { url: '/api/attendance/wfh-proof/aaa', filename: 'anh1.png', document_id: 'aaa', size: 1024 },
  { url: '/api/attendance/wfh-proof/bbb', filename: 'anh2.jpg', document_id: 'bbb', size: 2048 },
  { url: 'https://notion.so/my-task', filename: 'notion.so…', isLink: true },
  { url: '/api/attendance/wfh-proof/ccc', filename: 'don_ot.pdf', document_id: 'ccc', size: 50000 },
  { url: '/api/attendance/wfh-proof/ddd', filename: 'anh5.png', document_id: 'ddd', size: 12000 }
];

const jsonStr = JSON.stringify(sampleProofs);
const parsedMulti = parseProofList(jsonStr);
assert.equal(parsedMulti.length, 5);
assert.equal(parsedMulti[0].filename, 'anh1.png');
assert.equal(parsedMulti[2].isLink, true);
assert.equal(parsedMulti[4].filename, 'anh5.png');

// Test 5: serializeProofList
// Empty list
assert.deepEqual(serializeProofList([]), { url: null, filename: null, docId: null });

// Single item -> outputs raw URL string (100% backward compatible format)
const singleSerialized = serializeProofList([sampleProofs[0]]);
assert.equal(singleSerialized.url, '/api/attendance/wfh-proof/aaa');
assert.equal(singleSerialized.filename, 'anh1.png');
assert.equal(singleSerialized.docId, 'aaa');

// Multi-item (2 to 5 files) -> outputs JSON string
const multiSerialized = serializeProofList(sampleProofs);
assert.equal(typeof multiSerialized.url, 'string');
assert.ok(multiSerialized.url.startsWith('['));
assert.equal(multiSerialized.filename, '5 tệp minh chứng');
assert.equal(multiSerialized.docId, 'aaa');

// Re-parsing the serialized string produces identical list
const roundTrip = parseProofList(multiSerialized.url);
assert.equal(roundTrip.length, 5);
assert.equal(roundTrip[1].filename, 'anh2.jpg');
assert.equal(roundTrip[3].url, '/api/attendance/wfh-proof/ccc');

// Test 6: Per-shift Overtime items proofs isolation
const shift1Proofs = [
  { url: '/api/attendance/wfh-proof/s1-1', filename: 'ca1_log.pdf', document_id: 's1-1', size: 5000 },
  { url: 'https://docs.google.com/document/d/shift1', filename: 'docs.google.com…', isLink: true }
];
const shift2Proofs = [
  { url: '/api/attendance/wfh-proof/s2-1', filename: 'ca2_screenshot.png', document_id: 's2-1', size: 8500 }
];
const shift3Proofs = [];

const formPayload = {
  period_month: '2026-10',
  items: [
    {
      start_at: '2026-10-06T18:00',
      end_at: '2026-10-06T20:00',
      reason: 'Bảo trì hệ thống server',
      time_category: 'workday',
      proof_url: serializeProofList(shift1Proofs).url
    },
    {
      start_at: '2026-10-06T20:30',
      end_at: '2026-10-06T22:30',
      reason: 'Hỗ trợ khách hàng khẩn cấp',
      time_category: 'workday',
      proof_url: serializeProofList(shift2Proofs).url
    },
    {
      start_at: '2026-10-07T18:00',
      end_at: '2026-10-07T19:00',
      reason: 'Viết tài liệu bàn giao',
      time_category: 'workday',
      proof_url: serializeProofList(shift3Proofs).url
    }
  ]
};

// Verify Shift 1 has 2 proofs
const parsedShift1 = parseProofList(formPayload.items[0].proof_url);
assert.equal(parsedShift1.length, 2);
assert.equal(parsedShift1[0].filename, 'ca1_log.pdf');
assert.equal(parsedShift1[1].isLink, true);

// Verify Shift 2 has 1 single proof (backward compatible single url)
const parsedShift2 = parseProofList(formPayload.items[1].proof_url);
assert.equal(parsedShift2.length, 1);
assert.equal(parsedShift2[0].url, '/api/attendance/wfh-proof/s2-1');

// Verify Shift 3 has no proofs
const parsedShift3 = parseProofList(formPayload.items[2].proof_url);
assert.equal(parsedShift3.length, 0);

console.log('PASS: All multi-proof WFH and Overtime tests passed successfully!');

