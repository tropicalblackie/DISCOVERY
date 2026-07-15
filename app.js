const STORAGE_KEY = 'discovery-strategica-template-v3';
const EXPORT_VERSION = 3;
const GEOCODE_CACHE_KEY = 'discovery-strategica-geocode-v1';
const ARCHIVE_STORAGE_KEY = 'discovery-project-archive-v1';
const ACTIVE_PROJECT_KEY = 'discovery-project-active-v1';

let cantiereCount = 0;
let ipCount = 0;
let leafletMapInstance = null;
let geocodeCache = loadStoredGeocodeCache();
let archiveIndex = [];
let suspendAutosave = false;

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function loadStoredGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function persistGeocodeCache() {
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(geocodeCache));
  } catch {
    // Ignore cache persistence failures.
  }
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function geocodeAddress(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(geocodeCache, normalized)) {
    return geocodeCache[normalized];
  }

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=it&q=${encodeURIComponent(address)}`);
    if (!response.ok) throw new Error('geocoding-failed');
    const data = await response.json();
    const first = data?.[0];
    geocodeCache[normalized] = first ? { lat: Number(first.lat), lon: Number(first.lon) } : null;
    persistGeocodeCache();
    return geocodeCache[normalized];
  } catch {
    geocodeCache[normalized] = null;
    persistGeocodeCache();
    return null;
  }
}

function hasCoords(item) {
  return Boolean(item?.coords?.lat && item?.coords?.lon);
}

async function resolveMapPoints(projectAddress, rankedCantieri) {
  const points = [];
  const projectCoords = await geocodeAddress(projectAddress);
  points.push({ kind: 'project', label: 'P', name: projectAddress || 'Progetto', coords: projectCoords });

  const comparables = rankedCantieri.filter((item) => item.addr).slice(0, 8);
  for (let index = 0; index < comparables.length; index += 1) {
    const item = comparables[index];
    const coords = await geocodeAddress(item.addr);
    points.push({ kind: 'comp', label: String(index + 1), name: item.nome || item.addr, zona: item.zona, coords });
  }

  return points;
}

function canRenderFullLeafletMap(points, rankedCantieri) {
  const projectPoint = points.find((point) => point.kind === 'project');
  const comparableCount = rankedCantieri.filter((item) => item.addr).slice(0, 8).length;
  const geocodedComparableCount = points.filter((point) => point.kind === 'comp' && hasCoords(point)).length;
  return Boolean(hasCoords(projectPoint)) && comparableCount > 0 && geocodedComparableCount === comparableCount;
}

function renderLeafletMap(points) {
  const mapHost = document.getElementById('leaflet-map');
  if (!mapHost || !window.L) return;

  if (leafletMapInstance) {
    leafletMapInstance.remove();
    leafletMapInstance = null;
  }

  const validPoints = points.filter((point) => hasCoords(point));
  if (!validPoints.length) return;

  leafletMapInstance = window.L.map(mapHost, {
    zoomControl: false,
    scrollWheelZoom: false,
    dragging: true,
    attributionControl: true
  });

  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(leafletMapInstance);

  const bounds = [];
  validPoints.forEach((point) => {
    const latLng = [point.coords.lat, point.coords.lon];
    bounds.push(latLng);
    const marker = point.kind === 'project'
      ? window.L.circleMarker(latLng, {
          radius: 8,
          weight: 3,
          color: '#ffffff',
          fillColor: '#2d8a57',
          fillOpacity: 1
        })
      : window.L.circleMarker(latLng, {
          radius: 7,
          weight: 3,
          color: '#ffffff',
          fillColor: '#6b3fa0',
          fillOpacity: 1
        });
    marker.bindTooltip(`${point.label} · ${point.name}`, { direction: 'top', opacity: 0.92, sticky: true });
    marker.addTo(leafletMapInstance);
  });

  if (bounds.length === 1) {
    leafletMapInstance.setView(bounds[0], 15);
  } else {
    leafletMapInstance.fitBounds(bounds, { padding: [26, 26] });
  }

  setTimeout(() => leafletMapInstance?.invalidateSize(), 0);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return '—';
  return parsed.toLocaleString('it-IT');
}

function getFieldValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function getNumberValue(id) {
  const parsed = parseFloat(document.getElementById(id)?.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusBadge(status) {
  const normalized = (status || '').toLowerCase();
  if (!status) return '<span class="badge status-neutral">—</span>';
  if (normalized.includes('vend') || normalized.includes('assorb') || normalized.includes('prenot')) return `<span class="badge status-open">${escapeHtml(status)}</span>`;
  if (normalized.includes('lento') || normalized.includes('attesa') || normalized.includes('start')) return `<span class="badge status-warning">${escapeHtml(status)}</span>`;
  return `<span class="badge status-neutral">${escapeHtml(status)}</span>`;
}

function colorMq(mq, refMq) {
  if (!mq || !refMq) return `<span>${mq ? formatNumber(mq) : '—'}</span>`;
  if (mq >= refMq * 1.15) return `<span class="price-h">${formatNumber(mq)}</span>`;
  if (mq <= refMq * 0.85) return `<span class="price-l">${formatNumber(mq)}</span>`;
  return `<span class="price-m">${formatNumber(mq)}</span>`;
}

function deltaTag(value, ref) {
  if (!value || !ref) return '<span>—</span>';
  const delta = ((value / ref) - 1) * 100;
  const formatted = `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
  if (delta >= 10) return `<span class="delta-high">${formatted}</span>`;
  if (delta <= -10) return `<span class="delta-low">${formatted}</span>`;
  return `<span class="delta-mid">${formatted}</span>`;
}

function energiaBadge(en) {
  if (!en) return '<span class="badge badge-gray">—</span>';
  const upper = en.toUpperCase();
  if (upper.includes('A')) return `<span class="badge badge-green">${escapeHtml(en)}</span>`;
  if (['G', 'F', 'E'].some((letter) => upper.includes(letter))) return `<span class="badge badge-red">${escapeHtml(en)}</span>`;
  return `<span class="badge badge-amber">${escapeHtml(en)}</span>`;
}

function buildPremiumText(mqBp, mqMicro, premio, deprezzo) {
  if (mqBp && mqMicro) {
    const pct = ((mqBp / mqMicro - 1) * 100).toFixed(1);
    const sign = Number(pct) >= 0 ? '+' : '';
    let text = `Il nostro €/mq (${formatNumber(mqBp)} €/mq) è <strong>${sign}${escapeHtml(pct)}% rispetto alla media micro-zona</strong> (${formatNumber(mqMicro)} €/mq).`;
    if (premio) text += ` Motivazione premio: ${escapeHtml(premio)}.`;
    if (deprezzo) text += ` Deprezzamento applicato su: ${escapeHtml(deprezzo)}.`;
    return text;
  }
  if (premio) return `Motivazione premio: ${escapeHtml(premio)}.`;
  if (deprezzo) return `Deprezzamento applicato su: ${escapeHtml(deprezzo)}.`;
  return '';
}

function buildFallbackMapHtml(rankedCantieri) {
  const projectName = getFieldValue('f_indirizzo') || 'Progetto';
  const nodes = [{ label: 'P', name: projectName, className: 'project', left: 48, top: 50 }];
  const positions = [
    { left: 24, top: 24 },
    { left: 72, top: 26 },
    { left: 18, top: 68 },
    { left: 78, top: 62 },
    { left: 38, top: 18 },
    { left: 60, top: 74 },
    { left: 12, top: 46 },
    { left: 84, top: 42 }
  ];

  rankedCantieri.slice(0, 8).forEach((cantiere, index) => {
    const pos = positions[index];
    nodes.push({
      label: String(index + 1),
      name: cantiere.nome || cantiere.addr || `Comparabile ${index + 1}`,
      className: 'comp',
      left: pos.left,
      top: pos.top
    });
  });

  return `
    <div class="map-fallback">
      <div class="map-fallback-badge">Mappa area</div>
      ${nodes.map((node) => `
        <div class="map-dot ${node.className}" style="left: calc(${node.left}% - 9px); top: calc(${node.top}% - 9px);">
          ${escapeHtml(node.label)}
          <div class="map-dot-label">${escapeHtml(node.name)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function addCantiere(data = {}) {
  cantiereCount += 1;
  const rowId = `cantiere_${cantiereCount}`;
  const tbody = document.getElementById('cantieri-tbody');
  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.innerHTML = `
    <td><input type="text" class="c_nome" placeholder="Es. Dils-Nizzoli8" value="${escapeHtml(data.nome || '')}"></td>
    <td><input type="text" class="c_addr" placeholder="Via Marcello Nizzoli, 8, Milano" value="${escapeHtml(data.addr || '')}"></td>
    <td><input type="text" class="c_zona" placeholder="Es. Bande Nere" value="${escapeHtml(data.zona || '')}"></td>
    <td><input type="number" class="c_unita" placeholder="12" value="${escapeHtml(data.unita || '')}"></td>
    <td><input type="text" class="c_inizio" placeholder="Es. Gen 2024" value="${escapeHtml(data.inizio || '')}"></td>
    <td><input type="text" class="c_tipo" placeholder="Es. Trilo/Quadri" value="${escapeHtml(data.tipo || '')}"></td>
    <td><input type="number" class="c_sup" placeholder="95" value="${escapeHtml(data.sup || '')}"></td>
    <td><input type="number" class="c_mq" placeholder="6800" value="${escapeHtml(data.mq || '')}"></td>
    <td><input type="text" class="c_en" placeholder="A4" value="${escapeHtml(data.en || '')}"></td>
    <td><input type="text" class="c_stato" placeholder="In vendita" value="${escapeHtml(data.stato || '')}"></td>
    <td><button class="btn btn-small btn-danger" type="button" onclick="removeCantiere('${rowId}')">✕</button></td>
  `;
  tbody.appendChild(tr);
}

function removeCantiere(id) {
  document.getElementById(id)?.remove();
  persistFormState();
  updateQualityUI();
  renderLivePanel();
}

function getCantieriData() {
  return Array.from(document.querySelectorAll('#cantieri-tbody tr')).map((tr) => ({
    nome: tr.querySelector('.c_nome').value.trim(),
    addr: tr.querySelector('.c_addr').value.trim(),
    zona: tr.querySelector('.c_zona').value.trim(),
    unita: tr.querySelector('.c_unita').value.trim(),
    inizio: tr.querySelector('.c_inizio').value.trim(),
    tipo: tr.querySelector('.c_tipo').value.trim(),
    sup: tr.querySelector('.c_sup').value.trim(),
    mq: parseFloat(tr.querySelector('.c_mq').value) || 0,
    en: tr.querySelector('.c_en').value.trim(),
    stato: tr.querySelector('.c_stato').value.trim()
  })).filter((item) => item.nome || item.addr);
}

function addIpotesi(data = {}) {
  ipCount += 1;
  const labels = ['Mass Market', 'Premium / Upsell', 'Resa Veloce / Investimento', 'Test di Mercato / Ibrido'];
  const defaultLabel = labels[ipCount - 1] || `Ipotesi ${ipCount}`;
  const container = document.getElementById('ipotesi-container');
  const div = document.createElement('div');
  div.className = 'ipotesi-editor';
  div.innerHTML = `
    <div class="ipotesi-editor-header">
      <span class="ip-badge">Ipotesi ${ipCount}</span>
      <input type="text" class="ip_title" placeholder="Titolo (Es. ${escapeHtml(defaultLabel)})" value="${escapeHtml(data.title || '')}">
      <button class="btn btn-small btn-danger" type="button" onclick="removeIpotesi(this)">✕</button>
    </div>
    <div class="inline-two-col">
      <div class="field"><label>Descrizione (mix, target, logica)</label><textarea class="ip_body" placeholder="Es. Mix trilocali 80-95 mq, target prima casa famiglia, colma gap offerta nuova...">${escapeHtml(data.body || '')}</textarea></div>
      <div class="field"><label>Target €/mq e TTS stimato</label><input type="text" class="ip_price" placeholder="Es. 4.800-5.100 €/mq · TTS 3-5 mesi" value="${escapeHtml(data.price || '')}"></div>
    </div>
  `;
  container.appendChild(div);
}

function removeIpotesi(button) {
  button.closest('.ipotesi-editor')?.remove();
  persistFormState();
  updateQualityUI();
  renderLivePanel();
}

function getIpotesiData() {
  return Array.from(document.querySelectorAll('#ipotesi-container .ipotesi-editor')).map((div, index) => ({
    num: index + 1,
    title: div.querySelector('.ip_title').value.trim(),
    body: div.querySelector('.ip_body').value.trim(),
    price: div.querySelector('.ip_price').value.trim()
  }));
}

function collectFieldValues() {
  const fields = Array.from(document.querySelectorAll('#input-panel input, #input-panel select, #input-panel textarea'));
  const values = {};
  fields.forEach((field) => {
    if (field.id) values[field.id] = field.value;
  });
  return values;
}

function collectFormState() {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    values: collectFieldValues(),
    cantieri: getCantieriData(),
    ipotesi: getIpotesiData()
  };
}

function ensureArchiveShape(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && item.id && item.name && item.state).map((item) => ({
    id: item.id,
    name: item.name,
    updatedAt: item.updatedAt || new Date().toISOString(),
    state: item.state
  }));
}

function loadArchive() {
  try {
    archiveIndex = ensureArchiveShape(JSON.parse(localStorage.getItem(ARCHIVE_STORAGE_KEY) || '[]'));
  } catch {
    archiveIndex = [];
  }

  if (!archiveIndex.length) {
    const legacyRaw = localStorage.getItem(STORAGE_KEY);
    const baseState = legacyRaw ? JSON.parse(legacyRaw) : null;
    const seedState = baseState || { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), values: {}, cantieri: [], ipotesi: [] };
    archiveIndex = [{ id: uid('proj'), name: 'Scheda 1', updatedAt: new Date().toISOString(), state: seedState }];
    persistArchive();
  }

  refreshArchiveSelect();
}

function persistArchive() {
  try {
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archiveIndex));
  } catch {
    // Ignore archive persistence failures.
  }
}

function getActiveProjectId() {
  const stored = localStorage.getItem(ACTIVE_PROJECT_KEY);
  if (stored && archiveIndex.some((item) => item.id === stored)) return stored;
  const firstId = archiveIndex[0]?.id || '';
  if (firstId) localStorage.setItem(ACTIVE_PROJECT_KEY, firstId);
  return firstId;
}

function setActiveProjectId(id) {
  if (!id) return;
  localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  const select = document.getElementById('archive-select');
  if (select) select.value = id;
}

function getActiveArchiveItem() {
  const activeId = getActiveProjectId();
  return archiveIndex.find((item) => item.id === activeId) || archiveIndex[0];
}

function refreshArchiveSelect() {
  const select = document.getElementById('archive-select');
  if (!select) return;
  const activeId = getActiveProjectId();
  select.innerHTML = archiveIndex
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
  select.value = activeId;
}

function applyState(state) {
  suspendAutosave = true;
  Object.entries(state.values || {}).forEach(([id, value]) => {
    const field = document.getElementById(id);
    if (field) field.value = value;
  });
  document.getElementById('cantieri-tbody').innerHTML = '';
  document.getElementById('ipotesi-container').innerHTML = '';
  cantiereCount = 0;
  ipCount = 0;
  (state.cantieri || []).forEach((row) => addCantiere(row));
  (state.ipotesi || []).forEach((row) => addIpotesi(row));
  if (!(state.cantieri || []).length) {
    for (let i = 0; i < 3; i += 1) addCantiere();
  }
  if (!(state.ipotesi || []).length) {
    for (let i = 0; i < 4; i += 1) addIpotesi();
  }
  suspendAutosave = false;
  updateQualityUI();
  renderLivePanel();
}

function loadProjectById(id) {
  const item = archiveIndex.find((entry) => entry.id === id);
  if (!item) return;
  setActiveProjectId(id);
  applyState(item.state);
}

function saveCurrentProject() {
  const active = getActiveArchiveItem();
  if (!active) return;
  active.state = collectFormState();
  active.updatedAt = new Date().toISOString();
  persistArchive();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(active.state));
  updateQualityUI();
  renderLivePanel();
}

function createNewProject() {
  const index = archiveIndex.length + 1;
  const name = window.prompt('Nome nuova scheda', `Scheda ${index}`)?.trim();
  if (!name) return;
  const fresh = {
    id: uid('proj'),
    name,
    updatedAt: new Date().toISOString(),
    state: { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), values: {}, cantieri: [], ipotesi: [] }
  };
  archiveIndex.unshift(fresh);
  persistArchive();
  refreshArchiveSelect();
  loadProjectById(fresh.id);
}

function duplicateProject() {
  const active = getActiveArchiveItem();
  if (!active) return;
  const name = window.prompt('Nome copia', `${active.name} copia`)?.trim();
  if (!name) return;
  const clone = {
    id: uid('proj'),
    name,
    updatedAt: new Date().toISOString(),
    state: JSON.parse(JSON.stringify(collectFormState()))
  };
  archiveIndex.unshift(clone);
  persistArchive();
  refreshArchiveSelect();
  loadProjectById(clone.id);
}

function deleteCurrentProject() {
  if (archiveIndex.length === 1) {
    alert('Serve almeno una scheda in archivio.');
    return;
  }
  const active = getActiveArchiveItem();
  if (!active) return;
  const ok = window.confirm(`Eliminare "${active.name}"?`);
  if (!ok) return;
  archiveIndex = archiveIndex.filter((item) => item.id !== active.id);
  persistArchive();
  refreshArchiveSelect();
  const next = archiveIndex[0];
  if (next) loadProjectById(next.id);
}

function persistFormState() {
  if (suspendAutosave) return;
  const state = collectFormState();
  const active = getActiveArchiveItem();
  if (active) {
    active.state = state;
    active.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    persistArchive();
  }
}

function restoreActiveState() {
  const active = getActiveArchiveItem();
  if (!active) return false;
  applyState(active.state || {});
  return true;
}

function seedDefaultRows() {
  for (let i = 0; i < 3; i += 1) addCantiere();
  for (let i = 0; i < 4; i += 1) addIpotesi();
}

function getPrimaticcioSampleState() {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    values: {
      f_indirizzo: 'Via Giovanni Labus, 1',
      f_citta: 'Milano',
      f_macrozona: 'Bande Nere / Inganni',
      f_microzona: 'Primaticcio',
      f_data: 'Lug 2026',
      f_ciclo: 'Crescita',

      f_mq_medio: '4142', f_mq_p80: '4799', f_mq_min: '3164', f_mq_max: '5162',
      f_m_ott_min: '3629', f_m_ott_med: '4539', f_m_ott_max: '5448',
      f_m_buo_min: '2973', f_m_buo_med: '3833', f_m_buo_max: '4699',
      f_m_nor_min: '3200', f_m_nor_med: '3645', f_m_nor_max: '4279',
      f_l2_min: '3231', f_l2_med: '4304', f_l2_max: '5199',
      f_l3_min: '3005', f_l3_med: '4054', f_l3_max: '5041',
      f_l4_min: '3462', f_l4_med: '4131', f_l4_max: '5021',
      f_mq_bp: '4799', f_scarto: '-11',
      f_premio: 'Categoria catastale A2 e tagli trilocali ben allineati alla domanda locale possono sostenere un premio.',
      f_deprezzo: 'Categoria catastale A4 o mix troppo distante dal trilocale medio riducono la capacita di assorbimento.',

      f_st_tot: '238', f_st_assorb: '0,06', f_st_tts: '3,83 mesi', f_st_tempo: '3,3 mesi',
      f_st_nuovo: '10', f_st_ottimo: '88', f_st_buono: '89', f_st_nor: '46',
      f_st_1l: '2', f_st_2l: '77', f_st_3l: '98', f_st_4l: '51', f_st_5l: '9', f_st_5p: '1',

      f_d_ricerche: '12,92%', f_d_visti: '12,06%', f_d_lead: '7,65', f_d_conv: '3,5 /1000',
      f_d_app: '35', f_d_other: '28', f_d_casa: '13', f_d_villa: '13', f_d_attico: '12',
      f_d_1l: '5', f_d_2l: '39', f_d_3l: '45', f_d_4l: '10', f_d_5l: '2',
      f_c_locali: '46', f_c_piano: '32', f_c_stato: '17', f_c_terrazzo: '12', f_c_tipologia: '11', f_c_box: '6', f_c_giardino: '3',

      f_cv_med: '3680', f_cv_range: '1.954–5.709', f_cv_prezzo: '336.027 €', f_cv_ntn: '93,26',
      f_cv_a2_min: '3414', f_cv_a2_med: '4329', f_cv_a2_max: '5709',
      f_cv_a3_min: '1953', f_cv_a3_med: '3729', f_cv_a3_max: '4678',
      f_cv_a4_min: '1852', f_cv_a4_med: '2400', f_cv_a4_max: '2870',

      m1_title: 'Zona a domanda contenuta ma stabile',
      m1_color: 'neutral',
      m1_body: 'Primaticcio si posiziona costantemente in fondo alla classifica delle zone comparabili su prezzo e assorbimento.',
      m2_title: 'Asking 4.142 euro/mq',
      m2_color: 'pos',
      m2_body: 'Range 3.164-5.162 euro/mq ed elasticita contenuta: il prezzo si negozia poco.',
      m3_title: 'Closing 3.680 euro/mq',
      m3_color: 'neutral',
      m3_body: 'Il gap tra A2 e A4 e enorme: la categoria catastale conta piu della zona.',
      m4_title: '93,26 NTN in crescita',
      m4_color: 'opp',
      m4_body: 'Le compravendite 2025 crescono del 14% sul 2024, segno di buon turnover.',
      m5_title: '238 annunci attivi',
      m5_color: 'alert',
      m5_body: 'Offerta concentrata su 3 locali e 2 locali; il nuovo/in costruzione e marginale.',
      m6_title: 'Domanda allineata allo stock',
      m6_color: 'neutral',
      m6_body: 'Il 45% delle ricerche cerca 3 locali e il 39% 2 locali: la domanda riflette quasi perfettamente lo stock.',
      m7_title: 'Trilocale 80-95 mq',
      m7_color: 'opp',
      m7_body: 'Il 3 locali e il taglio piu cercato e piu scambiato, con superficie media di 86,2 mq.',

      tw1: 'Il trilocale 80-95 mq e il prodotto piu coerente con domanda, stock e superficie media transata della zona.',
      tw2: 'La categoria catastale pesa piu della zona: il gap A2/A4 supera i 1.900 euro/mq.',
      tw3: 'Se il tasso di conversione continua a crescere, conviene accelerare il pre-selling.',
      val_timeline: 'Monitorare il tasso di conversione e accelerare il pre-selling se il trend resta in crescita.',
      val_test: 'Pubblicare un trilocale categoria A2 e verificare se il mercato riconosce il premio catastale atteso.',

      d_esito: 'GO condizionato',
      d_conf: '70',
      d_when: '60 giorni',
      d_reason: 'Zona a domanda contenuta ma NTN in crescita (+14%). Il gap A2/A4 va monitorato in fase di pricing.',
      d_next: 'Verificare l\'assorbimento reale sul trilocale, taglio dominante sia in domanda (45%) sia in offerta.'
    },
    cantieri: [
      {
        nome: 'Dils-Nizzoli8',
        addr: 'Via M. Nizzoli, 8, MI',
        zona: 'Bande Nere',
        unita: '16',
        inizio: 'Gen 2024',
        tipo: 'Bilo/Trilo/Quadri',
        sup: '130',
        mq: 7000,
        en: 'A+',
        stato: 'In vendita'
      },
      {
        nome: '3070-Nizzoli4',
        addr: 'Via M. Nizzoli, 4, MI',
        zona: 'Bande Nere',
        unita: '8',
        inizio: 'Mar 2023',
        tipo: 'Trilo/Quadri',
        sup: '103',
        mq: 7400,
        en: 'A4',
        stato: 'In vendita'
      },
      {
        nome: '702D-Tuberose',
        addr: 'Via Tuberose, 14, MI',
        zona: 'Bande Nere',
        unita: '1',
        inizio: 'Lug 2023',
        tipo: 'Quadri grande',
        sup: '193',
        mq: 9067,
        en: 'A4',
        stato: 'In vendita'
      },
      {
        nome: 'V065572-SGimig',
        addr: 'Via San Gimignano, 10, MI',
        zona: 'Primaticcio',
        unita: '1',
        inizio: 'Set 2024',
        tipo: 'Quadri',
        sup: '140',
        mq: 6857,
        en: '—',
        stato: 'In vendita'
      },
      {
        nome: 'GIMIG9',
        addr: 'Vle San Gimignano, 9, MI',
        zona: 'Primaticcio',
        unita: '1',
        inizio: 'Nov 2023',
        tipo: 'Bilocale',
        sup: '45',
        mq: 5778,
        en: 'A+',
        stato: 'In vendita'
      }
    ],
    ipotesi: [
      {
        title: '01 Mass Market',
        body: 'Trilo 80-95mq: taglio dominante su domanda (45%) e stock, sup. media compravenduta 86,2mq.',
        price: '3.900-4.300 euro/mq'
      },
      {
        title: '02 Premium',
        body: 'Bilo/Trilo cat. A2 piani alti: gap A2 vs A3 e +600 euro/mq medio, margine concreto su prodotto di qualita.',
        price: '4.300-4.800 euro/mq'
      },
      {
        title: '03 Resa Veloce',
        body: 'Bilo 55-65mq: secondo taglio piu richiesto (39% domanda), buon turnover e stock secondo per volume.',
        price: '4.000-4.300 euro/mq'
      },
      {
        title: '04 Test Ibrido',
        body: 'Quadrilocale in classe energetica alta: stock nuovo/in costr. quasi assente e poca concorrenza diretta.',
        price: '3.700-4.100 euro/mq'
      }
    ]
  };
}

function loadPrimaticcioSample() {
  const hasContent = Object.values(collectFieldValues()).some((value) => String(value || '').trim())
    || getCantieriData().length > 0
    || getIpotesiData().length > 0;

  if (hasContent) {
    const ok = window.confirm('Sostituire i dati correnti con il sample Primaticcio?');
    if (!ok) return;
  }

  applyState(getPrimaticcioSampleState());
  saveCurrentProject();
  updateQualityUI();
  renderLivePanel();
}

function scoreCantiere(cantiere, mqBp) {
  let score = 0;
  if (cantiere.addr) score += 12;
  if (cantiere.mq > 0) {
    score += 30;
    if (mqBp > 0) {
      const delta = Math.abs((cantiere.mq / mqBp) - 1);
      score += Math.max(0, 30 - Math.round(delta * 100));
    }
  }
  const en = (cantiere.en || '').toUpperCase();
  if (en.includes('A')) score += 14;
  else if (en.includes('B') || en.includes('C')) score += 9;
  else if (en) score += 4;

  const stato = (cantiere.stato || '').toLowerCase();
  if (stato.includes('vend') || stato.includes('assorb') || stato.includes('prenot')) score += 10;
  else if (stato.includes('attesa') || stato.includes('lento')) score += 5;

  if (cantiere.unita) score += 4;
  return Math.min(100, score);
}

function buildRankedCantieri(cantieri, mqBp) {
  return cantieri
    .map((cantiere) => ({ ...cantiere, rankScore: scoreCantiere(cantiere, mqBp) }))
    .sort((a, b) => b.rankScore - a.rankScore);
}

function generateCompetitorMetrics(cantieri, mqBp) {
  const priced = cantieri.filter((c) => c.mq > 0);
  const energiesA = cantieri.filter((c) => c.en && c.en.toUpperCase().includes('A')).length;
  const avgPrice = priced.length ? priced.reduce((sum, c) => sum + c.mq, 0) / priced.length : 0;
  const minPrice = priced.length ? Math.min(...priced.map((c) => c.mq)) : 0;
  const maxPrice = priced.length ? Math.max(...priced.map((c) => c.mq)) : 0;
  const deltaVsComp = avgPrice && mqBp ? ((mqBp / avgPrice) - 1) * 100 : 0;
  return { count: cantieri.length, avgPrice, minPrice, maxPrice, energiesA, deltaVsComp };
}

function metricKpiHtml(metrics, mqBp) {
  return `
    <div class="metric-kpi-row">
      <div class="metric-kpi"><span class="metric-kpi-label">Comparabili</span><span class="metric-kpi-value">${metrics.count || '—'}</span><span class="metric-kpi-meta">cantieri inseriti</span></div>
      <div class="metric-kpi"><span class="metric-kpi-label">Avg €/mq comp.</span><span class="metric-kpi-value">${formatNumber(metrics.avgPrice)}</span><span class="metric-kpi-meta">fascia ${formatNumber(metrics.minPrice)} - ${formatNumber(metrics.maxPrice)}</span></div>
      <div class="metric-kpi"><span class="metric-kpi-label">Classe A</span><span class="metric-kpi-value">${metrics.energiesA || 0}</span><span class="metric-kpi-meta">su ${metrics.count || 0} comparabili</span></div>
      <div class="metric-kpi"><span class="metric-kpi-label">BP vs comp.</span><span class="metric-kpi-value">${metrics.avgPrice && mqBp ? `${metrics.deltaVsComp > 0 ? '+' : ''}${metrics.deltaVsComp.toFixed(1)}%` : '—'}</span><span class="metric-kpi-meta">delta sul prezzo medio competitor</span></div>
    </div>
  `;
}

function normalizeDecisionClass(decision) {
  if (decision === 'GO') return 'decision-go';
  if (decision === 'GO condizionato') return 'decision-go-soft';
  if (decision === 'NO GO') return 'decision-no';
  return '';
}

function getDensityClass(cantieriCount, ipotesiCount, textLoad) {
  if (cantieriCount >= 8 || ipotesiCount >= 6 || textLoad > 1600) return 'ultra-dense';
  if (cantieriCount >= 6 || ipotesiCount >= 5 || textLoad > 1000) return 'dense-layout';
  return '';
}

function computeQualityReport() {
  const indirizzo = getFieldValue('f_indirizzo');
  const citta = getFieldValue('f_citta');
  const macrozona = getFieldValue('f_macrozona');
  const microzona = getFieldValue('f_microzona');
  const data = getFieldValue('f_data');
  const ciclo = getFieldValue('f_ciclo');

  const mqMedio = getNumberValue('f_mq_medio');
  const mqBp = getNumberValue('f_mq_bp');
  const cvMed = getNumberValue('f_cv_med');
  const stTot = getNumberValue('f_st_tot');
  const cvNtn = getFieldValue('f_cv_ntn');

  const cantieri = getCantieriData();
  const ipotesi = getIpotesiData();
  const takeaway = [getFieldValue('tw1'), getFieldValue('tw2'), getFieldValue('tw3')].filter(Boolean);
  const decision = getFieldValue('d_esito');
  const decisionReason = getFieldValue('d_reason');

  let score = 0;
  const warnings = [];

  const baseFields = [indirizzo, citta, macrozona, microzona, data, ciclo].filter(Boolean).length;
  score += Math.round((baseFields / 6) * 28);
  if (baseFields < 6) warnings.push('Completa i dati generali per migliorare la consistenza.');

  const pricingFields = [mqMedio, mqBp, cvMed, stTot, cvNtn].filter(Boolean).length;
  score += Math.round((pricingFields / 5) * 24);
  if (pricingFields < 3) warnings.push('Inserisci i prezzi annunci, BP e compravendite per un benchmark affidabile.');

  const fullCantieri = cantieri.filter((item) => item.addr && item.mq > 0).length;
  score += Math.min(22, fullCantieri * 6);
  if (fullCantieri < 3) warnings.push('Servono almeno 3 cantieri completi (indirizzo + €/mq).');

  const fullIpotesi = ipotesi.filter((item) => item.title && item.body).length;
  score += Math.min(14, fullIpotesi * 4);
  if (fullIpotesi < 4) warnings.push('Definisci 4 ipotesi complete per confronto decisionale.');

  score += takeaway.length >= 2 ? 7 : takeaway.length * 3;
  if (takeaway.length < 2) warnings.push('Aggiungi almeno 2 takeaway concreti.');

  if (decision && decisionReason) score += 5;
  else warnings.push('Compila la decisione operativa finale.');

  const state = score >= 85 ? 'Pronta' : score >= 65 ? 'Quasi pronta' : 'Da completare';
  return { score: Math.min(100, score), warnings, state };
}

function updateQualityUI() {
  const report = computeQualityReport();
  const scoreNode = document.getElementById('quality-score');
  const fillNode = document.getElementById('quality-bar-fill');
  const stateNode = document.getElementById('quality-state');
  if (scoreNode) scoreNode.textContent = `${report.score}/100`;
  if (fillNode) fillNode.style.width = `${report.score}%`;
  if (stateNode) stateNode.textContent = report.state;

  const validationBox = document.getElementById('validation-errors');
  if (!validationBox) return;
  if (!report.warnings.length) {
    validationBox.classList.remove('show');
    validationBox.innerHTML = '';
    return;
  }
  validationBox.classList.add('show');
  validationBox.innerHTML = `<strong>Controlli veloci</strong><ul>${report.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function validateBeforeGenerate() {
  const errors = [];
  const indirizzo = getFieldValue('f_indirizzo');
  const citta = getFieldValue('f_citta');
  const mqBp = getNumberValue('f_mq_bp');
  const mqMedio = getNumberValue('f_mq_medio');
  const scarto = getNumberValue('f_scarto');
  const cantieri = getCantieriData();
  const ipotesi = getIpotesiData();
  const decision = getFieldValue('d_esito');
  const decisionConf = getNumberValue('d_conf');

  if (!indirizzo || !citta) errors.push('Compila indirizzo progetto e citta.');
  if (mqBp <= 0 || mqMedio <= 0) errors.push('Inserisci almeno €/mq Nostro BP e €/mq medio annunci.');
  if (cantieri.length < 2) errors.push('Inserisci almeno 2 cantieri comparabili.');
  if (cantieri.some((item) => !item.addr || item.mq <= 0)) errors.push('Ogni cantiere deve avere indirizzo completo e €/mq.');
  if (ipotesi.filter((item) => item.title && item.body).length < 2) errors.push('Servono almeno 2 ipotesi complete per generare il documento.');
  if (decision === 'GO' && decisionConf > 0 && decisionConf < 55) errors.push('Decisione GO incoerente con confidenza sotto 55%.');
  if (scarto > 5) errors.push('Scarto asking/closing positivo oltre 5%: verifica il dato.');

  return errors;
}

function applySmartSuggestions() {
  const ciclo = getFieldValue('f_ciclo');
  const micro = getFieldValue('f_microzona') || 'micro-zona';
  const mqBp = getNumberValue('f_mq_bp');
  const mqMedio = getNumberValue('f_mq_medio');

  if (!getFieldValue('m1_title')) {
    const titleByCycle = ciclo === 'Crescita' ? 'Mercato in accelerazione' : ciclo === 'Contrazione' ? 'Mercato selettivo' : 'Mercato bilanciato';
    document.getElementById('m1_title').value = titleByCycle;
  }
  if (!getFieldValue('m1_body')) {
    document.getElementById('m1_body').value = `Focus su ${micro}: domanda attiva ma sensibile a prezzo e qualita prodotto.`;
  }
  if (!getFieldValue('m2_body')) {
    const trend = ciclo === 'Crescita' ? 'Pressione rialzista' : ciclo === 'Contrazione' ? 'Mercato difensivo' : 'Stabilita in consolidamento';
    document.getElementById('m2_body').value = `${trend} con attenzione al posizionamento iniziale.`;
  }
  if (!getFieldValue('tw1')) {
    document.getElementById('tw1').value = `Concentrare l'offerta su tagli ad alta assorbibilita in ${micro}.`;
  }
  if (!getFieldValue('tw2') && mqBp && mqMedio) {
    const delta = ((mqBp / mqMedio) - 1) * 100;
    document.getElementById('tw2').value = `Posizionamento target ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs media annunci con narrativa premium chiara.`;
  }
  if (!getFieldValue('val_timeline')) {
    document.getElementById('val_timeline').value = 'Avvio pre-selling con checkpoint lead ogni 14 giorni e revisione prezzo al giorno 75.';
  }
  if (!getFieldValue('d_esito')) {
    document.getElementById('d_esito').value = 'GO condizionato';
  }
  if (!getFieldValue('d_reason')) {
    document.getElementById('d_reason').value = 'Benchmark competitivo favorevole ma da validare su velocita assorbimento reale.';
  }
  if (!getFieldValue('d_next')) {
    document.getElementById('d_next').value = 'Attivare test commerciale su 2 configurazioni e monitorare conversione per 30 giorni.';
  }

  persistFormState();
  updateQualityUI();
  renderLivePanel();
}

function renderLivePanel() {
  // Live panel removed by request.
}

function getDecisionHtml() {
  const decision = getFieldValue('d_esito');
  const confidence = getFieldValue('d_conf');
  const horizon = getFieldValue('d_when');
  const reason = getFieldValue('d_reason');
  const next = getFieldValue('d_next');
  const decisionClass = normalizeDecisionClass(decision);

  return `
    <div class="decision-grid">
      <div class="decision-box">
        <div class="decision-main">
          <span class="decision-label">Decisione</span>
          <span class="decision-value ${decisionClass}">${escapeHtml(decision || 'Da definire')}</span>
          <span class="decision-conf">Conf. ${escapeHtml(confidence || '—')}%</span>
        </div>
        <div class="decision-body">${reason ? escapeHtml(reason) : '<span class="slot">Motivazione da compilare</span>'}</div>
      </div>
      <div class="decision-box">
        <div class="decision-main">
          <span class="decision-label">Prossimo step</span>
          <span class="decision-conf">Orizzonte ${escapeHtml(horizon || '—')}</span>
        </div>
        <div class="decision-body">${next ? escapeHtml(next) : '<span class="slot">Azione successiva da compilare</span>'}</div>
      </div>
    </div>
  `;
}

async function generateDoc() {
  const hardErrors = validateBeforeGenerate();
  if (hardErrors.length) {
    const validationBox = document.getElementById('validation-errors');
    if (validationBox) {
      validationBox.classList.add('show');
      validationBox.innerHTML = `<strong>Blocco generazione</strong><ul>${hardErrors.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    }
    updateQualityUI();
    window.scrollTo(0, 0);
    return;
  }

  const indirizzo = getFieldValue('f_indirizzo');
  const citta = getFieldValue('f_citta');
  const macrozona = getFieldValue('f_macrozona');
  const microzona = getFieldValue('f_microzona');
  const data = getFieldValue('f_data');
  const ciclo = getFieldValue('f_ciclo');
  // 01 Prezzi annunci
  const mqMedio = getNumberValue('f_mq_medio');
  const mqP80 = getNumberValue('f_mq_p80');
  const mqMin = getNumberValue('f_mq_min');
  const mqMax = getNumberValue('f_mq_max');
  const mOttMin = getNumberValue('f_m_ott_min'); const mOttMed = getNumberValue('f_m_ott_med'); const mOttMax = getNumberValue('f_m_ott_max');
  const mBuoMin = getNumberValue('f_m_buo_min'); const mBuoMed = getNumberValue('f_m_buo_med'); const mBuoMax = getNumberValue('f_m_buo_max');
  const mNorMin = getNumberValue('f_m_nor_min'); const mNorMed = getNumberValue('f_m_nor_med'); const mNorMax = getNumberValue('f_m_nor_max');
  const l2Min = getNumberValue('f_l2_min'); const l2Med = getNumberValue('f_l2_med'); const l2Max = getNumberValue('f_l2_max');
  const l3Min = getNumberValue('f_l3_min'); const l3Med = getNumberValue('f_l3_med'); const l3Max = getNumberValue('f_l3_max');
  const l4Min = getNumberValue('f_l4_min'); const l4Med = getNumberValue('f_l4_med'); const l4Max = getNumberValue('f_l4_max');
  const mqBp = getNumberValue('f_mq_bp');
  const scarto = getNumberValue('f_scarto');
  const premio = getFieldValue('f_premio');
  const deprezzo = getFieldValue('f_deprezzo');
  // 02 Stock
  const stTot = getNumberValue('f_st_tot'); const stAssorb = getFieldValue('f_st_assorb'); const stTts = getFieldValue('f_st_tts'); const stTempo = getFieldValue('f_st_tempo');
  const stNuovo = getNumberValue('f_st_nuovo'); const stOttimo = getNumberValue('f_st_ottimo'); const stBuono = getNumberValue('f_st_buono'); const stNor = getNumberValue('f_st_nor');
  const st1l = getNumberValue('f_st_1l'); const st2l = getNumberValue('f_st_2l'); const st3l = getNumberValue('f_st_3l'); const st4l = getNumberValue('f_st_4l'); const st5l = getNumberValue('f_st_5l'); const st5p = getNumberValue('f_st_5p');
  // 03 Domanda
  const dRicerche = getFieldValue('f_d_ricerche'); const dVisti = getFieldValue('f_d_visti'); const dLead = getFieldValue('f_d_lead'); const dConv = getFieldValue('f_d_conv');
  const dApp = getNumberValue('f_d_app'); const dOther = getNumberValue('f_d_other'); const dCasa = getNumberValue('f_d_casa'); const dVilla = getNumberValue('f_d_villa'); const dAttico = getNumberValue('f_d_attico');
  const d1l = getNumberValue('f_d_1l'); const d2l = getNumberValue('f_d_2l'); const d3l = getNumberValue('f_d_3l'); const d4l = getNumberValue('f_d_4l'); const d5l = getNumberValue('f_d_5l');
  const cLocali = getNumberValue('f_c_locali'); const cPiano = getNumberValue('f_c_piano'); const cStato = getNumberValue('f_c_stato'); const cTerrazzo = getNumberValue('f_c_terrazzo'); const cTipologia = getNumberValue('f_c_tipologia'); const cBox = getNumberValue('f_c_box'); const cGiardino = getNumberValue('f_c_giardino');
  // 04 Compravendite
  const cvMed = getNumberValue('f_cv_med'); const cvRange = getFieldValue('f_cv_range'); const cvPrezzo = getFieldValue('f_cv_prezzo'); const cvNtn = getFieldValue('f_cv_ntn');
  const cvA2Min = getNumberValue('f_cv_a2_min'); const cvA2Med = getNumberValue('f_cv_a2_med'); const cvA2Max = getNumberValue('f_cv_a2_max');
  const cvA3Min = getNumberValue('f_cv_a3_min'); const cvA3Med = getNumberValue('f_cv_a3_med'); const cvA3Max = getNumberValue('f_cv_a3_max');
  const cvA4Min = getNumberValue('f_cv_a4_min'); const cvA4Med = getNumberValue('f_cv_a4_med'); const cvA4Max = getNumberValue('f_cv_a4_max');
  const metrics = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
    label: ['Rating di mercato', 'Prezzi annunci', 'Prezzi compravendite', 'Volumi di mercato', 'Stock disponibile', 'Domanda', 'Mix dimensionale'][i - 1],
    title: getFieldValue(`m${i}_title`),
    color: getFieldValue(`m${i}_color`),
    body: getFieldValue(`m${i}_body`)
  }));
  const cantieri = getCantieriData();
  const rankedCantieri = buildRankedCantieri(cantieri, mqBp);
  const ipotesi = getIpotesiData();
  const takeaway = [getFieldValue('tw1'), getFieldValue('tw2'), getFieldValue('tw3')].filter(Boolean);
  const valTimeline = getFieldValue('val_timeline');
  const valTest = getFieldValue('val_test');
  const premiumText = buildPremiumText(mqBp, mqMedio, premio, deprezzo);
  const competitorMetrics = generateCompetitorMetrics(rankedCantieri, mqBp);
  const projectAddress = [indirizzo, citta].filter(Boolean).join(', ');
  const mapPoints = await resolveMapPoints(projectAddress, rankedCantieri);
  const covered = mapPoints.filter((point) => point.kind === 'comp' && hasCoords(point)).length;
  const totalComparableMap = rankedCantieri.filter((item) => item.addr).slice(0, 8).length;

  const metricHtml = metrics.map((metric) => `
    <div class="mc ${metric.color === 'neutral' ? '' : escapeHtml(metric.color)}">
      <div class="mc-label">${escapeHtml(metric.label)}</div>
      <div class="mc-rating">${metric.title ? escapeHtml(metric.title) : '<span class="slot">—</span>'}</div>
      <div class="mc-body">${escapeHtml(metric.body)}</div>
    </div>
  `).join('');

  const useLeafletMap = canRenderFullLeafletMap(mapPoints, rankedCantieri);
  const mapVisual = useLeafletMap
    ? '<div id="leaflet-map" class="leaflet-map" aria-label="Mappa progetto e comparabili"></div>'
    : buildFallbackMapHtml(rankedCantieri);

  const mapHtml = `
    <div class="map-layout">
      <div id="map-container">${mapVisual}</div>
      <div class="map-side">
        <div class="map-side-panel">
          <div class="map-legend-title">Legenda e ranking</div>
          <div class="legend-item"><span class="legend-pin project">P</span>Progetto in analisi</div>
          ${rankedCantieri.filter((c) => c.addr).slice(0, 8).map((c, index) => `<div class="legend-item"><span class="legend-pin comp">${index + 1}</span>${escapeHtml(c.nome || 'Comparabile')} · score ${Math.round(c.rankScore)}</div>`).join('') || '<div class="legend-item">Aggiungi un indirizzo completo per visualizzarlo</div>'}
        </div>
        <div class="map-side-panel">
          <div class="map-legend-title">Insight rapidi</div>
          <div class="insight-item">Prezzo medio comparabili: <strong>${formatNumber(competitorMetrics.avgPrice)}</strong> €/mq</div>
          <div class="insight-item">Range osservato: <strong>${formatNumber(competitorMetrics.minPrice)}</strong> - <strong>${formatNumber(competitorMetrics.maxPrice)}</strong> €/mq</div>
          <div class="insight-item">Copertura geocode: <strong>${covered}/${totalComparableMap}</strong></div>
          <div class="insight-item">BP progetto vs media competitor: <strong>${competitorMetrics.avgPrice && mqBp ? `${competitorMetrics.deltaVsComp > 0 ? '+' : ''}${competitorMetrics.deltaVsComp.toFixed(1)}%` : 'n.d.'}</strong></div>
        </div>
      </div>
    </div>
  `;

  const cantieriRows = rankedCantieri.length ? rankedCantieri.map((c, index) => `
      <tr>
        <td><strong>#${index + 1} ${escapeHtml(c.nome || '—')}</strong></td>
        <td>${escapeHtml(c.addr || '—')}</td>
        <td>${escapeHtml(c.zona || '—')}</td>
        <td style="text-align:center; font-family:var(--mono);">${escapeHtml(c.unita || '—')}</td>
        <td style="font-family:var(--mono);">${escapeHtml(c.inizio || '—')}</td>
        <td>${escapeHtml(c.tipo || '—')}</td>
        <td style="text-align:center; font-family:var(--mono);">${escapeHtml(c.sup || '—')}</td>
        <td style="text-align:right;">${colorMq(c.mq, mqMedio)}</td>
        <td style="text-align:right;">${deltaTag(c.mq, mqBp || mqMedio)}</td>
        <td>${energiaBadge(c.en)}</td>
        <td>${statusBadge(c.stato)}</td>
      </tr>
    `).join('') : '<tr><td colspan="11" style="text-align:center; color:var(--muted); padding:8px; font-style:italic;">Nessun cantiere inserito</td></tr>';

  const ipotesiHtml = ipotesi.length ? ipotesi.map((ip) => `
      <div class="ip">
        <div class="ip-num">Ipotesi 0${ip.num}</div>
        <div class="ip-title">${ip.title ? escapeHtml(ip.title) : '<span class="slot">—</span>'}</div>
        <div class="ip-body">${escapeHtml(ip.body)}</div>
        ${ip.price ? `<div class="ip-price">${escapeHtml(ip.price)}</div>` : ''}
      </div>
    `).join('') : '<div class="ip" style="grid-column:1/-1; text-align:center; color:var(--muted); font-style:italic; font-size:7pt;">Nessuna ipotesi inserita</div>';

  const takeawayHtml = takeaway.length ? takeaway.map((item) => `<div class="tw-item"><span class="tw-arrow">→</span><span class="tw-text">${escapeHtml(item)}</span></div>`).join('') : '<div class="tw-item"><span class="tw-arrow">→</span><span class="tw-text" style="opacity:.5; font-style:italic;">Inserisci i takeaway nel form</span></div>';
  const cicloColor = ciclo === 'Crescita' ? 'badge-green' : ciclo === 'Contrazione' ? 'badge-red' : 'badge-amber';

  const textLoad = [premio, deprezzo, valTimeline, valTest, getFieldValue('d_reason'), getFieldValue('d_next'), ...takeaway].join(' ').length;
  const densityClass = getDensityClass(rankedCantieri.length, ipotesi.length, textLoad);

  document.getElementById('doc-page').className = `page ${densityClass}`;
  document.getElementById('doc-page').innerHTML = `
    <div class="doc-header">
      <div>
        <div class="doc-eyebrow">Discovery</div>
        <div class="doc-address">${indirizzo ? escapeHtml(indirizzo) : '<span class="slot">Indirizzo progetto</span>'}${citta ? `, ${escapeHtml(citta)}` : ''}</div>
      </div>
      <div class="doc-meta">
        <span class="zona">Micro-zona: ${escapeHtml(microzona || '—')}</span>
        <span>Macro-zona: ${escapeHtml(macrozona || '—')}</span>
        <span>Data: ${escapeHtml(data || '—')}</span>
        ${ciclo ? `<span><span class="badge ${cicloColor}">${escapeHtml(ciclo)}</span></span>` : ''}
      </div>
    </div>
    <div class="doc-section">
      <div class="doc-section-label">01 · Prezzi annunci</div>
      <div class="price-bar">
        <div class="ps"><div class="ps-label">€/mq medio</div><div class="ps-val">${formatNumber(mqMedio)}</div><div class="ps-sub">${escapeHtml(microzona || '—')}</div></div>
        <div class="ps"><div class="ps-label">€/mq 80° perc.</div><div class="ps-val">${formatNumber(mqP80)}</div><div class="ps-sub">asking alto</div></div>
        <div class="ps"><div class="ps-label">€/mq minimo</div><div class="ps-val">${formatNumber(mqMin)}</div><div class="ps-sub">fascia bassa</div></div>
        <div class="ps"><div class="ps-label">€/mq massimo</div><div class="ps-val">${formatNumber(mqMax)}</div><div class="ps-sub">fascia alta</div></div>
        <div class="ps accent"><div class="ps-label">€/mq Nostro BP</div><div class="ps-val">${formatNumber(mqBp)}</div><div class="ps-sub">target progetto</div></div>
      </div>
      ${(mOttMed || mBuoMed || mNorMed) ? `
      <table class="data-table">
        <thead><tr><th>Stato manutenzione</th><th>Minimo</th><th>Medio</th><th>Massimo</th></tr></thead>
        <tbody>
          ${mOttMed ? `<tr><td>Ottimo / Ristrutturato</td><td>${formatNumber(mOttMin)}</td><td><strong>${formatNumber(mOttMed)}</strong></td><td>${formatNumber(mOttMax)}</td></tr>` : ''}
          ${mBuoMed ? `<tr><td>Buono / Abitabile</td><td>${formatNumber(mBuoMin)}</td><td><strong>${formatNumber(mBuoMed)}</strong></td><td>${formatNumber(mBuoMax)}</td></tr>` : ''}
          ${mNorMed ? `<tr><td>Non ristrutturato</td><td>${formatNumber(mNorMin)}</td><td><strong>${formatNumber(mNorMed)}</strong></td><td>${formatNumber(mNorMax)}</td></tr>` : ''}
        </tbody>
      </table>` : ''}
      ${(l2Med || l3Med || l4Med) ? `
      <table class="data-table">
        <thead><tr><th>N° locali</th><th>Minimo</th><th>Medio</th><th>Massimo</th></tr></thead>
        <tbody>
          ${l2Med ? `<tr><td>2 locali</td><td>${formatNumber(l2Min)}</td><td><strong>${formatNumber(l2Med)}</strong></td><td>${formatNumber(l2Max)}</td></tr>` : ''}
          ${l3Med ? `<tr><td>3 locali</td><td>${formatNumber(l3Min)}</td><td><strong>${formatNumber(l3Med)}</strong></td><td>${formatNumber(l3Max)}</td></tr>` : ''}
          ${l4Med ? `<tr><td>4 locali</td><td>${formatNumber(l4Min)}</td><td><strong>${formatNumber(l4Med)}</strong></td><td>${formatNumber(l4Max)}</td></tr>` : ''}
        </tbody>
      </table>` : ''}
      ${scarto ? `<div class="sub-bar"><div class="sub-stat"><span class="sub-stat-label">Scarto asking/closing</span><span class="sub-stat-value">${escapeHtml(String(scarto))}%</span></div></div>` : ''}
      ${premiumText ? `<div class="premium-note"><strong>Premio / Deprezzamento:</strong> ${premiumText}</div>` : ''}
    </div>
    <div class="doc-section">
      <div class="doc-section-label">02 · Stock annunci</div>
      <div class="price-bar">
        ${stTot ? `<div class="ps"><div class="ps-label">Tot. annunci</div><div class="ps-val">${formatNumber(stTot)}</div><div class="ps-sub">attivi</div></div>` : ''}
        ${stAssorb ? `<div class="ps"><div class="ps-label">Indice assorb.</div><div class="ps-val">${escapeHtml(stAssorb)}</div><div class="ps-sub">mensile</div></div>` : ''}
        ${stTts ? `<div class="ps"><div class="ps-label">Time to sell</div><div class="ps-val">${escapeHtml(stTts)}</div><div class="ps-sub">stima</div></div>` : ''}
        ${stTempo ? `<div class="ps"><div class="ps-label">Tempo mercato</div><div class="ps-val">${escapeHtml(stTempo)}</div><div class="ps-sub">medio</div></div>` : ''}
      </div>
      ${(stNuovo || stOttimo || stBuono || stNor) ? `
      <table class="data-table">
        <thead><tr><th>Stato manutenzione</th><th>N° annunci</th></tr></thead>
        <tbody>
          ${stNuovo !== 0 ? `<tr><td>Nuovo / In costruzione</td><td><strong>${formatNumber(stNuovo)}</strong></td></tr>` : ''}
          ${stOttimo ? `<tr><td>Ottimo / Ristrutturato</td><td>${formatNumber(stOttimo)}</td></tr>` : ''}
          ${stBuono ? `<tr><td>Buono / Abitabile</td><td>${formatNumber(stBuono)}</td></tr>` : ''}
          ${stNor ? `<tr><td>Non ristrutturato</td><td>${formatNumber(stNor)}</td></tr>` : ''}
        </tbody>
      </table>` : ''}
      ${(st2l || st3l) ? `
      <table class="data-table">
        <thead><tr><th>N° locali</th><th>N° annunci</th></tr></thead>
        <tbody>
          ${st1l ? `<tr><td>1 locale</td><td>${formatNumber(st1l)}</td></tr>` : ''}
          ${st2l ? `<tr><td>2 locali</td><td>${formatNumber(st2l)}</td></tr>` : ''}
          ${st3l ? `<tr><td>3 locali</td><td><strong>${formatNumber(st3l)}</strong></td></tr>` : ''}
          ${st4l ? `<tr><td>4 locali</td><td>${formatNumber(st4l)}</td></tr>` : ''}
          ${st5l ? `<tr><td>5 locali</td><td>${formatNumber(st5l)}</td></tr>` : ''}
          ${st5p ? `<tr><td>Più di 5 locali</td><td>${formatNumber(st5p)}</td></tr>` : ''}
        </tbody>
      </table>` : ''}
    </div>
    <div class="doc-section">
      <div class="doc-section-label">03 · Domanda</div>
      <div class="price-bar">
        ${dRicerche ? `<div class="ps"><div class="ps-label">Quota ricerche</div><div class="ps-val">${escapeHtml(dRicerche)}</div><div class="ps-sub">zona</div></div>` : ''}
        ${dVisti ? `<div class="ps"><div class="ps-label">Quota ann. visti</div><div class="ps-val">${escapeHtml(dVisti)}</div><div class="ps-sub">&nbsp;</div></div>` : ''}
        ${dLead ? `<div class="ps"><div class="ps-label">Lead medi/ann.</div><div class="ps-val">${escapeHtml(dLead)}</div><div class="ps-sub">&nbsp;</div></div>` : ''}
        ${dConv ? `<div class="ps accent"><div class="ps-label">Tasso conversione</div><div class="ps-val">${escapeHtml(dConv)}</div><div class="ps-sub">&nbsp;</div></div>` : ''}
      </div>
      ${(d2l || d3l) ? `
      <table class="data-table">
        <thead><tr><th>N° locali ricercato</th><th>%</th><th>Tipo immobile</th><th>%</th></tr></thead>
        <tbody>
          <tr><td>1 locale</td><td>${d1l ? d1l + '%' : '—'}</td><td>Appartamento</td><td>${dApp ? dApp + '%' : '—'}</td></tr>
          <tr><td>2 locali</td><td>${d2l ? d2l + '%' : '—'}</td><td>Other / non spec.</td><td>${dOther ? dOther + '%' : '—'}</td></tr>
          <tr><td><strong>3 locali</strong></td><td><strong>${d3l ? d3l + '%' : '—'}</strong></td><td>Casa indipendente</td><td>${dCasa ? dCasa + '%' : '—'}</td></tr>
          <tr><td>4 locali</td><td>${d4l ? d4l + '%' : '—'}</td><td>Villa</td><td>${dVilla ? dVilla + '%' : '—'}</td></tr>
          <tr><td>5 locali</td><td>${d5l ? d5l + '%' : '—'}</td><td>Attico / Mansarda</td><td>${dAttico ? dAttico + '%' : '—'}</td></tr>
        </tbody>
      </table>` : ''}
      ${cLocali ? `
      <table class="data-table">
        <thead><tr><th>Caratteristica più cercata</th><th>%</th></tr></thead>
        <tbody>
          <tr><td>N. locali minimo</td><td>${cLocali}%</td></tr>
          ${cPiano ? `<tr><td>Piano specifico</td><td>${cPiano}%</td></tr>` : ''}
          ${cStato ? `<tr><td>Stato specifico</td><td>${cStato}%</td></tr>` : ''}
          ${cTerrazzo ? `<tr><td>Terrazzo / Balcone</td><td>${cTerrazzo}%</td></tr>` : ''}
          ${cTipologia ? `<tr><td>Tipologia specifica</td><td>${cTipologia}%</td></tr>` : ''}
          ${cBox ? `<tr><td>Box / Posto auto</td><td>${cBox}%</td></tr>` : ''}
          ${cGiardino ? `<tr><td>Giardino</td><td>${cGiardino}%</td></tr>` : ''}
        </tbody>
      </table>` : ''}
    </div>
    <div class="doc-section">
      <div class="doc-section-label">04 · Compravendite</div>
      <div class="price-bar">
        ${cvMed ? `<div class="ps accent"><div class="ps-label">€/mq medio CV</div><div class="ps-val">${formatNumber(cvMed)}</div><div class="ps-sub">${escapeHtml(microzona || '—')}</div></div>` : ''}
        ${cvRange ? `<div class="ps"><div class="ps-label">Range €/mq</div><div class="ps-val">${escapeHtml(cvRange)}</div><div class="ps-sub">min–max</div></div>` : ''}
        ${cvPrezzo ? `<div class="ps"><div class="ps-label">Prezzo medio</div><div class="ps-val">${escapeHtml(cvPrezzo)}</div><div class="ps-sub">per unità</div></div>` : ''}
        ${cvNtn ? `<div class="ps"><div class="ps-label">NTN</div><div class="ps-val">${escapeHtml(cvNtn)}</div><div class="ps-sub">transazioni</div></div>` : ''}
      </div>
      ${(cvA2Med || cvA3Med || cvA4Med) ? `
      <table class="data-table">
        <thead><tr><th>Categoria catastale</th><th>Minimo</th><th>Medio</th><th>Massimo</th></tr></thead>
        <tbody>
          ${cvA2Med ? `<tr><td>A2 · Civile</td><td>${formatNumber(cvA2Min)}</td><td><strong>${formatNumber(cvA2Med)}</strong></td><td>${formatNumber(cvA2Max)}</td></tr>` : ''}
          ${cvA3Med ? `<tr><td>A3 · Economico</td><td>${formatNumber(cvA3Min)}</td><td><strong>${formatNumber(cvA3Med)}</strong></td><td>${formatNumber(cvA3Max)}</td></tr>` : ''}
          ${cvA4Med ? `<tr><td>A4 · Popolare</td><td>${formatNumber(cvA4Min)}</td><td><strong>${formatNumber(cvA4Med)}</strong></td><td>${formatNumber(cvA4Max)}</td></tr>` : ''}
        </tbody>
      </table>` : ''}
    </div>
    <div class="doc-section">
      <div class="doc-section-label">05 · Metriche chiave</div>
      <div class="metriche-grid">${metricHtml}</div>
    </div>
    <div class="doc-section">
      <div class="doc-section-label">06 · Cantieri limitrofi</div>
      ${metricKpiHtml(competitorMetrics, mqBp)}
      ${mapHtml}
      <table class="comp-table">
        <thead>
          <tr>
            <th>Cantiere</th>
            <th>Indirizzo</th>
            <th>Zona</th>
            <th style="text-align:center">N°</th>
            <th>Start</th>
            <th>Tipologia</th>
            <th style="text-align:center">Sup.</th>
            <th style="text-align:right">€/mq</th>
            <th style="text-align:right">Delta BP</th>
            <th>Cl.E.</th>
            <th>Assorbimento</th>
          </tr>
        </thead>
        <tbody>${cantieriRows}</tbody>
      </table>
    </div>
    <div class="doc-section">
      <div class="doc-section-label">08 · Ipotesi di sviluppo</div>
      <div class="ipotesi-grid">${ipotesiHtml}</div>
    </div>
    <div class="doc-section">
      <div class="doc-section-label">09 · Takeaway</div>
      <div class="takeaway">${takeawayHtml}</div>
      <div class="val-grid">
        <div class="val-box"><div class="val-label">Timeline commercializzazione</div><div class="val-body">${valTimeline ? escapeHtml(valTimeline) : '<span class="slot">Da compilare</span>'}</div></div>
        <div class="val-box"><div class="val-label">Test di validazione layout</div><div class="val-body">${valTest ? escapeHtml(valTest) : '<span class="slot">Da compilare</span>'}</div></div>
      </div>
    </div>
    <div class="doc-section">
      <div class="doc-section-label">07 · Decisione operativa</div>
      ${getDecisionHtml()}
    </div>
    <div class="doc-footer">
      <span>${escapeHtml(indirizzo || '—')} · ${escapeHtml(microzona || '—')} · ${escapeHtml(macrozona || '—')}</span>
      <span>Benchmark cantieri comparabili</span>
      <span>Confidenziale — uso interno</span>
    </div>
  `;

  document.getElementById('input-panel').style.display = 'none';
  document.getElementById('doc-output').style.display = 'block';

  if (useLeafletMap) {
    renderLeafletMap(mapPoints);
  }

  persistFormState();
  window.scrollTo(0, 0);
}

function backToInput() {
  document.getElementById('doc-output').style.display = 'none';
  document.getElementById('input-panel').style.display = 'block';
  updateQualityUI();
  renderLivePanel();
  window.scrollTo(0, 0);
}

function scheduleRefresh() {
  updateQualityUI();
  renderLivePanel();
}

function initLaunchSequence() {
  const launch = document.getElementById('launch-screen');
  if (!launch) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visibleMs = reduceMotion ? 220 : 1600;
  const exitMs = reduceMotion ? 60 : 480;

  requestAnimationFrame(() => launch.classList.add('is-visible'));

  window.setTimeout(() => {
    document.body.classList.remove('app-loading');
    launch.classList.add('is-exit');
    window.setTimeout(() => launch.remove(), exitMs);
  }, visibleMs);
}

function initAutosave() {
  document.addEventListener('input', (event) => {
    if (!event.target.closest('#input-panel')) return;
    persistFormState();
    scheduleRefresh();
  });

  document.addEventListener('change', (event) => {
    if (!event.target.closest('#input-panel')) return;
    persistFormState();
    scheduleRefresh();
  });

  const archiveSelect = document.getElementById('archive-select');
  if (archiveSelect) {
    archiveSelect.addEventListener('change', (event) => {
      const nextId = event.target.value;
      loadProjectById(nextId);
    });
  }
}

window.addCantiere = addCantiere;
window.removeCantiere = removeCantiere;
window.addIpotesi = addIpotesi;
window.removeIpotesi = removeIpotesi;
window.generateDoc = generateDoc;
window.backToInput = backToInput;
window.createNewProject = createNewProject;
window.saveCurrentProject = saveCurrentProject;
window.duplicateProject = duplicateProject;
window.deleteCurrentProject = deleteCurrentProject;
window.applySmartSuggestions = applySmartSuggestions;
window.loadPrimaticcioSample = loadPrimaticcioSample;

initLaunchSequence();
loadArchive();
initAutosave();
if (!restoreActiveState()) {
  seedDefaultRows();
  saveCurrentProject();
}
updateQualityUI();
renderLivePanel();
