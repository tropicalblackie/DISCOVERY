const STORAGE_KEY = 'discovery-strategica-template-v2';
const EXPORT_VERSION = 2;
let cantiereCount = 0;
let ipCount = 0;

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

function buildStaticMapUrl(cantieriData) {
  const apiKey = getFieldValue('f_apikey');
  const indirizzo = getFieldValue('f_indirizzo');
  const citta = getFieldValue('f_citta');
  if (!apiKey || !indirizzo) return null;
  const projectAddr = encodeURIComponent((indirizzo + ', ' + citta).trim());
  const markers = cantieriData.filter((c) => c.addr).slice(0, 8).map((c, index) => `markers=color:0xb84a2e%7Clabel:${index + 1}%7C${encodeURIComponent(c.addr)}`).join('&');
  const projectMarker = `markers=color:0x236343%7Clabel:P%7C${projectAddr}`;
  return `https://maps.googleapis.com/maps/api/staticmap?size=1200x720&scale=2&maptype=roadmap&zoom=14&center=${projectAddr}&${projectMarker}&${markers}&key=${encodeURIComponent(apiKey)}`;
}

function buildFallbackMapHtml(cantieriData) {
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

  cantieriData.slice(0, 8).forEach((cantiere, index) => {
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
      <div class="map-fallback-badge">Vista schematica</div>
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
  const rowId = 'cantiere_' + cantiereCount;
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
  const defaultLabel = labels[ipCount - 1] || 'Ipotesi ' + ipCount;
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
}

function getIpotesiData() {
  return Array.from(document.querySelectorAll('#ipotesi-container .ipotesi-editor')).map((div, index) => ({
    num: index + 1,
    title: div.querySelector('.ip_title').value.trim(),
    body: div.querySelector('.ip_body').value.trim(),
    price: div.querySelector('.ip_price').value.trim()
  }));
}

function collectFormState() {
  const fields = Array.from(document.querySelectorAll('#input-panel input, #input-panel select, #input-panel textarea'));
  const values = {};
  fields.forEach((field) => {
    if (field.id) values[field.id] = field.value;
  });
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), values, cantieri: getCantieriData(), ipotesi: getIpotesiData() };
}

function persistFormState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectFormState()));
  } catch (error) {
    console.error('Impossibile salvare i dati in locale', error);
  }
}

function applyState(state) {
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
  if (!(state.cantieri || []).length && !(state.ipotesi || []).length) seedDefaultRows();
}

function restoreFormState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    applyState(JSON.parse(raw));
    return true;
  } catch (error) {
    console.error('Impossibile ripristinare i dati salvati', error);
    return false;
  }
}

function downloadJson() {
  const payload = JSON.stringify(collectFormState(), null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const slugBase = (getFieldValue('f_indirizzo') || 'discovery-strategica').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  link.href = url;
  link.download = `${slugBase || 'discovery-strategica'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importJsonFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const state = JSON.parse(String(event.target?.result || '{}'));
      applyState(state);
      persistFormState();
      if (document.getElementById('doc-output').style.display === 'block') generateDoc();
    } catch (error) {
      alert('Il file JSON non è valido.');
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  localStorage.removeItem(STORAGE_KEY);
  document.getElementById('doc-output').style.display = 'none';
  document.getElementById('input-panel').style.display = 'block';
  document.querySelectorAll('#input-panel input, #input-panel textarea').forEach((field) => {
    if (field.type === 'file') return;
    field.value = '';
  });
  document.querySelectorAll('#input-panel select').forEach((field) => {
    field.selectedIndex = 0;
  });
  document.getElementById('cantieri-tbody').innerHTML = '';
  document.getElementById('ipotesi-container').innerHTML = '';
  cantiereCount = 0;
  ipCount = 0;
  seedDefaultRows();
}

function seedDefaultRows() {
  for (let i = 0; i < 3; i += 1) addCantiere();
  for (let i = 0; i < 4; i += 1) addIpotesi();
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

function generateDoc() {
  const indirizzo = getFieldValue('f_indirizzo');
  const citta = getFieldValue('f_citta');
  const macrozona = getFieldValue('f_macrozona');
  const microzona = getFieldValue('f_microzona');
  const data = getFieldValue('f_data');
  const ciclo = getFieldValue('f_ciclo');
  const mqMilano = getNumberValue('f_mq_milano');
  const mqMacro = getNumberValue('f_mq_macro');
  const mqMicro = getNumberValue('f_mq_micro');
  const mqBp = getNumberValue('f_mq_bp');
  const mqNuovo = getNumberValue('f_mq_nuovo');
  const mqCv = getNumberValue('f_mq_cv');
  const scarto = getNumberValue('f_scarto');
  const premio = getFieldValue('f_premio');
  const deprezzo = getFieldValue('f_deprezzo');
  const metrics = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
    label: ['Rating di mercato', 'Prezzi annunci', 'Prezzi compravendite', 'Volumi di mercato', 'Stock disponibile', 'Efficienza energetica', 'Mix dimensionale'][i - 1],
    title: getFieldValue(`m${i}_title`),
    color: getFieldValue(`m${i}_color`),
    body: getFieldValue(`m${i}_body`)
  }));
  const cantieri = getCantieriData();
  const ipotesi = getIpotesiData();
  const takeaway = [getFieldValue('tw1'), getFieldValue('tw2'), getFieldValue('tw3')].filter(Boolean);
  const valTimeline = getFieldValue('val_timeline');
  const valTest = getFieldValue('val_test');
  const premiumText = buildPremiumText(mqBp, mqMicro, premio, deprezzo);
  const competitorMetrics = generateCompetitorMetrics(cantieri, mqBp);
  const staticMapUrl = buildStaticMapUrl(cantieri);
  const metricHtml = metrics.map((metric) => `
    <div class="mc ${metric.color === 'neutral' ? '' : escapeHtml(metric.color)}">
      <div class="mc-label">${escapeHtml(metric.label)}</div>
      <div class="mc-rating">${metric.title ? escapeHtml(metric.title) : '<span class="slot">—</span>'}</div>
      <div class="mc-body">${escapeHtml(metric.body)}</div>
    </div>
  `).join('');
  const mapVisual = staticMapUrl
    ? `<img class="map-static" src="${staticMapUrl}" alt="Mappa comparabili e progetto">`
    : buildFallbackMapHtml(cantieri);
  const mapHtml = `
    <div class="map-layout">
      <div id="map-container">${mapVisual}</div>
      <div class="map-side">
        <div class="map-side-panel">
          <div class="map-legend-title">Legenda</div>
          <div class="legend-item"><span class="legend-pin project">P</span>Progetto in analisi</div>
          ${cantieri.filter((c) => c.addr).slice(0, 8).map((c, index) => `<div class="legend-item"><span class="legend-pin comp">${index + 1}</span>${escapeHtml(c.nome || 'Comparabile')} · ${escapeHtml(c.zona || 'zona n.d.')}</div>`).join('') || '<div class="legend-item">Aggiungi un indirizzo per posizionarlo sulla mappa</div>'}
        </div>
        <div class="map-side-panel">
          <div class="map-legend-title">Insight rapidi</div>
          <div class="insight-item">Prezzo medio comparabili: <strong>${formatNumber(competitorMetrics.avgPrice)}</strong> €/mq</div>
          <div class="insight-item">Range osservato: <strong>${formatNumber(competitorMetrics.minPrice)}</strong> - <strong>${formatNumber(competitorMetrics.maxPrice)}</strong> €/mq</div>
          <div class="insight-item">BP progetto vs media competitor: <strong>${competitorMetrics.avgPrice && mqBp ? `${competitorMetrics.deltaVsComp > 0 ? '+' : ''}${competitorMetrics.deltaVsComp.toFixed(1)}%` : 'n.d.'}</strong></div>
        </div>
      </div>
    </div>
  `;
  const cantieriRows = cantieri.length ? cantieri.map((c) => `
      <tr>
        <td><strong>${escapeHtml(c.nome || '—')}</strong></td>
        <td>${escapeHtml(c.addr || '—')}</td>
        <td>${escapeHtml(c.zona || '—')}</td>
        <td style="text-align:center; font-family:var(--mono);">${escapeHtml(c.unita || '—')}</td>
        <td style="font-family:var(--mono);">${escapeHtml(c.inizio || '—')}</td>
        <td>${escapeHtml(c.tipo || '—')}</td>
        <td style="text-align:center; font-family:var(--mono);">${escapeHtml(c.sup || '—')}</td>
        <td style="text-align:right;">${colorMq(c.mq, mqMicro || mqMacro)}</td>
        <td style="text-align:right;">${deltaTag(c.mq, mqBp || mqMicro || mqMacro)}</td>
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
  document.getElementById('doc-page').innerHTML = `
    <div class="doc-header">
      <div>
        <div class="doc-eyebrow">Discovery Strategica · Executive Summary</div>
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
      <div class="doc-section-label">01 · Analisi di Mercato — Posizionamento €/mq</div>
      <div class="price-bar">
        <div class="ps"><div class="ps-label">€/mq Milano</div><div class="ps-val">${formatNumber(mqMilano)}</div><div class="ps-sub">Riferimento città</div></div>
        <div class="ps"><div class="ps-label">€/mq Macro-zona</div><div class="ps-val">${formatNumber(mqMacro)}</div><div class="ps-sub">${escapeHtml(macrozona || '—')}</div></div>
        <div class="ps"><div class="ps-label">€/mq Micro-zona</div><div class="ps-val">${formatNumber(mqMicro)}</div><div class="ps-sub">${escapeHtml(microzona || '—')}</div></div>
        <div class="ps accent"><div class="ps-label">€/mq Nostro BP</div><div class="ps-val">${formatNumber(mqBp)}</div><div class="ps-sub">Target di progetto</div></div>
      </div>
      ${(mqCv || mqNuovo || scarto) ? `<div class="sub-bar">${mqCv ? `<div class="sub-stat"><span class="sub-stat-label">€/mq compravenduto</span><span class="sub-stat-value">${formatNumber(mqCv)}</span></div>` : ''}${mqNuovo ? `<div class="sub-stat"><span class="sub-stat-label">€/mq nuovo/in costr.</span><span class="sub-stat-value">${formatNumber(mqNuovo)}</span></div>` : ''}${scarto ? `<div class="sub-stat"><span class="sub-stat-label">Scarto asking/closing</span><span class="sub-stat-value">${escapeHtml(String(scarto))}%</span></div>` : ''}</div>` : ''}
      ${premiumText ? `<div class="premium-note"><strong>Premio / Deprezzamento:</strong> ${premiumText}</div>` : ''}
    </div>
    <div class="doc-section">
      <div class="doc-section-label">02 · Le 7 Metriche Chiave</div>
      <div class="metriche-grid">${metricHtml}</div>
    </div>
    <div class="doc-section">
      <div class="doc-section-label">03 · Cantieri Limitrofi — Contesto Competitivo</div>
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
      <div class="doc-section-label">04 · Ipotesi di Sviluppo Data-Driven</div>
      <div class="ipotesi-grid">${ipotesiHtml}</div>
    </div>
    <div class="doc-section">
      <div class="doc-section-label">05 · Takeaway Strategici e Test di Validazione</div>
      <div class="takeaway">${takeawayHtml}</div>
      <div class="val-grid">
        <div class="val-box"><div class="val-label">Timeline commercializzazione</div><div class="val-body">${valTimeline ? escapeHtml(valTimeline) : '<span class="slot">Da compilare</span>'}</div></div>
        <div class="val-box"><div class="val-label">Test di validazione layout</div><div class="val-body">${valTest ? escapeHtml(valTest) : '<span class="slot">Da compilare</span>'}</div></div>
      </div>
    </div>
    <div class="doc-footer">
      <span>${escapeHtml(indirizzo || '—')} · ${escapeHtml(microzona || '—')} · ${escapeHtml(macrozona || '—')}</span>
      <span>Benchmark cantieri comparabili</span>
      <span>Confidenziale — uso interno</span>
    </div>
  `;
  document.getElementById('input-panel').style.display = 'none';
  document.getElementById('doc-output').style.display = 'block';
  persistFormState();
  window.scrollTo(0, 0);
}

function backToInput() {
  document.getElementById('doc-output').style.display = 'none';
  document.getElementById('input-panel').style.display = 'block';
  window.scrollTo(0, 0);
}

function initAutosave() {
  document.addEventListener('input', (event) => {
    if (event.target.closest('#input-panel')) persistFormState();
  });
  document.addEventListener('change', (event) => {
    if (event.target.closest('#input-panel')) persistFormState();
  });
}

function initImportExport() {
  const exportButton = document.getElementById('export-json-btn');
  const importButton = document.getElementById('import-json-btn');
  const importInput = document.getElementById('import-json-input');
  exportButton?.addEventListener('click', downloadJson);
  importButton?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) importJsonFile(file);
    event.target.value = '';
  });
}

initAutosave();
initImportExport();
if (!restoreFormState()) seedDefaultRows();