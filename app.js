(() => {
  const CONTACT_TYPES = ['Web/Email', 'Visita física', 'Teléfono', 'WhatsApp', 'Visita sin comercial', 'Invitación'];
  const cfg = window.APP_CONFIG || {};
  const supabaseReady = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const db = supabaseReady ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, contacts: [], monthlyCancellations: [], cancellationsLoaded: false, month: '', year: String(new Date().getFullYear()), periodMode: 'month', rangeStart: '', rangeEnd: '', view: 'overview', search: '', typeFilter: '', dateFrom: '', dateTo: '', sortBy: 'contact_date', sortDirection: 'desc', pendingDelete: null, editingContactId: null, editingContactTypeId: null, history: [], redoHistory: [], historyBusy: false, pendingDuplicateContact: null, pendingBackupImport: null, customizingOverview: false, draggedWidgetId: null };
  const DEFAULT_WIDGET_ORDER = ['outcomes', 'followups', 'ratios', 'recent', 'funnel', 'daily'];
  const PREVIOUS_WIDGET_ORDER = ['outcomes', 'ratios', 'followups', 'recent', 'funnel', 'daily'];
  const OLDER_WIDGET_ORDER = ['outcomes', 'ratios', 'followups', 'funnel', 'recent', 'daily'];
  const EARLIER_WIDGET_ORDER = ['outcomes', 'ratios', 'followups', 'funnel', 'daily', 'recent'];
  const LEGACY_DEFAULT_WIDGET_ORDER = ['funnel', 'outcomes', 'ratios', 'followups', 'daily', 'recent'];
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
  function updateHistoryButtons() {
    $('undo-button').disabled = state.historyBusy || !state.history.length;
    $('redo-button').disabled = state.historyBusy || !state.redoHistory.length;
  }
  function recordHistory(label, undo, redo) {
    state.history.push({ label, undo, redo });
    if (state.history.length > 50) state.history.shift();
    state.redoHistory = [];
    updateHistoryButtons();
  }
  async function writeContactFields(id, fields) {
    const { error } = await db.from('gym_contacts').update(fields).eq('id', id).eq('owner_id', state.user.id);
    if (error) throw error;
  }
  async function deleteContactRow(id) {
    const { error } = await db.from('gym_contacts').delete().eq('id', id).eq('owner_id', state.user.id);
    if (error) throw error;
  }
  async function insertContactRow(row) {
    const { error } = await db.from('gym_contacts').insert(row);
    if (error) throw error;
  }
  async function writeMonthlyCount(month, count) {
    const { error } = await db.from('gym_monthly_cancellations').upsert({ owner_id: state.user.id, month_start: `${month}-01`, cancellation_count: count }, { onConflict: 'owner_id,month_start' });
    if (error) throw error;
  }
  async function runHistory(direction) {
    const source = direction === 'undo' ? state.history : state.redoHistory;
    const target = direction === 'undo' ? state.redoHistory : state.history;
    if (state.historyBusy) return;
    const action = source.pop();
    if (!action) return;
    state.historyBusy = true;
    updateHistoryButtons();
    try {
      await action[direction]();
      target.push(action);
      await loadContacts();
      await loadMonthlyCancellations();
      notice(`${direction === 'undo' ? 'Deshecho' : 'Rehecho'}: ${action.label}.`);
    } catch (error) {
      source.push(action);
      notice(`No se pudo ${direction === 'undo' ? 'deshacer' : 'rehacer'} el cambio: ${error.message}`, 'error');
    } finally {
      state.historyBusy = false;
      updateHistoryButtons();
    }
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

  const BACKUP_FORMAT = 'infinitfitness-comercial-backup';
  const BACKUP_VERSION = 1;
  async function fetchAllRows(table) {
    const result = [];
    const pageSize = 1000;
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await db.from(table).select('*').range(start, start + pageSize - 1);
      if (error) throw error;
      result.push(...(data || []));
      if (!data || data.length < pageSize) return result;
    }
  }
  function backupRows(rows, size = 200) {
    const groups = [];
    for (let i = 0; i < rows.length; i += size) groups.push(rows.slice(i, i + size));
    return groups;
  }
  async function exportFullBackup() {
    const [contacts, cancellations] = await Promise.all([
      fetchAllRows('gym_contacts'),
      fetchAllRows('gym_monthly_cancellations')
    ]);
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      data: { contacts, monthly_cancellations: cancellations },
      settings: { dashboard_widget_order: state.user?.user_metadata?.dashboard_widget_order ?? null }
    };
    const text = JSON.stringify(payload, null, 2);
    const date = isoDay(new Date());
    const fileName = `copia-gimnasio-${date}.json`;
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        startIn: 'desktop',
        types: [{ description: 'Copia de seguridad JSON', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([text], { type: 'application/json' }));
      await writable.close();
    } else {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = fileName; link.click();
      URL.revokeObjectURL(url);
    }
    $('backup-file-summary').textContent = `Copia exportada: ${contacts.length} contactos y ${cancellations.length} meses con bajas.`;
    notice('Copia de seguridad guardada.');
  }
  function prepareBackupImport(fileText, fileName) {
    const backup = JSON.parse(fileText);
    if (backup?.format !== BACKUP_FORMAT || backup?.version !== BACKUP_VERSION || !Array.isArray(backup?.data?.contacts) || !Array.isArray(backup?.data?.monthly_cancellations)) {
      throw new Error('El archivo no es una copia válida de esta aplicación.');
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    const contactFields = ['id','member_number','contact_type','contact_date','visit_date','hot_done','warm_done','is_alta','alta_date','import_warnings','legacy_source_key','created_at','hot_enabled','warm_enabled','hot_due_date','warm_due_date'];
    const cancellationFields = ['id','month_start','cancellation_count','created_at','updated_at'];
    const contacts = backup.data.contacts.map((record, index) => {
      if (!record || typeof record !== 'object' || !uuidPattern.test(record.id || '') || !CONTACT_TYPES.includes(record.contact_type) || !isoDatePattern.test(record.contact_date || '')) throw new Error(`El contacto ${index + 1} no tiene un formato válido.`);
      const row = Object.fromEntries(contactFields.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
      row.owner_id = state.user.id;
      return row;
    });
    const cancellations = backup.data.monthly_cancellations.map((record, index) => {
      if (!record || typeof record !== 'object' || !uuidPattern.test(record.id || '') || !isoDatePattern.test(record.month_start || '') || !record.month_start.endsWith('-01') || !Number.isInteger(Number(record.cancellation_count)) || Number(record.cancellation_count) < 0) throw new Error(`El mes de bajas ${index + 1} no tiene un formato válido.`);
      const row = Object.fromEntries(cancellationFields.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
      row.owner_id = state.user.id;
      return row;
    });
    if (new Set(contacts.map((row) => row.id)).size !== contacts.length || new Set(cancellations.map((row) => row.month_start)).size !== cancellations.length) throw new Error('La copia contiene registros repetidos.');
    return { raw: backup, contacts, cancellations, fileName };
  }
  async function replaceAllContacts(rows) {
    const { error: deleteError } = await db.from('gym_contacts').delete().eq('owner_id', state.user.id);
    if (deleteError) throw deleteError;
    for (const group of backupRows(rows)) {
      const { error } = await db.from('gym_contacts').insert(group);
      if (error) throw error;
    }
  }
  async function setMonthlyBackup(rows, existingRows) {
    const monthsInBackup = new Set(rows.map((row) => row.month_start));
    for (const row of existingRows) {
      if (monthsInBackup.has(row.month_start)) continue;
      const { error } = await db.from('gym_monthly_cancellations').update({ cancellation_count: 0 }).eq('owner_id', state.user.id).eq('month_start', row.month_start);
      if (error) throw error;
    }
    for (const group of backupRows(rows)) {
      const { error } = await db.from('gym_monthly_cancellations').upsert(group, { onConflict: 'owner_id,month_start' });
      if (error) throw error;
    }
  }
  async function restoreFullBackup() {
    const pending = state.pendingBackupImport;
    if (!pending) return;
    const confirmed = window.confirm(`Se reemplazarán los contactos actuales (${state.contacts.length}) por ${pending.contacts.length} contactos de “${pending.fileName}” y se restaurarán sus bajas mensuales. ¿Quieres continuar?`);
    if (!confirmed) return;
    $('restore-backup-button').disabled = true;
    $('backup-file-summary').textContent = 'Restaurando la copia… No cierres esta ventana.';
    const [oldContacts, oldCancellations] = await Promise.all([fetchAllRows('gym_contacts'), fetchAllRows('gym_monthly_cancellations')]);
    let contactsChanged = false;
    let cancellationsChanged = false;
    try {
      const { error: deleteError } = await db.from('gym_contacts').delete().eq('owner_id', state.user.id);
      if (deleteError) throw deleteError;
      contactsChanged = true;
      for (const group of backupRows(pending.contacts)) {
        const { error } = await db.from('gym_contacts').insert(group);
        if (error) throw error;
      }
      cancellationsChanged = true;
      await setMonthlyBackup(pending.cancellations, oldCancellations);
      if (pending.raw.settings && Object.hasOwn(pending.raw.settings, 'dashboard_widget_order')) {
        const { data, error } = await db.auth.updateUser({ data: { dashboard_widget_order: pending.raw.settings.dashboard_widget_order } });
        if (error) throw error;
        if (data?.user) state.user = data.user;
      }
      state.history = []; state.redoHistory = [];
      state.pendingBackupImport = null;
      $('backup-dialog').close();
      $('backup-warning').classList.add('hidden');
      $('restore-backup-button').disabled = true;
      await Promise.all([loadContacts(), loadMonthlyCancellations(), applySavedWidgetOrder()]);
      notice('Copia restaurada correctamente.');
    } catch (error) {
      const rollbackErrors = [];
      if (contactsChanged) try { await replaceAllContacts(oldContacts); } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      if (cancellationsChanged) try { await setMonthlyBackup(oldCancellations, await fetchAllRows('gym_monthly_cancellations')); } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      $('backup-file-summary').textContent = rollbackErrors.length ? `Falló la restauración y no se pudo completar la recuperación automática: ${rollbackErrors.join('; ')}` : `No se pudo restaurar la copia. Se han recuperado los datos anteriores. ${error.message}`;
      $('restore-backup-button').disabled = false;
      throw error;
    }
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

  function getWidgetElements() { return [...$('overview-widgets').querySelectorAll('[data-widget-id]')]; }
  function arrangeWidgets(order) {
    const container = $('overview-widgets');
    const byId = new Map(getWidgetElements().map((widget) => [widget.dataset.widgetId, widget]));
    [...order, ...DEFAULT_WIDGET_ORDER].forEach((id) => { const widget = byId.get(id); if (widget) { container.append(widget); byId.delete(id); } });
    byId.forEach((widget) => container.append(widget));
  }
  async function saveWidgetOrder(order, showNotice = true) {
    const { data, error } = await db.auth.updateUser({ data: { dashboard_widget_order: order } });
    if (error) { notice(`No se pudo guardar el orden: ${error.message}`, 'error'); return false; }
    state.user = data.user || state.user;
    if (showNotice) notice('Orden del resumen guardado.');
    return true;
  }
  function setOverviewEditMode(enabled) {
    state.customizingOverview = enabled;
    const container = $('overview-widgets');
    container.classList.toggle('is-customizing', enabled);
    $('customize-overview-button').title = enabled ? 'Terminar personalización' : 'Personalizar resumen';
    $('customize-overview-button').setAttribute('aria-label', $('customize-overview-button').title);
    $('reset-overview-layout-button').classList.toggle('hidden', !enabled || state.view !== 'overview');
    $('overview-customize-hint').classList.toggle('hidden', !enabled);
    container.querySelectorAll('.widget-drag-handle').forEach((handle) => handle.remove());
    if (enabled) getWidgetElements().forEach((widget) => {
      const handle = document.createElement('button');
      handle.type = 'button'; handle.className = 'widget-drag-handle'; handle.draggable = true;
      handle.textContent = '⠿'; handle.title = 'Arrastra para mover; usa flechas arriba y abajo para ordenar';
      handle.setAttribute('aria-label', `Mover ${widget.querySelector('h2')?.textContent || 'bloque'}`);
      handle.addEventListener('keydown', async (event) => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const siblings = getWidgetElements(); const index = siblings.indexOf(widget);
        const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (!target) return;
        if (event.key === 'ArrowUp') target.before(widget); else target.after(widget);
        handle.focus();
        await saveWidgetOrder(getWidgetElements().map((item) => item.dataset.widgetId), false);
      });
      widget.append(handle);
    });
  }
  async function applySavedWidgetOrder() {
    const order = state.user?.user_metadata?.dashboard_widget_order;
    if (!Array.isArray(order)) { arrangeWidgets(DEFAULT_WIDGET_ORDER); return; }
    if ([LEGACY_DEFAULT_WIDGET_ORDER, PREVIOUS_WIDGET_ORDER, OLDER_WIDGET_ORDER, EARLIER_WIDGET_ORDER].some((previous) => JSON.stringify(order) === JSON.stringify(previous))) {
      arrangeWidgets(DEFAULT_WIDGET_ORDER);
      await saveWidgetOrder(DEFAULT_WIDGET_ORDER, false);
      return;
    }
    arrangeWidgets(order);
  }
  function setView(view) {
    state.view = view;
    document.querySelectorAll('.view-section').forEach((section) => section.classList.toggle('hidden', section.id !== `${view}-section`));
    document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${view}`));
    $('page-title').textContent = ({ overview: 'Resumen', contacts: 'Contactos', cancellations: 'Altas y bajas', followups: 'Seguimientos' })[view];
    $('customize-overview-button').classList.toggle('hidden', view !== 'overview');
    if (view !== 'overview' && state.customizingOverview) setOverviewEditMode(false);
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
    $('daily-title').textContent = isYear ? 'Contactos, visitas y altas por mes' : 'Contactos, visitas y altas por día';
    const dayKeys = [];
    if (isYear) {
      for (let month = 1; month <= 12; month++) dayKeys.push(`${state.year}-${String(month).padStart(2, '0')}`);
    } else {
      for (let day = periodStart; day <= periodEnd; day = dateOffset(day, 1)) dayKeys.push(day);
    }
    const contactsByDate = new Map();
    contactsInPeriod.forEach((contact) => {
      const key = isYear ? contact.contact_date.slice(0, 7) : contact.contact_date;
      contactsByDate.set(key, (contactsByDate.get(key) || 0) + 1);
    });
    const visitsByDate = new Map();
    const salesByVisitDate = new Map();
    const visitsInPeriod = state.contacts.filter((contact) => contact.visit_date && inSelectedPeriod(contact.visit_date));
    visitsInPeriod.forEach((contact) => {
      const key = isYear ? contact.visit_date.slice(0, 7) : contact.visit_date;
      visitsByDate.set(key, (visitsByDate.get(key) || 0) + 1);
      if (contact.is_alta && contact.alta_date) salesByVisitDate.set(key, (salesByVisitDate.get(key) || 0) + 1);
    });
    const countsByDay = dayKeys.map((day) => ({
      contacts: contactsByDate.get(day) || 0,
      visits: visitsByDate.get(day) || 0,
      sales: salesByVisitDate.get(day) || 0
    }));
    const maxDay = Math.max(1, ...countsByDay.map((item) => Math.max(item.contacts, item.visits)));
    const totalContacts = countsByDay.reduce((total, item) => total + item.contacts, 0);
    const totalVisits = countsByDay.reduce((total, item) => total + item.visits, 0);
    const totalVisitSales = countsByDay.reduce((total, item) => total + item.sales, 0);
    $('daily-total').textContent = `${totalContacts} contactos · ${totalVisits} visitas · ${totalVisitSales} altas`;
    $('daily-chart').innerHTML = countsByDay.map((item, index) => {
      const day = dayKeys[index];
      const label = isYear ? new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 1)) : (state.periodMode === 'month' ? String(Number(day.slice(8, 10))) : `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`);
      const title = isYear ? new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 1)) : fmtDate(day);
      const contactHeight = item.contacts ? Math.max(5, (item.contacts / maxDay) * 100) : 0;
      const visitHeight = item.visits ? Math.max(5, (item.visits / maxDay) * 100) : 0;
      const salesHeight = item.sales ? Math.max(4, (item.sales / maxDay) * 100) : 0;
      return `<div class="day-column" title="${title}: ${item.contacts} contactos · ${item.visits} visitas · ${item.sales} altas"><div class="bar-track"><span class="bar-series bar-contacts" style="height:${contactHeight}%"></span><i class="bar-series bar-visits" style="height:${visitHeight}%"></i><b class="bar-series bar-sales" style="height:${salesHeight}%"></b></div><small>${label}</small></div>`;
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
    await writeMonthlyCount(month, count);
    recordHistory(`Cambiar bajas de ${month}`, () => writeMonthlyCount(month, current), () => writeMonthlyCount(month, count));
    await loadMonthlyCancellations();
  }
  function contactRow(c) {
    const review = c.import_warnings?.length ? `<span class="pill warning" title="${escapeHtml(c.import_warnings.join(' · '))}">Revisar</span>` : '';
    return `<tr><td class="member-number-cell">${escapeHtml(c.member_number || 'Sin número')}</td><td>${fmtDate(c.contact_date)}</td><td><button class="contact-type-button" type="button" data-edit-contact-type="${escapeHtml(c.id)}" aria-label="Cambiar tipo de contacto de socio ${escapeHtml(c.member_number || 'sin número')}" title="Pulsa para cambiar el tipo de contacto">${escapeHtml(c.contact_type)}</button></td><td>${fmtDate(c.visit_date)}</td><td>${followupStatusCell(c, 'hot')}</td><td>${followupStatusCell(c, 'warm')}</td><td>${altaStatusCell(c)} ${review}</td><td class="action-cell"><button class="edit-button" type="button" data-edit-contact="${escapeHtml(c.id)}" aria-label="Modificar contacto de socio ${escapeHtml(c.member_number || 'sin número')}" title="Modificar contacto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.8 5.7 3.5 3.5"/></svg></button><button class="delete-button" type="button" data-delete-contact="${escapeHtml(c.id)}" aria-label="Eliminar contacto de socio ${escapeHtml(c.member_number || 'sin número')}" title="Eliminar contacto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m3 3v7m6-7v7" /></svg></button></td></tr>`;
  }
  function openContactTypeDialog(id) {
    const contact = state.contacts.find((item) => item.id === id);
    if (!contact || !CONTACT_TYPES.includes(contact.contact_type)) return;
    state.editingContactTypeId = id;
    $('contact-type-member').textContent = `Socio ${contact.member_number || 'sin número'}`;
    $('contact-type-select').value = contact.contact_type;
    $('contact-type-visit-date').value = contact.visit_date || '';
    const needsVisitDate = ['Visita física', 'Invitación', 'Visita sin comercial'].includes(contact.contact_type);
    $('contact-type-visit-date-field').classList.toggle('hidden', !needsVisitDate);
    $('contact-type-visit-date').required = needsVisitDate;
    $('contact-type-dialog').showModal();
  }
  async function saveContactType() {
    const id = state.editingContactTypeId;
    const value = $('contact-type-select').value;
    const visitDate = $('contact-type-visit-date').value || null;
    const current = state.contacts.find((item) => item.id === id);
    if (!id || !current || !CONTACT_TYPES.includes(value)) return;
    if (['Visita física', 'Invitación', 'Visita sin comercial'].includes(value) && !visitDate) {
      notice('Indica la fecha de la visita.', 'error');
      $('contact-type-visit-date').focus();
      return;
    }
    const button = $('save-contact-type');
    button.disabled = true;
    const before = { contact_type: current.contact_type, visit_date: current.visit_date, hot_enabled: current.hot_enabled, warm_enabled: current.warm_enabled };
    const after = { contact_type: value };
    if (['Visita física', 'Invitación', 'Visita sin comercial'].includes(value)) Object.assign(after, { visit_date: visitDate });
    else Object.assign(after, { visit_date: null });
    try {
      await writeContactFields(id, after);
      recordHistory('Cambiar tipo de contacto', () => writeContactFields(id, before), () => writeContactFields(id, after));
      $('contact-type-dialog').close();
      state.editingContactTypeId = null;
      notice(value === 'Visita física' ? 'Visita guardada con su fecha.' : 'Tipo de contacto actualizado.');
      await loadContacts();
    } finally {
      button.disabled = false;
    }
  }
  function emptyRow(span, text) { return `<tr><td class="empty-cell" colspan="${span}">${escapeHtml(text)}</td></tr>`; }

  function openDuplicateContactDialog(contact, memberNumber) {
    state.pendingDuplicateContact = contact;
    const todayKey = isoDay(new Date());
    const within60Days = Boolean(contact.contact_date && contact.contact_date >= dateOffset(todayKey, -60) && contact.contact_date <= todayKey);
    $('duplicate-contact-title').textContent = within60Days ? 'Socio ya contactado recientemente' : 'Este socio ya tuvo un contacto';
    $('duplicate-contact-message').textContent = within60Days
      ? `El socio ${memberNumber} ya tiene un contacto registrado en los últimos 60 días. Revisa su ficha antes de añadir otro.` 
      : `El último contacto del socio ${memberNumber} fue el ${fmtDate(contact.contact_date)}. Han pasado más de 60 días; puedes modificar esa ficha o registrar un contacto nuevo.`;
    const hotEnabled = Boolean(contact.hot_enabled ?? contact.visit_date);
    const warmEnabled = Boolean(contact.warm_enabled ?? contact.visit_date);
    const followupText = (enabled, done, due) => !enabled ? 'No activado' : (done ? 'Hecho' : fmtDate(due));
    $('duplicate-contact-profile').innerHTML = `<div class="duplicate-profile-top"><strong>Socio ${escapeHtml(contact.member_number || memberNumber)}</strong><span>Último contacto · ${fmtDate(contact.contact_date)}</span></div><div class="duplicate-profile-grid"><div><small>Tipo de contacto</small><strong>${escapeHtml(contact.contact_type || '—')}</strong></div><div><small>Visita</small><strong>${fmtDate(contact.visit_date)}</strong></div><div><small>Hot</small><strong>${followupText(hotEnabled, contact.hot_done, dueFor(contact, 'hot'))}</strong></div><div><small>Warm</small><strong>${followupText(warmEnabled, contact.warm_done, dueFor(contact, 'warm'))}</strong></div><div><small>Alta</small><strong>${contact.is_alta ? `Sí · ${fmtDate(contact.alta_date)}` : 'No'}</strong></div></div>`;
    $('contact-dialog').close();
    $('duplicate-contact-dialog').showModal();
  }

  async function saveContact(form, allowDuplicate = false) {
    const values = new FormData(form);
    const isAlta = values.get('is_alta') === 'on';
    const visitDate = values.get('visit_date') || null;
    const payload = {
      owner_id: state.user.id,
      member_number: values.get('member_number')?.trim() || null,
      contact_type: values.get('contact_type'),
      contact_date: values.get('contact_date'),
      visit_date: ['Visita física', 'Invitación', 'Visita sin comercial'].includes(values.get('contact_type')) ? visitDate : null,
      hot_enabled: values.get('hot_enabled') === 'on',
      warm_enabled: values.get('warm_enabled') === 'on',
      hot_done: false,
      warm_done: false,
      is_alta: isAlta,
      alta_date: isAlta ? (values.get('alta_date') || null) : null
    };
    if (payload.member_number && /^\d{1,4}$/.test(payload.member_number)) payload.member_number = payload.member_number.padStart(4, '0');
    if (!payload.member_number || !/^\d{4}$/.test(payload.member_number)) throw new Error('El número de socio debe tener hasta 4 cifras.');
    if (!payload.contact_type) throw new Error('Selecciona un tipo de contacto.');
    if (isAlta && !payload.alta_date) throw new Error('Indica la fecha del alta.');
    const wasEditing = Boolean(state.editingContactId);
    if (!wasEditing && !allowDuplicate) {
      const { data: previousContacts, error: duplicateError } = await db.from('gym_contacts')
        .select('*')
        .eq('owner_id', state.user.id)
        .eq('member_number', payload.member_number)
        .order('contact_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);
      if (duplicateError) throw new Error(`No se pudo comprobar el historial de este socio: ${duplicateError.message}`);
      if (previousContacts?.length) {
        openDuplicateContactDialog(previousContacts[0], payload.member_number);
        return;
      }
    }
    if (wasEditing) {
      const id = state.editingContactId;
      const current = state.contacts.find((item) => item.id === id);
      const before = {
        member_number: current.member_number, contact_type: current.contact_type, contact_date: current.contact_date,
        visit_date: current.visit_date, hot_enabled: current.hot_enabled, warm_enabled: current.warm_enabled,
        is_alta: current.is_alta, alta_date: current.alta_date, hot_done: current.hot_done, warm_done: current.warm_done
      };
      const after = {
        member_number: payload.member_number, contact_type: payload.contact_type, contact_date: payload.contact_date,
        visit_date: payload.visit_date, hot_enabled: payload.hot_enabled, warm_enabled: payload.warm_enabled,
        is_alta: payload.is_alta, alta_date: payload.alta_date, hot_done: current.hot_done, warm_done: current.warm_done
      };
      await writeContactFields(id, after);
      recordHistory('Modificar contacto', () => writeContactFields(id, before), () => writeContactFields(id, after));
    } else {
      const { data: created, error } = await db.from('gym_contacts').insert(payload).select('*').single();
      if (error) throw error;
      recordHistory('Añadir contacto', () => deleteContactRow(created.id), () => insertContactRow(created));
    }
    form.reset();
    $('alta-date-field').classList.add('hidden');
    state.editingContactId = null;
    $('contact-dialog').close();
    notice(wasEditing ? 'Contacto modificado.' : 'Contacto guardado.');
    await loadContacts();
  }
  function openNewContact() {
    state.editingContactId = null;
    const form = $('contact-form');
    form.reset();
    $('visit-date-field').classList.add('hidden');
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
    $('visit-date-field').classList.toggle('hidden', !['Visita física', 'Invitación', 'Visita sin comercial'].includes(contact.contact_type));
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
    $('complete-followup-date').disabled = Boolean(contact[`${kind}_done`]);
    $('complete-followup-date').textContent = contact[`${kind}_done`] ? 'Ya está hecho' : 'Marcar hecho';
    $('followup-date-dialog').showModal();
  }

  async function finishFollowupFromDialog(action) {
    const target = state.followupDateEdit;
    if (!target) return;
    const contact = state.contacts.find((item) => item.id === target.id);
    if (!contact) return;
    const enabledColumn = `${target.kind}_enabled`;
    const dateColumn = `${target.kind}_due_date`;
    const doneColumn = `${target.kind}_done`;
    const before = {
      [enabledColumn]: contact[enabledColumn] ?? null,
      [dateColumn]: contact[dateColumn] || null,
      [doneColumn]: Boolean(contact[doneColumn])
    };
    const after = action === 'done'
      ? { [doneColumn]: true }
      : { [enabledColumn]: false, [dateColumn]: null, [doneColumn]: false };
    await writeContactFields(target.id, after);
    recordHistory(action === 'done' ? 'Marcar seguimiento como hecho' : 'Quitar seguimiento', () => writeContactFields(target.id, before), () => writeContactFields(target.id, after));
    $('followup-date-dialog').close();
    state.followupDateEdit = null;
    notice(action === 'done' ? 'Seguimiento marcado como hecho.' : 'Seguimiento quitado.');
    await loadContacts();
  }
  async function saveFollowupDate(date) {
    const target = state.followupDateEdit;
    if (!target) return;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Elige una fecha válida.');
    const column = `${target.kind}_due_date`;
    const doneColumn = `${target.kind}_done`;
    const contact = state.contacts.find((item) => item.id === target.id);
    const before = { [column]: contact?.[column] || null, [doneColumn]: Boolean(contact?.[doneColumn]) };
    const after = { [column]: date || null, [doneColumn]: false };
    await writeContactFields(target.id, after);
    recordHistory(`Cambiar fecha ${target.kind === 'hot' ? 'Hot' : 'Warm'}`, () => writeContactFields(target.id, before), () => writeContactFields(target.id, after));
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
    const id = state.editingAltaId;
    const current = state.contacts.find((item) => item.id === id);
    const before = { is_alta: Boolean(current?.is_alta), alta_date: current?.alta_date || null };

    const after = { is_alta: isAlta, alta_date: isAlta ? altaDate : null };
    await writeContactFields(id, after);
    recordHistory('Cambiar estado de alta', () => writeContactFields(id, before), () => writeContactFields(id, after));
    $('alta-status-dialog').close();
    state.editingAltaId = null;
    notice(isAlta ? 'Alta actualizada.' : 'Estado actualizado: sin alta.');
    await loadContacts();
  }

  async function completeFollowup(id, field) {
    const contact = state.contacts.find((item) => item.id === id);
    const before = Boolean(contact?.[field]);
    const after = !before;
    try {
      await writeContactFields(id, { [field]: after });
      recordHistory(after ? 'Marcar seguimiento como hecho' : 'Reabrir seguimiento', () => writeContactFields(id, { [field]: before }), () => writeContactFields(id, { [field]: after }));
      await loadContacts();
    } catch (error) {
      notice(`No se pudo actualizar el seguimiento: ${error.message}`, 'error');
    }
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
      const deletedId = state.pendingDelete;
      const deletedRow = state.contacts.find((item) => item.id === deletedId);
      await deleteContactRow(deletedId);
      recordHistory('Eliminar contacto', () => insertContactRow(deletedRow), () => deleteContactRow(deletedId));
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
    $('month-picker-group').classList.toggle('hidden', !isMonth);
    $('year-picker-label').classList.toggle('hidden', state.periodMode !== 'year');
    $('range-start-label').classList.toggle('hidden', !isRange);
    $('range-end-label').classList.toggle('hidden', !isRange);
    $('period-range-error').classList.add('hidden');
    render();
  });
  $('month-filter').addEventListener('change', (e) => { state.month = e.target.value; render(); });
  const changeSelectedMonth = (offset) => {
    const [year, month] = state.month.split('-').map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    state.month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    $('month-filter').value = state.month;
    render();
  };
  $('previous-month').addEventListener('click', () => changeSelectedMonth(-1));
  $('next-month').addEventListener('click', () => changeSelectedMonth(1));
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
  ['contact-rows', 'recent-rows'].forEach((id) => $(id).addEventListener('click', (e) => {
    const button = e.target.closest('[data-edit-contact-type]');
    if (button) openContactTypeDialog(button.dataset.editContactType);
  }));
  document.body.addEventListener('click', (e) => {
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

  $('close-delete-confirm').addEventListener('click', () => $('delete-confirm').close());
  $('cancel-delete').addEventListener('click', () => $('delete-confirm').close());
  $('delete-confirm').addEventListener('close', () => { state.pendingDelete = null; });
  $('confirm-delete').addEventListener('click', deletePendingContact);
  $('new-contact-button').addEventListener('click', openNewContact);
  $('close-dialog').addEventListener('click', () => $('contact-dialog').close());
  $('cancel-dialog').addEventListener('click', () => $('contact-dialog').close());
  $('close-followup-date').addEventListener('click', () => $('followup-date-dialog').close());
  $('cancel-followup-date').addEventListener('click', () => $('followup-date-dialog').close());
  $('close-contact-type').addEventListener('click', () => $('contact-type-dialog').close());
  $('cancel-contact-type').addEventListener('click', () => $('contact-type-dialog').close());
  $('contact-type-select').addEventListener('change', (e) => {
    const needsVisitDate = ['Visita física', 'Invitación', 'Visita sin comercial'].includes(e.target.value);
    $('contact-type-visit-date-field').classList.toggle('hidden', !needsVisitDate);
    $('contact-type-visit-date').required = needsVisitDate;
  });
  $('contact-type-dialog').addEventListener('close', () => { state.editingContactTypeId = null; });
  $('contact-type-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await saveContactType(); } catch (error) { notice(`No se pudo cambiar el tipo de contacto: ${error.message}`, 'error'); } });
  $('complete-followup-date').addEventListener('click', async () => { try { await finishFollowupFromDialog('done'); } catch (error) { notice(error.message, 'error'); } });
  $('remove-followup-date').addEventListener('click', async () => { try { await finishFollowupFromDialog('remove'); } catch (error) { notice(error.message, 'error'); } });
  $('reset-followup-date').addEventListener('click', async () => { try { await saveFollowupDate(''); } catch (error) { notice(error.message, 'error'); } });
  $('followup-date-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await saveFollowupDate($('followup-date-input').value); } catch (error) { notice(error.message, 'error'); } });
  $('close-alta-status').addEventListener('click', () => $('alta-status-dialog').close());
  $('cancel-alta-status').addEventListener('click', () => $('alta-status-dialog').close());
  $('alta-status-checkbox').addEventListener('change', (e) => {
    $('alta-status-date-field').classList.toggle('hidden', !e.target.checked);
    $('alta-status-date').required = e.target.checked;
    if (e.target.checked && !$('alta-status-date').value) $('alta-status-date').value = isoDay(new Date());
  });
  $('alta-status-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await saveAltaStatus(); } catch (error) { notice(error.message, 'error'); } });
  $('is-alta').addEventListener('change', (e) => {
    $('alta-date-field').classList.toggle('hidden', !e.target.checked);
    $('contact-form').elements.alta_date.required = e.target.checked;
    if (e.target.checked && !$('contact-form').elements.alta_date.value) $('contact-form').elements.alta_date.value = isoDay(new Date());
  });
  document.querySelectorAll('input[name="contact_type"]').forEach((radio) => radio.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    const visitContact = e.target.value === 'Visita física';
    const showVisitDate = ['Visita física', 'Invitación', 'Visita sin comercial'].includes(e.target.value);
    $('visit-date-field').classList.toggle('hidden', !showVisitDate);
    if (!showVisitDate) $('contact-form').elements.visit_date.value = '';
    $('contact-form').elements.hot_enabled.checked = visitContact;
    $('contact-form').elements.warm_enabled.checked = visitContact;
  }));
  const memberNumberInput = $('contact-form').elements.member_number;
  memberNumberInput.addEventListener('input', () => { memberNumberInput.value = memberNumberInput.value.replace(/\D/g, '').slice(0, 4); });
  memberNumberInput.addEventListener('blur', () => { if (memberNumberInput.value) memberNumberInput.value = memberNumberInput.value.padStart(4, '0'); });
  $('contact-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await saveContact(e.currentTarget); } catch (error) { notice(error.message, 'error'); } });
  const returnFromDuplicateContact = () => {
    $('duplicate-contact-dialog').close();
    state.pendingDuplicateContact = null;
    $('contact-dialog').showModal();
  };
  $('close-duplicate-contact').addEventListener('click', returnFromDuplicateContact);
  $('cancel-duplicate-contact').addEventListener('click', returnFromDuplicateContact);
  $('modify-duplicate-contact').addEventListener('click', () => {
    const contact = state.pendingDuplicateContact;
    if (!contact) return;
    $('duplicate-contact-dialog').close();
    state.pendingDuplicateContact = null;
    openEditContact(contact.id);
  });
  $('add-duplicate-contact').addEventListener('click', async () => {
    if (!state.pendingDuplicateContact) return;
    $('duplicate-contact-dialog').close();
    state.pendingDuplicateContact = null;
    $('contact-dialog').showModal();
    try { await saveContact($('contact-form'), true); } catch (error) { notice(error.message, 'error'); }
  });
  $('customize-overview-button').addEventListener('click', () => setOverviewEditMode(!state.customizingOverview));
  $('reset-overview-layout-button').addEventListener('click', async () => {
    arrangeWidgets(DEFAULT_WIDGET_ORDER);
    if (await saveWidgetOrder(DEFAULT_WIDGET_ORDER)) setOverviewEditMode(true);
  });
  const widgetContainer = $('overview-widgets');
  widgetContainer.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('.widget-drag-handle');
    if (!handle || !state.customizingOverview) { event.preventDefault(); return; }
    const widget = handle.closest('[data-widget-id]'); state.draggedWidgetId = widget.dataset.widgetId;
    widget.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', state.draggedWidgetId);
  });
  widgetContainer.addEventListener('dragover', (event) => {
    if (!state.draggedWidgetId) return;
    const target = event.target.closest('[data-widget-id]');
    if (!target || target.dataset.widgetId === state.draggedWidgetId) return;
    event.preventDefault();
    const dragged = widgetContainer.querySelector(`[data-widget-id="${state.draggedWidgetId}"]`);
    const rect = target.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) target.before(dragged); else target.after(dragged);
  });
  widgetContainer.addEventListener('drop', async (event) => {
    if (!state.draggedWidgetId) return;
    event.preventDefault(); await saveWidgetOrder(getWidgetElements().map((widget) => widget.dataset.widgetId));
  });
  widgetContainer.addEventListener('dragend', () => {
    widgetContainer.querySelectorAll('.is-dragging').forEach((widget) => widget.classList.remove('is-dragging'));
    state.draggedWidgetId = null;
  });
  $('undo-button').addEventListener('click', () => runHistory('undo'));
  $('redo-button').addEventListener('click', () => runHistory('redo'));
  $('backup-button').addEventListener('click', () => $('backup-dialog').showModal());
  $('close-backup-dialog').addEventListener('click', () => $('backup-dialog').close());
  $('cancel-backup-dialog').addEventListener('click', () => $('backup-dialog').close());
  $('export-backup-button').addEventListener('click', async () => {
    try { await exportFullBackup(); }
    catch (error) { if (error.name !== 'AbortError') notice(`No se pudo exportar la copia: ${error.message}`, 'error'); }
  });
  $('choose-backup-button').addEventListener('click', () => $('backup-file-input').click());
  $('backup-file-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      state.pendingBackupImport = prepareBackupImport(await file.text(), file.name);
      $('backup-file-summary').textContent = `Archivo: ${file.name} · ${state.pendingBackupImport.contacts.length} contactos · ${state.pendingBackupImport.cancellations.length} meses de bajas`;
      $('backup-warning').classList.remove('hidden');
      $('restore-backup-button').disabled = false;
    } catch (error) {
      state.pendingBackupImport = null;
      $('backup-warning').classList.add('hidden');
      $('restore-backup-button').disabled = true;
      $('backup-file-summary').textContent = error.message;
    }
  });
  $('restore-backup-button').addEventListener('click', async () => {
    try { await restoreFullBackup(); }
    catch (error) { notice(`No se pudo restaurar la copia: ${error.message}`, 'error'); }
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
      applySavedWidgetOrder();
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

