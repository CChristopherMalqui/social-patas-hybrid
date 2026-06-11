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
  var state = { plans: [], log: [], routes: [], me: '', userId: null };

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

  // Botón de borrar: solo aparece en lo que creó el usuario actual.
  function delBtn(attr, ownerId) {
    if (ownerId !== state.userId) return '';
    return '<button class="del" data-' + attr + ' aria-label="eliminar"><i class="ti ti-x"></i></button>';
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
        '<span class="author">propuso ' + esc(p.author || 'alguien') + '</span>' +
        delBtn('del-plan="' + p.id + '"', p.user_id) +
        '</div>' +
        (p.place ? '<div class="where">' + esc(p.place) + '</div>' : '') +
        (p.notes ? '<div class="notes">' + esc(p.notes) + '</div>' : '') +
        '<div class="joiners">' +
          joining.map(function(j) { return '<span class="chip">' + esc(j.name) + '</span>'; }).join('') +
          '<button class="join-btn ' + (isIn ? 'in' : '') + '" data-join="' + p.id + '">' + (isIn ? '− me bajo' : '+ me apunto') + '</button>' +
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
    renderPlans(); renderStats();
  }

  async function loadLog() {
    var res = await sb.from('logs').select('*').order('created', { ascending: false });
    if (res.error) { console.error(res.error); return; }
    state.log = res.data || [];
    renderLog(); renderStats();
  }

  async function loadRoutes() {
    var res = await sb.from('routes').select('*').order('created', { ascending: false });
    if (res.error) { console.error(res.error); return; }
    state.routes = res.data || [];
    renderRoutes(); renderStats();
  }

  function loadAll() { loadPlans(); loadLog(); loadRoutes(); }

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
      var t = ev.target.closest('[data-join],[data-del-plan],[data-del-log],[data-del-route]');
      if (!t) return;

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

  function showApp(user) {
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
      subscribeRealtime();
      // Refresca las cuentas regresivas para que "en X min" siga al día
      setInterval(renderPlans, 60000);
    }
    loadAll();
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
