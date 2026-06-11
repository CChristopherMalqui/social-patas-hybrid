(function() {
  /* ============================================================
     Cliente de Supabase
  ============================================================ */
  var cfg = window.SP_CONFIG || {};
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf('PEGA_AQUI') === 0) {
    document.body.innerHTML = '<div style="max-width:520px;margin:60px auto;padding:24px;font-family:sans-serif;line-height:1.6">' +
      '<h2>⚙️ Falta configurar Supabase</h2>' +
      '<p>Abre <b>config.js</b> y pega tu <b>Project URL</b> y tu <b>anon key</b>. ' +
      'Sigue los pasos del archivo <b>SETUP.md</b>.</p></div>';
    return;
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  var TYPES = {
    run:   { label: 'Running',    icon: 'ti-run' },
    gym:   { label: 'Gym',        icon: 'ti-barbell' },
    cali:  { label: 'Calistenia', icon: 'ti-stretching' },
    walk:  { label: 'Caminata',   icon: 'ti-walk' },
    other: { label: 'Otro',       icon: 'ti-bolt' }
  };

  // Estado en memoria. Se llena desde la base de datos en la nube.
  var state = { plans: [], log: [], routes: [], posts: [], me: '', userId: null, isAdmin: false, profiles: [] };
  var pendingPhoto = null; // blob de la foto comprimida, lista para subir
  var openComments = {};   // qué publicaciones tienen los comentarios abiertos

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
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

  // Cuenta regresiva hacia la sesión planeada ("mañana", "en 3 días", "en 2 h")
  function countdown(date, time) {
    var target = new Date(date + 'T' + (time || '09:00') + ':00').getTime();
    var diff = target - Date.now();
    var soon = diff >= 0 && diff < 86400000 * 2;
    var label;
    if (diff < 0) label = 'pasó';
    else if (diff < 3600000) label = 'en ' + Math.max(1, Math.round(diff / 60000)) + ' min';
    else if (diff < 86400000) label = 'en ' + Math.round(diff / 3600000) + ' h';
    else {
      var days = Math.round(diff / 86400000);
      label = days === 1 ? 'mañana' : 'en ' + days + ' días';
    }
    return { label: label, soon: soon };
  }

  function pill(type) {
    var t = TYPES[type] || TYPES.other;
    return '<span class="pill"><i class="ti ' + t.icon + '" aria-hidden="true"></i> ' + t.label + '</span>';
  }

  function $(id) { return document.getElementById(id); }

  /* ---------- Toast ---------- */
  function toast(msg, icon) {
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<i class="ti ' + (icon || 'ti-check') + '"></i>' + esc(msg);
    box.appendChild(el);
    setTimeout(function() {
      el.classList.add('out');
      setTimeout(function() { el.remove(); }, 250);
    }, 2200);
  }

  /* ---------- Confetti burst ---------- */
  function confetti(x, y) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = ['#c14a22', '#e8852f', '#185fa5', '#2a9d5a', '#d4af37'];
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
        { transform: 'translate(' + dx + 'px,' + (dy + 120) + 'px) rotate(' + (Math.random()*720-360) + 'deg)', opacity: 0 }
      ], { duration: 750 + Math.random() * 400, easing: 'cubic-bezier(.2,.6,.4,1)' }).onfinish = function() { this.effect.target.remove(); };
    }
  }
  function confettiFrom(elem) {
    var r = elem.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top + r.height / 2);
  }

  /* ---------- Conteo animado de las estadísticas ---------- */
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
    var weekPlans = state.plans.filter(function(p) {
      return new Date(p.date + 'T' + (p.time || '23:59')).getTime() >= cutoff;
    });
    var joins = weekPlans.reduce(function(n, p) { return n + ((p.joining || []).length); }, 0);
    var vals = { plans: weekPlans.length, logs: state.log.length, routes: state.routes.length, joins: joins };
    Object.keys(vals).forEach(function(k) {
      var el = document.querySelector('[data-stat="' + k + '"]');
      if (el) animateNum(el, vals[k]);
    });
  }

  // Botón de borrar: aparece en lo propio, o en TODO si eres admin (moderación).
  function delBtn(attr, ownerId) {
    if (ownerId !== state.userId && !state.isAdmin) return '';
    return '<button class="del" data-' + attr + ' aria-label="Eliminar"><i class="ti ti-x"></i></button>';
  }

  function renderPlans() {
    var el = $('plan-list');
    var cutoff = Date.now() - 86400000;
    var upcoming = state.plans
      .filter(function(p) { return new Date(p.date + 'T' + (p.time || '23:59')).getTime() >= cutoff; })
      .sort(function(a, b) { return (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')); });
    if (upcoming.length === 0) {
      el.innerHTML = '<div class="empty">Nada propuesto todavía. Sé el primero.</div>';
      return;
    }
    el.innerHTML = upcoming.map(function(p, i) {
      var joining = p.joining || [];
      var isIn = joining.some(function(j) { return j.user_id === state.userId; });
      var cd = countdown(p.date, p.time);
      return '<div class="card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="meta">' + pill(p.type) +
        '<span>' + esc(fmtDate(p.date)) + (p.time ? ' · ' + esc(p.time) : '') + '</span>' +
        '<span class="countdown' + (cd.soon ? ' soon' : '') + '"><i class="ti ti-clock-hour-4"></i>' + esc(cd.label) + '</span>' +
        '<span class="author">Propuso ' + esc(p.author || 'alguien') + '</span>' +
        delBtn('del-plan="' + p.id + '"', p.user_id) +
        '</div>' +
        (p.place ? '<div class="where">' + esc(p.place) + '</div>' : '') +
        (p.notes ? '<div class="notes">' + esc(p.notes) + '</div>' : '') +
        '<div class="joiners">' +
          joining.map(function(j) { return '<span class="chip">' + esc(j.name) + '</span>'; }).join('') +
          '<button class="join-btn ' + (isIn ? 'in' : '') + '" data-join="' + p.id + '">' + (isIn ? '− No llego' : '+ Si llego') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderLog() {
    var el = $('log-list');
    var items = state.log;
    if (items.length === 0) {
      el.innerHTML = '<div class="empty">La bitácora está en blanco. Después del próximo entreno, cuéntalo aquí.</div>';
      return;
    }
    el.innerHTML = items.map(function(e, i) {
      return '<div class="card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="meta">' + pill(e.type) +
        '<span class="author">' + esc(e.author || 'alguien') + ' · ' + esc(fmtRel(e.created)) + '</span>' +
        delBtn('del-log="' + e.id + '"', e.user_id) +
        '</div>' +
        '<p class="note-serif">' + esc(e.content) + '</p>' +
      '</div>';
    }).join('');
  }

  function renderRoutes() {
    var el = $('route-list');
    var items = state.routes;
    if (items.length === 0) {
      el.innerHTML = '<div class="empty">Aún no hay rutas guardadas. Agrega ese lugar bueno que solo ustedes conocen.</div>';
      return;
    }
    el.innerHTML = items.map(function(r, i) {
      return '<div class="card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="meta">' + pill(r.type) +
        (r.dist ? '<span>' + esc(r.dist) + '</span>' : '') +
        '<span class="author">' + esc(r.author || 'alguien') + '</span>' +
        delBtn('del-route="' + r.id + '"', r.user_id) +
        '</div>' +
        '<div class="where">' + esc(r.name) + '</div>' +
        (r.notes ? '<div class="notes">' + esc(r.notes) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  function renderAll() { renderPlans(); renderLog(); renderRoutes(); renderStats(); }

  /* ============================================================
     Carga de datos desde la nube
  ============================================================ */
  async function loadPlans() {
    var res = await sb.from('plans')
      .select('id, user_id, author, date, time, type, place, notes, created, plan_joins(user_id, name)')
      .order('date', { ascending: true });
    if (res.error) { console.error(res.error); return; }
    state.plans = (res.data || []).map(function(p) {
      p.joining = p.plan_joins || [];
      return p;
    });
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

  function loadAll() { loadPlans(); loadLog(); loadRoutes(); loadPosts(); }

  /* ============================================================
     MURO (publicaciones con foto, 🔥 y comentarios)
  ============================================================ */
  function fileId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function publicUrl(path) {
    return sb.storage.from('posts').getPublicUrl(path).data.publicUrl;
  }

  // Comprime y reescala la imagen en el navegador antes de subirla.
  function compressImage(file, maxDim, quality) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() {
        var w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) {
          URL.revokeObjectURL(img.src);
          blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen'));
        }, 'image/jpeg', quality);
      };
      img.onerror = function() { reject(new Error('Imagen inválida')); };
      img.src = URL.createObjectURL(file);
    });
  }

  async function loadPosts() {
    var res = await sb.from('posts')
      .select('id, user_id, author, caption, image_path, created, post_reactions(user_id, name), post_comments(id, user_id, author, content, created)')
      .order('created', { ascending: false });
    if (res.error) { console.error(res.error); return; }
    state.posts = (res.data || []).map(function(p) {
      p.reactions = p.post_reactions || [];
      p.comments = (p.post_comments || []).slice().sort(function(a, b) { return a.created.localeCompare(b.created); });
      return p;
    });
    renderPosts(); renderAdmin();
  }

  function renderPosts() {
    var el = $('post-list');
    if (!el) return;
    if (state.posts.length === 0) {
      el.innerHTML = '<div class="empty">El muro está vacío. Sube la primera foto de la jauría.</div>';
      return;
    }
    el.innerHTML = state.posts.map(function(p, i) {
      var reacted = p.reactions.some(function(r) { return r.user_id === state.userId; });
      var rc = p.reactions.length;
      var cc = p.comments.length;
      var comments = p.comments.map(function(c) {
        var canDel = c.user_id === state.userId || state.isAdmin;
        return '<div class="comment">' +
          '<div class="c-body">' +
            '<span class="c-author">' + esc(c.author || 'alguien') + '</span>' +
            '<span class="c-time">' + esc(fmtRel(c.created)) + '</span>' +
            '<div class="c-text">' + esc(c.content) + '</div>' +
          '</div>' +
          (canDel ? '<button class="c-del" data-del-comment="' + c.id + '" aria-label="borrar comentario"><i class="ti ti-x"></i></button>' : '') +
        '</div>';
      }).join('');
      return '<div class="card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="meta">' +
          '<span class="author" style="margin-left:0">' + esc(p.author || 'alguien') + ' · ' + esc(fmtRel(p.created)) + '</span>' +
          delBtn('del-post="' + p.id + '"', p.user_id) +
        '</div>' +
        '<img class="post-img" src="' + esc(publicUrl(p.image_path)) + '" alt="" loading="lazy" data-zoom="' + esc(publicUrl(p.image_path)) + '" />' +
        (p.caption ? '<p class="post-caption">' + esc(p.caption) + '</p>' : '') +
        '<div class="post-actions">' +
          '<button class="react-btn ' + (reacted ? 'on' : '') + '" data-react="' + p.id + '">🔥 <span class="rcount">' + rc + '</span></button>' +
          '<button class="comment-btn" data-comments="' + p.id + '"><i class="ti ti-message-circle"></i> ' + cc + '</button>' +
        '</div>' +
        '<div class="comments' + (openComments[p.id] ? ' open' : '') + '" id="comments-' + p.id + '">' +
          comments +
          '<div class="comment-form">' +
            '<input type="text" id="cinput-' + p.id + '" placeholder="Escribe un comentario..." maxlength="500" />' +
            '<button data-comment-send="' + p.id + '" aria-label="enviar"><i class="ti ti-send"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function wirePosts() {
    $('post-toggle').onclick = function() { toggle('post-form'); };
    $('post-cancel').onclick = function() { resetPostForm(); toggle('post-form', false); };

    // Enviar comentario con Enter (los inputs se crean dinámicamente).
    document.body.addEventListener('keydown', function(ev) {
      var input = ev.target.closest && ev.target.closest('input[id^="cinput-"]');
      if (input && ev.key === 'Enter') {
        ev.preventDefault();
        var btn = document.querySelector('[data-comment-send="' + input.id.slice(7) + '"]');
        if (btn) btn.click();
      }
    });

    $('post-file').onchange = async function() {
      var file = this.files && this.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Elige una imagen', 'ti-photo'); return; }
      try {
        pendingPhoto = await compressImage(file, 1280, 0.8);
        var img = $('post-preview-img');
        img.src = URL.createObjectURL(pendingPhoto);
        $('post-preview').hidden = false;
        $('post-drop-text').textContent = 'Cambiar foto';
      } catch (e) {
        toast('No se pudo leer la imagen 😕', 'ti-alert-circle');
        console.error(e);
      }
    };

    $('post-save').onclick = async function(ev) {
      if (!pendingPhoto) { toast('Primero elige una foto', 'ti-camera'); return; }
      var btn = ev.currentTarget;
      btn.disabled = true;
      var path = state.userId + '/' + fileId() + '.jpg';
      var up = await sb.storage.from('posts').upload(path, pendingPhoto, { contentType: 'image/jpeg', upsert: false });
      if (up.error) { btn.disabled = false; toast('No se pudo subir la foto 😕', 'ti-alert-circle'); console.error(up.error); return; }
      var ins = await sb.from('posts').insert({
        user_id: state.userId, author: state.me,
        caption: $('post-caption').value.trim() || null,
        image_path: path
      });
      btn.disabled = false;
      if (ins.error) {
        await sb.storage.from('posts').remove([path]); // limpia si falló el registro
        toast('No se pudo publicar 😕', 'ti-alert-circle'); console.error(ins.error); return;
      }
      resetPostForm();
      toggle('post-form', false);
      await loadPosts();
      confettiFrom(btn);
      toast('¡Foto publicada! 📸', 'ti-photo');
    };
  }

  function resetPostForm() {
    pendingPhoto = null;
    $('post-file').value = '';
    $('post-caption').value = '';
    $('post-preview').hidden = true;
    $('post-preview-img').src = '';
    $('post-drop-text').textContent = 'Elige una foto';
  }

  /* ============================================================
     ADMIN
  ============================================================ */
  async function checkAdmin() {
    try {
      var res = await sb.rpc('is_admin');
      state.isAdmin = !res.error && res.data === true;
    } catch (e) { state.isAdmin = false; }
  }

  async function loadAdmin() {
    if (!state.isAdmin) return;
    var res = await sb.from('profiles').select('*').order('created', { ascending: true });
    if (res.error) { console.error(res.error); return; }
    state.profiles = res.data || [];
    renderAdmin();
  }

  function renderAdmin() {
    if (!state.isAdmin) return;
    var g = $('admin-global');
    if (!g) return;

    // Estadísticas globales (histórico completo)
    g.innerHTML =
      '<div class="admin-stat"><div class="num">' + state.profiles.length + '</div><div class="lbl">Usuarios</div></div>' +
      '<div class="admin-stat"><div class="num">' + state.plans.length + '</div><div class="lbl">Planes (total)</div></div>' +
      '<div class="admin-stat"><div class="num">' + state.log.length + '</div><div class="lbl">Entrenos</div></div>' +
      '<div class="admin-stat"><div class="num">' + state.routes.length + '</div><div class="lbl">Rutas</div></div>';

    // Conteo por usuario
    var by = {};
    state.profiles.forEach(function(u) { by[u.id] = { id: u.id, name: u.name || '—', email: u.email || '', plans: 0, logs: 0, routes: 0, photos: 0 }; });
    function bump(arr, key) { arr.forEach(function(x) { if (by[x.user_id]) by[x.user_id][key]++; }); }
    bump(state.plans, 'plans'); bump(state.log, 'logs'); bump(state.routes, 'routes'); bump(state.posts, 'photos');

    // Ranking: más entrenos primero, luego más actividad total
    var users = Object.keys(by).map(function(k) { return by[k]; });
    users.sort(function(a, b) {
      return (b.logs - a.logs) || ((b.plans + b.routes) - (a.plans + a.routes)) || a.name.localeCompare(b.name);
    });

    var medals = ['🥇', '🥈', '🥉'];
    $('admin-users').innerHTML = users.map(function(u, i) {
      var isMe = u.id === state.userId;
      var rank = medals[i] || (i + 1);
      return '<div class="urow">' +
        '<span class="rank">' + rank + '</span>' +
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
     Formularios desplegables
  ============================================================ */
  function toggle(id, open) {
    var f = $(id);
    var btnMap = { 'plan-form': 'plan-toggle', 'log-form': 'log-toggle', 'route-form': 'route-toggle' };
    var willOpen = open == null ? !f.classList.contains('open') : open;
    f.classList.toggle('open', willOpen);
    var btn = $(btnMap[id]);
    if (btn) btn.classList.toggle('open', willOpen);
  }

  function wireForms() {
    $('plan-toggle').onclick = function() { toggle('plan-form'); };
    $('plan-cancel').onclick = function() { toggle('plan-form', false); };
    $('log-toggle').onclick = function() { toggle('log-form'); };
    $('log-cancel').onclick = function() { toggle('log-form', false); };
    $('route-toggle').onclick = function() { toggle('route-form'); };
    $('route-cancel').onclick = function() { toggle('route-form', false); };

    $('plan-save').onclick = async function(ev) {
      var date = $('plan-date').value;
      if (!date) { toast('Elige una fecha', 'ti-calendar'); return; }
      var btn = ev.currentTarget;
      btn.disabled = true;
      var ins = await sb.from('plans').insert({
        user_id: state.userId, author: state.me, date: date,
        time: $('plan-time').value || null,
        type: $('plan-type').value,
        place: $('plan-where').value.trim() || null,
        notes: $('plan-notes').value.trim() || null
      }).select('id').single();
      if (!ins.error && ins.data) {
        // El creador queda apuntado automáticamente.
        await sb.from('plan_joins').insert({ plan_id: ins.data.id, user_id: state.userId, name: state.me });
      }
      btn.disabled = false;
      if (ins.error) { toast('No se pudo guardar 😕', 'ti-alert-circle'); console.error(ins.error); return; }
      ['plan-date','plan-time','plan-where','plan-notes'].forEach(function(id){ $(id).value = ''; });
      toggle('plan-form', false);
      await loadPlans();
      confettiFrom(btn);
      toast('¡Propuesta lanzada! 🐾', 'ti-calendar-plus');
    };

    $('log-save').onclick = async function(ev) {
      var content = $('log-content').value.trim();
      if (!content) { toast('Escribe algo 😉', 'ti-pencil'); return; }
      var btn = ev.currentTarget;
      btn.disabled = true;
      var res = await sb.from('logs').insert({
        user_id: state.userId, author: state.me,
        type: $('log-type').value, content: content
      });
      btn.disabled = false;
      if (res.error) { toast('No se pudo publicar 😕', 'ti-alert-circle'); console.error(res.error); return; }
      $('log-content').value = '';
      toggle('log-form', false);
      await loadLog();
      confettiFrom(btn);
      toast('Publicado en la bitácora ✍️', 'ti-notebook');
    };

    $('route-save').onclick = async function(ev) {
      var name = $('route-name').value.trim();
      if (!name) { toast('Ponle un nombre', 'ti-map-pin'); return; }
      var btn = ev.currentTarget;
      btn.disabled = true;
      var res = await sb.from('routes').insert({
        user_id: state.userId, author: state.me, name: name,
        type: $('route-type').value,
        dist: $('route-dist').value.trim() || null,
        notes: $('route-notes').value.trim() || null
      });
      btn.disabled = false;
      if (res.error) { toast('No se pudo guardar 😕', 'ti-alert-circle'); console.error(res.error); return; }
      ['route-name','route-dist','route-notes'].forEach(function(id){ $(id).value = ''; });
      toggle('route-form', false);
      await loadRoutes();
      confettiFrom(btn);
      toast('Ruta guardada 📍', 'ti-map-pin');
    };
  }

  // Anima la salida de la tarjeta antes de quitarla del DOM
  function removeWithAnim(btn, afterFn) {
    var card = btn.closest('.card');
    if (card) {
      card.classList.add('removing');
      setTimeout(afterFn, 250);
    } else {
      afterFn();
    }
  }

  function wireCardClicks() {
    document.body.addEventListener('click', async function(ev) {
      var t = ev.target.closest('[data-join],[data-del-plan],[data-del-log],[data-del-route],[data-purge],[data-react],[data-comments],[data-comment-send],[data-del-comment],[data-del-post],[data-zoom]');
      if (!t) return;

      // ----- Muro: ver foto en grande -----
      if (t.dataset.zoom) {
        var ov = document.createElement('div');
        ov.className = 'lightbox';
        var im = document.createElement('img');
        im.src = t.dataset.zoom;
        ov.appendChild(im);
        ov.onclick = function() { ov.remove(); };
        document.body.appendChild(ov);
        return;
      }

      // ----- Muro: reacción 🔥 -----
      if (t.dataset.react) {
        var post = state.posts.find(function(x) { return x.id === t.dataset.react; });
        if (!post) return;
        var has = post.reactions.some(function(r) { return r.user_id === state.userId; });
        if (has) {
          await sb.from('post_reactions').delete().eq('post_id', post.id).eq('user_id', state.userId);
        } else {
          await sb.from('post_reactions').insert({ post_id: post.id, user_id: state.userId, name: state.me });
          confettiFrom(t);
        }
        await loadPosts();
        return;
      }

      // ----- Muro: abrir/cerrar comentarios -----
      if (t.dataset.comments) {
        var id = t.dataset.comments;
        openComments[id] = !openComments[id];
        var box = $('comments-' + id);
        if (box) box.classList.toggle('open', openComments[id]);
        return;
      }

      // ----- Muro: enviar comentario -----
      if (t.dataset.commentSend) {
        var pid = t.dataset.commentSend;
        var input = $('cinput-' + pid);
        var txt = input ? input.value.trim() : '';
        if (!txt) { if (input) input.focus(); return; }
        openComments[pid] = true;
        var cins = await sb.from('post_comments').insert({ post_id: pid, user_id: state.userId, author: state.me, content: txt });
        if (cins.error) { toast('No se pudo comentar 😕', 'ti-alert-circle'); console.error(cins.error); return; }
        await loadPosts();
        return;
      }

      // ----- Muro: borrar comentario -----
      if (t.dataset.delComment) {
        await sb.from('post_comments').delete().eq('id', t.dataset.delComment);
        await loadPosts();
        return;
      }

      // ----- Muro: borrar publicación (y su foto) -----
      if (t.dataset.delPost) {
        if (!confirm('¿Borrar esta publicación?')) return;
        var pp = state.posts.find(function(x) { return x.id === t.dataset.delPost; });
        removeWithAnim(t, async function() {
          await sb.from('posts').delete().eq('id', t.dataset.delPost);
          if (pp && pp.image_path) await sb.storage.from('posts').remove([pp.image_path]);
          await loadPosts();
          toast('Publicación eliminada', 'ti-trash');
        });
        return;
      }

      if (t.dataset.purge) {
        if (!state.isAdmin) return;
        var u = state.profiles.find(function(x) { return x.id === t.dataset.purge; });
        var nombre = u ? u.name : 'este usuario';
        if (!confirm('¿Borrar TODO el contenido de ' + nombre + '?\n(planes, anécdotas y rutas). No se puede deshacer.')) return;
        var uid = t.dataset.purge;
        await sb.from('plan_joins').delete().eq('user_id', uid);
        await sb.from('plans').delete().eq('user_id', uid);
        await sb.from('logs').delete().eq('user_id', uid);
        await sb.from('routes').delete().eq('user_id', uid);
        await Promise.all([loadPlans(), loadLog(), loadRoutes()]);
        await loadAdmin();
        toast('Contenido de ' + nombre + ' eliminado', 'ti-trash');
        return;
      }

      if (t.dataset.join) {
        var p = state.plans.find(function(x) { return x.id === t.dataset.join; });
        if (!p) return;
        var isIn = (p.joining || []).some(function(j) { return j.user_id === state.userId; });
        if (isIn) {
          await sb.from('plan_joins').delete().eq('plan_id', p.id).eq('user_id', state.userId);
          toast('Te bajaste de este plan', 'ti-user-minus');
        } else {
          await sb.from('plan_joins').insert({ plan_id: p.id, user_id: state.userId, name: state.me });
          confettiFrom(t);
          toast('¡Apuntado! Nos vemos ahí 💪', 'ti-user-plus');
        }
        await loadPlans();

      } else if (t.dataset.delPlan) {
        if (!confirm('¿Borrar esta propuesta?')) return;
        removeWithAnim(t, async function() {
          await sb.from('plans').delete().eq('id', t.dataset.delPlan);
          await loadPlans();
          toast('Propuesta eliminada', 'ti-trash');
        });

      } else if (t.dataset.delLog) {
        if (!confirm('¿Borrar esta entrada?')) return;
        removeWithAnim(t, async function() {
          await sb.from('logs').delete().eq('id', t.dataset.delLog);
          await loadLog();
          toast('Entrada eliminada', 'ti-trash');
        });

      } else if (t.dataset.delRoute) {
        if (!confirm('¿Borrar esta ruta?')) return;
        removeWithAnim(t, async function() {
          await sb.from('routes').delete().eq('id', t.dataset.delRoute);
          await loadRoutes();
          toast('Ruta eliminada', 'ti-trash');
        });
      }
    });
  }

  /* ============================================================
     Tiempo real: refresca cuando otro usuario cambia algo
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadAdmin)
      .subscribe();
  }

  /* ============================================================
     Huellas flotantes del encabezado
  ============================================================ */
  function spawnPaws() {
    var box = $('paws');
    if (!box || box.childElementCount) return;
    for (var i = 0; i < 7; i++) {
      var p = document.createElement('span');
      p.className = 'paw';
      p.textContent = '🐾';
      p.style.left = (5 + Math.random() * 90) + '%';
      p.style.fontSize = (16 + Math.random() * 16) + 'px';
      p.style.animationDuration = (7 + Math.random() * 7) + 's';
      p.style.animationDelay = (Math.random() * 8) + 's';
      box.appendChild(p);
    }
  }

  /* ============================================================
     Autenticación (correo + contraseña)
  ============================================================ */
  var authMode = 'login'; // 'login' | 'signup'
  var appStarted = false;

  function authError(msg) {
    var e = $('auth-error');
    if (!msg) { e.hidden = true; return; }
    e.textContent = msg;
    e.hidden = false;
  }

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

  function showAuthScreen() {
    $('app').hidden = true;
    $('auth-screen').hidden = false;
  }

  async function showApp(user) {
    state.userId = user.id;
    state.me = (user.user_metadata && user.user_metadata.display_name) || user.email.split('@')[0];
    $('me-name').textContent = state.me;
    $('auth-screen').hidden = true;
    $('app').hidden = false;
    spawnPaws();
    if (!appStarted) {
      appStarted = true;
      wireForms();
      wireCardClicks();
      wirePosts();
      wireAdmin();
      subscribeRealtime();
      // Refresca las cuentas regresivas para que "en X min" siga al día
      setInterval(renderPlans, 60000);
    }
    await checkAdmin();
    $('admin-badge').hidden = !state.isAdmin;
    $('admin-section').hidden = !state.isAdmin;
    loadAll();
    loadAdmin();
  }

  function wireAdmin() {
    $('admin-toggle').onclick = function() {
      var panel = $('admin-panel');
      var open = panel.classList.toggle('open');
      this.classList.toggle('open', open);
      this.textContent = open ? 'Ocultar' : 'Mostrar';
    };
  }

  async function handleAuthSubmit() {
    var email = $('auth-email').value.trim();
    var pass = $('auth-pass').value;
    if (!email || !pass) { authError('Completa correo y contraseña.'); return; }

    var btn = $('auth-submit');
    btn.disabled = true;
    authError('');

    if (authMode === 'signup') {
      var name = $('auth-name').value.trim();
      if (!name) { authError('Pon tu nombre.'); btn.disabled = false; return; }
      var up = await sb.auth.signUp({
        email: email, password: pass,
        options: { data: { display_name: name } }
      });
      btn.disabled = false;
      if (up.error) { authError(traducirError(up.error.message)); return; }
      if (!up.data.session) {
        // El proyecto pide confirmar el correo antes de entrar.
        toast('Revisa tu correo para confirmar la cuenta 📧', 'ti-mail');
        setAuthMode('login');
        return;
      }
      // Si la confirmación está desactivada, ya hay sesión: onAuthStateChange abre la app.
    } else {
      var inp = await sb.auth.signInWithPassword({ email: email, password: pass });
      btn.disabled = false;
      if (inp.error) { authError(traducirError(inp.error.message)); return; }
    }
  }

  function traducirError(msg) {
    msg = msg || '';
    if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
    if (/User already registered/i.test(msg)) return 'Ese correo ya tiene cuenta. Inicia sesión.';
    if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
    if (/valid email/i.test(msg)) return 'Escribe un correo válido.';
    return msg;
  }

  function wireAuth() {
    $('auth-submit').onclick = handleAuthSubmit;
    $('auth-pass').addEventListener('keydown', function(e) { if (e.key === 'Enter') handleAuthSubmit(); });
    $('auth-switch-btn').onclick = function() { setAuthMode(authMode === 'login' ? 'signup' : 'login'); };
    $('logout-btn').onclick = async function() { await sb.auth.signOut(); };
  }

  /* ============================================================
     Arranque
  ============================================================ */
  wireAuth();
  setAuthMode('login');

  // Reacciona a login / logout (también restaura la sesión guardada).
  sb.auth.onAuthStateChange(function(_event, session) {
    if (session && session.user) showApp(session.user);
    else { appStarted && location.reload(); showAuthScreen(); }
  });

  // Estado inicial por si onAuthStateChange tarda.
  sb.auth.getSession().then(function(res) {
    if (res.data.session) showApp(res.data.session.user);
    else showAuthScreen();
  });
})();
