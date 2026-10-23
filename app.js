(() => {
  const CONTACT_TYPES = ['Web/Email', 'Visita física', 'Teléfono', 'WhatsApp', 'Visita sin comercial', 'Invitación'];
  const cfg = window.APP_CONFIG || {};
  const supabaseReady = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const db = supabaseReady ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, contacts: [], monthlyCancellations: [], cancellationsLoaded: false, month: '', year: String(new Date().getFullYear()), periodMode: 'month', rangeStart: '', rangeEnd: '', view: 'overview', search: '', typeFilter: '', dateFrom: '', dateTo: '', sortBy: 'contact_date', sortDirection: 'desc', pendingDelete: null, editingContactId: null };
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
    const customDate = contact[`${kind}_due_date`];
    if (customDate) return customDate;
    const baseDate = contact.visit_date || contact.contact_date;
    if (!baseDate) return '';
    return dateOffset(baseDate, kind === 'hot' ? 1 : 8);
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
    $('sort-by').value = state.sortBy;
    $('sort-direction').value = state.sortDirection;
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
      const { data, error } = await db.from('gym_contacts').select('*').order('contact_date', { ascending: false }).order('created_at', { ascending: false }).range(start, start + pageSize - 1);
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
    $('page-title').textContent = ({ overview: 'Resumen', contacts: 'Contactos', cancellations: 'Altas y bajas', followups: 'Seguimientos' })[view];
    if (view === 'contacts') {
      state.sortBy = 'contact_date';
      state.sortDirection = 'desc';
      updateSortIndicators();
      render();
    }
  }

  function render() {
    if (!db || !state.user) return;
    const { start: periodStart, end: periodEnd } = selectedPeriod();
    if (!periodStart || !periodEnd || periodStart > periodEnd) return;
    const contactsInPeriod = state.contacts.filter((c) => inSelectedPeriod(c.contact_date));
    const visits = contactsInPeriod.filter((c) => Boolean(c.visit_date));
    const sales = state.contacts.filter((c) => c.is_alta && inSelectedPeriod(c.alta_date));
    const cancellations = state.cancellationsLoaded ? state.monthlyCancellations.filter((record) => cancellationMonthInSelectedPeriod(record.month_start)).reduce((total, record) => total + Number(record.cancellation_count || 0), 0) : null;
    const membershipBaselineDate = '2026-10-23';
    const membershipBaselineCount = 445;
    const todayKey = isoDay(today);
    const altasDesdeBase = state.contacts.filter((contact) => contact.is_alta && contact.alta_date && contact.alta_date > membershipBaselineDate && contact.alta_date <= todayKey).length;
    const bajasEfectivasDesdeBase = state.cancellationsLoaded ? state.monthlyCancellations.filter((record) => {
      if (!record.month_start) return false;
      const end = monthEnd(record.month_start.slice(0, 7));
      return end > membershipBaselineDate && end <= todayKey;
    }).reduce((total, record) => total + Number(record.cancellation_count || 0), 0) : 0;
    const sociosActuales = Math.max(0, membershipBaselineCount + altasDesdeBase - bajasEfectivasDesdeBase);
    const mesActual = todayKey.slice(0, 7);
    const bajasPendientesMes = state.cancellationsLoaded && todayKey < monthEnd(mesActual)
      ? Number(state.monthlyCancellations.find((record) => record.month_start?.slice(0, 7) === mesActual)?.cancellation_count || 0)
      : 0;
    $('stat-current-members').textContent = sociosActuales;
    $('stat-members-after-cancellations').textContent = Math.max(0, sociosActuales - bajasPendientesMes);
    $('stat-members-projection-label').textContent = `Tras las bajas de ${new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(today)}`;
    $('stat-current-members-detail').textContent = sociosActuales;
    $('stat-members-after-cancellations-detail').textContent = Math.max(0, sociosActuales - bajasPendientesMes);
    $('stat-members-projection-label-detail').textContent = `Después de las bajas de ${new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(today)}`;
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
    const cancellationRecordsInPeriod = state.monthlyCancellations.filter((record) => cancellationMonthInSelectedPeriod(record.month_start));
    const lastCancellationUpdate = cancellationRecordsInPeriod.map((record) => record.updated_at || record.created_at).filter(Boolean).sort().at(-1);
    $('stat-cancellations-updated-at').textContent = lastCancellationUpdate
      ? `Última modificación: ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastCancellationUpdate))}`
      : 'Última modificación: todavía no hay cambios guardados';
    const canAdjustSummaryMonth = state.cancellationsLoaded && state.periodMode === 'month' && Boolean(state.month);
    $('summary-decrease-cancellations').disabled = !canAdjustSummaryMonth || Number(cancellations || 0) === 0;
    $('summary-increase-cancellations').disabled = !canAdjustSummaryMonth;
    $('summary-decrease-cancellations').title = canAdjustSummaryMonth ? 'Restar una baja del mes' : 'Selecciona “Por mes” para cambiar un contador';
    $('summary-increase-cancellations').title = canAdjustSummaryMonth ? 'Sumar una baja al mes' : 'Selecciona “Por mes” para cambiar un contador';
    const balance = cancellations === null ? null : sales.length - cancellations;
    $('stat-balance').textContent = balance === null ? '—' : balance;
    const balanceCard = $('stat-balance').closest('.balance-outcome');
    balanceCard.classList.toggle('balance-positive', balance !== null && balance > 0);
    balanceCard.classList.toggle('balance-negative', balance !== null && balance < 0);
    balanceCard.classList.toggle('balance-neutral', balance === null || balance === 0);
    [
      ['ratio-contact-sales', sales.length, contactsInPeriod.length],
      ['ratio-contact-visits', visits.length, contactsInPeriod.length],
      ['ratio-visit-sales', sales.length, visits.length]
    ].forEach(([id, numerator, denominator]) => {
      $(`${id}`).textContent = fmtPercent(numerator, denominator);
      $(`${id}-bar`).style.width = `${denominator ? Math.min(100, (numerator / denominator) * 100) : 0}%`;
    });

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

    const recent = [...contactsInPeriod].sort((a, b) => b.contact_date.localeCompare(a.contact_date) || (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 8);
    $('recent-rows').innerHTML = recent.length ? recent.map((c) => `<tr><td class="member-number-cell">${escapeHtml(c.member_number || 'Sin número')}</td><td>${fmtDate(c.contact_date)}</td><td><button class="contact-type-button" type="button" data-edit-contact-type="${escapeHtml(c.id)}" aria-label="Cambiar tipo de contacto de socio ${escapeHtml(c.member_number || 'sin número')}" title="Pulsa para cambiar el tipo de contacto">${escapeHtml(c.contact_type)}</button></td><td>${fmtDate(c.visit_date)}</td><td>${followupStatusCell(c, 'hot')}</td><td>${followupStatusCell(c, 'warm')}</td><td>${altaStatusCell(c)}</td></tr>`).join('') : emptyRow(7, 'No hay contactos en este periodo.');

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
      if (result !== 0) return state.sortDirection === 'asc' ? result : -result;
      if (state.sortBy === 'contact_date') return (b.created_at || '').localeCompare(a.created_at || '');
      return 0;
    });
    updateSortIndicators();
    $('contact-count').textContent = `${filtered.length} de ${contactsInPeriod.length} contactos`;
    $('contact-rows').innerHTML = filtered.length ? filtered.map(contactRow).join('') : emptyRow(8, 'No hay contactos que coincidan.');

    const tasks = state.contacts.flatMap((c) => {
      if (c.is_alta) return [];
      const hotEnabled = Boolean(c.hot_enabled ?? c.visit_date);
      const warmEnabled = Boolean(c.warm_enabled ?? c.visit_date);
      return [
        hotEnabled && !c.hot_done && dueFor(c, 'hot') ? { c, kind: 'Hot', date: dueFor(c, 'hot'), field: 'hot_done' } : null,
        warmEnabled && !c.warm_done && dueFor(c, 'warm') ? { c, kind: 'Warm', date: dueFor(c, 'warm'), field: 'warm_done' } : null
      ].filter(Boolean);
    }).sort((a, b) => a.date.localeCompare(b.date));
    const dueTodayOrPast = tasks.filter((t) => t.date <= isoDay(today));
    const renderTodayFollowups = (kind, target) => {
      const list = dueTodayOrPast.filter((task) => task.kind.toLowerCase() === kind).sort((a, b) => a.date.localeCompare(b.date));
      $(target).innerHTML = list.length ? list.map((t) => `<div class="compact-item"><span class="task-dot ${t.date < isoDay(today) ? 'overdue' : 'due-today'}"></span><div><strong>${escapeHtml(t.c.member_number || 'Sin número')}</strong><small>${fmtDate(t.date)}</small></div><button class="mini-check" data-complete="${t.c.id}" data-field="${t.field}" aria-label="Marcar ${kind === 'hot' ? 'Hot' : 'Warm'} como realizado">✓</button></div>`).join('') : `<p class="empty-state">No hay ${kind === 'hot' ? 'Hot' : 'Warm'} vencidos o para hoy.</p>`;
    };
    renderTodayFollowups('hot', 'today-hot-followups');
    renderTodayFollowups('warm', 'today-warm-followups');
    const renderFollowupTable = (kind, target) => {
      const list = tasks.filter((task) => task.kind.toLowerCase() === kind).sort((a, b) => a.date.localeCompare(b.date));
      $(target).innerHTML = list.length ? list.map((t) => {
        const dateStatus = t.date <= isoDay(today) ? 'attention' : 'hot';
        return `<tr class="${t.date < isoDay(today) ? 'overdue' : ''}"><td>${escapeHtml(t.c.member_number || 'Sin número')}</td><td>${escapeHtml(t.c.contact_type)}</td><td><button class="pill ${dateStatus} followup-date-pill" type="button" data-edit-followup-date="${escapeHtml(t.c.id)}" data-followup-kind="${kind}" title="Haz clic para cambiar la fecha prevista">${fmtDate(t.date)}</button></td><td><button class="button small secondary" data-complete="${t.c.id}" data-field="${t.field}">Marcar hecho</button></td></tr>`;
      }).join('') : emptyRow(4, `No hay ${kind === 'hot' ? 'Hot' : 'Warm'} pendientes.`);
    };
    renderFollowupTable('hot', 'hot-followup-rows');
    renderFollowupTable('warm', 'warm-followup-rows');
    renderMonthlyComparison();
  }

  function followupStatusCell(c, kind) {
    const enabled = c[`${kind}_enabled`] ?? Boolean(c.visit_date);
    if (!enabled) return '<span class="pill neutral">—</span>';
    if (c.is_alta) return '<span class="pill neutral">—</span>';
    const done = kind === 'hot' ? c.hot_done : c.warm_done;
    const editAttrs = `data-edit-followup-date="${escapeHtml(c.id)}" data-followup-kind="${kind}"`;
    const editLabel = `Elegir nueva fecha ${kind === 'hot' ? 'Hot' : 'Warm'} para el socio ${escapeHtml(c.member_number || 'sin número')}`;
    if (done) return `<button class="pill success followup-date-pill" type="button" ${editAttrs} aria-label="${editLabel}" title="Pulsa para programar otro seguimiento">Hecho</button>`;
    const due = dueFor(c, kind);
    const isDue = due && due <= isoDay(today);
    const statusClass = due ? (isDue ? 'attention' : 'hot') : 'neutral';
    const dateEditLabel = `Cambiar fecha ${kind === 'hot' ? 'Hot' : 'Warm'} de socio ${escapeHtml(c.member_number || 'sin número')}`;
    const dateButton = due ? `<button class="pill ${statusClass} followup-date-pill" type="button" ${editAttrs} aria-label="${dateEditLabel}" title="Haz clic para cambiar la fecha">${fmtDate(due)}</button>` : '<span class="pill neutral">—</span>';
    return `<span class="followup-date-cell">${dateButton}</span>`;
  }
  function altaStatusCell(c) {
    const label = c.is_alta ? `Alta · ${fmtDate(c.alta_date)}` : 'Sin alta';
    const statusClass = c.is_alta ? 'success' : 'neutral';
    return `<button class="pill ${statusClass} alta-status-button" type="button" data-edit-alta="${escapeHtml(c.id)}" aria-label="Modificar estado de alta del socio ${escapeHtml(c.member_number || 'sin número')}" title="Pulsa para cambiar el estado">${label}</button>`;
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
    const lastUpdated = record?.updated_at || record?.created_at;
    $('cancellation-updated-at').textContent = lastUpdated
      ? `Última modificación: ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastUpdated))}`
      : 'Última modificación: todavía no hay cambios guardados';
    $('decrease-cancellations').disabled = count === 0;
    $('increase-cancellations').disabled = false;
  }

  function renderMonthlyComparison() {
    const monthlySales = new Map();
    const monthlyLosses = new Map();
    state.contacts.forEach((contact) => {
      if (!contact.is_alta || !contact.alta_date) return;
      const month = contact.alta_date.slice(0, 7);
      monthlySales.set(month, (monthlySales.get(month) || 0) + 1);
    });
    state.monthlyCancellations.forEach((record) => {
      if (!record.month_start) return;
      const month = record.month_start.slice(0, 7);
      monthlyLosses.set(month, (monthlyLosses.get(month) || 0) + Number(record.cancellation_count || 0));
    });
    const months = [...new Set([...monthlySales.keys(), ...monthlyLosses.keys()])].sort((a, b) => b.localeCompare(a));
    const totalSales = [...monthlySales.values()].reduce((sum, count) => sum + count, 0);
    const totalLosses = [...monthlyLosses.values()].reduce((sum, count) => sum + count, 0);
    $('monthly-comparison-rows').innerHTML = months.length ? months.map((month) => {
      const sales = monthlySales.get(month) || 0;
      const losses = monthlyLosses.get(month) || 0;
      const balance = sales - losses;
      const balanceClass = balance > 0 ? 'positive' : (balance < 0 ? 'negative' : 'neutral');
      const balanceLabel = balance > 0 ? `+${balance}` : String(balance);
      return `<tr><td>${cancellationMonthLabel(`${month}-01`)}</td><td>${sales}</td><td>${losses}</td><td><span class="monthly-balance ${balanceClass}">${balanceLabel}</span></td></tr>`;
    }).join('') : emptyRow(4, 'Todavía no hay altas ni bajas registradas.');
    const totalBalance = totalSales - totalLosses;
    const totalBalanceClass = totalBalance > 0 ? 'positive' : (totalBalance < 0 ? 'negative' : 'neutral');
    const totalBalanceLabel = totalBalance > 0 ? `+${totalBalance}` : String(totalBalance);
    $('monthly-comparison-total').innerHTML = months.length ? `<tr class="monthly-total-row"><th>Total</th><td>${totalSales}</td><td>${totalLosses}</td><td><span class="monthly-balance ${totalBalanceClass}">${totalBalanceLabel}</span></td></tr>` : '';
  }

  async function adjustMonthlyCancellations(delta, monthOverride = null) {
    const month = monthOverride || $('cancellation-month').value;
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
    const review = c.import_warnings?.length ? `<span class="pill warning" title="${escapeHtml(c.import_warnings.join(' · '))}">Revisar</span>` : '';
    return `<tr><td class="member-number-cell">${escapeHtml(c.member_number || 'Sin número')}</td><td>${fmtDate(c.contact_date)}</td><td>${escapeHtml(c.contact_type)}</td><td>${fmtDate(c.visit_date)}</td><td>${followupStatusCell(c, 'hot')}</td><td>${followupStatusCell(c, 'warm')}</td><td>${altaStatusCell(c)} ${review}</td><td class="action-cell"><button class="edit-button" type="button" data-edit-contact="${escapeHtml(c.id)}" aria-label="Modificar contacto de socio ${escapeHtml(c.member_number || 'sin número')}" title="Modificar contacto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.8 5.7 3.5 3.5"/></svg></button><button class="delete-button" type="button" data-delete-contact="${escapeHtml(c.id)}" aria-label="Eliminar contacto de socio ${escapeHtml(c.member_number || 'sin número')}" title="Eliminar contacto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m3 3v7m6-7v7" /></svg></button></td></tr>`;
  }
  function openContactTypeSelect(button) {
    const contact = state.contacts.find((item) => item.id === button.dataset.editContactType);
    if (!contact || !CONTACT_TYPES.includes(contact.contact_type)) return;
    const select = document.createElement('select');
    select.className = 'contact-type-select';
    select.setAttribute('aria-label', `Nuevo tipo de contacto para socio ${contact.member_number || 'sin número'}`);
    select.dataset.saveContactType = contact.id;
    select.innerHTML = CONTACT_TYPES.map((type) => `<option value="${escapeHtml(type)}"${type === contact.contact_type ? ' selected' : ''}>${escapeHtml(type)}</option>`).join('');
    button.replaceWith(select);
    select.focus();
  }
  async function saveContactType(select) {
    const id = select.dataset.saveContactType;
    const value = select.value;
    if (!CONTACT_TYPES.includes(value)) return;
    select.disabled = true;
    const { error } = await db.from('gym_contacts').update({ contact_type: value }).eq('id', id).eq('owner_id', state.user.id);
    if (error) {
      notice(`No se pudo cambiar el tipo de contacto: ${error.message}`, 'error');
      await loadContacts();
      return;
    }
    const contact = state.contacts.find((item) => item.id === id);
    if (contact) contact.contact_type = value;
    notice('Tipo de contacto actualizado.');
    render();
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
      hot_enabled: values.get('hot_enabled') === 'on',
      warm_enabled: values.get('warm_enabled') === 'on',
      hot_done: false,
      warm_done: false,
      is_alta: isAlta,
      alta_date: isAlta ? (values.get('alta_date') || null) : null
    };
    if (!payload.member_number) throw new Error('Indica el número de socio.');
    if (!payload.contact_type) throw new Error('Selecciona un tipo de contacto.');
    if (isAlta && !payload.alta_date) throw new Error('Indica la fecha del alta.');
    const currentDate = isoDay(new Date());
    const cutoffDate = dateOffset(currentDate, -30);
    let duplicateQuery = db.from('gym_contacts')
      .select('id, contact_date')
      .eq('owner_id', state.user.id)
      .eq('member_number', payload.member_number)
      .gte('contact_date', cutoffDate)
      .lte('contact_date', currentDate)
      .limit(1);
    if (state.editingContactId) duplicateQuery = duplicateQuery.neq('id', state.editingContactId);
    const { data: recentDuplicates, error: duplicateError } = await duplicateQuery;
    if (duplicateError) throw new Error(`No se pudo comprobar si ya existe un contacto reciente: ${duplicateError.message}`);
    if (recentDuplicates?.length) {
      throw new Error(`El socio ${payload.member_number} ya tiene un contacto en los últimos 30 días (${fmtDate(recentDuplicates[0].contact_date)}). No se ha guardado.`);
    }
    const query = state.editingContactId
      ? db.from('gym_contacts').update({
          member_number: payload.member_number,
          contact_type: payload.contact_type,
          contact_date: payload.contact_date,
          visit_date: payload.visit_date,
          hot_enabled: payload.hot_enabled,
          warm_enabled: payload.warm_enabled,
          is_alta: payload.is_alta,
          alta_date: payload.alta_date
        }).eq('id', state.editingContactId).eq('owner_id', state.user.id)
      : db.from('gym_contacts').insert(payload);
    const { error } = await query;
    if (error) throw error;
    form.reset();
    $('alta-date-field').classList.add('hidden');
    const wasEditing = Boolean(state.editingContactId);
    state.editingContactId = null;
    $('contact-dialog').close();
    notice(wasEditing ? 'Contacto modificado.' : 'Contacto guardado.');
    await loadContacts();
  }

  function openNewContact() {
    state.editingContactId = null;
    const form = $('contact-form');
    form.reset();
    $('contact-dialog-eyebrow').textContent = 'NUEVO REGISTRO';
    $('contact-dialog-title').textContent = 'Registrar contacto';
    $('save-contact-button').textContent = 'Guardar contacto';
    $('alta-date-field').classList.add('hidden');
    form.elements.alta_date.required = false;
    form.elements.contact_date.value = isoDay(today);
    $('contact-dialog').showModal();
  }

  function openEditContact(id) {
    const contact = state.contacts.find((item) => item.id === id);
    if (!contact) return;
    state.editingContactId = id;
    const form = $('contact-form');
    form.reset();
    form.elements.member_number.value = contact.member_number || '';
    form.elements.contact_date.value = contact.contact_date || '';
    form.elements.visit_date.value = contact.visit_date || '';
    form.elements.hot_enabled.checked = Boolean(contact.hot_enabled ?? contact.visit_date);
    form.elements.warm_enabled.checked = Boolean(contact.warm_enabled ?? contact.visit_date);
    form.querySelectorAll('input[name="contact_type"]').forEach((radio) => {
      radio.checked = radio.value === contact.contact_type;
    });
    $('is-alta').checked = Boolean(contact.is_alta);
    $('alta-date-field').classList.toggle('hidden', !contact.is_alta);
    form.elements.alta_date.value = contact.alta_date || '';
    form.elements.alta_date.required = Boolean(contact.is_alta);
    $('contact-dialog-eyebrow').textContent = 'EDITAR REGISTRO';
    $('contact-dialog-title').textContent = 'Modificar contacto';
    $('save-contact-button').textContent = 'Guardar cambios';
    $('contact-dialog').showModal();
  }

  function openFollowupDateDialog(id, kind) {
    const contact = state.contacts.find((item) => item.id === id);
    if (!contact || !['hot', 'warm'].includes(kind)) return;
    state.followupDateEdit = { id, kind };
    $('followup-date-title').textContent = `Cambiar fecha ${kind === 'hot' ? 'Hot' : 'Warm'}`;
    $('followup-date-member').textContent = `Socio ${contact.member_number || 'sin número'}`;
    $('followup-date-input').value = contact[`${kind}_due_date`] || dueFor(contact, kind) || '';
    $('followup-date-dialog').showModal();
  }

  async function saveFollowupDate(date) {
    const target = state.followupDateEdit;
    if (!target) return;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Elige una fecha válida.');
    const column = `${target.kind}_due_date`;
    const doneColumn = `${target.kind}_done`;
    const { error } = await db.from('gym_contacts').update({ [column]: date || null, [doneColumn]: false }).eq('id', target.id).eq('owner_id', state.user.id);
    if (error) throw error;
    $('followup-date-dialog').close();
    state.followupDateEdit = null;
    notice(date ? 'Nueva fecha guardada; el seguimiento vuelve a estar pendiente.' : 'Fecha automática restablecida; el seguimiento vuelve a estar pendiente.');
    await loadContacts();
  }

  function openAltaStatusDialog(id) {
    const contact = state.contacts.find((item) => item.id === id);
    if (!contact) return;
    state.editingAltaId = id;
    $('alta-status-member').textContent = `Socio ${contact.member_number || 'sin número'}`;
    $('alta-status-checkbox').checked = Boolean(contact.is_alta);
    $('alta-status-date').value = contact.alta_date || '';
    $('alta-status-date-field').classList.toggle('hidden', !contact.is_alta);
    $('alta-status-date').required = Boolean(contact.is_alta);
    $('alta-status-dialog').showModal();
  }

  async function saveAltaStatus() {
    if (!state.editingAltaId) return;
    const isAlta = $('alta-status-checkbox').checked;
    const altaDate = $('alta-status-date').value || null;
    if (isAlta && !altaDate) throw new Error('Indica la fecha del alta.');
    const { error } = await db.from('gym_contacts').update({ is_alta: isAlta, alta_date: isAlta ? altaDate : null }).eq('id', state.editingAltaId).eq('owner_id', state.user.id);
    if (error) throw error;
    $('alta-status-dialog').close();
    state.editingAltaId = null;
    notice(isAlta ? 'Alta actualizada.' : 'Estado actualizado: sin alta.');
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
  $('summary-decrease-cancellations').addEventListener('click', async () => {
    try { await adjustMonthlyCancellations(-1, state.month); } catch (error) { notice(`No se pudo actualizar el total: ${error.message}`, 'error'); }
  });
  $('summary-increase-cancellations').addEventListener('click', async () => {
    try { await adjustMonthlyCancellations(1, state.month); } catch (error) { notice(`No se pudo actualizar el total: ${error.message}`, 'error'); }
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
    const editType = e.target.closest('[data-edit-contact-type]');
    if (editType) openContactTypeSelect(editType);
    const editFollowupDate = e.target.closest('[data-edit-followup-date]');
    if (editFollowupDate) openFollowupDateDialog(editFollowupDate.dataset.editFollowupDate, editFollowupDate.dataset.followupKind);
    const editAlta = e.target.closest('[data-edit-alta]');
    if (editAlta) openAltaStatusDialog(editAlta.dataset.editAlta);
    const button = e.target.closest('[data-complete]');
    if (button) completeFollowup(button.dataset.complete, button.dataset.field);
    const editButton = e.target.closest('[data-edit-contact]');
    if (editButton) openEditContact(editButton.dataset.editContact);
    const deleteButton = e.target.closest('[data-delete-contact]');
    if (deleteButton) requestDeleteContact(deleteButton.dataset.deleteContact);
  });
  document.body.addEventListener('change', (e) => {
    const select = e.target.closest('[data-save-contact-type]');
    if (select) saveContactType(select);
  });
  document.body.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.matches('[data-save-contact-type]')) render();
  });
  $('close-delete-confirm').addEventListener('click', () => $('delete-confirm').close());
  $('cancel-delete').addEventListener('click', () => $('delete-confirm').close());
  $('delete-confirm').addEventListener('close', () => { state.pendingDelete = null; });
  $('confirm-delete').addEventListener('click', deletePendingContact);
  $('new-contact-button').addEventListener('click', openNewContact);
  $('close-dialog').addEventListener('click', () => $('contact-dialog').close());
  $('cancel-dialog').addEventListener('click', () => $('contact-dialog').close());
  $('close-followup-date').addEventListener('click', () => $('followup-date-dialog').close());
  $('cancel-followup-date').addEventListener('click', () => $('followup-date-dialog').close());
  $('reset-followup-date').addEventListener('click', async () => { try { await saveFollowupDate(''); } catch (error) { notice(error.message, 'error'); } });
  $('followup-date-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await saveFollowupDate($('followup-date-input').value); } catch (error) { notice(error.message, 'error'); } });
  $('close-alta-status').addEventListener('click', () => $('alta-status-dialog').close());
  $('cancel-alta-status').addEventListener('click', () => $('alta-status-dialog').close());
  $('alta-status-checkbox').addEventListener('change', (e) => {
    $('alta-status-date-field').classList.toggle('hidden', !e.target.checked);
    $('alta-status-date').required = e.target.checked;
  });
  $('alta-status-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await saveAltaStatus(); } catch (error) { notice(error.message, 'error'); } });
  $('is-alta').addEventListener('change', (e) => { $('alta-date-field').classList.toggle('hidden', !e.target.checked); $('contact-form').elements.alta_date.required = e.target.checked; });
  document.querySelectorAll('input[name="contact_type"]').forEach((radio) => radio.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    const visitContact = e.target.value === 'Visita física';
    $('contact-form').elements.hot_enabled.checked = visitContact;
    $('contact-form').elements.warm_enabled.checked = visitContact;
  }));
  $('contact-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await saveContact(e.currentTarget); } catch (error) { notice(error.message, 'error'); } });
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

