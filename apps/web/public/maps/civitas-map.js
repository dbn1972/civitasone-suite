/*
 * CivitasMap bootstrap. Loaded by the map iframe (apps/web/src/app/_components/maps/CivitasMap.tsx)
 * as a same-origin script so the page CSP (script-src 'self' + nonce, no inline script) allows it.
 * It reads its inputs from <script type="application/json" id="civitas-map-config"> -- a data
 * block that is never executed -- so nothing from the database is ever interpreted as code.
 */
(function () {
  function fail(reason) {
    window.parent.postMessage({ type: 'map-error', reason: reason }, '*');
  }
  var cfgEl = document.getElementById('civitas-map-config');
  var cfg;
  try { cfg = JSON.parse(cfgEl ? cfgEl.textContent : ''); } catch (e) { fail('config'); return; }
  if (typeof L === 'undefined') { fail('script'); return; }

  var map = L.map('map', {
    center: [cfg.center.lat, cfg.center.lng],
    zoom: cfg.zoom,
    keyboard: true,
    zoomControl: true,
    attributionControl: true
  });

  var tilesLoaded = 0;
  var tileErrors = 0;
  var base = L.tileLayer(cfg.tileUrl, {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  });
  base.on('tileload', function () { tilesLoaded += 1; });
  base.on('tileerror', function () {
    tileErrors += 1;
    if (tilesLoaded === 0 && tileErrors >= 4) fail('tiles');
  });
  base.addTo(map);

  // GIS overlay layers (tile / wms / geojson), ordered by zIndex.
  (cfg.layers || []).forEach(function (layer) {
    try {
      var style = layer.styleJson || {};
      if (layer.sourceType === 'tile') {
        L.tileLayer(layer.url, Object.assign({ zIndex: layer.zIndex, maxZoom: 19 }, style)).addTo(map);
      } else if (layer.sourceType === 'wms') {
        L.tileLayer.wms(layer.url, Object.assign(
          { format: 'image/png', transparent: true, zIndex: layer.zIndex },
          style
        )).addTo(map);
      } else if (layer.sourceType === 'geojson') {
        fetch(layer.url).then(function (r) { return r.json(); }).then(function (data) {
          L.geoJSON(data, {
            style: style,
            onEachFeature: function (feature, lyr) {
              var name = (feature.properties && (feature.properties.name || feature.properties.label));
              if (name) lyr.bindPopup(String(name));
            }
          }).addTo(map);
        }).catch(function () { /* best-effort: bad/blocked GeoJSON source is non-fatal */ });
      }
    } catch (e) { /* one bad layer must not break the map */ }
  });

  (cfg.markers || []).forEach(function (m) {
    var marker = L.marker([m.lat, m.lng], {
      title: m.label || '',
      alt: m.label || 'Map marker at ' + m.lat.toFixed(4) + ', ' + m.lng.toFixed(4),
      keyboard: true
    }).addTo(map);

    // Built with textContent: marker labels come from the database and must
    // never be interpreted as HTML.
    var popup = document.createElement('div');
    popup.className = 'marker-popup';
    function addLine(tag, text) {
      var el = document.createElement(tag);
      el.textContent = text;
      popup.appendChild(el);
    }
    if (m.label) addLine('h3', String(m.label));
    if (m.description) addLine('p', String(m.description));
    addLine('p', '(' + m.lat.toFixed(6) + ', ' + m.lng.toFixed(6) + ')');
    marker.bindPopup(popup);

    marker.on('click', function () {
      window.parent.postMessage({ type: 'marker-click', marker: m }, '*');
    });
  });

  // Keyboard zoom controls
  document.addEventListener('keydown', function (e) {
    if (e.key === '+' || e.key === '=') map.zoomIn();
    if (e.key === '-') map.zoomOut();
  });
})();
