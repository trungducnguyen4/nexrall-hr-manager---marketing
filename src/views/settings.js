import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
import { esc, toast, openModal, closeModal, loadingHTML, roleLabel, setAvatar } from '../utils.js';
import { isSoundEnabled, toggleSound, playChatSound, playMentionSound, playTaskSound } from '../sound.js';
import { isPushSupported, getPushPermission, getExistingPushSubscription, subscribePushNotification, unsubscribePushNotification, testPushNotification } from '../push.js';
import { icon } from '../icons.js';

let _activeSettingsTab = 'notifications';

export async function renderSettings(el, me) {
  const isAdmin = me.role === 'admin';
  
  // Available tabs
  const tabs = [
    { id: 'notifications', label: 'Thông báo & Âm thanh', icon: 'bell' },
    { id: 'security', label: 'Bảo mật & Mật khẩu', icon: 'shield' },
    { id: 'profile', label: 'Thông tin cá nhân', icon: 'user' },
  ];

  if (isAdmin) {
    tabs.push({ id: 'company', label: 'Thông tin công ty', icon: 'building2' });
    tabs.push({ id: 'work-schedule', label: 'Giờ làm & Ngày lễ', icon: 'clock3' });
  }

  // Ensure active tab exists
  if (!tabs.some(t => t.id === _activeSettingsTab)) {
    _activeSettingsTab = 'notifications';
  }

  let _existingSub = null;
  if (isPushSupported()) {
    try {
      _existingSub = await getExistingPushSubscription();
    } catch (_) {}
  }

  function renderFrame() {
    el.innerHTML = `
      <div class="settings-container">
        <div class="settings-header">
          <div class="page-title">${icon('settings', 'lg')} <span>Cài đặt hệ thống</span></div>
          <div class="page-sub">Quản lý thông báo đẩy màn hình khóa, âm thanh, bảo mật tài khoản và cấu hình doanh nghiệp</div>
        </div>

        <div class="settings-nav-tabs" role="tablist">
          ${tabs.map(tab => `
            <button type="button" class="settings-tab-btn ${tab.id === _activeSettingsTab ? 'active' : ''}" data-tab="${tab.id}" role="tab">
              ${icon(tab.icon, 'sm')}
              <span>${tab.label}</span>
            </button>
          `).join('')}
        </div>

        <div id="settings-tab-content">
          ${renderActiveTabContent()}
        </div>
      </div>
    `;

    bindFrameEvents();
  }

  function renderActiveTabContent() {
    switch (_activeSettingsTab) {
      case 'notifications':
        return renderNotificationsTab();
      case 'security':
        return renderSecurityTab();
      case 'profile':
        return renderProfileTab();
      case 'company':
        return renderCompanyTab();
      case 'work-schedule':
        return renderWorkScheduleTab();
      default:
        return renderNotificationsTab();
    }
  }

  function renderNotificationsTab() {
    const soundEnabled = isSoundEnabled();
    const pushSupported = isPushSupported();
    const pushPermission = getPushPermission();
    const isPushActive = Boolean(pushSupported && pushPermission === 'granted' && _existingSub);
    const isStandalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
    const isIos = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream);

    return `
      <!-- PWA / Web Push Notification Hero Card -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-card-title">
              ${icon('smartPhone', 'md')}
              <span>Thông báo đẩy màn hình khóa (PWA / Web Push)</span>
            </div>
            <div class="settings-card-subtitle">
              Nhận thông báo nổi trực tiếp trên màn hình khóa điện thoại, sáng màn hình và rung chuông khi có tin nhắn mới hoặc có người tag tên bạn.
            </div>
          </div>
        </div>

        <div class="sound-toggle-hero" style="background:${isPushActive ? '#f0fdf4' : (pushPermission === 'denied' ? '#fff1f2' : 'var(--surface-2, #f8fafc)')}; border-color:${isPushActive ? '#bbf7d0' : (pushPermission === 'denied' ? '#fecdd3' : 'var(--border)')};">
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:${isPushActive ? '#dcfce7' : (pushPermission === 'denied' ? '#ffe4e6' : '#f1f5f9')};color:${isPushActive ? '#16a34a' : (pushPermission === 'denied' ? '#e11d48' : 'var(--text-3)')};">
              ${isPushActive ? icon('bell', 'md') : (pushPermission === 'denied' ? icon('bellOff', 'md') : icon('smartPhone', 'md'))}
            </div>
            <div>
              <div style="font-weight:700;font-size:14.5px;color:var(--text-1);">
                Trạng thái: 
                ${isPushActive 
                  ? '<span style="color:#16a34a;">ĐÃ KÍCH HOẠT TRÊN THIẾT BỊ NÀY</span>'
                  : (pushPermission === 'denied' 
                    ? '<span style="color:#e11d48;">BỊ CHẶN TRONG TRÌNH DUYỆT</span>'
                    : '<span style="color:var(--text-3);">CHƯA KÍCH HOẠT</span>')}
              </div>
              <div style="font-size:12.5px;color:var(--text-2);margin-top:2px;">
                ${isPushActive 
                  ? 'Thiết bị sẵn sàng nhận popup thông báo và rung chuông, kể cả khi bạn đã khóa màn hình.'
                  : (pushPermission === 'denied' 
                    ? 'Bạn đã chặn quyền thông báo. Vui lòng mở Cài đặt trình duyệt để Cho phép (Allow) thông báo.'
                    : (isIos && !isStandalone 
                      ? 'Trên iPhone: Cần mở app từ icon Màn hình chính (Home Screen) để kích hoạt thông báo.' 
                      : 'Bấm nút kích hoạt bên cạnh để nhận thông báo nổi trên màn hình khóa.'))}
              </div>
            </div>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${isPushActive ? `
              <button type="button" id="btn-test-push-action" class="btn-primary" style="min-width:140px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px;">
                ${icon('send', 'xs')} <span>Gửi thử thông báo</span>
              </button>
              <button type="button" id="btn-disable-push-action" class="btn-secondary btn-sm" style="color:var(--danger);">
                Tắt trên máy này
              </button>
            ` : (pushPermission !== 'denied' ? `
              <button type="button" id="btn-enable-push-action" class="btn-primary" style="min-width:170px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px;">
                ${icon('bell', 'xs')} <span>Kích hoạt thông báo</span>
              </button>
            ` : '')}
          </div>
        </div>

        ${isIos && !isStandalone ? `
          <div style="margin-top:14px;padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:13px;color:#92400e;line-height:1.6;">
            <strong>Để app xuất hiện trong mục "Cài đặt ➔ Thông báo" của iPhone:</strong><br/>
            1. Bấm nút <strong>Chia sẻ (Share - biểu tượng ⎋ / ô vuông có mũi tên lên)</strong> ở thanh dưới Safari.<br/>
            2. Chọn <strong>"Thêm vào MH chính" (Add to Home Screen)</strong>.<br/>
            3. <strong>Mở app từ icon NetViet HR trên màn hình chính</strong> (không mở từ tab Safari).<br/>
            4. Vào lại <strong>Cài đặt</strong> ➔ Bấm <strong>"Kích hoạt thông báo"</strong> và chọn <strong>Cho phép (Allow)</strong>.<br/>
            <em>Khi đó iPhone sẽ tự động thêm "NetViet HR" vào danh sách Thông báo hệ thống!</em>
          </div>
        ` : `
          <div style="margin-top:14px;padding:12px 14px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;font-size:12.5px;color:#475569;line-height:1.5;">
            <strong>Mẹo:</strong> Sau khi bấm <strong>"Kích hoạt thông báo"</strong> và chọn <strong>Cho phép</strong>, ứng dụng sẽ được hệ điều hành lưu vào mục <em>Cài đặt ➔ Thông báo</em> để bạn tùy chỉnh biểu ngữ, âm thanh và hiển thị trên màn hình khóa.
          </div>
        `}
      </div>

      <!-- Sound & Chimes Card -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-card-title">
              ${icon('volume2', 'md')}
              <span>Âm thanh & Chuông thông báo</span>
            </div>
            <div class="settings-card-subtitle">
              Phát âm thanh thông báo tức thì khi bạn đang mở ứng dụng.
            </div>
          </div>
        </div>

        <div class="sound-toggle-hero">
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="width:42px;height:42px;border-radius:10px;display:grid;place-items:center;background:${soundEnabled ? '#fff0eb' : '#f1f5f9'};color:${soundEnabled ? 'var(--primary)' : 'var(--text-3)'};">
              ${icon(soundEnabled ? 'volume2' : 'volumeX', 'md')}
            </div>
            <div>
              <div style="font-weight:700;font-size:14.5px;color:var(--text-1);">
                Trạng thái chuông: <span style="color:${soundEnabled ? 'var(--primary)' : 'var(--text-3)'};">${soundEnabled ? 'ĐANG BẬT' : 'ĐANG TẮT'}</span>
              </div>
              <div style="font-size:12.5px;color:var(--text-2);margin-top:2px;">
                ${soundEnabled ? 'Hệ thống sẽ phát chuông khi có sự kiện mới.' : 'Hệ thống đang ở chế độ im lặng.'}
              </div>
            </div>
          </div>

          <button type="button" id="btn-toggle-sound-action" class="${soundEnabled ? 'btn-secondary' : 'btn-primary'}" style="min-width:130px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px;">
            ${soundEnabled ? `${icon('volumeX', 'xs')} <span>Tắt âm thanh</span>` : `${icon('volume2', 'xs')} <span>Bật âm thanh</span>`}
          </button>
        </div>

        <div style="margin-top:20px;">
          <div style="font-weight:700;font-size:13.5px;color:var(--text-1);margin-bottom:4px;display:flex;align-items:center;gap:6px;">
            ${icon('music', 'xs')} Nghe thử các kiểu chuông hệ thống
          </div>
          <div style="font-size:12.5px;color:var(--text-2);margin-bottom:12px;">
            Bấm vào từng mục để kiểm tra âm thanh trực tiếp trên thiết bị của bạn:
          </div>

          <div class="sound-test-grid">
            <div class="sound-test-item">
              <div>
                <div style="font-weight:600;font-size:13.5px;color:var(--text-1);display:flex;align-items:center;gap:6px;">${icon('messageSquare', 'xs')} Tin nhắn mới</div>
                <div style="font-size:12px;color:var(--text-3);margin-top:2px;">Chuông êm 2 nốt</div>
              </div>
              <button type="button" id="btn-test-chat" class="btn-secondary btn-sm" title="Phát thử" style="display:inline-flex;align-items:center;gap:4px;">
                ${icon('play', 'xs')} <span>Phát</span>
              </button>
            </div>

            <div class="sound-test-item">
              <div>
                <div style="font-weight:600;font-size:13.5px;color:var(--text-1);display:flex;align-items:center;gap:6px;">${icon('sparkles', 'xs')} Nhắc tên (Mention)</div>
                <div style="font-size:12px;color:var(--text-3);margin-top:2px;">Chuông 3 nốt cao</div>
              </div>
              <button type="button" id="btn-test-mention" class="btn-secondary btn-sm" title="Phát thử" style="display:inline-flex;align-items:center;gap:4px;">
                ${icon('play', 'xs')} <span>Phát</span>
              </button>
            </div>

            <div class="sound-test-item">
              <div>
                <div style="font-weight:600;font-size:13.5px;color:var(--text-1);display:flex;align-items:center;gap:6px;">${icon('bell', 'xs')} Tag công việc</div>
                <div style="font-size:12px;color:var(--text-3);margin-top:2px;">Chuông nhiệm vụ C-G-C</div>
              </div>
              <button type="button" id="btn-test-task" class="btn-secondary btn-sm" title="Phát thử" style="display:inline-flex;align-items:center;gap:4px;">
                ${icon('play', 'xs')} <span>Phát</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSecurityTab() {
    return `
      <div class="settings-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-card-title">
              ${icon('shield', 'md')}
              <span>Đổi mật khẩu tài khoản</span>
            </div>
            <div class="settings-card-subtitle">
              Nên sử dụng mật khẩu mạnh bao gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt để bảo vệ tài khoản.
            </div>
          </div>
        </div>

        <div class="settings-form-narrow">
          <div class="field">
            <label>Mật khẩu hiện tại</label>
            <div class="pw-wrap">
              <input type="password" id="pw-old" placeholder="Nhập mật khẩu hiện tại" autocomplete="current-password"/>
              <button type="button" id="pw-eye-old" class="pw-eye-btn" aria-label="Hiện mật khẩu">${icon('eye', 'sm')}</button>
            </div>
          </div>

          <div class="field">
            <label>Mật khẩu mới</label>
            <div class="pw-wrap">
              <input type="password" id="pw-new" placeholder="Tạo mật khẩu mới an toàn" autocomplete="new-password"/>
              <button type="button" id="pw-eye-new" class="pw-eye-btn" aria-label="Hiện mật khẩu">${icon('eye', 'sm')}</button>
            </div>
            <ul id="pw-rules" class="password-rules" style="margin-top:8px;" aria-live="polite">
              <li data-rule="length">Từ 8 đến 20 ký tự</li>
              <li data-rule="upper">Có ít nhất 1 chữ in hoa</li>
              <li data-rule="lower">Có ít nhất 1 chữ thường</li>
              <li data-rule="number">Có ít nhất 1 chữ số</li>
              <li data-rule="special">Có ít nhất 1 ký tự đặc biệt (! @ # $ %)</li>
              <li data-rule="space">Không chứa khoảng trắng</li>
            </ul>
          </div>

          <div class="field">
            <label>Xác nhận mật khẩu mới</label>
            <input type="password" id="pw-confirm" placeholder="Nhập lại mật khẩu mới"/>
          </div>

          <div class="settings-action-bar">
            <button id="btn-change-pw-save" class="btn-primary" style="min-width:160px;">
              Cập nhật mật khẩu
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderProfileTab() {
    return `
      <div class="settings-card">
        <div class="settings-profile-banner">
          <div id="settings-profile-av" class="avatar avatar-lg"></div>
          <div class="settings-profile-info">
            <h3>${esc(me.full_name)}</h3>
            <div class="settings-profile-badges">
              <span class="badge badge-primary">${esc(roleLabel(me.role))}</span>
              <span class="badge badge-secondary">${esc(me.department || 'Chưa xếp phòng')}</span>
              ${me.employee_code ? `<span class="badge badge-muted">Mã: ${esc(me.employee_code)}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="detail-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px 20px;">
          <div class="detail-item">
            <div class="detail-label">Họ và tên</div>
            <div class="detail-val" style="font-weight:600;">${esc(me.full_name)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Email đăng nhập</div>
            <div class="detail-val" style="font-size:13px;word-break:break-all;">${esc(me.email)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Mã nhân viên</div>
            <div class="detail-val">${esc(me.employee_code || '—')}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Vị trí / Chức danh</div>
            <div class="detail-val">${esc(me.position || '—')}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Phòng ban</div>
            <div class="detail-val">${esc(me.department || '—')}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Mức lương cơ bản</div>
            <div class="detail-val" style="font-weight:700;color:var(--primary);">${Number(me.salary || 0).toLocaleString('vi-VN')} ₫</div>
          </div>
        </div>

        <div class="settings-action-bar">
          <a href="#/users/${me.id}" class="btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">
            ${icon('user', 'sm')}
            <span>Xem hồ sơ chi tiết & giấy tờ</span>
          </a>
        </div>
      </div>
    `;
  }

  function renderCompanyTab() {
    return `
      <div class="settings-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-card-title">
              ${icon('building2', 'md')}
              <span>Thông tin doanh nghiệp</span>
            </div>
            <div class="settings-card-subtitle">
              Thông tin hiển thị trên phiếu lương, hợp đồng và hóa đơn xuất cho nhân viên.
            </div>
          </div>
        </div>

        <div id="company-settings-body">
          ${loadingHTML()}
        </div>
      </div>
    `;
  }

  function renderWorkScheduleTab() {
    return `
      <div class="settings-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-card-title">
              ${icon('clock3', 'md')}
              <span>Cấu hình ca làm việc tiêu chuẩn</span>
            </div>
            <div class="settings-card-subtitle">
              Quy định khung giờ chuẩn để tính thời gian đi muộn, về sớm và làm thêm giờ (OT).
            </div>
          </div>
        </div>

        <div id="work-settings-body">
          ${loadingHTML()}
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-card-title">
              ${icon('gift', 'md')}
              <span>Ngày lễ/Tết tính làm thêm giờ (Hệ số 300%)</span>
            </div>
            <div class="settings-card-subtitle">
              Các ngày làm việc trong danh sách này sẽ được hệ thống tính lương OT theo hệ số ngày lễ.
            </div>
          </div>
        </div>

        <div id="holiday-settings-body">
          ${loadingHTML()}
        </div>
      </div>
    `;
  }

  function bindFrameEvents() {
    // Tab switching
    el.querySelectorAll('.settings-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        if (tabId && tabId !== _activeSettingsTab) {
          _activeSettingsTab = tabId;
          renderFrame();
        }
      });
    });

    // Sub-tab specific bindings
    if (_activeSettingsTab === 'notifications') {
      document.getElementById('btn-toggle-sound-action')?.addEventListener('click', () => {
        const next = toggleSound();
        renderFrame();
        toast(next ? 'Đã bật âm thanh thông báo' : 'Đã tắt âm thanh thông báo', 'info');
      });

      document.getElementById('btn-test-chat')?.addEventListener('click', () => playChatSound());
      document.getElementById('btn-test-mention')?.addEventListener('click', () => playMentionSound());
      document.getElementById('btn-test-task')?.addEventListener('click', () => playTaskSound());

      // Web Push handlers
      document.getElementById('btn-enable-push-action')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-enable-push-action');
        if (btn) { btn.disabled = true; btn.textContent = 'Đang kích hoạt...'; }
        try {
          _existingSub = await subscribePushNotification();
          toast('Kích hoạt thông báo màn hình khóa thành công!', 'success');
          renderFrame();
        } catch (err) {
          toast(err.message, 'error');
          if (btn) { btn.disabled = false; btn.innerHTML = `${icon('bell', 'xs')} <span>Kích hoạt thông báo</span>`; }
        }
      });

      document.getElementById('btn-disable-push-action')?.addEventListener('click', async () => {
        if (!confirm('Bạn có chắc muốn tắt nhận thông báo màn hình khóa trên thiết bị này?')) return;
        try {
          await unsubscribePushNotification();
          _existingSub = null;
          toast('Đã tắt thông báo màn hình khóa trên thiết bị này', 'info');
          renderFrame();
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      document.getElementById('btn-test-push-action')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-test-push-action');
        if (btn) { btn.disabled = true; btn.textContent = 'Đang gửi...'; }
        try {
          await testPushNotification();
          toast('Đã gửi thông báo thử nghiệm! Kiểm tra màn hình khóa hoặc thanh thông báo của bạn nhé.', 'success', 5000);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          if (btn) { btn.disabled = false; btn.innerHTML = `${icon('send', 'xs')} <span>Gửi thử thông báo</span>`; }
        }
      });
    }

    if (_activeSettingsTab === 'security') {
      // Toggle password visibility
      document.getElementById('pw-eye-old')?.addEventListener('click', () => togglePw('pw-old', 'pw-eye-old'));
      document.getElementById('pw-eye-new')?.addEventListener('click', () => togglePw('pw-new', 'pw-eye-new'));

      function togglePw(id, eyeId) {
        const inp = document.getElementById(id);
        const eye = document.getElementById(eyeId);
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        if (eye) eye.innerHTML = inp.type === 'password' ? icon('eye', 'sm') : icon('eyeOff', 'sm');
      }

      function renderPasswordRules(value) {
        const checks = {
          length: value.length >= 8 && value.length <= 20, upper: /[A-Z]/.test(value), lower: /[a-z]/.test(value),
          number: /[0-9]/.test(value), special: /[^A-Za-z0-9\s]/.test(value), space: !/\s/.test(value),
        };
        document.querySelectorAll('#pw-rules [data-rule]').forEach(item => {
          const passed = checks[item.dataset.rule];
          item.classList.toggle('is-valid', passed);
          item.classList.toggle('is-invalid', Boolean(value) && !passed);
        });
        return Object.values(checks).every(Boolean);
      }
      document.getElementById('pw-new')?.addEventListener('input', event => renderPasswordRules(event.target.value));

      // Change password
      document.getElementById('btn-change-pw-save')?.addEventListener('click', async () => {
        const old_password = document.getElementById('pw-old')?.value;
        const new_password = document.getElementById('pw-new')?.value;
        const confirm = document.getElementById('pw-confirm')?.value;
        if (!old_password || !new_password) { toast('Điền đầy đủ thông tin', 'error'); return; }
        if (!renderPasswordRules(new_password)) { toast('Mật khẩu mới chưa đáp ứng đủ quy tắc', 'error'); return; }
        if (new_password !== confirm) { toast('Mật khẩu xác nhận không khớp', 'error'); return; }
        try {
          await api.changePassword(old_password, new_password);
          toast('Đổi mật khẩu thành công!', 'success');
          document.getElementById('pw-old').value = '';
          document.getElementById('pw-new').value = '';
          document.getElementById('pw-confirm').value = '';
        } catch(e) { toast(e.message, 'error'); }
      });
    }

    if (_activeSettingsTab === 'profile') {
      const avHost = document.getElementById('settings-profile-av');
      if (avHost) {
        setAvatar(avHost, me.full_name, me.avatar_color, me.avatar_initials, me.avatar_url);
      }
    }

    if (_activeSettingsTab === 'company' && isAdmin) {
      loadCompanySettings();
    }

    if (_activeSettingsTab === 'work-schedule' && isAdmin) {
      loadWorkScheduleSettings();
    }
  }

  async function loadCompanySettings() {
    const body = document.getElementById('company-settings-body');
    if (!body) return;
    try {
      const { settings = {} } = await api.getSettings();
      body.innerHTML = `
        <div class="settings-grid-2col">
          <div class="field">
            <label>Tên công ty / Doanh nghiệp</label>
            <input type="text" id="cs-name" value="${esc(settings.company_name || '')}" placeholder="Ví dụ: NetViet TV"/>
          </div>
          <div class="field">
            <label>Địa chỉ văn phòng</label>
            <input type="text" id="cs-addr" value="${esc(settings.company_address || '')}" placeholder="Ví dụ: Tầng 5, Tòa nhà..."/>
          </div>
          <div class="field">
            <label>Số điện thoại liên hệ</label>
            <input type="text" id="cs-phone" value="${esc(settings.company_phone || '')}" placeholder="090..."/>
          </div>
          <div class="field">
            <label>Email liên hệ chính</label>
            <input type="email" id="cs-email" value="${esc(settings.company_email || '')}" placeholder="hr@netviet.tv"/>
          </div>
        </div>

        <div class="settings-action-bar">
          <button id="save-company" class="btn-primary" style="min-width:160px;">
            Lưu thông tin công ty
          </button>
        </div>
      `;

      document.getElementById('save-company')?.addEventListener('click', async () => {
        try {
          await api.saveSettings({
            company_name: document.getElementById('cs-name').value,
            company_address: document.getElementById('cs-addr').value,
            company_phone: document.getElementById('cs-phone').value,
            company_email: document.getElementById('cs-email').value,
          });
          toast('Đã lưu thông tin công ty thành công', 'success');
        } catch(e) { toast(e.message, 'error'); }
      });
    } catch(e) {
      body.innerHTML = `<div style="color:var(--danger);font-size:13px;">${esc(e.message)}</div>`;
    }
  }

  async function loadWorkScheduleSettings() {
    const workBody = document.getElementById('work-settings-body');
    if (workBody) {
      try {
        const { settings = {} } = await api.getSettings();
        workBody.innerHTML = `
          <div class="settings-grid-2col">
            <div class="field">
              <label>Giờ vào làm tiêu chuẩn</label>
              <input type="time" id="ws-start" value="${esc(settings.work_start || '08:30')}"/>
            </div>
            <div class="field">
              <label>Giờ tan làm tiêu chuẩn</label>
              <input type="time" id="ws-end" value="${esc(settings.work_end || '17:00')}"/>
            </div>
          </div>

          <div class="field" style="margin-top:12px;">
            <label>Thời gian miễn trừ đi muộn (Phút)</label>
            <input type="number" id="ws-late" value="${esc(settings.late_threshold || '15')}" min="0" max="60" style="max-width:240px;"/>
            <div style="font-size:12px;color:var(--text-3);margin-top:4px;">Nhân viên check-in muộn trong khoảng này sẽ không bị trừ công.</div>
          </div>

          <div class="field" style="margin-top:16px;">
            <label>Ngày làm việc trong tuần</label>
            <div class="dow-pill-group">
              ${[
                { dow: 1, label: 'Thứ 2' },
                { dow: 2, label: 'Thứ 3' },
                { dow: 3, label: 'Thứ 4' },
                { dow: 4, label: 'Thứ 5' },
                { dow: 5, label: 'Thứ 6' },
                { dow: 6, label: 'Thứ 7' },
                { dow: 0, label: 'Chủ nhật' },
              ].map(d => {
                const checked = (settings.work_days || '1,2,3,4,5,6').split(',').includes(String(d.dow));
                return `
                  <label class="dow-pill">
                    <input type="checkbox" data-dow="${d.dow}" ${checked ? 'checked' : ''}/>
                    <span>${d.label}</span>
                  </label>
                `;
              }).join('')}
            </div>
          </div>

          <div class="settings-action-bar">
            <button id="save-work" class="btn-primary" style="min-width:160px;">
              Lưu cấu hình giờ làm
            </button>
          </div>
        `;

        document.getElementById('save-work')?.addEventListener('click', async () => {
          const dows = [...document.querySelectorAll('[data-dow]:checked')].map(c => c.dataset.dow);
          try {
            await api.saveSettings({
              work_start: document.getElementById('ws-start').value,
              work_end: document.getElementById('ws-end').value,
              late_threshold: document.getElementById('ws-late').value,
              work_days: dows.join(','),
            });
            toast('Đã lưu cấu hình giờ làm', 'success');
          } catch(e) { toast(e.message, 'error'); }
        });
      } catch(e) {
        workBody.innerHTML = `<div style="color:var(--danger);font-size:13px;">${esc(e.message)}</div>`;
      }
    }

    renderHolidaySettings();
  }

  async function renderHolidaySettings() {
    const el = document.getElementById('holiday-settings-body');
    if (!el) return;
    try {
      const { holidays = [] } = await api.getCompanyHolidays();
      el.innerHTML = `
        <div style="background:var(--surface-2, #f8fafc);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px;">
          <div style="font-weight:600;font-size:13.5px;color:var(--text-1);margin-bottom:10px;">+ Thêm ngày lễ mới</div>
          <div class="settings-grid-2col">
            <div class="field" style="margin-bottom:0;">
              <label>Ngày lễ (YYYY-MM-DD)</label>
              <input type="date" id="holiday-date"/>
            </div>
            <div class="field" style="margin-bottom:0;">
              <label>Tên dịp lễ / Tết</label>
              <input type="text" id="holiday-name" placeholder="Ví dụ: Tết Dương lịch, Quốc khánh..."/>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:12px;">
            <button id="holiday-add" class="btn-primary btn-sm" style="min-width:140px;">+ Thêm vào danh sách</button>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:140px;">Ngày</th>
                <th>Tên ngày lễ / Tết</th>
                <th style="width:150px;">Trạng thái</th>
                <th style="width:90px;text-align:right;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${holidays.length ? holidays.map(h => `
                <tr>
                  <td style="font-weight:600;font-variant-numeric:tabular-nums;">${esc(h.holiday_date)}</td>
                  <td>${esc(h.name)}</td>
                  <td>
                    <span class="badge ${Number(h.is_active) ? 'badge-success' : 'badge-muted'}">
                      ${Number(h.is_active) ? 'Áp dụng 300%' : 'Tạm tắt'}
                    </span>
                  </td>
                  <td style="text-align:right;">
                    <button class="btn-icon holiday-edit" data-id="${h.id}" data-date="${esc(h.holiday_date)}" data-name="${esc(h.name)}" data-active="${Number(h.is_active)}" title="Sửa">${icon('pencil', 'xs')}</button>
                    <button class="btn-icon holiday-delete" data-id="${h.id}" title="Xóa">${icon('trash2', 'xs')}</button>
                  </td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="4" style="text-align:center;color:var(--text-3);padding:24px 0;">Chưa có ngày lễ/Tết nào được cấu hình</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      `;

      document.getElementById('holiday-add')?.addEventListener('click', async () => {
        const holiday_date = document.getElementById('holiday-date').value;
        const name = document.getElementById('holiday-name').value.trim();
        if (!holiday_date || !name) { toast('Vui lòng nhập ngày và tên ngày lễ', 'error'); return; }
        try {
          await api.createCompanyHoliday({ holiday_date, name });
          toast('Đã thêm ngày lễ thành công', 'success');
          renderHolidaySettings();
        } catch (e) { toast(e.message, 'error'); }
      });

      el.querySelectorAll('.holiday-edit').forEach(btn => btn.addEventListener('click', async () => {
        const holiday_date = prompt('Ngày (YYYY-MM-DD):', btn.dataset.date);
        if (holiday_date === null) return;
        const name = prompt('Tên ngày lễ/Tết:', btn.dataset.name);
        if (name === null) return;
        try {
          await api.updateCompanyHoliday(btn.dataset.id, { holiday_date, name, is_active: Number(btn.dataset.active) === 1 });
          toast('Đã cập nhật ngày lễ', 'success');
          renderHolidaySettings();
        } catch (e) { toast(e.message, 'error'); }
      }));

      el.querySelectorAll('.holiday-delete').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Xóa ngày lễ này?')) return;
        try {
          await api.deleteCompanyHoliday(btn.dataset.id);
          toast('Đã xóa ngày lễ', 'success');
          renderHolidaySettings();
        } catch (e) { toast(e.message, 'error'); }
      }));
    } catch (e) {
      el.innerHTML = `<div style="color:var(--danger);font-size:13px;">${esc(e.message)}</div>`;
    }
  }

  el._cleanup = () => {};

  EventBus.bindView(el, 'users', () => { if (_activeSettingsTab === 'profile') renderFrame(); });
  EventBus.bindView(el, 'user:*', () => { if (_activeSettingsTab === 'profile') renderFrame(); });

  // Initial render
  renderFrame();
}
