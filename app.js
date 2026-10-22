(() => {
  const cfg = window.APP_CONFIG || {};
  const supabaseReady = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const db = supabaseReady ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, contacts: [], monthlyCancellations: [], cancellationsLoaded: false, month: '', year: String(new Date().getFullYear()), periodMode: 'month', rangeStart: '', rangeEnd: '', view: 'overview', search: '', typeFilter: '', dateFrom: '', dateTo: '', sortBy: 'member_number', sortDirection: 'asc', pendingDelete: null };
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
  function selectedPeriod() {
    if (state.periodMode === 'month') return { start: `${state.month}-01`, end: monthEnd(state.month) };
    if (state.periodMode === 'year') return { start: `${state.year}-01-01`, end: `${state.year}-12-31` };
    return { start: state.rangeStart, end: state.rangeEnd };
  }
  function inSelectedPeriod(date) {
    const { start, end } = selectedPeriod();
    return Boolean(date && start && end && date >= start && date <= end);
  }
  function cancellationMonthInSelectedPeriod(monthStart) {
    if (!monthStart) return false;
    const { start, end } = selectedPeriod();
    const first = `${monthStart.slice(0, 7)}-01`;
    const last = monthEnd(monthStart.slice(0, 7));
    return first <= end && last >= start;
  }
  function updateSortIndicators() {
    document.querySelectorAll('.sort-header').forEach((button) => {
      const active = button.dataset.sortKey === state.sortBy;
      const arrow = active ? (state.sortDirection === 'asc' ? '↑' : '↓') : '↕';
      button.querySelector('.sort-indicator').textContent = arrow;
      button.closest('th').setAttribute('aria-sort', active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
      button.setAttribute('aria-label', `${button.textContent.trim().replace(/[↑↓↕]/g, '').trim()}; ${active ? (state.sortDirection === 'asc' ? 'orden ascendente' : 'orden descendente') : 'ordenar'}`);
    });
  }

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
    updateYearOptions();
    render();
  }

  async function loadMonthlyCancellations() {
    const { data, error } = await db.from('gym_monthly_cancellations').select('*').order('month_start', { ascending: false });
    if (error) throw error;
    state.monthlyCancellations = data || [];
    state.cancellationsLoaded = true;
    updateYearOptions();
    renderCancellations();
    render();
  }

  function updateYearOptions() {
    const years = new Set([String(today.getFullYear())]);
    state.contacts.forEach((contact) => [contact.contact_date, contact.visit_date, contact.alta_date].forEach((date) => {
      if (date) years.add(date.slice(0, 4));
    }));
    state.monthlyCancellations.forEach((record) => { if (record.month_start) years.add(record.month_start.slice(0, 4)); });
    if (!years.has(state.year)) years.add(state.year);
    $('year-filter').innerHTML = [...years].sort((a, b) => Number(b) - Number(a)).map((year) => `<option value="${year}">${year}</option>`).join('');
    $('year-filter').value = state.year;
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.view-section').forEach((section) => section.classList.toggle('hidden', section.id !== `${view}-section`));
    document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${view}`));
    $('page-title').textContent = ({ overview: 'Resumen', contacts: 'Contactos', cancellations: 'Bajas', followups: 'Seguimientos' })[view];
  }

  function render() {
    if (!db || !state.user) return;
    const { start: periodStart, end: periodEnd } = selectedPeriod();
    if (!periodStart || !periodEnd || periodStart > periodEnd) return;
    const contactsInPeriod = state.contacts.filter((c) => inSelectedPeriod(c.contact_date));
    const visits = contactsInPeriod.filter((c) => Boolean(c.visit_date));
    const sales = state.contacts.filter((c) => c.is_alta && inSelectedPeriod(c.alta_date));
    const cancellations = state.cancellationsLoaded ? state.monthlyCancellations.filter((record) => cancellationMonthInSelectedPeriod(record.month_start)).reduce((total, record) => total + Number(record.cancellation_count || 0), 0) : null;
    const noSale = contactsInPeriod.filter((c) => !c.alta_date || c.alta_date > periodEnd);
    const visitsNoSale = visits.filter((c) => !c.alta_date || c.alta_date > periodEnd);
    const periodLabel = state.periodMode === 'month' ? 'mes' : (state.periodMode === 'year' ? 'año' : 'periodo');
    $('stat-contacts-label').textContent = `Contactos del ${periodLabel}`;
    $('stat-sales-label').textContent = `Altas del ${periodLabel}`;
    $('stat-cancellations-label').textContent = `Bajas del ${periodLabel}`;
    $('stat-cancellations-note').textContent = state.periodMode === 'range' ? 'Incluye los meses que se solapan con el rango' : 'Bajas registradas por mes';
    $('stat-contacts').textContent = contactsInPeriod.length;
    $('stat-no-sale').textContent = noSale.length;
    $('stat-visits').textContent = visits.length;
    $('stat-visits-no-sale').textContent = visitsNoSale.length;
    $('stat-sales').textContent = sales.length;
    $('stat-cancellations').textContent = cancellations === null ? '—' : cancellations;
    $('stat-balance').textContent = cancellations === null ? '—' : sales.length - cancellations;
    $('ratio-contact-sales').textContent = fmtPercent(sales.length, contactsInPeriod.length);
    $('ratio-contact-visits').textContent = fmtPercent(visits.length, contactsInPeriod.length);
    $('ratio-visit-sales').textContent = fmtPercent(sales.length, visits.length);

    const isYear = state.periodMode === 'year';
    $('daily-title').textContent = isYear ? 'Contactos por mes' : 'Contactos por día';
    const dayKeys = [];
    if (isYear) {
      for (let month = 1; month <= 12; month++) dayKeys.push(`${state.year}-${String(month).padStart(2, '0')}`);
    } else {
      for (let day = periodStart; day <= periodEnd; day = dateOffset(day, 1)) dayKeys.push(day);
    }
    const countsByDate = new Map();
    contactsInPeriod.forEach((contact) => {
      const key = isYear ? contact.contact_date.slice(0, 7) : contact.contact_date;
      countsByDate.set(key, (countsByDate.get(key) || 0) + 1);
    });
    const countsByDay = dayKeys.map((day) => countsByDate.get(day) || 0);
    const maxDay = Math.max(1, ...countsByDay);
    $('daily-total').textContent = `${contactsInPeriod.length} contactos`;
    $('daily-chart').innerHTML = countsByDay.map((count, index) => {
      const day = dayKeys[index];
      const label = isYear ? new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 1)) : (state.periodMode === 'month' ? String(Number(day.slice(8, 10))) : `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`);
      const title = isYear ? new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 1)) : fmtDate(day);
      return `<div class="day-column" title="${title}: ${count} contacto${count === 1 ? '' : 's'}"><div class="bar-track"><span class="bar-fill ${count ? '' : 'zero'}" style="height:${count ? Math.max(5, (count / maxDay) * 100) : 2}%"></span></div><small>${label}</small></div>`;
    }).join('');

    const recent = [...contactsInPeriod].sort((a, b) => b.contact_date.localeCompare(a.contact_date)).slice(0, 8);
    $('recent-rows').innerHTML = recent.length ? recent.map((c) => `<tr><td>${escapeHtml(c.member_number || 'Sin número')}</td><td>${escapeHtml(c.contact_type)}</td><td>${fmtDate(c.contact_date)}</td><td>${fmtDate(c.visit_date)}</td><td>${statusBadge(c)}</td></tr>`).join('') : emptyRow(5, 'No hay contactos en este periodo.');

    const q = state.search.toLocaleLowerCase('es');
    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
    const filtered = contactsInPeriod.filter((c) => {
      const matchesSearch = !q || `${c.member_number || ''} ${c.contact_type}`.toLocaleLowerCase('es').includes(q);
      const matchesType = !state.typeFilter || c.contact_type === state.typeFilter;
      const matchesFrom = !state.dateFrom || c.contact_date >= state.dateFrom;
      const matchesTo = !state.dateTo || c.contact_date <= state.dateTo;
      return matchesSearch && matchesType && matchesFrom && matchesTo;
    }).sort((a, b) => {
      const left = a[state.sortBy] ?? '';
      const right = b[state.sortBy] ?? '';
      if (left === '' && right === '') return 0;
      if (left === '') return 1;
      if (right === '') return -1;
      const result = collator.compare(String(left), String(right));
      return state.sortDirection === 'asc' ? result : -result;
    });
    updateSortIndicators();
    $('contact-count').textContent = `${filtered.length} de ${contactsInPeriod.length} contactos`;
    $('contact-rows').innerHTML = filtered.length ? filtered.map(contactRow).join('') : emptyRow(8, 'No hay contactos que coincidan.');

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
  function cancellationMonthLabel(monthStart) {
    const [year, month] = monthStart.slice(0, 7).split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  }
  function renderCancellations() {
    const month = $('cancellation-month').value;
    if (!state.cancellationsLoaded) {
      $('cancellation-error').textContent = 'No se pudieron cargar las bajas. Comprueba que se haya ejecutado la migración 002 de Supabase.';
      $('cancellation-error').classList.remove('hidden');
      $('cancellation-count').textContent = '—';
      $('decrease-cancellations').disabled = true;
      $('increase-cancellations').disabled = true;
      return;
    }
    $('cancellation-error').classList.add('hidden');
    const record = state.monthlyCancellations.find((row) => row.month_start.slice(0, 7) === month);
    const count = Number(record?.cancellation_count || 0);
    $('cancellation-count').textContent = count;
    $('cancellation-month-label').textContent = month ? `Total de ${cancellationMonthLabel(`${month}-01`)}` : '';
    $('decrease-cancellations').disabled = count === 0;
    $('increase-cancellations').disabled = false;
  }

  async function adjustMonthlyCancellations(delta) {
    const month = $('cancellation-month').value;
    if (!month) throw new Error('Elige el mes y el año.');
    const current = Number($('cancellation-count').textContent || 0);
    const count = Math.max(0, current + delta);
    $('decrease-cancellations').disabled = true;
    $('increase-cancellations').disabled = true;
    const { error } = await db.from('gym_monthly_cancellations').upsert({
      owner_id: state.user.id,
      month_start: `${month}-01`,
      cancellation_count: count
    }, { onConflict: 'owner_id,month_start' });
    if (error) {
      renderCancellations();
      throw error;
    }
    await loadMonthlyCancellations();
  }

  function contactRow(c) {
    const hot = c.is_alta ? '—' : (c.hot_done ? '<span class="pill success">Hecho</span>' : `<span class="pill ${dueFor(c, 'hot') ? 'hot' : 'neutral'}">${dueFor(c, 'hot') ? fmtDate(dueFor(c, 'hot')) : '—'}</span>`);
    const warm = c.is_alta ? '—' : (c.warm_done ? '<span class="pill success">Hecho</span>' : `<span class="pill ${dueFor(c, 'warm') ? 'warm' : 'neutral'}">${dueFor(c, 'warm') ? fmtDate(dueFor(c, 'warm')) : '—'}</span>`);
    const review = c.import_warnings?.length ? `<span class="pill warning" title="${escapeHtml(c.import_warnings.join(' · '))}">Revisar</span>` : '';
    return `<tr><td>${escapeHtml(c.member_number || 'Sin número')}</td><td>${escapeHtml(c.contact_type)}</td><td>${fmtDate(c.contact_date)}</td><td>${fmtDate(c.visit_date)}</td><td>${hot}</td><td>${warm}</td><td>${c.is_alta ? `<span class="pill success">Alta · ${fmtDate(c.alta_date)}</span>` : '<span class="pill neutral">Sin alta</span>'} ${review}</td><td class="action-cell"><button class="delete-button" type="button" data-delete-contact="${escapeHtml(c.id)}" aria-label="Eliminar contacto de socio ${escapeHtml(c.member_number || 'sin número')}" title="Eliminar contacto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m3 3v7m6-7v7" /></svg></button></td></tr>`;
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

  function requestDeleteContact(id) {
    const contact = state.contacts.find((item) => item.id === id);
    if (!contact) return;
    state.pendingDelete = id;
    const member = contact.member_number ? `Socio ${contact.member_number}` : 'Sin número de socio';
    $('delete-confirm-details').textContent = `${member} · ${contact.contact_type} · ${fmtDate(contact.contact_date)}`;
    $('delete-confirm').showModal();
  }

  async function deletePendingContact() {
    if (!state.pendingDelete) return;
    const button = $('confirm-delete');
    button.disabled = true;
    try {
      const { error } = await db.from('gym_contacts').delete().eq('id', state.pendingDelete).eq('owner_id', state.user.id);
      if (error) throw error;
      $('delete-confirm').close();
      state.pendingDelete = null;
      notice('Contacto eliminado.');
      await loadContacts();
    } catch (error) {
      notice(`No se pudo eliminar el contacto: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
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

  function importMonthlyCancellations(workbook) {
    const monthNumbers = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    const imported = new Map();
    for (const sheetName of workbook.SheetNames) {
      if (/plantilla|listas/i.test(sheetName)) continue;
      const normalizedName = sheetName.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const match = normalizedName.match(/^([a-z]+)\s+(\d{4})$/);
      if (!match || !monthNumbers[match[1]]) continue;
      const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
      const row = matrix.find((cells) => cells.some((value) => String(value ?? '').trim().toLocaleLowerCase('es') === 'bajas del mes'));
      if (!row) continue;
      const labelColumn = row.findIndex((value) => String(value ?? '').trim().toLocaleLowerCase('es') === 'bajas del mes');
      const rawCount = row[labelColumn + 1];
      if (rawCount === null || rawCount === undefined || String(rawCount).trim() === '') continue;
      const count = Number(rawCount);
      if (!Number.isInteger(count) || count < 0) continue;
      const monthStart = `${match[2]}-${String(monthNumbers[match[1]]).padStart(2, '0')}-01`;
      imported.set(monthStart, { owner_id: state.user.id, month_start: monthStart, cancellation_count: count });
    }
    return [...imported.values()];
  }

  async function importWorkbook(file) {
    if (!window.XLSX) throw new Error('No se pudo cargar el lector de Excel. Comprueba la conexión a Internet e inténtalo de nuevo.');
    $('import-progress').textContent = 'Leyendo el libro…';
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true, cellFormula: false });
    const { imported, skipped } = importRows(workbook);
    const monthlyCancellationRows = importMonthlyCancellations(workbook);
    if (!imported.length && !monthlyCancellationRows.length) throw new Error('No se encontraron contactos ni bajas mensuales importables.');
    let cancellationRowsToInsert = [];
    let cancellationMonthsAlreadyPresent = 0;
    if (monthlyCancellationRows.length) {
      const { data: existingMonths, error } = await db.from('gym_monthly_cancellations').select('month_start').eq('owner_id', state.user.id);
      if (error) throw error;
      const existing = new Set((existingMonths || []).map((row) => row.month_start));
      cancellationRowsToInsert = monthlyCancellationRows.filter((row) => !existing.has(row.month_start));
      cancellationMonthsAlreadyPresent = monthlyCancellationRows.length - cancellationRowsToInsert.length;
    }
    const batchSize = 400;
    for (let start = 0; start < imported.length; start += batchSize) {
      const batch = imported.slice(start, start + batchSize);
      $('import-progress').textContent = `Guardando ${Math.min(start + batch.length, imported.length)} de ${imported.length} contactos…`;
      const { error } = await db.from('gym_contacts').upsert(batch, { onConflict: 'owner_id,legacy_source_key' });
      if (error) throw error;
    }
    if (cancellationRowsToInsert.length) {
      const { error } = await db.from('gym_monthly_cancellations').upsert(cancellationRowsToInsert, { onConflict: 'owner_id,month_start', ignoreDuplicates: true });
      if (error) throw error;
    }
    const warnings = imported.reduce((sum, row) => sum + row.import_warnings.length, 0);
    $('import-progress').textContent = `Importación completada: ${imported.length} contactos y ${cancellationRowsToInsert.length} meses con bajas. ${cancellationMonthsAlreadyPresent} meses ya tenían datos y se conservaron.`;
    notice(`Importación lista: ${imported.length} contactos y ${cancellationRowsToInsert.length} meses con bajas. ${warnings} avisos y ${skipped.length} filas sin fecha de contacto.`);
    await loadContacts();
    await loadMonthlyCancellations();
  }

  $('month-filter').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  state.month = $('month-filter').value;
  updateYearOptions();
  state.rangeStart = `${state.month}-01`;
  state.rangeEnd = monthEnd(state.month);
  $('range-start').value = state.rangeStart;
  $('range-end').value = state.rangeEnd;
  $('cancellation-month').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  $('period-mode').addEventListener('change', (e) => {
    state.periodMode = e.target.value;
    const isRange = state.periodMode === 'range';
    const isMonth = state.periodMode === 'month';
    $('month-picker-label').classList.toggle('hidden', !isMonth);
    $('year-picker-label').classList.toggle('hidden', state.periodMode !== 'year');
    $('range-start-label').classList.toggle('hidden', !isRange);
    $('range-end-label').classList.toggle('hidden', !isRange);
    $('period-range-error').classList.add('hidden');
    render();
  });
  $('month-filter').addEventListener('change', (e) => { state.month = e.target.value; render(); });
  $('year-filter').addEventListener('change', (e) => { state.year = e.target.value; render(); });
  const updateDateRange = () => {
    state.rangeStart = $('range-start').value;
    state.rangeEnd = $('range-end').value;
    const invalid = !state.rangeStart || !state.rangeEnd || state.rangeStart > state.rangeEnd;
    $('period-range-error').classList.toggle('hidden', !invalid);
    if (!invalid) render();
  };
  $('range-start').addEventListener('change', updateDateRange);
  $('range-end').addEventListener('change', updateDateRange);
  $('cancellation-month').addEventListener('change', renderCancellations);
  $('decrease-cancellations').addEventListener('click', async () => {
    try { await adjustMonthlyCancellations(-1); } catch (error) { notice(`No se pudo actualizar el total: ${error.message}`, 'error'); }
  });
  $('increase-cancellations').addEventListener('click', async () => {
    try { await adjustMonthlyCancellations(1); } catch (error) { notice(`No se pudo actualizar el total: ${error.message}`, 'error'); }
  });
  $('search-input').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  $('type-filter').addEventListener('change', (e) => { state.typeFilter = e.target.value; render(); });
  $('date-from-filter').addEventListener('change', (e) => { state.dateFrom = e.target.value; render(); });
  $('date-to-filter').addEventListener('change', (e) => { state.dateTo = e.target.value; render(); });
  $('sort-by').addEventListener('change', (e) => { state.sortBy = e.target.value; render(); });
  $('sort-direction').addEventListener('change', (e) => { state.sortDirection = e.target.value; render(); });
  document.querySelectorAll('.sort-header').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.sortKey;
    if (state.sortBy === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    else {
      state.sortBy = key;
      state.sortDirection = ['contact_type'].includes(key) ? 'asc' : 'desc';
    }
    $('sort-by').value = state.sortBy;
    $('sort-direction').value = state.sortDirection;
    render();
  }));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('.nav-link').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setView(a.hash.slice(1)); }));
  document.body.addEventListener('click', (e) => {
    const button = e.target.closest('[data-complete]');
    if (button) completeFollowup(button.dataset.complete, button.dataset.field);
    const deleteButton = e.target.closest('[data-delete-contact]');
    if (deleteButton) requestDeleteContact(deleteButton.dataset.deleteContact);
  });
  $('close-delete-confirm').addEventListener('click', () => $('delete-confirm').close());
  $('cancel-delete').addEventListener('click', () => $('delete-confirm').close());
  $('delete-confirm').addEventListener('close', () => { state.pendingDelete = null; });
  $('confirm-delete').addEventListener('click', deletePendingContact);
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
      window.setTimeout(() => {
        loadContacts().catch((error) => notice(`No se pudieron cargar los contactos: ${error.message}`, 'error'));
        loadMonthlyCancellations().catch((error) => {
          state.cancellationsLoaded = false;
          renderCancellations();
          render();
          notice(`No se pudieron cargar las bajas. Comprueba la migración 002 de Supabase: ${error.message}`, 'error');
        });
      }, 0);
    }
  });
})();

