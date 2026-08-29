# Analysis Report: Comprehensive Domain Mutation Broadcast Pipeline

**Author**: Explorer M1_3 (Milestone 1 — Backend Real-Time Core & Broadcast Pipeline)  
**Date**: 2026-08-27  
**Target Codebase**: `server.js` (Cloudflare Worker backend)  
**Output Purpose**: Exhaustive audit and exact code injection guide for wiring `broadcastAppEvent()` into all domain mutation endpoints across NetViet HR.

---

## 1. Executive Summary

To achieve seamless, zero-refresh real-time synchronization across all users (User A mutates -> User B immediately observes changes without manual F5 refresh), every state-mutating endpoint in `server.js` must emit a strongly typed event via the universal `broadcastAppEvent()` helper.

This investigation systematically inspected all 9,677 lines of `server.js` to establish:
1. Exact file line numbers for DB writes and response returns.
2. The precise insertion point for `broadcastAppEvent()` right after DB commit and before `return json(...)`.
3. Standardized topic names and event names conforming to the system contract.
4. Comprehensive structured payload schemas for each event.
5. Targeting metadata (`actorId`, `targetUserIds` for privacy/scoping, or omitted for full-topic broadcast).

---

## 2. Event Dispatch Helper Contract

The universal helper `broadcastAppEvent(env, topic, eventName, payload, options)` (implemented by M1_2 / `server.js`) uses non-blocking dispatch to `env.SYNC_HUB` (the `AppSyncHub` Durable Object).

### Contract Signature
```javascript
/**
 * Broadcasts a domain event to AppSyncHub Durable Object.
 * @param {object} env - Cloudflare Worker environment bindings (contains env.SYNC_HUB)
 * @param {string} topic - Topic namespace ('tasks', 'chat', 'notifications', 'attendance', 'leave', 'payroll', 'invoices', 'users')
 * @param {string} event - Concrete event name (e.g., 'task:created', 'leave:approved')
 * @param {object} payload - Domain data payload
 * @param {object} [options] - Optional routing config { actorId, targetUserIds }
 */
async function broadcastAppEvent(env, topic, event, payload, options = {}) {
  try {
    if (!env.SYNC_HUB) return;
    const hubId = env.SYNC_HUB.idFromName('global');
    const hubStub = env.SYNC_HUB.get(hubId);
    const envelope = {
      topic,
      event,
      payload,
      actorId: options.actorId || null,
      targetUserIds: options.targetUserIds || null,
      timestamp: new Date().toISOString(),
    };
    // Non-blocking RPC / HTTP call to AppSyncHub
    hubStub.fetch('http://do/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    }).catch(err => console.warn(`Broadcast failed for ${topic}/${event}:`, err));
  } catch (err) {
    console.warn(`broadcastAppEvent error for ${topic}/${event}:`, err);
  }
}
```

---

## 3. Detailed Endpoint Specification & Injection Guide

### Domain 1: Tasks & Subtasks

#### 1.1 `POST /api/tasks` (Task Creation)
- **Location**: `server.js`, lines 6941–6979
- **DB Write**: Lines 6955–6958 (`INSERT INTO tasks ...`)
- **Followers**: Lines 6968–6977 (`defaultFollowerIds`)
- **Insertion Point**: Immediately before line 6978 (`return json({ ok: true, id: taskId });`)
- **Topic**: `'tasks'`
- **Event**: `'task:created'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'tasks', 'task:created', {
      id: taskId,
      title: b.title,
      description: b.description || '',
      status,
      priority,
      assigned_to: b.assigned_to || null,
      assigned_by: me.id,
      department: b.department || '',
      date: b.date || null,
      due_date: b.due_date || null,
      team_project_id: projectId,
      group_id: groupId,
      label_id: labelId,
      label_color: labelColor,
    }, { actorId: me.id });
```

#### 1.2 `PUT /api/tasks/:id` (Task Update)
- **Location**: `server.js`, lines 7016–7057
- **DB Write**: Lines 7038–7039 (`UPDATE tasks SET ... WHERE id=?`)
- **Insertion Point**: Immediately before line 7056 (`return json({ ok: true });`)
- **Topic**: `'tasks'`
- **Event**: `'task:updated'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'tasks', 'task:updated', {
      id: tid,
      title: nextTitle,
      description: b.description ?? task.description,
      status: nextStatus,
      priority: nextPriority,
      assigned_to: nextAssigneeId,
      department: b.department ?? task.department,
      date: b.date ?? task.date,
      due_date: b.due_date ?? task.due_date,
      team_project_id: nextProjectId,
      group_id: nextGroupId,
      label_id: nextLabelId,
      position: nextPosition,
      activity_action: activityAction,
    }, { actorId: me.id });
```

#### 1.3 `DELETE /api/tasks/:id` (Task Deletion)
- **Location**: `server.js`, lines 7058–7074
- **DB Write**: Lines 7066–7071 (`DELETE FROM tasks WHERE id=?`, etc.)
- **Insertion Point**: Immediately before line 7072 (`return json({ ok: true });`)
- **Topic**: `'tasks'`
- **Event**: `'task:deleted'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'tasks', 'task:deleted', {
      id: tid,
    }, { actorId: me.id });
```

#### 1.4 `POST /api/tasks/reorder` (Task Reorder / Board Drag & Drop)
- **Location**: `server.js`, lines 6903–6939
- **DB Write**: Line 6936 (`await env.DB.batch(statements);`)
- **Insertion Point**: Immediately before line 6938 (`return json({ ok: true, updated: statements.length });`)
- **Topic**: `'tasks'`
- **Event**: `'task:reordered'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'tasks', 'task:reordered', {
      project_id: projectId,
      moves: b.moves || null,
      task_ids: b.task_ids || null,
      group_id: b.group_id !== undefined ? intOrNull(b.group_id) : null,
    }, { actorId: me.id });
```

#### 1.5 `POST /api/tasks/:id/subtasks` (Subtask Creation)
- **Location**: `server.js`, lines 7076–7108
- **DB Write**: Lines 7090–7092 (`INSERT INTO subtasks ...`)
- **Insertion Point**: Immediately before line 7107 (`return json({ ok: true, id: subtaskId });`)
- **Topic**: `'tasks'`
- **Event**: `'subtask:created'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'tasks', 'subtask:created', {
      id: subtaskId,
      task_id: tid,
      title,
      description: b.description || null,
      assigned_to: b.assigned_to || null,
      due_date: b.due_date || null,
      is_done: 0,
    }, { actorId: me.id });
```

#### 1.6 `PUT /api/subtasks/:id` (Subtask Update / Toggle Done)
- **Location**: `server.js`, lines 7110–7140
- **DB Write**: Lines 7125–7126 (`UPDATE subtasks SET ... WHERE id=?`)
- **Insertion Point**: Immediately before line 7139 (`return json({ ok: true });`)
- **Topic**: `'tasks'`
- **Event**: `'subtask:updated'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'tasks', 'subtask:updated', {
      id: sid,
      task_id: subtask.task_id,
      title: nextTitle,
      description: b.description ?? subtask.description ?? null,
      is_done: nextDone,
      assigned_to: nextAssigneeId,
      due_date: b.due_date ?? subtask.due_date ?? null,
    }, { actorId: me.id });
```

#### 1.7 `DELETE /api/subtasks/:id` (Subtask Deletion)
- **Location**: `server.js`, lines 7141–7153
- **DB Write**: Line 7150 (`DELETE FROM subtasks WHERE id=?`)
- **Note**: Ensure `owner` query selects `s.task_id` (`SELECT s.task_id, t.assigned_to ...`)
- **Insertion Point**: Immediately before line 7151 (`return json({ ok: true });`)
- **Topic**: `'tasks'`
- **Event**: `'subtask:deleted'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'tasks', 'subtask:deleted', {
      id: sid,
      task_id: owner.task_id,
    }, { actorId: me.id });
```

#### 1.8 Additional Task Supporting Endpoints
- `POST /api/task-projects` (line 6537): `broadcastAppEvent(env, 'tasks', 'task_project:created', { id: projectId, name })`
- `PUT /api/task-projects/:id` (line 6623): `broadcastAppEvent(env, 'tasks', 'task_project:updated', { id: projectId })`
- `DELETE /api/task-projects/:id` (line 6648): `broadcastAppEvent(env, 'tasks', 'task_project:deleted', { id: projectId })`
- `PUT /api/task-projects/:id/members` (line 6676): `broadcastAppEvent(env, 'tasks', 'task_project:members_updated', { id: projectId, members })`
- `POST /api/task-groups` (line 6732): `broadcastAppEvent(env, 'tasks', 'task_group:created', { id: r.meta.last_row_id, project_id: projectId, name })`
- `PUT /api/task-groups/:id` (line 6751): `broadcastAppEvent(env, 'tasks', 'task_group:updated', { id: groupId, name, is_archived: b.is_archived ?? 0 })`
- `DELETE /api/task-groups/:id` (line 6755): `broadcastAppEvent(env, 'tasks', 'task_group:deleted', { id: groupId })`
- `POST /api/tasks/:id/followers` (line 7264): `broadcastAppEvent(env, 'tasks', 'task:follower_added', { task_id: tid, user_id: uid2 })`
- `DELETE /api/tasks/:id/followers/:id` (line 7274): `broadcastAppEvent(env, 'tasks', 'task:follower_removed', { task_id: tid, user_id: followerId })`

---

### Domain 2: Task Comments & Mentions

#### 2.1 `POST /api/tasks/:id/comments` (Comment Creation & User Mentions)
- **Location**: `server.js`, lines 7155–7200
- **DB Write**: Line 7168 (`INSERT INTO task_comments ...`)
- **Mention Notifications**: Lines 7177–7180 (`INSERT INTO task_mention_notifications ...`)
- **Insertion Point**: Immediately before line 7198 (`return json({ ok: true, id: commentId });`)
- **Topic**: `'tasks'` (for comment thread sync) & `'notifications'` (for mentioned user badge)
- **Events**: `'comment:created'` and `'notification:mention'`
- **Injection Snippet**:
```javascript
    // 1. Broadcast comment to task watchers / active task view
    await broadcastAppEvent(env, 'tasks', 'comment:created', {
      id: commentId,
      task_id: tid,
      user_id: me.id,
      full_name: me.full_name,
      avatar_color: me.avatar_color,
      avatar_initials: me.avatar_initials,
      content: b.content,
      mentions,
      created_at: new Date().toISOString(),
    }, { actorId: me.id });

    // 2. Broadcast live notification event targeted to mentioned users
    if (mentions.length) {
      const targetMentionIds = mentions.map(m => Number(m.user_id)).filter(uid => uid && uid !== Number(me.id));
      if (targetMentionIds.length) {
        await broadcastAppEvent(env, 'notifications', 'notification:mention', {
          id: commentId,
          type: 'task_mention',
          task_id: tid,
          task_title: task?.title || '',
          mentioned_by: me.id,
          mentioned_by_name: me.full_name || '',
          snippet: b.content.slice(0, 120),
        }, { actorId: me.id, targetUserIds: targetMentionIds });
      }
    }
```

---

### Domain 3: Notifications & Live Badges

#### 3.1 `PATCH /api/notifications/task-mentions/:id/read` (Mark Single Notification Read)
- **Location**: `server.js`, lines 4549–4554
- **DB Write**: Line 4551 (`UPDATE task_mention_notifications SET is_read=1 WHERE id=? AND user_id=?`)
- **Insertion Point**: Immediately before line 4553 (`return json({ ok: true });`)
- **Topic**: `'notifications'`
- **Event**: `'notification:read'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'notifications', 'notification:read', {
      id: parseInt(mentionReadMatch[1]),
      user_id: me.id,
    }, { actorId: me.id, targetUserIds: [me.id] });
```

---

### Domain 4: Attendance & Overtime

#### 4.1 `POST /api/attendance/register` (Daily Attendance Registration)
- **Location**: `server.js`, lines 5763–5789
- **DB Write**: Lines 5780–5787 (`UPDATE/INSERT INTO attendance ...`)
- **Insertion Point**: Immediately before line 5788 (`return json({ ok: true });`)
- **Topic**: `'attendance'`
- **Event**: `'attendance:registered'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', 'attendance:registered', {
      user_id: me.id,
      user_name: me.full_name,
      employee_code: me.employee_code,
      department: me.department,
      date: today,
      work_type: workType,
      shift,
      status: 'registered',
    }, { actorId: me.id });
```

#### 4.2 `POST /api/attendance/checkin` (Check-in Mutation)
- **Location**: `server.js`, lines 5791–5839
- **DB Write**: Lines 5836–5837 (`UPDATE attendance SET checkin_time=?, ... WHERE id=?`)
- **Insertion Point**: Immediately before line 5838 (`return json({ ok: true, status, time: timeStr, ... });`)
- **Topic**: `'attendance'`
- **Event**: `'attendance:checkin'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', 'attendance:checkin', {
      id: existing.id,
      user_id: me.id,
      user_name: me.full_name,
      employee_code: me.employee_code,
      department: me.department,
      date: today,
      checkin_time: timeStr,
      status,
      late_minutes: lateMinutes,
      geofence_status: geofenceStatus,
      requires_review: requiresReview,
    }, { actorId: me.id });
```

#### 4.3 `POST /api/attendance/checkout` (Check-out Mutation)
- **Location**: `server.js`, lines 5841–5906
- **DB Write**: Lines 5903–5904 (`UPDATE attendance SET checkout_time=?, ... WHERE id=?`)
- **Insertion Point**: Immediately before line 5905 (`return json({ ok: true, attendance_id: record.id, ... });`)
- **Topic**: `'attendance'`
- **Event**: `'attendance:checkout'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', 'attendance:checkout', {
      id: record.id,
      user_id: me.id,
      user_name: me.full_name,
      employee_code: me.employee_code,
      department: me.department,
      date: today,
      checkout_time: timeStr,
      work_hours: workHours,
      early_minutes: earlyMinutes,
      status: record.status,
    }, { actorId: me.id });
```

#### 4.4 `POST /api/attendance/:id/location-review` (Location Review Approval/Rejection)
- **Location**: `server.js`, lines 5988–6003
- **DB Write**: Lines 6000–6001 (`UPDATE attendance SET checkin_review_status=?, ... WHERE id=?`)
- **Insertion Point**: Immediately before line 6002 (`return json({ ok: true, attendance_id: aid, status: decision });`)
- **Topic**: `'attendance'`
- **Event**: `'attendance:location_reviewed'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', 'attendance:location_reviewed', {
      id: aid,
      user_id: row.user_id,
      status: decision,
      reviewed_by: me.id,
      reviewed_by_name: me.full_name || '',
      note,
    }, { actorId: me.id });
```

#### 4.5 `PUT /api/attendance/:id` (Manager Edit Attendance Record)
- **Location**: `server.js`, lines 6188–6232
- **DB Write**: Lines 6200–6201 (absent/leave) or lines 6228–6230 (present/late)
- **Insertion Point**: Immediately before lines 6202 / 6231 (`return json({ ok: true, ... });`)
- **Topic**: `'attendance'`
- **Event**: `'attendance:updated'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', 'attendance:updated', {
      id: aid,
      user_id: record.user_id,
      date: record.date,
      status,
      checkin_time: checkinTime || null,
      checkout_time: checkoutTime || null,
      work_hours: metrics?.workHours || 0,
      late_minutes: metrics?.lateMinutes || 0,
      early_minutes: metrics?.earlyMinutes || 0,
    }, { actorId: me.id });
```

#### 4.6 `DELETE /api/attendance/:id` (Delete Attendance Record)
- **Location**: `server.js`, lines 6234–6246
- **DB Write**: Lines 6241–6244 (`DELETE FROM attendance WHERE id=?`)
- **Insertion Point**: Immediately before line 6245 (`return json({ ok: true, deleted_id: aid });`)
- **Topic**: `'attendance'`
- **Event**: `'attendance:deleted'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', 'attendance:deleted', {
      id: aid,
      user_id: record.user_id,
      date: record.date,
    }, { actorId: me.id });
```

#### 4.7 `POST /api/attendance/batch` (Batch Add Attendance)
- **Location**: `server.js`, lines 6335–6399
- **DB Write**: Lines 6394–6397
- **Insertion Point**: Immediately before line 6398 (`return json({ ok: true, ...summary });`)
- **Topic**: `'attendance'`
- **Event**: `'attendance:batch_imported'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', 'attendance:batch_imported', {
      user_id: employeeId,
      created_dates: createdDates,
      count: createdDates.length,
    }, { actorId: me.id });
```

#### 4.8 `POST /api/overtime-requests` (Overtime Request Submission)
- **Location**: `server.js`, lines 6020–6041
- **DB Write**: Lines 6034–6035 (`INSERT INTO overtime_requests ...`)
- **Insertion Point**: Immediately before line 6036 (`return json({ ok: true, id: r.meta.last_row_id, ... });`)
- **Topic**: `'attendance'`
- **Event**: `'overtime:requested'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', 'overtime:requested', {
      id: r.meta.last_row_id,
      attendance_id: record.id,
      user_id: me.id,
      user_name: me.full_name,
      employee_code: me.employee_code,
      department: me.department,
      work_date: record.date,
      requested_minutes: requestedMinutes,
      reason,
      status: 'pending',
    }, { actorId: me.id });
```

#### 4.9 `POST /api/overtime-requests/:id/(approve|reject)` (Overtime Decision)
- **Location**: `server.js`, lines 6043–6064
- **DB Write**: Lines 6059–6060 (`UPDATE overtime_requests SET ... WHERE id=?`)
- **Insertion Point**: Immediately before line 6063 (`return json({ ok: true, status: nextStatus, ... });`)
- **Topic**: `'attendance'`
- **Event**: action === 'approve' ? `'overtime:approved'` : `'overtime:rejected'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'attendance', action === 'approve' ? 'overtime:approved' : 'overtime:rejected', {
      id,
      user_id: requestRow.user_id,
      status: nextStatus,
      approved_minutes: approvedMinutes,
      reviewer_id: me.id,
      reviewer_name: me.full_name || '',
      review_note: note || null,
      overtime: ot,
    }, { actorId: me.id });
```

#### 4.10 `POST /api/overtime-forms` & Decisions
- `POST /api/overtime-forms` (line 6104):
  `broadcastAppEvent(env, 'attendance', 'overtime_form:created', { id: formId, user_id: me.id, period_month: periodMonth, status }, { actorId: me.id })`
- `PUT /api/overtime-forms/:id` (line 6123):
  `broadcastAppEvent(env, 'attendance', 'overtime_form:updated', { id: formId, user_id: me.id, period_month: periodMonth }, { actorId: me.id })`
- `POST /api/overtime-forms/:id/submit` (line 6133):
  `broadcastAppEvent(env, 'attendance', 'overtime_form:submitted', { id: formId, user_id: me.id, status: 'pending' }, { actorId: me.id })`
- `POST /api/overtime-forms/:id/decision` (line 6163):
  `broadcastAppEvent(env, 'attendance', 'overtime_form:decided', { id: formId, user_id: form.user_id, status: nextStatus, approved_minutes: approvedTotal }, { actorId: me.id })`

---

### Domain 5: Leave Requests & Approvals

#### 5.1 `POST /api/leave` (Leave Request Submission)
- **Location**: `server.js`, lines 7695–7747
- **DB Write**: Lines 7733–7735 (`INSERT INTO leave_requests ...`)
- **Insertion Point**: Immediately before line 7742 (`return json({ ok: true, id: r.meta.last_row_id });`)
- **Topic**: `'leave'`
- **Event**: `'leave:created'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'leave', 'leave:created', {
      id: r.meta.last_row_id,
      user_id: me.id,
      employee_name: me.full_name,
      employee_code: me.employee_code,
      department: me.department,
      type: typeCode,
      type_name: leaveType.name,
      start_date: b.start_date,
      end_date: b.end_date,
      leave_session: session,
      total_days: leaveDays,
      status: 'pending',
      current_approver: currentApprover,
      handover_user_id: handoverUser?.id || null,
      handover_user_name: handoverUser?.full_name || null,
      reason,
    }, { actorId: me.id });
```

#### 5.2 `PUT /api/leave/:id` (Approval, Rejection, and Edit)
- **Location**: `server.js`, lines 7773–7809

##### 5.2.1 Rejection Branch (`b.status === 'rejected'`)
- **DB Write**: Lines 7782, 7785–7788, 7790
- **Insertion Point**: Immediately before line 7791 (`return json({ ok: true });`)
- **Topic**: `'leave'`
- **Event**: `'leave:rejected'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'leave', 'leave:rejected', {
      id,
      employee_id: request.employee_id,
      status: 'rejected',
      actor_id: me.id,
      actor_name: me.full_name || '',
      note: String(b.note || ''),
    }, { actorId: me.id });
```

##### 5.2.2 Approval Branch (`b.status === 'approved'`)
- **DB Write**: Lines 7799–7800
- **Insertion Point**: Immediately before line 7801 (`return json({ ok: true, final: finalApproved });`)
- **Topic**: `'leave'`
- **Event**: finalApproved ? `'leave:approved'` : `'leave:forwarded'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'leave', finalApproved ? 'leave:approved' : 'leave:forwarded', {
      id,
      employee_id: request.employee_id,
      status: finalApproved ? 'approved' : 'pending',
      final: finalApproved,
      approval_level: nextLevel,
      current_approver: nextApprover,
      actor_id: me.id,
      actor_name: me.full_name || '',
      note: String(b.note || ''),
    }, { actorId: me.id });
```

##### 5.2.3 Employee Edit Reason (`b.reason !== undefined`)
- **DB Write**: Line 7807
- **Insertion Point**: Immediately before line 7808 (`return json({ ok: true });`)
- **Topic**: `'leave'`
- **Event**: `'leave:updated'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'leave', 'leave:updated', {
      id,
      employee_id: request.employee_id,
      reason: b.reason,
    }, { actorId: me.id });
```

#### 5.3 `DELETE /api/leave/:id` (Delete/Cancel Leave Request)
- **Location**: `server.js`, lines 7810–7824
- **DB Write**: Lines 7816–7821 (`DELETE FROM leave_requests WHERE id=?`)
- **Insertion Point**: Immediately before line 7822 (`return json({ ok: true });`)
- **Topic**: `'leave'`
- **Event**: `'leave:deleted'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'leave', 'leave:deleted', {
      id,
      employee_id: request.employee_id,
    }, { actorId: me.id });
```

#### 5.4 `POST /api/leave/balances` (Adjust Leave Balance)
- **Location**: `server.js`, lines 7623–7638
- **DB Write**: Lines 7630–7636
- **Insertion Point**: Immediately before line 7637 (`return json({ ok: true });`)
- **Topic**: `'leave'`
- **Event**: `'leave_balance:updated'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'leave', 'leave_balance:updated', {
      user_id: userId,
      leave_type_code: typeCode,
      balance_year: year,
      delta_days: delta,
      note,
      updated_by: me.id,
      updated_by_name: me.full_name || '',
    }, { actorId: me.id, targetUserIds: [userId] });
```

---

### Domain 6: Payroll & Invoices

#### 6.1 `POST /api/invoices` (Create Payslip Invoice)
- **Location**: `server.js`, lines 7299–7324
- **DB Write**: Lines 7319–7322 (`INSERT INTO invoices ...`)
- **Insertion Point**: Immediately before line 7323 (`return json({ ok: true, id: r.meta.last_row_id, invoice_number: invNum });`)
- **Topic**: `'invoices'`
- **Event**: `'invoice:created'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'invoices', 'invoice:created', {
      id: r.meta.last_row_id,
      invoice_number: invNum,
      user_id: b.user_id,
      month: b.month,
      year: b.year,
      net_salary: net,
      status: b.status || 'draft',
    }, { actorId: me.id, targetUserIds: [b.user_id] });
```

#### 6.2 `POST /api/invoices/:id/confirm` (Employee Confirms Payslip)
- **Location**: `server.js`, lines 7327–7344
- **DB Write**: Lines 7335–7342 (`UPDATE invoices SET status='employee_confirmed', ...`)
- **Insertion Point**: Immediately before line 7343 (`return json({ ok: true });`)
- **Topic**: `'invoices'`
- **Event**: `'invoice:confirmed'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'invoices', 'invoice:confirmed', {
      id: iid,
      user_id: inv.user_id,
      status: 'employee_confirmed',
    }, { actorId: me.id });
```

#### 6.3 `POST /api/invoices/:id/review-request` (Employee Requests Review)
- **Location**: `server.js`, lines 7347–7374
- **DB Write**: Lines 7364–7372 (`UPDATE invoices SET status='review_requested', ...`)
- **Insertion Point**: Immediately before line 7373 (`return json({ ok: true });`)
- **Topic**: `'invoices'`
- **Event**: `'invoice:review_requested'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'invoices', 'invoice:review_requested', {
      id: iid,
      user_id: inv.user_id,
      user_name: me.full_name,
      category,
      message,
      status: 'review_requested',
    }, { actorId: me.id });
```

#### 6.4 `POST /api/invoices/:id/resolve-review` (Manager Resolves Payslip Review)
- **Location**: `server.js`, lines 7376–7402
- **DB Write**: Lines 7391–7400 (`UPDATE invoices SET status=?, ...`)
- **Insertion Point**: Immediately before line 7401 (`return json({ ok: true });`)
- **Topic**: `'invoices'`
- **Event**: `'invoice:review_resolved'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'invoices', 'invoice:review_resolved', {
      id: iid,
      user_id: inv.user_id,
      status: nextStatus,
      note,
      handled_by: me.id,
      handled_by_name: me.full_name || '',
    }, { actorId: me.id, targetUserIds: [inv.user_id] });
```

#### 6.5 `PUT /api/invoices/:id` (Update Invoice)
- **Location**: `server.js`, lines 7424–7451
- **DB Write**: Lines 7443–7449 (`UPDATE invoices SET ...`)
- **Insertion Point**: Immediately before line 7450 (`return json({ ok: true });`)
- **Topic**: `'invoices'`
- **Event**: `'invoice:updated'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'invoices', 'invoice:updated', {
      id: iid,
      user_id: existingInv.user_id,
      status: nextStatus,
      net_salary: net,
    }, { actorId: me.id, targetUserIds: [existingInv.user_id] });
```

#### 6.6 `POST /api/payroll/load` (Sync Attendance & Load Monthly Payroll)
- **Location**: `server.js`, lines 7995–8064
- **DB Write**: Lines 8031–8047
- **Insertion Point**: Immediately before line 8048 (`return json({ ok: true, loaded: true, ... });`)
- **Topic**: `'payroll'`
- **Event**: `'payroll:loaded'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'payroll', 'payroll:loaded', {
      month,
      total: users.length,
      created,
      updated,
      complete: ready,
      missing: missingSalary,
      estimated_total: estimatedTotal,
    }, { actorId: me.id });
```

#### 6.7 `POST /api/payroll/batch` (Batch Payroll Sync)
- **Location**: `server.js`, lines 8066–8107
- **DB Write**: Lines 8090–8105
- **Insertion Point**: Immediately before line 8106 (`return json({ ok: true, status: 'draft', ... });`)
- **Topic**: `'payroll'`
- **Event**: `'payroll:batch_synced'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'payroll', 'payroll:batch_synced', {
      month,
      total: users.length,
      created,
      updated,
      complete: ready,
      missing,
    }, { actorId: me.id });
```

#### 6.8 `POST /api/payroll/export-payslips` (Batch Export Payslips / Invoices)
- **Location**: `server.js`, lines 8108–8214
- **DB Write**: Lines 8157–8207
- **Insertion Point**: Immediately before line 8209 (`return json({ ok: true, month, ... });`)
- **Topics**: `'payroll'` & `'invoices'`
- **Events**: `'payroll:payslips_exported'` and `'invoices:batch_issued'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'payroll', 'payroll:payslips_exported', {
      month,
      total: rows.length,
      created,
      updated,
      skipped,
    }, { actorId: me.id });

    await broadcastAppEvent(env, 'invoices', 'invoices:batch_issued', {
      month,
      count: created + updated,
    }, { actorId: me.id });
```

#### 6.9 `POST /api/payroll` & `PUT /api/payroll/:id` & `DELETE /api/payroll/:id`
- `POST /api/payroll` (line 8226):
  `broadcastAppEvent(env, 'payroll', 'payroll:created', { id: r.meta.last_row_id, employee_id: b.employee_id, month: b.month, net_salary: net }, { actorId: me.id })`
- `PUT /api/payroll/:id` (lines 8283 / 8302):
  `broadcastAppEvent(env, 'payroll', 'payroll:updated', { id, employee_id: current.employee_id, month: current.month, net_salary: net }, { actorId: me.id })`
- `DELETE /api/payroll/:id` (line 8317):
  `broadcastAppEvent(env, 'payroll', 'payroll:deleted', { id, employee_id: current.employee_id, month: current.month }, { actorId: me.id })`
- `POST /api/payroll-adjustments/apply` (line 7983):
  `broadcastAppEvent(env, 'payroll', 'payroll:adjusted', { month, applied, skipped }, { actorId: me.id })`

---

### Domain 7: Users & Roles

#### 7.1 `POST /api/users` (Create Employee Account)
- **Location**: `server.js`, lines 4994–5052
- **DB Write**: Lines 5025–5040 (`INSERT INTO users ...`)
- **Insertion Point**: Immediately before line 5042 (`return json({ ok: true, id: newUserId, employee_code: code });`)
- **Topic**: `'users'`
- **Event**: `'user:created'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'users', 'user:created', {
      id: newUserId,
      employee_code: code,
      full_name: fullName,
      email,
      role: b.role || 'employee',
      department: dept,
      position,
      is_active: 1,
      lifecycle_status: b.lifecycle_status || (isTts ? 'Thực tập' : 'Chính thức'),
    }, { actorId: me.id });
```

#### 7.2 `PUT /api/users/:id` (Admin/Manager Update User Profile & Roles)
- **Location**: `server.js`, lines 5281–5374
- **DB Write**: Lines 5339–5366 (`UPDATE users SET ...`)
- **Insertion Point**: Immediately before line 5367 (`return json({ ok: true, change_set_id: changeSetId });`)
- **Topic**: `'users'`
- **Event**: `'user:updated'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'users', 'user:updated', {
      id: uid,
      full_name: b.full_name,
      email: b.email,
      role: b.role,
      department: normalizeDeptName(b.department || ''),
      position: b.position,
      is_active: b.is_active,
      changed_fields: legacyChanges.map(([f]) => f),
    }, { actorId: me.id });
```

#### 7.3 `PATCH /api/users/:id/profile` (Employee Profile Field Updates)
- **Location**: `server.js`, lines 4620–4736
- **DB Write**: Line 4734
- **Insertion Point**: Immediately before line 4735 (`return json({ ok: true, change_set_id: changeSetId, ... });`)
- **Topic**: `'users'`
- **Event**: `'user:profile_updated'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'users', 'user:profile_updated', {
      id: userId,
      changes,
      changed_fields: actualChanges.map(([field]) => field),
    }, { actorId: me.id });
```

#### 7.4 `PUT /api/users/:id/lifecycle` (Employee Lifecycle Change)
- **Location**: `server.js`, lines 5385–5424
- **DB Write**: Lines 5408–5422 (`UPDATE users SET lifecycle_status=? ...`)
- **Insertion Point**: Immediately before line 5423 (`return json({ ok: true });`)
- **Topic**: `'users'`
- **Event**: `'user:lifecycle_changed'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'users', 'user:lifecycle_changed', {
      id: luid,
      from_status: fromStatus,
      to_status: newStatus,
      reason,
      changed_by: me.id,
      changed_by_name: me.full_name || '',
    }, { actorId: me.id });
```

#### 7.5 `DELETE /api/users/:id` (Hard Delete User Account)
- **Location**: `server.js`, lines 4738–4760
- **DB Write**: Lines 4747–4755 (`DELETE FROM users WHERE id=?`)
- **Insertion Point**: Immediately before line 4756 (`return json({ ok: true, ... });`)
- **Topic**: `'users'`
- **Event**: `'user:deleted'`
- **Injection Snippet**:
```javascript
    await broadcastAppEvent(env, 'users', 'user:deleted', {
      id: userId,
      employee_code: target.employee_code,
      full_name: target.full_name,
    }, { actorId: me.id });
```

---

## 4. Master Feature Domain Broadcast Matrix

| # | Endpoint | Method | `server.js` Lines | Topic | Event Name | Target Filter |
|---|----------|--------|-------------------|-------|------------|---------------|
| 1 | `/api/tasks` | `POST` | 6941–6979 | `tasks` | `task:created` | Public / Topic |
| 2 | `/api/tasks/:id` | `PUT` | 7016–7057 | `tasks` | `task:updated` | Public / Topic |
| 3 | `/api/tasks/:id` | `DELETE` | 7058–7074 | `tasks` | `task:deleted` | Public / Topic |
| 4 | `/api/tasks/reorder` | `POST` | 6903–6939 | `tasks` | `task:reordered` | Public / Topic |
| 5 | `/api/tasks/:id/subtasks` | `POST` | 7076–7108 | `tasks` | `subtask:created` | Public / Topic |
| 6 | `/api/subtasks/:id` | `PUT` | 7110–7140 | `tasks` | `subtask:updated` | Public / Topic |
| 7 | `/api/subtasks/:id` | `DELETE` | 7141–7153 | `tasks` | `subtask:deleted` | Public / Topic |
| 8 | `/api/tasks/:id/comments` | `POST` | 7155–7200 | `tasks` + `notifications` | `comment:created` + `notification:mention` | Topic + `targetUserIds` |
| 9 | `/api/notifications/task-mentions/:id/read` | `PATCH` | 4549–4554 | `notifications` | `notification:read` | `[me.id]` |
| 10 | `/api/attendance/register` | `POST` | 5763–5789 | `attendance` | `attendance:registered` | Public / Topic |
| 11 | `/api/attendance/checkin` | `POST` | 5791–5839 | `attendance` | `attendance:checkin` | Public / Topic |
| 12 | `/api/attendance/checkout` | `POST` | 5841–5906 | `attendance` | `attendance:checkout` | Public / Topic |
| 13 | `/api/attendance/:id/location-review` | `POST` | 5988–6003 | `attendance` | `attendance:location_reviewed` | Public / Topic |
| 14 | `/api/attendance/:id` | `PUT` | 6188–6232 | `attendance` | `attendance:updated` | Public / Topic |
| 15 | `/api/attendance/:id` | `DELETE` | 6234–6246 | `attendance` | `attendance:deleted` | Public / Topic |
| 16 | `/api/attendance/batch` | `POST` | 6335–6399 | `attendance` | `attendance:batch_imported` | Public / Topic |
| 17 | `/api/overtime-requests` | `POST` | 6020–6041 | `attendance` | `overtime:requested` | Public / Topic |
| 18 | `/api/overtime-requests/:id/approve` | `POST` | 6043–6064 | `attendance` | `overtime:approved` | Public / Topic |
| 19 | `/api/overtime-requests/:id/reject` | `POST` | 6043–6064 | `attendance` | `overtime:rejected` | Public / Topic |
| 20 | `/api/overtime-forms` | `POST` | 6088–6105 | `attendance` | `overtime_form:created` | Public / Topic |
| 21 | `/api/overtime-forms/:id` | `PUT` | 6108–6124 | `attendance` | `overtime_form:updated` | Public / Topic |
| 22 | `/api/overtime-forms/:id/submit` | `POST` | 6127–6134 | `attendance` | `overtime_form:submitted` | Public / Topic |
| 23 | `/api/overtime-forms/:id/decision` | `POST` | 6137–6164 | `attendance` | `overtime_form:decided` | Public / Topic |
| 24 | `/api/leave` | `POST` | 7695–7747 | `leave` | `leave:created` | Public / Topic |
| 25 | `/api/leave/:id` (reject) | `PUT` | 7780–7792 | `leave` | `leave:rejected` | Public / Topic |
| 26 | `/api/leave/:id` (approve) | `PUT` | 7793–7802 | `leave` | `leave:approved` / `leave:forwarded` | Public / Topic |
| 27 | `/api/leave/:id` (edit) | `PUT` | 7803–7808 | `leave` | `leave:updated` | Public / Topic |
| 28 | `/api/leave/:id` | `DELETE` | 7810–7824 | `leave` | `leave:deleted` | Public / Topic |
| 29 | `/api/leave/balances` | `POST` | 7623–7638 | `leave` | `leave_balance:updated` | Topic + `[userId]` |
| 30 | `/api/invoices` | `POST` | 7299–7324 | `invoices` | `invoice:created` | Topic + `[user_id]` |
| 31 | `/api/invoices/:id/confirm` | `POST` | 7327–7344 | `invoices` | `invoice:confirmed` | Public / Topic |
| 32 | `/api/invoices/:id/review-request` | `POST` | 7347–7374 | `invoices` | `invoice:review_requested` | Public / Topic |
| 33 | `/api/invoices/:id/resolve-review` | `POST` | 7376–7402 | `invoices` | `invoice:review_resolved` | Topic + `[user_id]` |
| 34 | `/api/invoices/:id` | `PUT` | 7424–7451 | `invoices` | `invoice:updated` | Topic + `[user_id]` |
| 35 | `/api/payroll/load` | `POST` | 7995–8064 | `payroll` | `payroll:loaded` | Public / Topic |
| 36 | `/api/payroll/batch` | `POST` | 8066–8107 | `payroll` | `payroll:batch_synced` | Public / Topic |
| 37 | `/api/payroll/export-payslips` | `POST` | 8108–8214 | `payroll` + `invoices` | `payroll:payslips_exported` + `invoices:batch_issued` | Public / Topic |
| 38 | `/api/payroll` | `POST` | 8215–8241 | `payroll` | `payroll:created` | Public / Topic |
| 39 | `/api/payroll/:id` | `PUT` | 8242–8303 | `payroll` | `payroll:updated` | Public / Topic |
| 40 | `/api/payroll/:id` | `DELETE` | 8304–8319 | `payroll` | `payroll:deleted` | Public / Topic |
| 41 | `/api/payroll-adjustments/apply` | `POST` | 7919–7984 | `payroll` | `payroll:adjusted` | Public / Topic |
| 42 | `/api/users` | `POST` | 4994–5052 | `users` | `user:created` | Public / Topic |
| 43 | `/api/users/:id` | `PUT` | 5281–5374 | `users` | `user:updated` | Public / Topic |
| 44 | `/api/users/:id/profile` | `PATCH` | 4620–4736 | `users` | `user:profile_updated` | Public / Topic |
| 45 | `/api/users/:id/lifecycle` | `PUT` | 5385–5424 | `users` | `user:lifecycle_changed` | Public / Topic |
| 46 | `/api/users/:id` | `DELETE` | 4738–4760 | `users` | `user:deleted` | Public / Topic |

---

## 5. Verification Plan

1. **Syntax & AST Validation**:
   - Run `node --check server.js` to ensure zero syntax errors after code insertions.
2. **Local Regression Test Suite**:
   - Run `npm test` or the test suite to verify no existing tests break.
3. **AppSyncHub Broadcast Verification**:
   - Invoke mutation endpoints using curl or test client, verify AppSyncHub DO receives event envelope with matching `topic`, `event`, and `payload`.
