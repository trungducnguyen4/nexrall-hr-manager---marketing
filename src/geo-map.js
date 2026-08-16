// ════════════════════════════════════════════════
//  Shared 2D map renderer — OpenStreetMap tiles + SVG overlay.
//
//  Used by:
//    · Office configuration page  → markers: []
//    · Attendance page            → markers: today's check-in points
//
//  No external map library. If tiles cannot load (offline / blocked) the
//  renderer falls back to a neutral grid so the geofence circle and the
//  employee markers remain usable.
//
//  One renderer for both screens — never copy-paste a second map.
// ════════════════════════════════════════════════

const TILE_SIZE = 256;
const MAX_LAT = 85.05112878;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const KIND_COLORS = { me: '#3B82F6', inside: '#10B981', outside: '#EF4444' };

// ── Projection helpers (pure, exported for tests) ──
export function projectLatLng(lat, lng, zoom) {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, Number(lat)));
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((Number(lng) + 180) / 360) * scale;
  const sin = Math.sin((clamped * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function metersPerPixelAt(lat, zoom) {
  return (156543.03392 * Math.cos((Number(lat) * Math.PI) / 180)) / Math.pow(2, zoom);
}

// Marker → visual kind: current user = blue, inside = green, outside = red.
export function classifyMarker(marker, currentUserId) {
  if (marker?.is_current_user) return 'me';
  if (currentUserId !== undefined && Number(marker?.employee_id) === Number(currentUserId)) return 'me';
  return marker?.inside_geofence ? 'inside' : 'outside';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function defaultTooltipHTML(marker) {
  const name = escapeHtml(marker.label || marker.employee_name || 'Nhân viên');
  const status = marker.inside_geofence
    ? '<span class="geo-tooltip-status geo-tooltip-inside">Trong phạm vi</span>'
    : '<span class="geo-tooltip-status geo-tooltip-outside">Ngoài phạm vi</span>';
  return `<div class="geo-tooltip-name">${name}</div>`
    + (marker.checkin_time ? `<div>Check-in: ${escapeHtml(marker.checkin_time)}</div>` : '')
    + (marker.distance_m != null ? `<div>Cách văn phòng: ${Math.round(Number(marker.distance_m))} m</div>` : '')
    + status;
}

/**
 * Render an interactive 2D map into `container`.
 *
 * @param {HTMLElement} container
 * @param {Object} options
 *   center            {latitude, longitude} office center
 *   radiusMeters      geofence radius
 *   officeName        label next to the office pin
 *   markers           [{ latitude, longitude, label, kind, tooltipHTML,
 *                        employee_id, is_current_user, inside_geofence,
 *                        checkin_time, distance_m }]
 *   theme             'light' | 'dark'
 *   height            px (number)
 *   interactive       enable pan/zoom
 * @returns {{ setMarkers, setOffice, fit, destroy }}
 */
export function renderGeoMap(container, options = {}) {
  const {
    center = { latitude: 21.0285, longitude: 105.8542 },
    radiusMeters = 100,
    officeName = 'Văn phòng',
    markers = [],
    theme = 'light',
    height = 240,
    interactive = true,
    fitMinZoom = 13,
    fitMaxZoom = 17.5,
    minZoom = 4,
    maxZoom = 19,
  } = options;

  // ── DOM scaffold ───────────────────────────────
  container.classList.add('geo-map');
  container.classList.toggle('geo-map--dark', theme === 'dark');
  container.style.height = typeof height === 'number' ? `${height}px` : String(height);

  const fallbackEl = document.createElement('div');
  fallbackEl.className = 'geo-map-fallback';
  const tilesEl = document.createElement('div');
  tilesEl.className = 'geo-map-tiles';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'geo-map-svg');
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'geo-map-tooltip';
  tooltipEl.hidden = true;
  const attributionEl = document.createElement('div');
  attributionEl.className = 'geo-map-attribution';
  attributionEl.textContent = '© OpenStreetMap';

  container.innerHTML = '';
  container.append(fallbackEl, tilesEl, svg, tooltipEl, attributionEl);

  let btnIn = null, btnOut = null;
  if (interactive) {
    const zoomBox = document.createElement('div');
    zoomBox.className = 'geo-map-zoom';
    btnIn = document.createElement('button');
    btnIn.type = 'button'; btnIn.textContent = '+'; btnIn.title = 'Phóng to';
    btnOut = document.createElement('button');
    btnOut.type = 'button'; btnOut.textContent = '−'; btnOut.title = 'Thu nhỏ';
    zoomBox.append(btnIn, btnOut);
    container.append(zoomBox);
  }

  // ── State ──────────────────────────────────────
  let office = { latitude: Number(center.latitude), longitude: Number(center.longitude) };
  let radius = Number(radiusMeters) || 100;
  let officeLabel = String(officeName || 'Văn phòng');
  let markerList = (markers || []).map(marker => ({ ...marker }));
  let view = { latitude: office.latitude, longitude: office.longitude, zoom: 16 };
  let pan = { x: 0, y: 0 };
  let width = Math.max(220, container.clientWidth || 300);
  let heightPx = Math.max(120, container.clientHeight || (typeof height === 'number' ? height : 240));
  let tilesBroken = false;
  let userMoved = false; // once the user pans/zooms, auto-fit stops overriding
  let rafId = 0;
  let destroyed = false;

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

  const worldCenter = () => projectLatLng(view.latitude, view.longitude, view.zoom);
  const topLeft = () => {
    const wc = worldCenter();
    return { x: wc.x - width / 2 + pan.x, y: wc.y - heightPx / 2 + pan.y };
  };
  const screenPoint = (lat, lng) => {
    const p = projectLatLng(lat, lng, view.zoom);
    const tl = topLeft();
    return { x: p.x - tl.x, y: p.y - tl.y };
  };

  // ── Rendering ──────────────────────────────────
  function renderTiles() {
    tilesEl.innerHTML = '';
    if (tilesBroken) {
      tilesEl.style.display = 'none';
      attributionEl.style.display = 'none';
      return;
    }
    tilesEl.style.display = '';
    attributionEl.style.display = '';
    const z = view.zoom;
    const n = Math.pow(2, z);
    const tl = topLeft();
    const startX = Math.floor(tl.x / TILE_SIZE);
    const endX = Math.floor((tl.x + width) / TILE_SIZE);
    const startY = Math.floor(tl.y / TILE_SIZE);
    const endY = Math.floor((tl.y + heightPx) / TILE_SIZE);
    const fragment = document.createDocumentFragment();
    for (let tx = startX; tx <= endX; tx++) {
      for (let ty = startY; ty <= endY; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wrappedX = ((tx % n) + n) % n;
        const img = document.createElement('img');
        img.className = 'geo-map-tile';
        img.alt = '';
        img.draggable = false;
        img.loading = 'lazy';
        img.src = TILE_URL.replace('{z}', z).replace('{x}', wrappedX).replace('{y}', ty);
        img.style.left = `${tx * TILE_SIZE - tl.x}px`;
        img.style.top = `${ty * TILE_SIZE - tl.y}px`;
        img.style.width = `${TILE_SIZE}px`;
        img.style.height = `${TILE_SIZE}px`;
        img.addEventListener('error', () => {
          if (!tilesBroken) { tilesBroken = true; scheduleRender(); }
        });
        fragment.appendChild(img);
      }
    }
    tilesEl.appendChild(fragment);
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${width} ${heightPx}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(heightPx));
    const textColor = theme === 'dark' ? '#F1F5F9' : '#0F172A';
    const haloColor = theme === 'dark' ? 'rgba(15,23,42,.92)' : 'rgba(255,255,255,.92)';

    const officePoint = screenPoint(office.latitude, office.longitude);

    // Geofence circle + radius label
    const radiusPx = Math.max(6, radius / metersPerPixelAt(office.latitude, view.zoom));
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', officePoint.x);
    circle.setAttribute('cy', officePoint.y);
    circle.setAttribute('r', radiusPx);
    circle.setAttribute('fill', 'rgba(99,102,241,.14)');
    circle.setAttribute('stroke', '#6366F1');
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('stroke-dasharray', '5 4');
    svg.appendChild(circle);

    const radiusText = document.createElementNS(svgNS, 'text');
    radiusText.setAttribute('x', officePoint.x + radiusPx + 5);
    radiusText.setAttribute('y', officePoint.y + 3);
    radiusText.setAttribute('font-size', '10');
    radiusText.setAttribute('font-weight', '700');
    radiusText.setAttribute('fill', textColor);
    radiusText.setAttribute('paint-order', 'stroke');
    radiusText.setAttribute('stroke', haloColor);
    radiusText.setAttribute('stroke-width', '3');
    radiusText.textContent = `${Math.round(radius)} m`;
    svg.appendChild(radiusText);

    // Office pin
    const pin = document.createElementNS(svgNS, 'g');
    pin.setAttribute('transform', `translate(${officePoint.x},${officePoint.y})`);
    const pinPath = document.createElementNS(svgNS, 'path');
    pinPath.setAttribute('d', 'M0,0 C-4.5,-10 -11,-14.5 -11,-21.5 A11,11 0 1,1 11,-21.5 C11,-14.5 4.5,-10 0,0 Z');
    pinPath.setAttribute('fill', '#EF4444');
    pinPath.setAttribute('stroke', '#ffffff');
    pinPath.setAttribute('stroke-width', '1.6');
    pin.appendChild(pinPath);
    const pinDot = document.createElementNS(svgNS, 'circle');
    pinDot.setAttribute('cy', '-21.5');
    pinDot.setAttribute('r', '4.2');
    pinDot.setAttribute('fill', '#ffffff');
    pin.appendChild(pinDot);
    svg.appendChild(pin);

    const officeText = document.createElementNS(svgNS, 'text');
    officeText.setAttribute('x', officePoint.x);
    officeText.setAttribute('y', officePoint.y + 26);
    officeText.setAttribute('font-size', '11');
    officeText.setAttribute('font-weight', '800');
    officeText.setAttribute('text-anchor', 'middle');
    officeText.setAttribute('fill', textColor);
    officeText.setAttribute('paint-order', 'stroke');
    officeText.setAttribute('stroke', haloColor);
    officeText.setAttribute('stroke-width', '3');
    officeText.textContent = officeLabel;
    svg.appendChild(officeText);

    // Employee check-in markers (never render on the config page: markers=[])
    markerList.forEach(marker => {
      if (!Number.isFinite(Number(marker.latitude)) || !Number.isFinite(Number(marker.longitude))) return;
      const point = screenPoint(Number(marker.latitude), Number(marker.longitude));
      const kind = marker.kind || classifyMarker(marker);
      const color = KIND_COLORS[kind] || KIND_COLORS.inside;

      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('cx', point.x);
      dot.setAttribute('cy', point.y);
      dot.setAttribute('r', kind === 'me' ? 9 : 7);
      dot.setAttribute('fill', color);
      dot.setAttribute('stroke', '#ffffff');
      dot.setAttribute('stroke-width', '2');
      dot.style.pointerEvents = 'auto';
      dot.style.cursor = 'pointer';
      dot.addEventListener('click', event => { event.stopPropagation(); showTooltip(marker, point); });
      svg.appendChild(dot);

      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', point.x + (kind === 'me' ? 12 : 10));
      label.setAttribute('y', point.y - (kind === 'me' ? 11 : 9));
      label.setAttribute('font-size', '10.5');
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', textColor);
      label.setAttribute('paint-order', 'stroke');
      label.setAttribute('stroke', haloColor);
      label.setAttribute('stroke-width', '3');
      label.textContent = String(marker.label || marker.employee_name || `NV ${marker.employee_id ?? ''}`);
      svg.appendChild(label);

      if (kind === 'outside') {
        const tag = document.createElementNS(svgNS, 'text');
        tag.setAttribute('x', point.x + 10);
        tag.setAttribute('y', point.y + 5);
        tag.setAttribute('font-size', '9');
        tag.setAttribute('font-weight', '800');
        tag.setAttribute('fill', '#EF4444');
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
    tooltipEl.style.top = `${clamp(activeTooltipPoint.y - 8, 4, Math.max(4, heightPx - 90))}px`;
  }

  // ── Fit viewport: geofence circle + visible markers ──
  function fitView({ force = false } = {}) {
    if (!force && userMoved) return;
    const dLat = radius / 111320;
    const dLng = radius / (111320 * Math.max(0.05, Math.cos((office.latitude * Math.PI) / 180)));
    let minLat = office.latitude - dLat, maxLat = office.latitude + dLat;
    let minLng = office.longitude - dLng, maxLng = office.longitude + dLng;
    markerList.forEach(marker => {
      if (!Number.isFinite(Number(marker.latitude)) || !Number.isFinite(Number(marker.longitude))) return;
      minLat = Math.min(minLat, Number(marker.latitude));
      maxLat = Math.max(maxLat, Number(marker.latitude));
      minLng = Math.min(minLng, Number(marker.longitude));
      maxLng = Math.max(maxLng, Number(marker.longitude));
    });
    const padLat = Math.max(dLat, (maxLat - minLat) * 0.18);
    const padLng = Math.max(dLng, (maxLng - minLng) * 0.18);
    minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

    let chosenZoom = fitMinZoom;
    for (let z = fitMaxZoom; z >= fitMinZoom; z -= 0.5) {
      const a = projectLatLng(minLat, minLng, z);
      const b = projectLatLng(maxLat, maxLng, z);
      if (b.x - a.x <= width && b.y - a.y <= heightPx) { chosenZoom = z; break; }
    }
    // Never zoom out past fitMinZoom even if a marker is far away.
    view = {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      zoom: clamp(Math.round(chosenZoom), minZoom, maxZoom),
    };
    pan = { x: 0, y: 0 };
    scheduleRender();
  }

  // ── View manipulation ──────────────────────────
  function setZoom(next, fromUser = false) {
    const target = clamp(Math.round(Number(next)), minZoom, maxZoom);
    if (fromUser) userMoved = true;
    if (target === view.zoom) return;
    const centerWorld = { x: worldCenter().x + pan.x, y: worldCenter().y + pan.y };
    view.zoom = target;
    pan = { x: centerWorld.x - worldCenter().x, y: centerWorld.y - worldCenter().y };
    scheduleRender();
  }

  function scheduleRender() {
    if (destroyed || rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (destroyed) return;
      renderTiles();
      renderOverlay();
    });
  }

  // ── Interactions ───────────────────────────────
  let dragging = false;
  let lastPoint = null;
  if (interactive) {
    btnIn?.addEventListener('click', () => setZoom(view.zoom + 1, true));
    btnOut?.addEventListener('click', () => setZoom(view.zoom - 1, true));
    container.addEventListener('pointerdown', event => {
      if (event.target.closest('.geo-map-zoom')) return;
      dragging = true;
      lastPoint = { x: event.clientX, y: event.clientY };
      hideTooltip();
    });
    container.addEventListener('pointermove', event => {
      if (!dragging || !lastPoint) return;
      const dx = event.clientX - lastPoint.x;
      const dy = event.clientY - lastPoint.y;
      lastPoint = { x: event.clientX, y: event.clientY };
      pan = { x: pan.x + dx, y: pan.y + dy };
      userMoved = true;
      scheduleRender();
    });
    const endDrag = () => { dragging = false; lastPoint = null; };
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
    container.addEventListener('wheel', event => {
      event.preventDefault();
      setZoom(view.zoom + (event.deltaY > 0 ? -1 : 1), true);
    }, { passive: false });
  }

  // ── Resize ─────────────────────────────────────
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (w > 0 && h > 0 && (w !== width || h !== heightPx)) {
      width = w; heightPx = h;
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
      office = { latitude: Number(nextCenter?.latitude ?? office.latitude), longitude: Number(nextCenter?.longitude ?? office.longitude) };
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

  // Initial render + fit
  fitView({ force: true });
  return api;
}
