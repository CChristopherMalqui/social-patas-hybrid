(function () {
  /* ============================================================
     Cliente de Supabase
  ============================================================ */
  var cfg = window.SP_CONFIG || {};
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf('PEGA_AQUI') === 0) {
    document.body.innerHTML = '<div style="max-width:520px;margin:60px auto;padding:24px;font-family:sans-serif;line-height:1.6">' +
      '<h2>⚙️ Falta configurar Supabase</h2>' +
      '<p>Abre <b>config.js</b> y pega tu <b>Project URL</b> y tu <b>clave publicable</b>. ' +
      'Sigue los pasos del archivo <b>contexto/SETUP.md</b>.</p></div>';
    return;
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  /*
    ============================================================
     app.js = la LÓGICA (qué pasa al tocar cada botón)
    ------------------------------------------------------------
     Lo más útil para personalizar está señalado con  ⚙️  abajo:
       • TYPES  -> los tipos de actividad (Running, Gym, etc.)
       • EMOJIS -> los emojis del selector de comentarios
       • Ubicación inicial del mapa (busca "Lima por defecto")
       • Calidad/tamaño de las fotos (busca "compressImage")
     El resto es el motor de la app; cámbialo con cuidado.
    ============================================================
  */

  // ⚙️ TIPOS DE ACTIVIDAD. 'label' = lo que se ve; 'icon' = ícono de tabler.io/icons.
  //    La CLAVE de la izquierda (run, gym...) debe coincidir con los <option value="...">
  //    del index.html. Puedes cambiar los textos/íconos o agregar tipos nuevos.
  var TYPES = {
    run:   { label: 'Running',    icon: 'ti-run' },
    gym:   { label: 'Gym',        icon: 'ti-barbell' },
    cali:  { label: 'Calistenia', icon: 'ti-stretching' },
    walk:  { label: 'Caminata',   icon: 'ti-walk' },
    other: { label: 'Otro',       icon: 'ti-bolt' }
  };

  var state = { plans: [], log: [], routes: [], posts: [], me: '', userId: null, authEmail: '', isAdmin: false, profiles: [], profilesById: {}, profile: null };
  var pendingPhoto = null;   // blob de la foto comprimida, lista para subir
  var openComments = {};     // qué publicaciones tienen los comentarios abiertos
  var commentDrafts = {};    // borradores de comentarios (no se pierden al refrescar)
  var currentView = 'semana';

  /* ---------- Helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(d) {
    if (!d) return '';
    var dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtRel(iso) {
    var dt = new Date(iso);
    var diff = (Date.now() - dt.getTime()) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return Math.round(diff / 60) + ' min';
    if (diff < 86400) return 'hace ' + Math.round(diff / 3600) + ' h';
    if (diff < 86400 * 7) return 'hace ' + Math.round(diff / 86400) + ' d';
    return dt.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
  }
  function countdown(date, time) {
    var target = new Date(date + 'T' + (time || '09:00') + ':00').getTime();
    var diff = target - Date.now();
    var soon = diff >= 0 && diff < 86400000 * 2;
    var label;
    if (diff < 0) label = 'pasó';
    else if (diff < 3600000) label = 'en ' + Math.max(1, Math.round(diff / 60000)) + ' min';
    else if (diff < 86400000) label = 'en ' + Math.round(diff / 3600000) + ' h';
    else { var days = Math.round(diff / 86400000); label = days === 1 ? 'mañana' : 'en ' + days + ' días'; }
    return { label: label, soon: soon };
  }
  function pill(type) {
    var t = TYPES[type] || TYPES.other;
    return '<span class="pill"><i class="ti ' + t.icon + '" aria-hidden="true"></i> ' + t.label + '</span>';
  }

  /* ---------- Avatares ---------- */
  function avatarUrl(path) { return path ? sb.storage.from('avatars').getPublicUrl(path).data.publicUrl : null; }
  function avatarOf(uid) {
    var pr = state.profilesById[uid] || {};
    var name = pr.name || '';
    return { url: pr.avatar_path ? avatarUrl(pr.avatar_path) : null, name: name, initial: (name || '?').trim().charAt(0).toUpperCase() || '🐾' };
  }
  function avatarHtml(uid, size) {
    var a = avatarOf(uid);
    if (a.url) return '<img class="avatar ' + (size || 'av-md') + '" src="' + esc(a.url) + '" alt="" />';
    return '<span class="avatar avatar-ph ' + (size || 'av-md') + '">' + esc(a.initial) + '</span>';
  }
  // Cabecera "bonita" de una publicación: avatar + nombre + tiempo (clic = ver perfil).
  function authorHead(uid, authorName, created) {
    return '<div class="post-head" data-profile="' + uid + '">' +
      avatarHtml(uid, 'av-md') +
      '<div class="ph-info">' +
        '<span class="ph-name">' + esc(authorName || 'alguien') + '</span>' +
        '<span class="ph-time">' + esc(fmtRel(created)) + '</span>' +
      '</div>' +
    '</div>';
  }

  /* ---------- Toast ---------- */
  function toast(msg, icon) {
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<i class="ti ' + (icon || 'ti-check') + '"></i>' + esc(msg);
    box.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 250); }, 2400);
  }

  /* ---------- Confetti ---------- */
  function confetti(x, y) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = ['#1f7d3e', '#38a85c', '#185fa5', '#d4af37', '#6fd089'];
    for (var i = 0; i < 18; i++) {
      var p = document.createElement('div');
      p.className = 'confetti';
      p.style.background = colors[i % colors.length];
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      document.body.appendChild(p);
      var ang = Math.random() * Math.PI * 2;
      var dist = 40 + Math.random() * 90;
      var dx = Math.cos(ang) * dist;
      var dy = Math.sin(ang) * dist - 40;
      p.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + (dy + 120) + 'px) rotate(' + (Math.random() * 720 - 360) + 'deg)', opacity: 0 }
      ], { duration: 750 + Math.random() * 400, easing: 'cubic-bezier(.2,.6,.4,1)' }).onfinish = function () { this.effect.target.remove(); };
    }
  }
  function confettiFrom(elem) { var r = elem.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2); }

  /* ---------- Conteo animado ---------- */
  function animateNum(el, to) {
    var from = parseInt(el.textContent, 10) || 0;
    if (from === to) { el.textContent = to; return; }
    var start = null, dur = 500;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / dur, 1);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function renderStats() {
    var cutoff = Date.now() - 86400000;
    var weekPlans = state.plans.filter(function (p) { return new Date(p.date + 'T' + (p.time || '23:59')).getTime() >= cutoff; });
    var joins = weekPlans.reduce(function (n, p) { return n + ((p.joining || []).length); }, 0);
    var vals = { plans: weekPlans.length, logs: state.log.length, routes: state.routes.length, joins: joins };
    Object.keys(vals).forEach(function (k) { var el = document.querySelector('[data-stat="' + k + '"]'); if (el) animateNum(el, vals[k]); });
  }

  // Botón de borrar: aparece en lo propio, o en TODO si eres admin (moderación).
  function delBtn(attr, ownerId) {
    if (ownerId !== state.userId && !state.isAdmin) return '';
    return '<button class="del" data-' + attr + ' aria-label="Eliminar"><i class="ti ti-x"></i></button>';
  }

  /* ============================================================
     RENDER de cada lista
  ============================================================ */
  function renderPlans() {
    var el = $('plan-list');
    var cutoff = Date.now() - 86400000;
    var upcoming = state.plans
      .filter(function (p) { return new Date(p.date + 'T' + (p.time || '23:59')).getTime() >= cutoff; })
      .sort(function (a, b) { return (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')); });
    if (upcoming.length === 0) { el.innerHTML = '<div class="empty">Nada propuesto todavía. Sé el primero.</div>'; return; }
    el.innerHTML = upcoming.map(function (p, i) {
      var joining = p.joining || [];
      var isIn = joining.some(function (j) { return j.user_id === state.userId; });
      var cd = countdown(p.date, p.time);
      return '<div class="card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="meta">' + pill(p.type) +
        '<span>' + esc(fmtDate(p.date)) + (p.time ? ' · ' + esc(p.time) : '') + '</span>' +
        '<span class="countdown' + (cd.soon ? ' soon' : '') + '"><i class="ti ti-clock-hour-4"></i>' + esc(cd.label) + '</span>' +
        '<span class="author" data-profile="' + p.user_id + '">Propuso ' + esc(p.author || 'alguien') + '</span>' +
        delBtn('del-plan="' + p.id + '"', p.user_id) +
        '</div>' +
        (p.place ? '<div class="where">' + esc(p.place) + '</div>' : '') +
        (p.notes ? '<div class="notes">' + esc(p.notes) + '</div>' : '') +
        '<div class="joiners">' +
          joining.map(function (j) { return '<span class="chip">' + esc(j.name) + '</span>'; }).join('') +
          '<button class="join-btn ' + (isIn ? 'in' : '') + '" data-join="' + p.id + '">' + (isIn ? '− me bajo' : '+ me apunto') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderLog() {
    var el = $('log-list');
    if (state.log.length === 0) { el.innerHTML = '<div class="empty">La bitácora está en blanco. Después del próximo entreno, cuéntalo aquí.</div>'; return; }
    el.innerHTML = state.log.map(function (e, i) {
      return '<div class="card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="post-top">' +
          authorHead(e.user_id, e.author, e.created) +
          delBtn('del-log="' + e.id + '"', e.user_id) +
        '</div>' +
        '<div class="meta" style="margin:0 0 4px">' + pill(e.type) + '</div>' +
        '<p class="note-serif">' + esc(e.content) + '</p>' +
      '</div>';
    }).join('');
  }

  function renderRoutes() {
    var el = $('route-list');
    if (state.routes.length === 0) { el.innerHTML = '<div class="empty">Aún no hay rutas guardadas. Agrega ese lugar bueno que solo ustedes conocen.</div>'; return; }
    el.innerHTML = state.routes.map(function (r, i) {
      var hasGeo = r.lat != null && r.lng != null;
      return '<div class="card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="meta">' + pill(r.type) +
        (r.dist ? '<span>' + esc(r.dist) + '</span>' : '') +
        '<span class="author" data-profile="' + r.user_id + '">' + esc(r.author || 'alguien') + '</span>' +
        delBtn('del-route="' + r.id + '"', r.user_id) +
        '</div>' +
        '<div class="where">' + esc(r.name) + '</div>' +
        (r.notes ? '<div class="notes">' + esc(r.notes) + '</div>' : '') +
        (hasGeo
          ? '<div class="route-map" data-lat="' + r.lat + '" data-lng="' + r.lng + '"></div>' +
            '<div class="route-links"><a class="map-link" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + r.lat + ',' + r.lng + '"><i class="ti ti-external-link"></i> Ver en Google Maps</a></div>'
          : '') +
      '</div>';
    }).join('');
    if (currentView === 'rutas') setTimeout(initRouteMaps, 30);
  }

  function renderPosts() {
    var el = $('post-list');
    if (!el) return;
    if (state.posts.length === 0) { el.innerHTML = '<div class="empty">El muro está vacío. Sube la primera foto de la jauría.</div>'; return; }
    el.innerHTML = state.posts.map(function (p, i) {
      var reacted = p.reactions.some(function (r) { return r.user_id === state.userId; });
      var comments = p.comments.map(function (c) {
        var canDel = c.user_id === state.userId || state.isAdmin;
        return '<div class="comment">' +
          '<div class="c-body">' +
            '<span class="c-author">' + esc(c.author || 'alguien') + '</span>' +
            '<span class="c-time">' + esc(fmtRel(c.created)) + '</span>' +
            '<div class="c-text">' + esc(c.content) + '</div>' +
          '</div>' +
          (canDel ? '<button class="c-del" data-del-comment="' + c.id + '" aria-label="borrar"><i class="ti ti-x"></i></button>' : '') +
        '</div>';
      }).join('');
      var draft = commentDrafts[p.id] || '';
      return '<div class="card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="post-top">' +
          authorHead(p.user_id, p.author, p.created) +
          delBtn('del-post="' + p.id + '"', p.user_id) +
        '</div>' +
        '<img class="post-img" src="' + esc(publicUrl(p.image_path)) + '" alt="" loading="lazy" data-zoom="' + esc(publicUrl(p.image_path)) + '" />' +
        (p.caption ? '<p class="post-caption">' + esc(p.caption) + '</p>' : '') +
        '<div class="post-actions">' +
          '<button class="react-btn ' + (reacted ? 'on' : '') + '" data-react="' + p.id + '">🔥 <span class="rcount">' + p.reactions.length + '</span></button>' +
          '<button class="comment-btn" data-comments="' + p.id + '"><i class="ti ti-message-circle"></i> ' + p.comments.length + '</button>' +
        '</div>' +
        '<div class="comments' + (openComments[p.id] ? ' open' : '') + '" id="comments-' + p.id + '">' +
          comments +
          '<div class="comment-form">' +
            '<input type="text" id="cinput-' + p.id + '" placeholder="Escribe un comentario..." maxlength="500" value="' + esc(draft) + '" />' +
            '<button class="emoji-btn" type="button" data-emoji="' + p.id + '" aria-label="emojis">😊</button>' +
            '<button data-comment-send="' + p.id + '" aria-label="enviar"><i class="ti ti-send"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderAll() { renderPlans(); renderLog(); renderRoutes(); renderStats(); }

  /* ============================================================
     CARGA desde la nube
  ============================================================ */
  async function loadPlans() {
    var res = await sb.from('plans')
      .select('id, user_id, author, date, time, type, place, notes, created, plan_joins(user_id, name)')
      .order('date', { ascending: true });
    if (res.error) { console.error(res.error); return; }
    state.plans = (res.data || []).map(function (p) { p.joining = p.plan_joins || []; return p; });
    renderPlans(); renderStats(); renderAdmin();
  }
  async function loadLog() {
    var res = await sb.from('logs').select('*').order('created', { ascending: false });
    if (res.error) { console.error(res.error); return; }
    state.log = res.data || [];
    renderLog(); renderStats(); renderAdmin();
  }
  async function loadRoutes() {
    var res = await sb.from('routes').select('*').order('created', { ascending: false });
    if (res.error) { console.error(res.error); return; }
    state.routes = res.data || [];
    renderRoutes(); renderStats(); renderAdmin();
  }
  async function loadPosts() {
    var res = await sb.from('posts')
      .select('id, user_id, author, caption, image_path, created, post_reactions(user_id, name), post_comments(id, user_id, author, content, created)')
      .order('created', { ascending: false });
    if (res.error) { console.error(res.error); return; }
    state.posts = (res.data || []).map(function (p) {
      p.reactions = p.post_reactions || [];
      p.comments = (p.post_comments || []).slice().sort(function (a, b) { return a.created.localeCompare(b.created); });
      return p;
    });
    renderPosts(); renderAdmin();
  }
  function loadAll() { loadPlans(); loadLog(); loadRoutes(); loadPosts(); }

  /* ============================================================
     MURO: foto, compresión, 🔥, comentarios
  ============================================================ */
  function fileId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function publicUrl(path) { return sb.storage.from('posts').getPublicUrl(path).data.publicUrl; }

  function compressImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (blob) { URL.revokeObjectURL(img.src); blob ? resolve(blob) : reject(new Error('fallo')); }, 'image/jpeg', quality);
      };
      img.onerror = function () { reject(new Error('Imagen inválida')); };
      img.src = URL.createObjectURL(file);
    });
  }

  function resetPostForm() {
    pendingPhoto = null;
    $('post-file').value = '';
    $('post-caption').value = '';
    $('post-preview').hidden = true;
    $('post-preview-img').src = '';
    $('post-drop-text').textContent = 'Elige una foto';
  }

  function wirePosts() {
    $('post-toggle').onclick = function () { toggle('post-form'); };
    $('post-cancel').onclick = function () { resetPostForm(); toggle('post-form', false); };

    $('post-file').onchange = async function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Elige una imagen', 'ti-photo'); return; }
      try {
        // ⚙️ Calidad de la foto: (archivo, máximo de píxeles del lado largo, calidad 0–1).
        //    1280 y 0.8 da buena calidad pesando poco (~300 KB). Sube los números = más calidad y peso.
        pendingPhoto = await compressImage(file, 1280, 0.8);
        $('post-preview-img').src = URL.createObjectURL(pendingPhoto);
        $('post-preview').hidden = false;
        $('post-drop-text').textContent = 'Cambiar foto';
      } catch (e) { toast('No se pudo leer la imagen 😕', 'ti-alert-circle'); console.error(e); }
    };

    $('post-save').onclick = async function (ev) {
      if (!pendingPhoto) { toast('Primero elige una foto', 'ti-camera'); return; }
      var btn = ev.currentTarget; btn.disabled = true;
      var path = state.userId + '/' + fileId() + '.jpg';
      var up = await sb.storage.from('posts').upload(path, pendingPhoto, { contentType: 'image/jpeg', upsert: false });
      if (up.error) { btn.disabled = false; toast('No se pudo subir la foto 😕', 'ti-alert-circle'); console.error(up.error); return; }
      var ins = await sb.from('posts').insert({ user_id: state.userId, author: state.me, caption: $('post-caption').value.trim() || null, image_path: path });
      btn.disabled = false;
      if (ins.error) { await sb.storage.from('posts').remove([path]); toast('No se pudo publicar 😕', 'ti-alert-circle'); console.error(ins.error); return; }
      resetPostForm(); toggle('post-form', false);
      await loadPosts(); confettiFrom(btn); toast('¡Foto publicada! 📸', 'ti-photo');
    };

    // Guarda el borrador de cada comentario para que no se pierda al refrescar.
    document.body.addEventListener('input', function (ev) {
      var inp = ev.target;
      if (inp && inp.id && inp.id.indexOf('cinput-') === 0) commentDrafts[inp.id.slice(7)] = inp.value;
    });
    // Enviar comentario con Enter.
    document.body.addEventListener('keydown', function (ev) {
      var inp = ev.target.closest && ev.target.closest('input[id^="cinput-"]');
      if (inp && ev.key === 'Enter') {
        ev.preventDefault();
        var btn = document.querySelector('[data-comment-send="' + inp.id.slice(7) + '"]');
        if (btn) btn.click();
      }
    });
  }

  /* ---------- Selector de emojis ---------- */
  // ⚙️ EMOJIS del selector (al costado de enviar comentario). Agrega/quita los que quieras.
  var EMOJIS = ['🔥', '💪', '👏', '😂', '😍', '🙌', '🥵', '🏃', '🏋️', '🚶', '🤙', '✅', '❤️', '😎', '🎉', '👀', '🥇', '😅', '🙏', '💀', '🤔', '😤', '🦵', '⚡'];
  var emojiPanel = null, emojiTargetId = null;
  function openEmoji(btn, postId) {
    emojiTargetId = postId;
    if (!emojiPanel) {
      emojiPanel = document.createElement('div');
      emojiPanel.className = 'emoji-panel';
      emojiPanel.innerHTML = EMOJIS.map(function (e) { return '<button type="button">' + e + '</button>'; }).join('');
      emojiPanel.addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        var input = $('cinput-' + emojiTargetId); if (!input) return;
        input.value += b.textContent;
        commentDrafts[emojiTargetId] = input.value;
        input.focus();
      });
      document.body.appendChild(emojiPanel);
      document.addEventListener('click', function (ev) {
        if (emojiPanel.style.display === 'grid' && !emojiPanel.contains(ev.target) && !ev.target.closest('[data-emoji]')) emojiPanel.style.display = 'none';
      });
    }
    emojiPanel.style.display = 'grid';
    var r = btn.getBoundingClientRect();
    var ph = emojiPanel.offsetHeight || 150, pw = 232;
    var top = r.top - ph - 6; if (top < 8) top = r.bottom + 6;
    var left = Math.min(r.left, window.innerWidth - pw - 8); if (left < 8) left = 8;
    emojiPanel.style.top = top + 'px';
    emojiPanel.style.left = left + 'px';
  }

  /* ============================================================
     MAPAS (Leaflet)
  ============================================================ */
  var pickerMap = null, pickerMarker = null;
  function ensurePicker() {
    if (!window.L) return;
    if (pickerMap) { setTimeout(function () { pickerMap.invalidateSize(); }, 80); return; }
    var c = $('route-picker-map');
    // ⚙️ Ubicación inicial del mapa: [latitud, longitud], zoom. Ahora está en Lima, Perú.
    //    Cambia estos números para centrarlo en tu ciudad (búscala en Google Maps).
    pickerMap = L.map(c).setView([-12.0464, -77.0428], 12); // Lima por defecto
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(pickerMap);
    pickerMap.on('click', function (e) { setPicker(e.latlng.lat, e.latlng.lng); });
    setTimeout(function () { pickerMap.invalidateSize(); }, 80);
  }
  function setPicker(lat, lng) {
    $('route-lat').value = lat;
    $('route-lng').value = lng;
    if (pickerMarker) pickerMarker.setLatLng([lat, lng]);
    else if (window.L) pickerMarker = L.marker([lat, lng]).addTo(pickerMap);
    $('route-picker-hint').textContent = 'Punto marcado ✓';
  }
  function clearPicker() {
    $('route-lat').value = '';
    $('route-lng').value = '';
    if (pickerMarker && pickerMap) { pickerMap.removeLayer(pickerMarker); pickerMarker = null; }
    $('route-picker-hint').textContent = 'Toca el mapa para marcar';
  }
  function initRouteMaps() {
    if (!window.L) return;
    document.querySelectorAll('.route-map[data-lat]:not(.ready)').forEach(function (div) {
      var lat = parseFloat(div.dataset.lat), lng = parseFloat(div.dataset.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      div.classList.add('ready');
      var m = L.map(div, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false }).setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
      L.marker([lat, lng]).addTo(m);
      setTimeout(function () { m.invalidateSize(); }, 60);
    });
  }

  /* ============================================================
     Formularios
  ============================================================ */
  function toggle(id, open) {
    var f = $(id);
    var btnMap = { 'plan-form': 'plan-toggle', 'log-form': 'log-toggle', 'route-form': 'route-toggle', 'post-form': 'post-toggle' };
    var willOpen = open == null ? !f.classList.contains('open') : open;
    f.classList.toggle('open', willOpen);
    var btn = $(btnMap[id]);
    if (btn) btn.classList.toggle('open', willOpen);
  }

  function resetRouteForm() {
    ['route-name', 'route-dist', 'route-notes'].forEach(function (id) { $(id).value = ''; });
    clearPicker();
  }

  function wireForms() {
    $('plan-toggle').onclick = function () { toggle('plan-form'); };
    $('plan-cancel').onclick = function () { toggle('plan-form', false); };
    $('log-toggle').onclick = function () { toggle('log-form'); };
    $('log-cancel').onclick = function () { toggle('log-form', false); };
    $('route-toggle').onclick = function () { toggle('route-form'); ensurePicker(); };
    $('route-cancel').onclick = function () { resetRouteForm(); toggle('route-form', false); };

    $('route-locate').onclick = function () {
      if (!navigator.geolocation) { toast('Tu navegador no da ubicación', 'ti-map-pin'); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (pickerMap) pickerMap.setView([lat, lng], 16);
        setPicker(lat, lng);
      }, function () { toast('No se pudo obtener tu ubicación', 'ti-map-pin'); });
    };

    $('plan-save').onclick = async function (ev) {
      var date = $('plan-date').value;
      if (!date) { toast('Elige una fecha', 'ti-calendar'); return; }
      var btn = ev.currentTarget; btn.disabled = true;
      var ins = await sb.from('plans').insert({
        user_id: state.userId, author: state.me, date: date,
        time: $('plan-time').value || null, type: $('plan-type').value,
        place: $('plan-where').value.trim() || null, notes: $('plan-notes').value.trim() || null
      }).select('id').single();
      if (!ins.error && ins.data) await sb.from('plan_joins').insert({ plan_id: ins.data.id, user_id: state.userId, name: state.me });
      btn.disabled = false;
      if (ins.error) { toast('No se pudo guardar 😕', 'ti-alert-circle'); console.error(ins.error); return; }
      ['plan-date', 'plan-time', 'plan-where', 'plan-notes'].forEach(function (id) { $(id).value = ''; });
      toggle('plan-form', false); await loadPlans(); confettiFrom(btn); toast('¡Propuesta lanzada! 🐾', 'ti-calendar-plus');
    };

    $('log-save').onclick = async function (ev) {
      var content = $('log-content').value.trim();
      if (!content) { toast('Escribe algo 😉', 'ti-pencil'); return; }
      var btn = ev.currentTarget; btn.disabled = true;
      var res = await sb.from('logs').insert({ user_id: state.userId, author: state.me, type: $('log-type').value, content: content });
      btn.disabled = false;
      if (res.error) { toast('No se pudo publicar 😕', 'ti-alert-circle'); console.error(res.error); return; }
      $('log-content').value = ''; toggle('log-form', false); await loadLog(); confettiFrom(btn); toast('Publicado en la bitácora ✍️', 'ti-notebook');
    };

    $('route-save').onclick = async function (ev) {
      var name = $('route-name').value.trim();
      if (!name) { toast('Ponle un nombre', 'ti-map-pin'); return; }
      var btn = ev.currentTarget; btn.disabled = true;
      var latv = $('route-lat').value, lngv = $('route-lng').value;
      var res = await sb.from('routes').insert({
        user_id: state.userId, author: state.me, name: name, type: $('route-type').value,
        dist: $('route-dist').value.trim() || null, notes: $('route-notes').value.trim() || null,
        lat: latv ? parseFloat(latv) : null, lng: lngv ? parseFloat(lngv) : null
      });
      btn.disabled = false;
      if (res.error) { toast('No se pudo guardar 😕', 'ti-alert-circle'); console.error(res.error); return; }
      resetRouteForm(); toggle('route-form', false); await loadRoutes(); confettiFrom(btn); toast('Ruta guardada 📍', 'ti-map-pin');
    };
  }

  /* ============================================================
     MI PERFIL
  ============================================================ */
  async function loadProfile() {
    var res = await sb.from('profiles').select('*').eq('id', state.userId).single();
    if (!res.error && res.data) state.profile = res.data;
    fillProfile();
  }
  function fillProfile() {
    var p = state.profile || {};
    // Los datos salen YA escritos (con respaldo del nombre/correo de la cuenta).
    $('profile-name').value = p.name || state.me || '';
    $('profile-email').value = p.email || state.authEmail || '';
    $('profile-phone').value = p.phone || '';
    $('profile-age').value = (p.age != null ? p.age : '');
    $('profile-sports').value = p.sports || '';
    $('profile-bio').value = p.bio || '';
    var initial = (p.name || state.me || '').trim().charAt(0).toUpperCase() || '🐾';
    $('profile-avatar').innerHTML = p.avatar_path
      ? '<img src="' + esc(avatarUrl(p.avatar_path)) + '" alt="" />'
      : esc(initial);
    if (p.created) $('profile-since').textContent = 'Miembro desde ' + new Date(p.created).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function wireProfile() {
    $('profile-save').onclick = async function (ev) {
      var btn = ev.currentTarget; btn.disabled = true;
      var name = $('profile-name').value.trim();
      var email = $('profile-email').value.trim();
      var ageVal = $('profile-age').value.trim();
      var upd = {
        name: name || null,
        email: email || (state.profile && state.profile.email) || null,
        phone: $('profile-phone').value.trim() || null,
        age: ageVal ? parseInt(ageVal, 10) : null,
        sports: $('profile-sports').value.trim() || null,
        bio: $('profile-bio').value.trim() || null
      };
      var res = await sb.from('profiles').update(upd).eq('id', state.userId);
      if (res.error) { btn.disabled = false; toast('No se pudo guardar 😕', 'ti-alert-circle'); console.error(res.error); return; }

      // Actualiza el nombre mostrado (metadata de la cuenta) y, además, lo
      // refresca en TODO lo que ya publicaste (retroactivo).
      if (name && name !== state.me) {
        await sb.auth.updateUser({ data: { display_name: name } });
        state.me = name;
        document.querySelectorAll('.me-name').forEach(function (e) { e.textContent = name; });
        await Promise.all([
          sb.from('plans').update({ author: name }).eq('user_id', state.userId),
          sb.from('logs').update({ author: name }).eq('user_id', state.userId),
          sb.from('routes').update({ author: name }).eq('user_id', state.userId),
          sb.from('posts').update({ author: name }).eq('user_id', state.userId),
          sb.from('plan_joins').update({ name: name }).eq('user_id', state.userId),
          sb.from('post_comments').update({ author: name }).eq('user_id', state.userId)
        ]);
        loadAll();
      }
      // Actualiza el correo de la cuenta si cambió.
      var emailChanged = email && state.profile && email !== state.profile.email;
      if (emailChanged) {
        var er = await sb.auth.updateUser({ email: email });
        if (er.error) toast('Perfil guardado, pero el correo no se pudo cambiar', 'ti-alert-circle');
        else toast('Revisa tu correo para confirmar el nuevo email 📧', 'ti-mail');
      }
      btn.disabled = false;
      state.profile = Object.assign({}, state.profile, upd);
      fillProfile();
      loadProfiles(); // refresca nombre/avatar en todas las publicaciones
      confettiFrom(btn);
      if (!emailChanged) toast('Perfil actualizado ✅', 'ti-user-check');
    };

    // Subir / cambiar foto de perfil (avatar).
    $('profile-avatar-file').onchange = async function () {
      var file = this.files && this.files[0];
      if (!file || !/^image\//.test(file.type)) return;
      var blob;
      try { blob = await compressImage(file, 400, 0.82); }
      catch (e) { toast('No se pudo leer la imagen 😕', 'ti-alert-circle'); return; }
      var path = state.userId + '/' + fileId() + '.jpg';
      var up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) { toast('No se pudo subir la foto 😕', 'ti-alert-circle'); console.error(up.error); return; }
      var res = await sb.from('profiles').update({ avatar_path: path }).eq('id', state.userId);
      if (res.error) { toast('No se pudo guardar la foto 😕', 'ti-alert-circle'); console.error(res.error); return; }
      state.profile = Object.assign({}, state.profile, { avatar_path: path });
      fillProfile();
      loadProfiles();
      toast('Foto de perfil actualizada 📸', 'ti-user-check');
    };
  }

  /* ============================================================
     ACTIVIDAD (Mi actividad / actividad de un perfil)
  ============================================================ */
  function activityFor(uid) {
    var items = [];
    state.posts.forEach(function (p) { if (p.user_id === uid) items.push({ kind: 'post', created: p.created, data: p }); });
    state.log.forEach(function (e) { if (e.user_id === uid) items.push({ kind: 'log', created: e.created, data: e }); });
    state.plans.forEach(function (p) { if (p.user_id === uid) items.push({ kind: 'plan', created: p.created, data: p }); });
    state.routes.forEach(function (r) { if (r.user_id === uid) items.push({ kind: 'route', created: r.created, data: r }); });
    items.sort(function (a, b) { return String(b.created).localeCompare(String(a.created)); });
    return items;
  }
  var ACT_ICON = { post: '📷', log: '📓', plan: '📅', route: '📍' };
  var ACT_KIND = { post: 'Foto en el muro', log: 'Block de Patas', plan: 'Propuso entreno', route: 'Ruta' };
  function actText(it) {
    var d = it.data;
    if (it.kind === 'post') return d.caption || 'Compartió una foto';
    if (it.kind === 'log') return d.content;
    if (it.kind === 'plan') return (TYPES[d.type] ? TYPES[d.type].label : '') + (d.place ? ' · ' + d.place : '') + ' · ' + fmtDate(d.date);
    if (it.kind === 'route') return d.name;
    return '';
  }
  function renderActivity(container, uid) {
    if (!container) return;
    var items = activityFor(uid);
    if (items.length === 0) { container.innerHTML = '<div class="pm-empty">Todavía no ha subido nada.</div>'; return; }
    container.innerHTML = items.map(function (it) {
      var thumb = it.kind === 'post' ? '<img class="act-thumb" src="' + esc(publicUrl(it.data.image_path)) + '" alt="" loading="lazy" />' : '<div class="act-icon">' + ACT_ICON[it.kind] + '</div>';
      return '<div class="act-item">' + thumb +
        '<div class="act-body">' +
          '<div class="act-kind">' + ACT_KIND[it.kind] + '</div>' +
          '<div class="act-text">' + esc(actText(it)) + '</div>' +
          '<div class="act-time">' + esc(fmtRel(it.created)) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  function renderMyActivity() { renderActivity($('profile-activity'), state.userId); }

  function updateSidebarAvatar() {
    var box = document.querySelector('.sidebar-user');
    if (!box) return;
    var icon = box.querySelector('i, .avatar');
    var html = avatarHtml(state.userId, 'av-sm');
    if (icon) icon.outerHTML = html;
  }

  /* ============================================================
     PERFIL PÚBLICO (al tocar al autor de una publicación)
  ============================================================ */
  function openProfileModal(uid) {
    var p = state.profilesById[uid] || {};
    var rows = '';
    function row(label, val) { return val ? '<div class="pm-row"><span class="pm-label">' + label + '</span><span class="pm-val">' + esc(val) + '</span></div>' : ''; }
    rows += row('Correo', p.email);
    rows += row('Número', p.phone);
    rows += row('Edad', p.age != null ? p.age : '');
    rows += row('Deportes', p.sports);
    rows += row('Descripción', p.bio);
    if (!rows) rows = '<div class="pm-empty">Sin datos por ahora.</div>';
    var since = p.created ? 'Miembro desde ' + new Date(p.created).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' }) : '';
    $('pm-body').innerHTML =
      '<div class="pm-head">' + avatarHtml(uid, 'av-lg') +
        '<div class="pm-name">' + esc(p.name || 'Miembro') + '</div>' +
        (since ? '<div class="pm-sub">' + esc(since) + '</div>' : '') +
      '</div>' +
      '<h3 class="pm-section">Datos</h3>' +
      '<div class="pm-data">' + rows + '</div>' +
      '<h3 class="pm-section">Actividad</h3>' +
      '<div id="pm-activity"></div>';
    renderActivity($('pm-activity'), uid);
    $('profile-modal').hidden = false;
  }
  function closeProfileModal() { $('profile-modal').hidden = true; }

  /* ============================================================
     ADMIN
  ============================================================ */
  async function checkAdmin() {
    try { var res = await sb.rpc('is_admin'); state.isAdmin = !res.error && res.data === true; }
    catch (e) { state.isAdmin = false; }
  }
  // Carga TODOS los perfiles (ahora visibles para cualquier miembro):
  // se usan para los avatares, los nombres de autor y los perfiles públicos.
  async function loadProfiles() {
    var res = await sb.from('profiles').select('*').order('created', { ascending: true });
    if (res.error) { console.error(res.error); return; }
    state.profiles = res.data || [];
    state.profilesById = {};
    state.profiles.forEach(function (p) { state.profilesById[p.id] = p; });
    // Re-render para que aparezcan los avatares/nombres que acaban de llegar.
    renderPosts(); renderLog(); renderPlans(); renderRoutes(); renderAdmin(); renderMyActivity();
    updateSidebarAvatar();
  }
  function renderAdmin() {
    if (!state.isAdmin) return;
    var g = $('admin-global'); if (!g) return;
    g.innerHTML =
      '<div class="admin-stat"><div class="num">' + state.profiles.length + '</div><div class="lbl">Usuarios</div></div>' +
      '<div class="admin-stat"><div class="num">' + state.plans.length + '</div><div class="lbl">Planes</div></div>' +
      '<div class="admin-stat"><div class="num">' + state.log.length + '</div><div class="lbl">Entrenos</div></div>' +
      '<div class="admin-stat"><div class="num">' + state.posts.length + '</div><div class="lbl">Fotos</div></div>';

    var by = {};
    state.profiles.forEach(function (u) { by[u.id] = { id: u.id, name: u.name || '—', email: u.email || '', plans: 0, logs: 0, routes: 0, photos: 0 }; });
    function bump(arr, key) { arr.forEach(function (x) { if (by[x.user_id]) by[x.user_id][key]++; }); }
    bump(state.plans, 'plans'); bump(state.log, 'logs'); bump(state.routes, 'routes'); bump(state.posts, 'photos');

    var users = Object.keys(by).map(function (k) { return by[k]; });
    users.sort(function (a, b) { return (b.logs - a.logs) || ((b.plans + b.routes + b.photos) - (a.plans + a.routes + a.photos)) || a.name.localeCompare(b.name); });

    var medals = ['🥇', '🥈', '🥉'];
    $('admin-users').innerHTML = users.map(function (u, i) {
      var isMe = u.id === state.userId;
      return '<div class="urow">' +
        '<span class="rank">' + (medals[i] || (i + 1)) + '</span>' +
        '<div class="uinfo">' +
          '<div class="uname">' + esc(u.name) + (isMe ? '<span class="you">TÚ</span>' : '') + '</div>' +
          '<div class="uemail">' + esc(u.email) + '</div>' +
        '</div>' +
        '<div class="ucounts">' +
          '<span title="Entrenos"><b>' + u.logs + '</b> 📓</span>' +
          '<span title="Fotos"><b>' + u.photos + '</b> 📷</span>' +
          '<span title="Planes"><b>' + u.plans + '</b> 📅</span>' +
          '<span title="Rutas"><b>' + u.routes + '</b> 📍</span>' +
        '</div>' +
        (isMe ? '' : '<button class="purge" data-purge="' + u.id + '">Limpiar</button>') +
      '</div>';
    }).join('');
  }

  /* ============================================================
     Clicks delegados
  ============================================================ */
  function removeWithAnim(btn, afterFn) {
    var card = btn.closest('.card');
    if (card) { card.classList.add('removing'); setTimeout(afterFn, 250); } else { afterFn(); }
  }

  function wireCardClicks() {
    document.body.addEventListener('click', async function (ev) {
      var t = ev.target.closest('[data-join],[data-del-plan],[data-del-log],[data-del-route],[data-purge],[data-react],[data-comments],[data-emoji],[data-comment-send],[data-del-comment],[data-del-post],[data-zoom],[data-profile]');
      if (!t) return;

      if (t.dataset.profile) { openProfileModal(t.dataset.profile); return; }
      if (t.dataset.zoom) {
        var ov = document.createElement('div'); ov.className = 'lightbox';
        var im = document.createElement('img'); im.src = t.dataset.zoom; ov.appendChild(im);
        ov.onclick = function () { ov.remove(); }; document.body.appendChild(ov); return;
      }
      if (t.dataset.emoji) { openEmoji(t, t.dataset.emoji); return; }

      if (t.dataset.react) {
        var post = state.posts.find(function (x) { return x.id === t.dataset.react; });
        if (!post) return;
        if (post.reactions.some(function (r) { return r.user_id === state.userId; })) {
          await sb.from('post_reactions').delete().eq('post_id', post.id).eq('user_id', state.userId);
        } else {
          await sb.from('post_reactions').insert({ post_id: post.id, user_id: state.userId, name: state.me });
          confettiFrom(t);
        }
        await loadPosts(); return;
      }
      if (t.dataset.comments) {
        var cid = t.dataset.comments;
        openComments[cid] = !openComments[cid];
        var box = $('comments-' + cid); if (box) box.classList.toggle('open', openComments[cid]);
        return;
      }
      if (t.dataset.commentSend) {
        var pid = t.dataset.commentSend;
        var input = $('cinput-' + pid);
        var txt = input ? input.value.trim() : '';
        if (!txt) { if (input) input.focus(); return; }
        openComments[pid] = true;
        var cins = await sb.from('post_comments').insert({ post_id: pid, user_id: state.userId, author: state.me, content: txt });
        if (cins.error) { toast('No se pudo comentar 😕', 'ti-alert-circle'); console.error(cins.error); return; }
        delete commentDrafts[pid];
        await loadPosts(); return;
      }
      if (t.dataset.delComment) { await sb.from('post_comments').delete().eq('id', t.dataset.delComment); await loadPosts(); return; }
      if (t.dataset.delPost) {
        if (!confirm('¿Borrar esta publicación?')) return;
        var pp = state.posts.find(function (x) { return x.id === t.dataset.delPost; });
        removeWithAnim(t, async function () {
          await sb.from('posts').delete().eq('id', t.dataset.delPost);
          if (pp && pp.image_path) await sb.storage.from('posts').remove([pp.image_path]);
          await loadPosts(); toast('Publicación eliminada', 'ti-trash');
        }); return;
      }
      if (t.dataset.purge) {
        if (!state.isAdmin) return;
        var u = state.profiles.find(function (x) { return x.id === t.dataset.purge; });
        var nombre = u ? u.name : 'este usuario';
        if (!confirm('¿Borrar TODO el contenido de ' + nombre + '?\n(planes, anécdotas, rutas y fotos). No se puede deshacer.')) return;
        var uid = t.dataset.purge;
        await sb.from('plan_joins').delete().eq('user_id', uid);
        await sb.from('plans').delete().eq('user_id', uid);
        await sb.from('logs').delete().eq('user_id', uid);
        await sb.from('routes').delete().eq('user_id', uid);
        await sb.from('posts').delete().eq('user_id', uid);
        await Promise.all([loadPlans(), loadLog(), loadRoutes(), loadPosts()]);
        await loadProfiles();
        toast('Contenido de ' + nombre + ' eliminado', 'ti-trash'); return;
      }
      if (t.dataset.join) {
        var p = state.plans.find(function (x) { return x.id === t.dataset.join; });
        if (!p) return;
        if ((p.joining || []).some(function (j) { return j.user_id === state.userId; })) {
          await sb.from('plan_joins').delete().eq('plan_id', p.id).eq('user_id', state.userId);
          toast('Te bajaste de este plan', 'ti-user-minus');
        } else {
          await sb.from('plan_joins').insert({ plan_id: p.id, user_id: state.userId, name: state.me });
          confettiFrom(t); toast('¡Apuntado! Nos vemos ahí 💪', 'ti-user-plus');
        }
        await loadPlans(); return;
      }
      if (t.dataset.delPlan) {
        if (!confirm('¿Borrar esta propuesta?')) return;
        removeWithAnim(t, async function () { await sb.from('plans').delete().eq('id', t.dataset.delPlan); await loadPlans(); toast('Propuesta eliminada', 'ti-trash'); }); return;
      }
      if (t.dataset.delLog) {
        if (!confirm('¿Borrar esta entrada?')) return;
        removeWithAnim(t, async function () { await sb.from('logs').delete().eq('id', t.dataset.delLog); await loadLog(); toast('Entrada eliminada', 'ti-trash'); }); return;
      }
      if (t.dataset.delRoute) {
        if (!confirm('¿Borrar esta ruta?')) return;
        removeWithAnim(t, async function () { await sb.from('routes').delete().eq('id', t.dataset.delRoute); await loadRoutes(); toast('Ruta eliminada', 'ti-trash'); }); return;
      }
    });
  }

  /* ============================================================
     Tiempo real
  ============================================================ */
  function subscribeRealtime() {
    sb.channel('sp-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, loadPlans)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_joins' }, loadPlans)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'logs' }, loadLog)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, loadRoutes)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, loadPosts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_reactions' }, loadPosts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_comments' }, loadPosts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadProfiles)
      .subscribe();
  }

  /* ============================================================
     Navegación (sidebar / vistas)
  ============================================================ */
  var VIEWS = ['semana', 'muro', 'bitacora', 'rutas', 'perfil', 'admin'];
  var VIEW_TITLES = { semana: 'Esta semana', muro: 'Muro', bitacora: 'Block de Patas', rutas: 'Rutas y lugares', perfil: 'Mi Perfil', admin: 'Panel de admin' };
  function closeSidebar() { $('sidebar').classList.remove('open'); $('nav-overlay').classList.remove('show'); }
  function showView(v) {
    currentView = v;
    VIEWS.forEach(function (id) { var el = $('view-' + id); if (el) el.hidden = (id !== v); });
    document.querySelectorAll('.nav-item[data-view]').forEach(function (b) { b.classList.toggle('active', b.dataset.view === v); });
    $('view-title').textContent = VIEW_TITLES[v] || '';
    closeSidebar();
    window.scrollTo(0, 0);
    if (v === 'rutas') setTimeout(initRouteMaps, 60);
    if (v === 'perfil') { loadProfile(); renderMyActivity(); }
  }
  function wireNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(function (b) { b.onclick = function () { showView(b.dataset.view); }; });
    $('nav-toggle').onclick = function () { $('sidebar').classList.add('open'); $('nav-overlay').classList.add('show'); };
    $('nav-overlay').onclick = closeSidebar;
    $('pm-close').onclick = closeProfileModal;
    $('profile-modal').onclick = function (e) { if (e.target === this) closeProfileModal(); };
  }

  /* ---------- Huellas en el sidebar ---------- */
  function spawnPaws() {
    var box = $('paws'); if (!box || box.childElementCount) return;
    for (var i = 0; i < 6; i++) {
      var p = document.createElement('span');
      p.className = 'paw'; p.textContent = '🐾';
      p.style.left = (5 + Math.random() * 80) + '%';
      p.style.fontSize = (14 + Math.random() * 14) + 'px';
      p.style.animationDuration = (8 + Math.random() * 7) + 's';
      p.style.animationDelay = (Math.random() * 8) + 's';
      box.appendChild(p);
    }
  }

  /* ============================================================
     Autenticación
  ============================================================ */
  var authMode = 'login', appStarted = false;
  function authError(msg) { var e = $('auth-error'); if (!msg) { e.hidden = true; return; } e.textContent = msg; e.hidden = false; }
  function setAuthMode(mode) {
    authMode = mode;
    var signup = mode === 'signup';
    $('auth-name-field').hidden = !signup;
    $('auth-submit').textContent = signup ? 'Crear cuenta' : 'Entrar';
    $('auth-switch-text').textContent = signup ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
    $('auth-switch-btn').textContent = signup ? 'Inicia sesión' : 'Regístrate';
    $('auth-pass').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    authError('');
  }
  function showAuthScreen() { $('app').hidden = true; $('auth-screen').hidden = false; }

  async function showApp(user) {
    state.userId = user.id;
    state.authEmail = user.email || '';
    state.me = (user.user_metadata && user.user_metadata.display_name) || user.email.split('@')[0];
    document.querySelectorAll('.me-name').forEach(function (e) { e.textContent = state.me; });
    $('auth-screen').hidden = true;
    $('app').hidden = false;
    spawnPaws();
    if (!appStarted) {
      appStarted = true;
      wireForms(); wirePosts(); wireProfile(); wireCardClicks(); wireNav(); subscribeRealtime();
      showView('semana');
      setInterval(renderPlans, 60000);
    }
    await checkAdmin();
    $('admin-badge').hidden = !state.isAdmin;
    $('nav-admin').hidden = !state.isAdmin;
    loadAll();
    loadProfiles();
    loadProfile();
  }

  function traducirError(msg) {
    msg = msg || '';
    if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
    if (/User already registered/i.test(msg)) return 'Ese correo ya tiene cuenta. Inicia sesión.';
    if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
    if (/valid email/i.test(msg)) return 'Escribe un correo válido.';
    return msg;
  }
  async function handleAuthSubmit() {
    var email = $('auth-email').value.trim(), pass = $('auth-pass').value;
    if (!email || !pass) { authError('Completa correo y contraseña.'); return; }
    var btn = $('auth-submit'); btn.disabled = true; authError('');
    if (authMode === 'signup') {
      var name = $('auth-name').value.trim();
      if (!name) { authError('Pon tu nombre.'); btn.disabled = false; return; }
      var up = await sb.auth.signUp({ email: email, password: pass, options: { data: { display_name: name } } });
      btn.disabled = false;
      if (up.error) { authError(traducirError(up.error.message)); return; }
      if (!up.data.session) { toast('Revisa tu correo para confirmar la cuenta 📧', 'ti-mail'); setAuthMode('login'); return; }
    } else {
      var inp = await sb.auth.signInWithPassword({ email: email, password: pass });
      btn.disabled = false;
      if (inp.error) { authError(traducirError(inp.error.message)); return; }
    }
  }
  function wireAuth() {
    $('auth-submit').onclick = handleAuthSubmit;
    $('auth-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') handleAuthSubmit(); });
    $('auth-switch-btn').onclick = function () { setAuthMode(authMode === 'login' ? 'signup' : 'login'); };
    $('logout-btn').onclick = async function () { await sb.auth.signOut(); };
  }

  /* ============================================================
     Arranque
  ============================================================ */
  wireAuth();
  setAuthMode('login');
  sb.auth.onAuthStateChange(function (_event, session) {
    if (session && session.user) showApp(session.user);
    else { if (appStarted) location.reload(); showAuthScreen(); }
  });
  sb.auth.getSession().then(function (res) {
    if (res.data.session) showApp(res.data.session.user);
    else showAuthScreen();
  });
})();
