(() => {
  const cfg = window.APP_CONFIG || {};
  const supabaseReady = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const db = supabaseReady ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, contacts: [], month: '', view: 'overview', search: '' };
  const contactTypes = ['Web/Email', 'Visita física', 'Teléfono', 'WhatsApp', 'Visita sin comercial', 'Invitación'];
  const today = new Date();
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monthKey = (date) => (date || '').slice(0, 7);
  const monthEnd = (month) => {
    const [year, monthNumber] = month.split('-').map(Number);
    return isoDay(new Date(year, monthNumber, 0));
  };

  function showError(target, message) { target.textContent = message; }
  function notice(message, kind = '') {
    const box = $('notice');
    box.textContent = message;
    box.className = `notice ${kind}`;
    box.classList.remove('hidden');
    window.setTimeout(() => box.classList.add('hidden'), 7000);
  }
  function fmtDate(value) {
    if (!value) return '—';
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
  }
  function fmtPercent(numerator, denominator) {
    return denominator ? `${Math.round((numerator / denominator) * 100)}%` : '—';
  }
  function dateOffset(date, days) {
    if (!date) return '';
    const [y, m, d] = date.split('-').map(Number);
    const out = new Date(y, m - 1, d + days);
    return isoDay(out);
  }
  function dueFor(contact, kind) {
    if (!contact.visit_date) return '';
    return dateOffset(contact.visit_date, kind === 'hot' ? 1 : 8);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function inSelectedMonth(date) { return monthKey(date) === state.month; }

  async function loadContacts() {
    const all = [];
    const pageSize = 1000;
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await db.from('gym_contacts').select('*').order('contact_date', { ascending: false }).range(start, start + pageSize - 1);
      if (error) throw error;
      all.push(...data);
      if (data.length < pageSize) break;
    }
    state.contacts = all;
    render();
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.view-section').forEach((section) => section.classList.toggle('hidden', section.id !== `${view}-section`));
    document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${view}`));
    $('page-title').textContent = ({ overview: 'Resumen', contacts: 'Contactos', followups: 'Seguimientos' })[view];
  }

  function render() {
    if (!db || !state.user) return;
    const contactsInMonth = state.contacts.filter((c) => inSelectedMonth(c.contact_date));
    const visits = contactsInMonth.filter((c) => Boolean(c.visit_date));
    const sales = state.contacts.filter((c) => c.is_alta && inSelectedMonth(c.alta_date));
    const noSale = contactsInMonth.filter((c) => !c.alta_date || c.alta_date > monthEnd(state.month));
    const visitsNoSale = visits.filter((c) => !c.alta_date || c.alta_date > monthEnd(state.month));
    $('stat-contacts').textContent = contactsInMonth.length;
    $('stat-no-sale').textContent = noSale.length;
    $('stat-visits').textContent = visits.length;
    $('stat-visits-no-sale').textContent = visitsNoSale.length;
    $('stat-sales').textContent = sales.length;
    $('ratio-contact-sales').textContent = fmtPercent(sales.length, contactsInMonth.length);
    $('ratio-contact-visits').textContent = fmtPercent(visits.length, contactsInMonth.length);
    $('ratio-visit-sales').textContent = fmtPercent(sales.length, visits.length);

    const [year, monthNumber] = state.month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const countsByDay = Array.from({ length: daysInMonth }, (_, index) => contactsInMonth.filter((c) => Number(c.contact_date.slice(8, 10)) === index + 1).length);
    const maxDay = Math.max(1, ...countsByDay);
    $('daily-total').textContent = `${contactsInMonth.length} contactos`;
    $('daily-chart').innerHTML = countsByDay.map((count, index) => `<div class="day-column" title="${index + 1}: ${count} contacto${count === 1 ? '' : 's'}"><div class="bar-track"><span class="bar-fill ${count ? '' : 'zero'}" style="height:${count ? Math.max(5, (count / maxDay) * 100) : 2}%"></span></div><small>${index + 1}</small></div>`).join('');

    const recent = [...contactsInMonth].sort((a, b) => b.contact_date.localeCompare(a.contact_date)).slice(0, 8);
    $('recent-rows').innerHTML = recent.length ? recent.map((c) => `<tr><td>${escapeHtml(c.member_number || 'Sin número')}</td><td>${escapeHtml(c.contact_type)}</td><td>${fmtDate(c.contact_date)}</td><td>${fmtDate(c.visit_date)}</td><td>${statusBadge(c)}</td></tr>`).join('') : emptyRow(5, 'No hay contactos en este mes.');

    const q = state.search.toLocaleLowerCase('es');
    const filtered = contactsInMonth.filter((c) => !q || `${c.member_number || ''} ${c.contact_type}`.toLocaleLowerCase('es').includes(q));
    $('contact-rows').innerHTML = filtered.length ? filtered.map(contactRow).join('') : emptyRow(7, 'No hay contactos que coincidan.');

    const tasks = state.contacts.flatMap((c) => {
      if (c.is_alta) return [];
      return [
        !c.hot_done && dueFor(c, 'hot') ? { c, kind: 'Hot', date: dueFor(c, 'hot'), field: 'hot_done' } : null,
        !c.warm_done && dueFor(c, 'warm') ? { c, kind: 'Warm', date: dueFor(c, 'warm'), field: 'warm_done' } : null
      ].filter(Boolean);
    }).sort((a, b) => a.date.localeCompare(b.date));
    const dueTodayOrPast = tasks.filter((t) => t.date <= isoDay(today));
    $('today-followups').innerHTML = dueTodayOrPast.length ? dueTodayOrPast.slice(0, 5).map((t) => `<div class="compact-item"><span class="task-dot ${t.kind.toLowerCase()}"></span><div><strong>${t.kind} · ${escapeHtml(t.c.member_number || 'Sin número')}</strong><small>${fmtDate(t.date)}</small></div><button class="mini-check" data-complete="${t.c.id}" data-field="${t.field}" aria-label="Marcar realizado">✓</button></div>`).join('') : '<p class="empty-state">No hay seguimientos vencidos o para hoy.</p>';
    $('followup-rows').innerHTML = tasks.length ? tasks.map((t) => `<tr class="${t.date < isoDay(today) ? 'overdue' : ''}"><td>${escapeHtml(t.c.member_number || 'Sin número')}</td><td>${escapeHtml(t.c.contact_type)}</td><td>${fmtDate(t.date)}</td><td><span class="pill ${t.kind.toLowerCase()}">${t.kind}</span></td><td><button class="button small secondary" data-complete="${t.c.id}" data-field="${t.field}">Marcar hecho</button></td></tr>`).join('') : emptyRow(5, 'No hay seguimientos pendientes.');
  }

  function statusBadge(c) {
    if (c.is_alta) return '<span class="pill success">Alta</span>';
    if (c.visit_date) return '<span class="pill warm">Visita</span>';
    return '<span class="pill neutral">Contacto</span>';
  }
  function contactRow(c) {
    const hot = c.is_alta ? '—' : (c.hot_done ? '<span class="pill success">Hecho</span>' : `<span class="pill ${dueFor(c, 'hot') ? 'hot' : 'neutral'}">${dueFor(c, 'hot') ? fmtDate(dueFor(c, 'hot')) : '—'}</span>`);
    const warm = c.is_alta ? '—' : (c.warm_done ? '<span class="pill success">Hecho</span>' : `<span class="pill ${dueFor(c, 'warm') ? 'warm' : 'neutral'}">${dueFor(c, 'warm') ? fmtDate(dueFor(c, 'warm')) : '—'}</span>`);
    const review = c.import_warnings?.length ? `<span class="pill warning" title="${escapeHtml(c.import_warnings.join(' · '))}">Revisar</span>` : '';
    return `<tr><td>${escapeHtml(c.member_number || 'Sin número')}</td><td>${escapeHtml(c.contact_type)}</td><td>${fmtDate(c.contact_date)}</td><td>${fmtDate(c.visit_date)}</td><td>${hot}</td><td>${warm}</td><td>${c.is_alta ? `<span class="pill success">Alta · ${fmtDate(c.alta_date)}</span>` : '<span class="pill neutral">Sin alta</span>'} ${review}</td></tr>`;
  }
  function emptyRow(span, text) { return `<tr><td class="empty-cell" colspan="${span}">${escapeHtml(text)}</td></tr>`; }

  async function saveContact(form) {
    const values = new FormData(form);
    const isAlta = values.get('is_alta') === 'on';
    const visitDate = values.get('visit_date') || null;
    const payload = {
      owner_id: state.user.id,
      member_number: values.get('member_number')?.trim() || null,
      contact_type: values.get('contact_type'),
      contact_date: values.get('contact_date'),
      visit_date: visitDate,
      hot_done: Boolean(visitDate && values.get('hot_done') === 'on'),
      warm_done: Boolean(visitDate && values.get('warm_done') === 'on'),
      is_alta: isAlta,
      alta_date: isAlta ? (values.get('alta_date') || null) : null
    };
    if (isAlta && !payload.alta_date) throw new Error('Indica la fecha del alta.');
    const { error } = await db.from('gym_contacts').insert(payload);
    if (error) throw error;
    form.reset();
    $('alta-date-field').classList.add('hidden');
    $('contact-dialog').close();
    notice('Contacto guardado.');
    await loadContacts();
  }

  async function completeFollowup(id, field) {
    const { error } = await db.from('gym_contacts').update({ [field]: true }).eq('id', id);
    if (error) return notice(`No se pudo actualizar el seguimiento: ${error.message}`, 'error');
    await loadContacts();
  }

  const trueValue = (value) => ['ok', 'si', 'sí', 'yes', 'true', '1', 'x'].includes(String(value ?? '').trim().toLocaleLowerCase('es'));
  function excelDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDay(new Date(value.getFullYear(), value.getMonth(), value.getDate()));
    if (typeof value === 'number' && value > 20000 && value < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
    if (typeof value === 'string' && value.trim()) {
      const dmy = value.trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
      if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return isoDay(date);
    }
    return null;
  }
  function normalizeType(value) {
    const normalized = String(value ?? '').trim().toLocaleLowerCase('es').replaceAll(' ', '').replaceAll('.', '');
    if (['web/mail', 'web/email', 'email', 'web'].includes(normalized)) return 'Web/Email';
    if (['visita', 'visitafisica'].includes(normalized)) return 'Visita física';
    if (['telf', 'telefono', 'teléfono'].includes(normalized)) return 'Teléfono';
    if (['whatsapp', 'whats'].includes(normalized)) return 'WhatsApp';
    if (['visitasincomercial'].includes(normalized)) return 'Visita sin comercial';
    if (['invitacion', 'invitación'].includes(normalized)) return 'Invitación';
    return contactTypes.includes(value) ? value : null;
  }
  function normalizeMember(value) {
    const member = String(value ?? '').trim().replace(/^\*+|\*+$/g, '').trim();
    return member || null;
  }
  function importRows(workbook) {
    const imported = [];
    const skipped = [];
    for (const sheetName of workbook.SheetNames) {
      if (/plantilla|listas/i.test(sheetName)) continue;
      const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
      for (let i = 4; i < matrix.length; i++) {
        const row = matrix[i] || [];
        const rawMember = row[1] || row[0]; // La columna "Otros" se usó para repetir un número de socio.
        const type = normalizeType(row[2]);
        const contactDate = excelDate(row[3]);
        const visitDate = excelDate(row[4]);
        const rawHotDone = trueValue(row[6]);
        const rawWarmDone = trueValue(row[8]);
        const isAlta = trueValue(row[9]);
        const altaDate = excelDate(row[10]);
        if (!rawMember && !row[2] && !row[3] && !row[4] && !row[9]) continue;
        const sourceKey = `${sheetName}:${i + 1}`;
        const warnings = [];
        if (!contactDate) { skipped.push(`${sheetName}, fila ${i + 1}: falta la fecha del contacto.`); continue; }
        if (!type) warnings.push(`Tipo de contacto sin reconocer: ${String(row[2] ?? 'vacío')}`);
        if ((rawHotDone || rawWarmDone) && !visitDate) warnings.push('Seguimiento marcado sin fecha de visita; queda pendiente de revisión.');
        if (isAlta && !altaDate) warnings.push('Alta marcada sin fecha; queda fuera del total mensual de altas hasta completar la fecha.');
        if (altaDate && altaDate < contactDate) warnings.push('La fecha de alta es anterior al contacto; posible error de registro.');
        imported.push({
          owner_id: state.user.id,
          member_number: normalizeMember(rawMember),
          contact_type: type || 'Web/Email',
          contact_date: contactDate,
          visit_date: visitDate,
          hot_done: Boolean(visitDate && rawHotDone),
          warm_done: Boolean(visitDate && rawWarmDone),
          is_alta: isAlta,
          alta_date: altaDate,
          import_warnings: warnings,
          legacy_source_key: sourceKey
        });
      }
    }
    return { imported, skipped };
  }

  async function importWorkbook(file) {
    if (!window.XLSX) throw new Error('No se pudo cargar el lector de Excel. Comprueba la conexión a Internet e inténtalo de nuevo.');
    $('import-progress').textContent = 'Leyendo el libro…';
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true, cellFormula: false });
    const { imported, skipped } = importRows(workbook);
    if (!imported.length) throw new Error('No se encontraron filas importables con fecha de contacto.');
    const batchSize = 400;
    for (let start = 0; start < imported.length; start += batchSize) {
      const batch = imported.slice(start, start + batchSize);
      $('import-progress').textContent = `Guardando ${Math.min(start + batch.length, imported.length)} de ${imported.length} filas…`;
      const { error } = await db.from('gym_contacts').upsert(batch, { onConflict: 'owner_id,legacy_source_key' });
      if (error) throw error;
    }
    const warnings = imported.reduce((sum, row) => sum + row.import_warnings.length, 0);
    $('import-progress').textContent = `Importación completada: ${imported.length} filas. ${warnings} avisos para revisar y ${skipped.length} filas omitidas por no tener fecha de contacto.`;
    notice(`Importación lista: ${imported.length} filas cargadas y ${warnings} avisos para revisar.`);
    await loadContacts();
  }

  $('month-filter').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  state.month = $('month-filter').value;
  $('month-filter').addEventListener('change', (e) => { state.month = e.target.value; render(); });
  $('search-input').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('.nav-link').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setView(a.hash.slice(1)); }));
  document.body.addEventListener('click', (e) => {
    const button = e.target.closest('[data-complete]');
    if (button) completeFollowup(button.dataset.complete, button.dataset.field);
  });
  $('new-contact-button').addEventListener('click', () => { $('contact-form').elements.contact_date.value = isoDay(today); $('contact-dialog').showModal(); });
  $('close-dialog').addEventListener('click', () => $('contact-dialog').close());
  $('cancel-dialog').addEventListener('click', () => $('contact-dialog').close());
  $('is-alta').addEventListener('change', (e) => { $('alta-date-field').classList.toggle('hidden', !e.target.checked); $('contact-form').elements.alta_date.required = e.target.checked; });
  $('contact-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await saveContact(e.currentTarget); } catch (error) { notice(error.message, 'error'); } });
  $('import-button').addEventListener('click', () => { $('import-progress').textContent = ''; $('import-dialog').showModal(); });
  $('close-import').addEventListener('click', () => $('import-dialog').close());
  $('cancel-import').addEventListener('click', () => $('import-dialog').close());
  $('choose-excel').addEventListener('click', () => $('excel-file').click());
  $('excel-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { await importWorkbook(file); } catch (error) { $('import-progress').textContent = error.message; }
    e.target.value = '';
  });
  $('logout-button').addEventListener('click', () => db?.auth.signOut());

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supabaseReady) return showError($('login-error'), 'Primero configura la URL y la clave publicable en supabase-config.js.');
    const values = new FormData(e.currentTarget);
    const { error } = await db.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') });
    if (error) showError($('login-error'), error.message);
  });

  if (!supabaseReady) showError($('login-error'), 'La aplicación está lista. Configura tu proyecto Supabase para activar el acceso.');
  else db.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user || null;
    $('auth-view').classList.toggle('hidden', Boolean(state.user));
    $('app-view').classList.toggle('hidden', !state.user);
    if (state.user) {
      window.setTimeout(() => loadContacts().catch((error) => notice(`No se pudieron cargar los datos: ${error.message}`, 'error')), 0);
    }
  });
})();

