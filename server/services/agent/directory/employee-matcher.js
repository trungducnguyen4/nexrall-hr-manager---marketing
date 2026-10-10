/**
 * Employee Matcher & Vietnamese NLP Query Parser
 * Resolves fuzzy queries, given names, accents, and natural language intents
 */

/**
 * Vietnamese Accent Stripping Helper
 */
export function stripVietnameseAccents(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/**
 * Levenshtein distance for string similarity calculation
 */
export function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Extract target employee name/code from natural language lookup queries
 */
export function extractEmployeeLookupTarget(query) {
  const q = String(query || '').trim();
  if (!q) return null;

  // 1. "[Tên/Mã] là ai", "[Tên/Mã] là ai vậy/thế", "ai là [Tên/Mã]"
  let m = q.match(/^(.+?)\s+(?:là ai|là người thế nào|là ai vậy|là ai thế)(?:\s*\?)?$/iu);
  if (m) {
    const raw = m[1].replace(/^(?:cho tôi biết|bạn có biết|xem giúp|cho hỏi|hỏi|cho biết)\s+/iu, '').trim();
    if (raw.length >= 2) return raw;
  }

  m = q.match(/^(?:ai là|ai thế)\s+([a-zA-ZÀ-ỹ0-9_\s]+)(?:\s*\?)?$/iu);
  if (m) {
    const raw = m[1].trim();
    if (raw.length >= 2 && !/^(?:người|nhân sự|nhân viên|ai|ai đó)\b/i.test(raw) && !/(?:nghỉ|muộn|trễ|làm việc|hôm nay|tháng)/i.test(raw)) {
      return raw;
    }
  }

  // 2. "thông tin / hồ sơ / profile / sđt / số điện thoại / email / liên hệ / chức vụ của [Tên/Mã]"
  m = q.match(/(?:thông tin|hồ sơ|profile|sđt|số điện thoại|email|liên hệ|chức danh|chức vụ|ở phòng nào|lý lịch)\s+(?:về|của|nhân sự|nhân viên)?\s+([a-zA-ZÀ-ỹ0-9_\s]+)(?:\s*\?)?$/iu);
  if (m) {
    const raw = m[1].trim();
    if (!/^(?:công ty|hệ thống|chính sách|nội quy|quy định|phòng ban|bảo mật|lương|bảng lương|thực nhận)$/iu.test(raw)) {
      return raw;
    }
  }

  // 3. "tìm / tra cứu / hỏi về (nhân viên / nhân sự / đồng nghiệp) [Tên/Mã]"
  m = q.match(/(?:tìm|tra cứu|hỏi về|xem hồ sơ)\s+(?:nhân viên|nhân sự|đồng nghiệp)?\s*([a-zA-ZÀ-ỹ0-9_\s]+)(?:\s*\?)?$/iu);
  if (m) {
    const raw = m[1].trim();
    if (!/^(?:công ty|hệ thống|chính sách|nội quy|quy định|phòng ban|bảo mật|lương|phép)$/iu.test(raw)) {
      return raw;
    }
  }

  return null;
}

/**
 * Check if the target is inquiring about oneself
 */
export function isSelfLookup(target, me) {
  if (!target) return true;
  const lower = stripVietnameseAccents(target);
  if (/^(?:tôi|toi|mình|minh|bản thân|ban than|em|anh|chị|chi)$/i.test(lower)) return true;
  if (me?.employee_code && lower === stripVietnameseAccents(me.employee_code)) return true;
  if (me?.full_name && lower === stripVietnameseAccents(me.full_name)) return true;
  return false;
}

/**
 * Extract multi-dimensional HR Lookup Intent from natural language query
 */
export function extractEmployeeLookupIntent(query, me) {
  const q = String(query || '').trim();
  if (!q) return null;

  // 1. Self Lookup
  if (/^(?:tôi|mình|bản thân)\s+(?:là ai|ở phòng nào|chức vụ gì)|^(?:thông tin|hồ sơ|lý lịch)\s+(?:của\s+)?(?:tôi|mình|bản thân)|^tôi là ai(?:\s*\?)?$/iu.test(q)) {
    return { type: 'self' };
  }

  // 2. Attendance Today Search
  // 2a. Đi muộn hôm nay
  if (/(?:ai|những\s+ai|danh\s+sách|hôm\s+nay\s+có\s+ai)\s+(?:đi\s+muộn|đi\s+trễ|đến\s+muộn|check[- ]?in\s+muộn)|(?:đi\s+muộn|đi\s+trễ|đến\s+muộn)\s+hôm\s+nay/iu.test(q)) {
    return { type: 'attendance_today', subType: 'late', title: 'Danh sách nhân sự đi muộn hôm nay' };
  }
  // 2b. Làm WFH hôm nay
  if (/(?:ai|những\s+ai|danh\s+sách|hôm\s+nay\s+có\s+ai)\s+(?:(?:làm\s+(?:việc\s+)?)?(?:tại\s+nhà|ở\s+nhà|wfh))(?:\s+hôm\s+nay)?|hôm\s+nay\s+(?:có\s+)?ai\s+(?:(?:làm\s+(?:việc\s+)?)?(?:tại\s+nhà|ở\s+nhà|wfh))|(?:ai|những\s+ai)\s+(?:làm\s+wfh|đang\s+wfh|làm\s+việc\s+wfh)/iu.test(q)) {
    return { type: 'attendance_today', subType: 'wfh', title: 'Danh sách nhân sự làm việc tại nhà (WFH) hôm nay' };
  }
  // 2c. Nghỉ phép hôm nay
  if (!/(?:nhiều nhất|ít nhất|thống kê|tổng quan|tổng hợp)/iu.test(q) && (/(?:ai|những\s+ai|danh\s+sách|hôm\s+nay\s+có\s+ai)\s+(?:đang\s+)?(?:nghỉ\s+phép|xin\s+nghỉ|nghỉ\s+làm)(?:\s+hôm\s+nay)?|hôm\s+nay\s+(?:có\s+)?ai\s+(?:nghỉ|nghỉ\s+phép)/iu.test(q))) {
    return { type: 'attendance_today', subType: 'on_leave', title: 'Danh sách nhân sự đang nghỉ phép hôm nay' };
  }
  // 2d. Chưa check-in hôm nay
  if (/(?:ai|những\s+ai|danh\s+sách|hôm\s+nay\s+có\s+ai)\s+(?:chưa|chưa\s+thấy)\s+(?:check[- ]?in|chấm\s+công|có\s+mặt)(?:\s+hôm\s+nay)?/iu.test(q)) {
    return { type: 'attendance_today', subType: 'not_checked_in', title: 'Danh sách nhân sự chưa check-in hôm nay' };
  }

  // 3. Contract & Lifecycle Search
  // 3a. Thử việc
  if (/(?:ai|những\s+ai|danh\s+sách\s+(?:nhân\s+viên)?)\s+(?:đang\s+)?thử\s+việc/iu.test(q)) {
    return { type: 'lifecycle', subType: 'probation', title: 'Danh sách nhân sự đang thử việc' };
  }
  // 3b. Thực tập sinh
  if (/(?:ai|những\s+ai|danh\s+sách\s+(?:nhân\s+viên)?)\s+(?:là\s+)?(?:thực\s+tập\s+sinh|tts)/iu.test(q)) {
    return { type: 'lifecycle', subType: 'intern', title: 'Danh sách nhân sự thực tập sinh (TTS)' };
  }
  // 3c. Chính thức
  if (/(?:ai|những\s+ai|danh\s+sách\s+(?:nhân\s+viên)?)\s+(?:là\s+)?chính\s+thức/iu.test(q)) {
    return { type: 'lifecycle', subType: 'official', title: 'Danh sách nhân sự chính thức' };
  }
  // 3d. Hợp đồng sắp hết hạn
  if (/(?:ai|những\s+ai|danh\s+sách)\s+(?:sắp|chuẩn\s+bị)\s+hết\s+hạn\s+hợp\s+đồng|hợp\s+đồng\s+(?:sắp|chuẩn\s+bị)\s+hết\s+hạn/iu.test(q)) {
    return { type: 'lifecycle', subType: 'expiring', title: 'Danh sách nhân sự sắp hết hạn hợp đồng lao động' };
  }

  // 4. Department Search
  let deptMatch = q.match(/(?:phòng|bộ\s+phận)\s+([a-zA-ZÀ-ỹ0-9_\s]+?)\s+(?:có\s+(?:những\s+)?ai|gồm\s+(?:những\s+)?ai|có\s+mấy\s+người|danh\s+sách|nhân\s+sự|thành\s+viên)(?:\s*\?)?$/iu)
    || q.match(/(?:danh\s+sách\s+(?:nhân\s+viên|nhân\s+sự)|những\s+ai|ai)\s+(?:ở|thuộc|làm\s+(?:ở|tại)|trong)\s+(?:phòng|bộ\s+phận)\s+([a-zA-ZÀ-ỹ0-9_\s]+)(?:\s*\?)?$/iu)
    || q.match(/(?:nhân\s+sự|thành\s+viên|danh\s+sách)\s+(?:phòng|bộ\s+phận)\s+([a-zA-ZÀ-ỹ0-9_\s]+)(?:\s*\?)?$/iu);
  if (deptMatch) {
    const rawDept = deptMatch[1].trim();
    if (rawDept.length >= 2 && !/^(?:công ty|hệ thống)$/iu.test(rawDept)) {
      return { type: 'department', departmentTarget: rawDept, title: `Danh sách nhân sự phòng ${rawDept}` };
    }
  }

  // 5. Name Group Search ("những ai tên vy", "ai tên vy", "có ai tên vy", "danh sách ai tên đức", "tìm ai tên vy")
  let nameGroupMatch = q.match(/^(?:những\s+ai|ai|có\s+ai|danh\s+sách\s+(?:nhân\s+viên|nhân\s+sự|ai)|tìm\s+(?:người|ai|nhân\s+viên|nhân\s+sự))\s+(?:tên|tên\s+là|mang\s+tên)\s+([a-zA-ZÀ-ỹ0-9_\s]+)(?:\s*\?)?$/iu)
    || q.match(/^(?:ai|những\s+ai)\s+tên\s+([a-zA-ZÀ-ỹ0-9_\s]+)(?:\s*\?)?$/iu)
    || q.match(/(?:nhân\s+viên|nhân\s+sự)\s+(?:tên|tên\s+là)\s+([a-zA-ZÀ-ỹ0-9_\s]+)(?:\s*\?)?$/iu);
  if (nameGroupMatch) {
    const targetName = nameGroupMatch[1].trim();
    if (targetName.length >= 1) {
      return { type: 'name', nameTarget: targetName, isGroup: true, title: `Danh sách nhân sự có tên "${targetName}"` };
    }
  }

  // 6. Single Person Search ("Chu Thị Hà Vy là ai", "THUYDT là ai", "hồ sơ của X")
  const singleTarget = extractEmployeeLookupTarget(q);
  if (singleTarget) {
    const isSelf = isSelfLookup(singleTarget, me);
    if (isSelf) return { type: 'self' };
    return { type: 'name', nameTarget: singleTarget, isGroup: false };
  }

  return null;
}

/**
 * Find all employees matching a group name query (e.g. "Vy" -> Chu Thị Hà Vy, Lê Lâm Khánh Vy, Nguyễn Ngọc Thủy Vy)
 */
export function findEmployeesByNameGroup(users, nameTarget) {
  if (!nameTarget || !users?.length) return [];
  const rawTarget = String(nameTarget).trim();
  const normTarget = stripVietnameseAccents(rawTarget);
  const targetTokens = normTarget.split(/\s+/).filter(Boolean);
  const targetFirstName = targetTokens[targetTokens.length - 1];

  return users.filter(u => {
    // 1. Employee code match
    if (String(u.employee_code || '').trim().toUpperCase() === rawTarget.toUpperCase()) return true;

    // 2. Unaccented full name exact match
    const uNorm = stripVietnameseAccents(u.full_name);
    if (uNorm === normTarget) return true;

    // 3. First Name (Tên chính) match (e.g. given name "vy" matches "Chu Thị Hà Vy")
    const uTokens = uNorm.split(/\s+/).filter(Boolean);
    const uFirstName = uTokens[uTokens.length - 1];
    if (uFirstName === targetFirstName) return true;

    // 4. Substring match if target has multiple words (e.g. "Khánh Vy")
    if (targetTokens.length > 1 && uNorm.includes(normTarget)) return true;

    return false;
  });
}

/**
 * Multi-tier Smart Employee Matcher
 * Resolves fuzzy queries (e.g. "Đoàn thị thủy" -> "Doãn Thị Thủy"), employee codes, exact names, unaccented names, first names
 */
export async function findEmployeeSmart(env, target) {
  if (!target || !String(target).trim()) return { found: false };
  const rawTarget = String(target).trim();
  const normTarget = stripVietnameseAccents(rawTarget);

  let users = [];
  try {
    const res = await env.DB.prepare(`
      SELECT id, employee_code, full_name, department, position, email, phone, 
             role, is_active, lifecycle_status, created_at, avatar_url, contract_type
        FROM users
    `).all();
    users = res.results || [];
  } catch (err) {
    console.error('findEmployeeSmart DB error:', err);
    return { found: false, error: err.message };
  }

  if (!users.length) return { found: false };

  // 1. Exact Employee Code match (case-insensitive)
  const byCode = users.find(u => String(u.employee_code || '').trim().toUpperCase() === rawTarget.toUpperCase());
  if (byCode) {
    return {
      found: true,
      employee: byCode,
      exactMatch: true,
      matchedVia: 'code'
    };
  }

  // 2. Exact Full Name match (accented)
  const byExactName = users.find(u => String(u.full_name || '').trim().toLowerCase() === rawTarget.toLowerCase());
  if (byExactName) {
    return {
      found: true,
      employee: byExactName,
      exactMatch: true,
      matchedVia: 'exact_name'
    };
  }

  // 3. Unaccented Full Name match (handles "Đoàn thị thủy" -> "Doãn Thị Thủy")
  const byUnaccented = users.filter(u => stripVietnameseAccents(u.full_name) === normTarget);
  if (byUnaccented.length === 1) {
    const emp = byUnaccented[0];
    const isDifferent = String(emp.full_name).trim().toLowerCase() !== rawTarget.toLowerCase();
    return {
      found: true,
      employee: emp,
      exactMatch: !isDifferent,
      matchedVia: 'unaccented',
      note: isDifferent ? `Hệ thống tìm thấy nhân sự có tên gần khớp nhất: **${emp.full_name}** (Mã: ${emp.employee_code || '—'})` : null
    };
  } else if (byUnaccented.length > 1) {
    return {
      found: true,
      multiple: true,
      candidates: byUnaccented,
      matchedVia: 'unaccented_multiple',
      note: `Tìm thấy ${byUnaccented.length} nhân sự khớp với "${rawTarget}":`
    };
  }

  // 4. First Name (Tên chính) match & fuzzy ranking
  const targetTokens = normTarget.split(/\s+/).filter(Boolean);
  const targetFirstName = targetTokens[targetTokens.length - 1];

  const candidatesWithSameFirstName = users.filter(u => {
    const uTokens = stripVietnameseAccents(u.full_name).split(/\s+/).filter(Boolean);
    const uFirstName = uTokens[uTokens.length - 1];
    return uFirstName === targetFirstName;
  });

  if (candidatesWithSameFirstName.length === 1) {
    const emp = candidatesWithSameFirstName[0];
    const isDifferent = String(emp.full_name).trim().toLowerCase() !== rawTarget.toLowerCase();
    return {
      found: true,
      employee: emp,
      exactMatch: !isDifferent,
      matchedVia: 'first_name_match',
      note: isDifferent ? `Hệ thống tìm thấy nhân sự có tên gần khớp nhất: **${emp.full_name}** (Mã: ${emp.employee_code || '—'})` : null
    };
  }

  if (candidatesWithSameFirstName.length > 1 && targetTokens.length === 1) {
    // Check if rawTarget has accents that match specifically one person's first name (e.g. "Thủy" vs "Thùy")
    const exactAccentedMatches = candidatesWithSameFirstName.filter(u => {
      const rawTokens = String(u.full_name || '').trim().split(/\s+/).filter(Boolean);
      const lastRawToken = rawTokens[rawTokens.length - 1];
      return lastRawToken && lastRawToken.toLowerCase() === rawTarget.toLowerCase();
    });

    if (exactAccentedMatches.length === 1) {
      const emp = exactAccentedMatches[0];
      return {
        found: true,
        employee: emp,
        exactMatch: true,
        matchedVia: 'exact_first_name_accented',
        note: `Hệ thống xác định nhân sự theo tên chính xác: **${emp.full_name}** (Mã: ${emp.employee_code || '—'})`
      };
    }

    return {
      found: true,
      multiple: true,
      candidates: candidatesWithSameFirstName,
      matchedVia: 'first_name_multiple',
      note: `Tìm thấy ${candidatesWithSameFirstName.length} nhân sự có tên "${rawTarget}":`
    };
  }

  if (candidatesWithSameFirstName.length > 1 && targetTokens.length > 1) {
    let bestCandidate = null;
    let minDistance = Infinity;
    for (const cand of candidatesWithSameFirstName) {
      const candNorm = stripVietnameseAccents(cand.full_name);
      const dist = levenshteinDistance(candNorm, normTarget);
      if (dist < minDistance) {
        minDistance = dist;
        bestCandidate = cand;
      }
    }
    if (bestCandidate && minDistance <= 4) {
      return {
        found: true,
        employee: bestCandidate,
        exactMatch: false,
        matchedVia: 'fuzzy_best_match',
        note: `Hệ thống tìm thấy nhân sự có tên gần khớp nhất: **${bestCandidate.full_name}** (Mã: ${bestCandidate.employee_code || '—'})`
      };
    }

    return {
      found: true,
      multiple: true,
      candidates: candidatesWithSameFirstName,
      matchedVia: 'first_name_multiple',
      note: `Tìm thấy ${candidatesWithSameFirstName.length} nhân sự có tên "${rawTarget}":`
    };
  }

  // 5. Substring Name match
  const bySubstring = users.filter(u => {
    const uNorm = stripVietnameseAccents(u.full_name);
    return uNorm.includes(normTarget) || normTarget.includes(uNorm);
  });
  if (bySubstring.length === 1) {
    const emp = bySubstring[0];
    return {
      found: true,
      employee: emp,
      exactMatch: false,
      matchedVia: 'substring',
      note: `Hệ thống tìm thấy nhân sự có tên gần khớp: **${emp.full_name}** (Mã: ${emp.employee_code || '—'})`
    };
  } else if (bySubstring.length > 1) {
    return {
      found: true,
      multiple: true,
      candidates: bySubstring.slice(0, 5),
      matchedVia: 'substring_multiple',
      note: `Tìm thấy ${bySubstring.length} nhân sự khớp với từ khóa "${rawTarget}":`
    };
  }

  // 6. Check Position match (e.g. "Trưởng phòng IT")
  const byPosition = users.filter(u => u.position && stripVietnameseAccents(u.position).includes(normTarget));
  if (byPosition.length === 1) {
    const emp = byPosition[0];
    return {
      found: true,
      employee: emp,
      exactMatch: false,
      matchedVia: 'position_match',
      note: `Hệ thống tìm thấy nhân sự giữ chức vụ **${emp.position}**: **${emp.full_name}** (Mã: ${emp.employee_code || '—'})`
    };
  } else if (byPosition.length > 1) {
    return {
      found: true,
      multiple: true,
      candidates: byPosition.slice(0, 5),
      matchedVia: 'position_multiple',
      note: `Tìm thấy ${byPosition.length} nhân sự giữ chức vụ liên quan đến "${rawTarget}":`
    };
  }

  return { found: false };
}
