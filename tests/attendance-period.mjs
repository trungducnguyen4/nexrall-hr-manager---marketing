import assert from 'node:assert/strict';
import { attendanceClosingMonth } from '../src/attendance-period.js';

// UTC timestamps selected so that their Vietnam calendar date is unambiguous.
// Always returns the current calendar month in Vietnam time (no day 10 rollback).
assert.equal(attendanceClosingMonth(new Date('2026-08-01T05:00:00Z')), '2026-08');
assert.equal(attendanceClosingMonth(new Date('2026-08-10T05:00:00Z')), '2026-08');
assert.equal(attendanceClosingMonth(new Date('2026-08-11T05:00:00Z')), '2026-08');
assert.equal(attendanceClosingMonth(new Date('2026-10-01T02:05:00Z')), '2026-10');
assert.equal(attendanceClosingMonth(new Date('2027-01-01T05:00:00Z')), '2027-01');
console.log('attendance-period: ok');
