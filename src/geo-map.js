// ════════════════════════════════════════════════
//  Shared schematic geofence renderer (SVG, no external tiles).
//
//  Used by:
//    · Office configuration page → markers: []
//    · Attendance page           → markers: today's check-in points
//
//  This is a "geofence visualization", NOT a street map: it draws a local
//  2D plane around the office origin (equirectangular approximation) with the
//  geofence circle, the office pin and the employee check-in markers.
//
//  - No OpenStreetMap / tile / zoom / attribution / network dependency.
//  - The shortest distance / inside-outside decision is ALWAYS computed by the
//    backend (Haversine). This projection only places markers in the right
//    relative direction around the office.
// ════════════════════════════════════════════════

const INSIDE_COLOR = '#3B82F6';  // blue  = within radius
const OUTSIDE_COLOR = '#EF4444'; // red   = outside radius
const OFFICE_COLOR = '#EF4444';

// ── Local plane helpers (pure, exported for tests) ──
// Office origin → meters East / North (equirectangular approximation).
export function projectToLocalPlane(officeLat, officeLng, lat, lng) {
  const cosLat = Math.max(0.0001, Math.cos((Number(officeLat) * Math.PI) / 180));
  const metersE = (Number(lng) - Number(officeLng)) * 111320 * cosLat;
  const metersN = (Number(lat) - Number(officeLat)) * 111320;
  return { metersE, metersN };
}

export function distanceFromOfficeMeters(officeLat, officeLng, lat, lng) {
  const p = projectToLocalPlane(officeLat, officeLng, lat, lng);
  return Math.hypot(p.metersE, p.metersN);
}

// Marker → visual kind: within = 'inside', without = 'outside', current user = 'me'.
export function classifyMarker(marker, currentUserId) {
  if (marker?.is_current_user) return 'me';
  if (currentUserId !== undefined && Number(marker?.employee_id) === Number(currentUserId)) return 'me';
  return marker?.inside_geofence === false ? 'outside' : 'inside';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function defaultTooltipHTML(marker) {
  const name = escapeHtml(marker.label || marker.employee_name || 'Nhân viên');
  const isInside = marker.inside_geofence !== false;
  const status = isInside
    ? '<span class="geo-tooltip-status geo-tooltip-inside">Trong phạm vi</span>'
    : '<span class="geo-tooltip-status geo-tooltip-outside">Ngoài phạm vi · Cần xem xét</span>';
  return `<div class="geo-tooltip-name">${name}</div>`
    + (marker.checkin_time ? `<div>Check-in: ${escapeHtml(marker.checkin_time)}</div>` : '')
    + (marker.distance_m != null ? `<div>Khoảng cách: ${Math.round(Number(marker.distance_m))} m</div>` : '')
    + (marker.checkin_accuracy_meters != null ? `<div>Độ chính xác GPS: ±${Math.round(Number(marker.checkin_accuracy_meters))} m</div>` : '')
    + status;
}

/**
 * Render an interactive schematic geofence view into `container`.
 *
 * @param {HTMLElement} container
 * @param {Object} options
 *   center            {latitude, longitude} office center
 *   radiusMeters      geofence radius
 *   officeName        label under the office pin
 *   markers           [{ latitude, longitude, label, kind, tooltipHTML,
 *                        employee_id, is_current_user, inside_geofence,
 *                        checkin_time, distance_m, checkin_accuracy_meters }]
 *   theme             'light' | 'dark'
 *   height            px (number)
 *   interactive       enable pan
 * @returns {{ setMarkers, setOffice, fit, destroy }}
 */
export function renderGeoMap(container, options = {}) {
  const {
    center = { latitude: 0, longitude: 0 },
    radiusMeters = 100,
    officeName = 'Văn phòng',
    markers = [],
    theme = 'light',
    height = 240,
    interactive = true,
  } = options;

  const office = { latitude: Number(center?.latitude ?? 0), longitude: Number(center?.longitude ?? 0) };
  let radius = Number(radiusMeters) || 100;
  let officeLabel = String(officeName || 'Văn phòng');
  let markerList = (markers || []).map(marker => ({ ...marker }));
  let width = Math.max(200, container.clientWidth || 300);
  let heightPx = Math.max(120, container.clientHeight || (typeof height === 'number' ? height : 240));
  let view = { scale: 10, panX: 0, panY: 0 };
  let rafId = 0;
  let destroyed = false;
  let userMoved = false;

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

  // ── DOM scaffold ───────────────────────────────
  container.classList.add('geo-map');
  container.classList.toggle('geo-map--dark', theme === 'dark');
  container.style.height = typeof height === 'number' ? `${height}px` : String(height);
  container.innerHTML = '';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'geo-map-svg');
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'geo-map-tooltip';
  tooltipEl.hidden = true;
  container.append(svg, tooltipEl);

  const screenX = metersE => width / 2 + view.panX + metersE * view.scale;
  const screenY = metersN => heightPx / 2 + view.panY - metersN * view.scale;

  // Auto-fit: geofence + farthest marker, padded, but never zoom out too far.
  function computeFitScale() {
    let maxDist = radius;
    markerList.forEach(marker => {
      if (!Number.isFinite(Number(marker.latitude)) || !Number.isFinite(Number(marker.longitude))) return;
      const d = distanceFromOfficeMeters(office.latitude, office.longitude, Number(marker.latitude), Number(marker.longitude));
      if (d > maxDist) maxDist = d;
    });
    const viewportRadius = clamp(maxDist * 1.25, radius * 1.25, 3000);
    return Math.max(1, Math.min((width - 24) / (2 * viewportRadius), (heightPx - 24) / (2 * viewportRadius)));
  }

  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${width} ${heightPx}`);

    const textColor = theme === 'dark' ? '#F1F5F9' : '#1E293B';
    const haloColor = theme === 'dark' ? 'rgba(15,23,42,.92)' : 'rgba(255,255,255,.94)';

    const bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('x', 0); bg.setAttribute('y', 0);
    bg.setAttribute('width', width); bg.setAttribute('height', heightPx);
    bg.setAttribute('rx', '8');
    bg.setAttribute('fill', theme === 'dark' ? '#14202b' : '#FFFFFF');
    svg.appendChild(bg);

    const officePoint = { x: screenX(0), y: screenY(0) };

    // Geofence circle: light translucent fill + dashed dark border.
    const circleR = Math.max(6, radius * view.scale);
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', officePoint.x); circle.setAttribute('cy', officePoint.y); circle.setAttribute('r', circleR);
    circle.setAttribute('fill', 'rgba(59,130,246,.10)');
    circle.setAttribute('stroke', '#1D4ED8');
    circle.setAttribute('stroke-width', '1.6');
    circle.setAttribute('stroke-dasharray', '6 5');
    svg.appendChild(circle);

    const radiusText = document.createElementNS(svgNS, 'text');
    radiusText.setAttribute('x', officePoint.x + circleR + 6);
    radiusText.setAttribute('y', officePoint.y + 3);
    radiusText.setAttribute('font-size', '10');
    radiusText.setAttribute('font-weight', '700');
    radiusText.setAttribute('fill', textColor);
    radiusText.setAttribute('paint-order', 'stroke');
    radiusText.setAttribute('stroke', haloColor);
    radiusText.setAttribute('stroke-width', '3');
    radiusText.textContent = `${Math.round(radius)} m`;
    svg.appendChild(radiusText);

    // Office pin.
    const pinG = document.createElementNS(svgNS, 'g');
    pinG.setAttribute('transform', `translate(${officePoint.x},${officePoint.y})`);
    const pinPath = document.createElementNS(svgNS, 'path');
    pinPath.setAttribute('d', 'M0,0 C-4.5,-10 -11,-14.5 -11,-21.5 A11,11 0 1,1 11,-21.5 C11,-14.5 4.5,-10 0,0 Z');
    pinPath.setAttribute('fill', OFFICE_COLOR);
    pinPath.setAttribute('stroke', '#ffffff');
    pinPath.setAttribute('stroke-width', '1.6');
    pinG.appendChild(pinPath);
    const pinDot = document.createElementNS(svgNS, 'circle');
    pinDot.setAttribute('cy', '-21.5'); pinDot.setAttribute('r', '4.2'); pinDot.setAttribute('fill', '#ffffff');
    pinG.appendChild(pinDot);
    svg.appendChild(pinG);

    const officeText = document.createElementNS(svgNS, 'text');
    officeText.setAttribute('x', officePoint.x); officeText.setAttribute('y', officePoint.y + 28);
    officeText.setAttribute('font-size', '11'); officeText.setAttribute('font-weight', '800'); officeText.setAttribute('text-anchor', 'middle');
    officeText.setAttribute('fill', textColor); officeText.setAttribute('paint-order', 'stroke'); officeText.setAttribute('stroke', haloColor); officeText.setAttribute('stroke-width', '3');
    officeText.textContent = officeLabel;
    svg.appendChild(officeText);

    // Employee check-in markers (never rendered on the config page: markers=[]).
    markerList.forEach(marker => {
      if (!Number.isFinite(Number(marker.latitude)) || !Number.isFinite(Number(marker.longitude))) return;
      const kind = marker.kind || classifyMarker(marker);
      const isInside = kind !== 'outside';
      const isCurrent = kind === 'me';
      const color = isInside ? INSIDE_COLOR : OUTSIDE_COLOR;
      const p = projectToLocalPlane(office.latitude, office.longitude, Number(marker.latitude), Number(marker.longitude));
      const point = { x: screenX(p.metersE), y: screenY(p.metersN) };

      if (isCurrent) {
        const ring = document.createElementNS(svgNS, 'circle');
        ring.setAttribute('cx', point.x); ring.setAttribute('cy', point.y); ring.setAttribute('r', 12);
        ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', color); ring.setAttribute('stroke-width', '2');
        ring.setAttribute('opacity', '.5');
        svg.appendChild(ring);
      }

      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('cx', point.x); dot.setAttribute('cy', point.y); dot.setAttribute('r', isCurrent ? 8 : 6);
      dot.setAttribute('fill', color);
      dot.setAttribute('stroke', '#ffffff');
      dot.setAttribute('stroke-width', '2');
      dot.style.pointerEvents = 'auto';
      dot.style.cursor = 'pointer';
      dot.addEventListener('click', event => { event.stopPropagation(); showTooltip(marker, point); });
      svg.appendChild(dot);

      const name = String(marker.label || marker.employee_name || `NV ${marker.employee_id ?? ''}`) + (isCurrent ? ' · Tôi' : '');
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', point.x + (isCurrent ? 12 : 10));
      label.setAttribute('y', point.y - (isCurrent ? 11 : 8));
      label.setAttribute('font-size', isCurrent ? '11' : '10.5');
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', textColor);
      label.setAttribute('paint-order', 'stroke');
      label.setAttribute('stroke', haloColor);
      label.setAttribute('stroke-width', '3');
      label.textContent = name;
      svg.appendChild(label);

      if (kind === 'outside') {
        const tag = document.createElementNS(svgNS, 'text');
        tag.setAttribute('x', point.x + 10);
        tag.setAttribute('y', point.y + 5);
        tag.setAttribute('font-size', '9');
        tag.setAttribute('font-weight', '800');
        tag.setAttribute('fill', OUTSIDE_COLOR);
        tag.setAttribute('paint-order', 'stroke');
        tag.setAttribute('stroke', haloColor);
        tag.setAttribute('stroke-width', '3');
        tag.textContent = 'NGOÀI PHẠM VI';
        svg.appendChild(tag);
      }
    });
    keepTooltipOnScreen();
  }

  // ── Tooltip ────────────────────────────────────
  let activeTooltipPoint = null;
  function showTooltip(marker, point) {
    tooltipEl.innerHTML = marker.tooltipHTML || defaultTooltipHTML(marker);
    tooltipEl.hidden = false;
    activeTooltipPoint = point;
    keepTooltipOnScreen();
  }
  function hideTooltip() {
    tooltipEl.hidden = true;
    activeTooltipPoint = null;
  }
  function keepTooltipOnScreen() {
    if (!activeTooltipPoint) return;
    tooltipEl.style.left = `${clamp(activeTooltipPoint.x + 14, 4, Math.max(4, width - 220))}px`;
    tooltipEl.style.top = `${clamp(activeTooltipPoint.y - 8, 4, Math.max(4, heightPx - 92))}px`;
  }

  function scheduleRender() {
    if (destroyed || rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (destroyed) return;
      render();
    });
  }

  function fitView({ force = false } = {}) {
    if (!force && userMoved) return;
    view.scale = computeFitScale();
    view.panX = 0;
    view.panY = 0;
    scheduleRender();
  }

  // ── Interactions (pan only; no zoom) ──────────
  let dragging = false;
  let lastPoint = null;
  if (interactive) {
    container.addEventListener('pointerdown', event => {
      dragging = true;
      lastPoint = { x: event.clientX, y: event.clientY };
      hideTooltip();
    });
    container.addEventListener('pointermove', event => {
      if (!dragging || !lastPoint) return;
      view.panX += event.clientX - lastPoint.x;
      view.panY += event.clientY - lastPoint.y;
      lastPoint = { x: event.clientX, y: event.clientY };
      userMoved = true;
      scheduleRender();
    });
    const endDrag = () => { dragging = false; lastPoint = null; };
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
  }

  // ── Resize ─────────────────────────────────────
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (w > 0 && h > 0 && (w !== width || h !== heightPx)) {
      width = w; heightPx = h;
      view.scale = computeFitScale();
      scheduleRender();
    }
  }) : null;
  resizeObserver?.observe(container);

  // ── Public API ─────────────────────────────────
  const api = {
    setMarkers(nextMarkers, { fit = true } = {}) {
      markerList = (nextMarkers || []).map(marker => ({ ...marker }));
      if (fit) { userMoved = false; fitView({ force: true }); }
      else scheduleRender();
    },
    setOffice(nextCenter, nextRadius, nextName, { fit = true } = {}) {
      office.latitude = Number(nextCenter?.latitude ?? office.latitude);
      office.longitude = Number(nextCenter?.longitude ?? office.longitude);
      radius = Number(nextRadius) || 100;
      officeLabel = String(nextName || officeName || 'Văn phòng');
      if (fit) { userMoved = false; fitView({ force: true }); }
      else scheduleRender();
    },
    fit() { userMoved = false; fitView({ force: true }); },
    destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      container.innerHTML = '';
      container.classList.remove('geo-map', 'geo-map--dark');
    },
  };

  fitView({ force: true });
  return api;
}