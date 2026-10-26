/* ==========================================================================
   TaskHub — frontend logic
   Vanilla JavaScript + Fetch API. No frameworks, no build step.
   ========================================================================== */

'use strict';

(() => {
  // ------------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------------

  const API_BASE = (
    document.querySelector('meta[name="taskhub-api-base"]')?.content ||
    'http://localhost:5000/api'
  ).replace(/\/+$/, '');

  const SEARCH_DEBOUNCE_MS = 300;
  const TOAST_DURATION_MS = 3500;
  const TITLE_MAX = 255;
  const DESCRIPTION_MAX = 10000;
  const STATUSES = ['all', 'incomplete', 'completed'];

  // ------------------------------------------------------------------------
  // DOM references
  // ------------------------------------------------------------------------

  const $ = (selector, root = document) => root.querySelector(selector);

  const els = {
    stats: $('#stats'),

    banner: $('#error-banner'),
    bannerMessage: $('#error-banner-message'),
    bannerRetry: $('#error-banner-retry'),
    bannerClose: $('#error-banner-close'),

    createForm: $('#create-form'),
    createTitle: $('#create-title'),
    createTitleCounter: $('#create-title-counter'),
    createDescription: $('#create-description'),
    createFormError: $('#create-form-error'),
    createSubmit: $('#create-submit'),

    searchInput: $('#search-input'),
    searchClear: $('#search-clear'),
    tabs: $('#filter-tabs'),

    region: $('#list-region'),
    progress: $('#list-progress'),
    loading: $('#loading-state'),
    empty: $('#empty-state'),
    emptyTitle: $('#empty-title'),
    emptyText: $('#empty-text'),
    emptyAction: $('#empty-reset'),
    list: $('#task-list'),
    template: $('#task-template'),

    editDialog: $('#edit-dialog'),
    editForm: $('#edit-form'),
    editTitle: $('#edit-title'),
    editTitleCounter: $('#edit-title-counter'),
    editDescription: $('#edit-description'),
    editFormError: $('#edit-form-error'),
    editSubmit: $('#edit-submit'),

    deleteDialog: $('#delete-dialog'),
    deleteTaskTitle: $('#delete-task-title'),
    deleteError: $('#delete-error'),
    deleteConfirm: $('#delete-confirm'),

    toasts: $('#toasts'),
  };

  const createFields = { title: els.createTitle, description: els.createDescription };
  const editFields = { title: els.editTitle, description: els.editDescription };

  // ------------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------------

  const state = {
    /** @type {Array<{id:string,title:string,description:string,completed:boolean,createdAt:string,updatedAt:string}>} */
    tasks: [],
    search: '',
    status: 'all',
    loading: false,
    hasLoaded: false,
    loadError: false,
    /** @type {AbortController | null} */
    listController: null,
    editingId: null,
    deletingId: null,
    editBusy: false,
    deleteBusy: false,
  };

  // ------------------------------------------------------------------------
  // API client
  // ------------------------------------------------------------------------

  class ApiError extends Error {
    constructor(message, { status = 0, details = null, network = false } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.details = details;
      this.network = network;
    }
  }

  /**
   * Thin wrapper around fetch that parses JSON and normalizes errors.
   * @param {string} path
   * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options]
   */
  async function apiRequest(path, { method = 'GET', body, signal } = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        signal,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ApiError(
        `Unable to reach the TaskHub API at ${API_BASE}. Make sure the backend is running.`,
        { network: true },
      );
    }

    if (response.status === 204) return null;

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Non-JSON body — handled below.
    }

    if (!response.ok) {
      throw new ApiError(payload?.error?.message || `Request failed (HTTP ${response.status})`, {
        status: response.status,
        details: payload?.error?.details ?? null,
      });
    }

    return payload;
  }

  const api = {
    list({ search, status }, signal) {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status && status !== 'all') params.set('status', status);
      const query = params.toString();
      return apiRequest(`/tasks${query ? `?${query}` : ''}`, { signal });
    },
    create(data) {
      return apiRequest('/tasks', { method: 'POST', body: data });
    },
    update(id, changes) {
      return apiRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
    },
    remove(id) {
      return apiRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };

  const isConnectivityError = (err) =>
    err instanceof ApiError && (err.network || err.status === 503);

  // ------------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------------

  function debounce(fn, wait) {
    let timer;
    const debounced = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
  }

  const absoluteDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  /** "Oct 26, 2026, 11:58 PM (5 minutes ago)" — relative part only within a week. */
  function formatTimestamp(iso) {
    const date = new Date(iso);
    const absolute = absoluteDate.format(date);
    const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
    const abs = Math.abs(diffSeconds);

    let relative = '';
    if (abs < 45) relative = 'just now';
    else if (abs < 3600) relative = relativeTime.format(Math.round(diffSeconds / 60), 'minute');
    else if (abs < 86400) relative = relativeTime.format(Math.round(diffSeconds / 3600), 'hour');
    else if (abs < 7 * 86400) relative = relativeTime.format(Math.round(diffSeconds / 86400), 'day');

    return relative ? `${absolute} (${relative})` : absolute;
  }

  const pluralize = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

  /**
   * Add a state class that triggers a Tailwind exit transition
   * (e.g. `[&.is-leaving]:opacity-0`) and resolve once it has finished,
   * with a timeout fallback (reduced motion, unsupported transitions).
   */
  function animateOut(node, className = 'is-leaving', timeout = 260) {
    return new Promise((resolve) => {
      if (!node || !node.isConnected) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      node.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, timeout);
      node.classList.add(className);
    });
  }

  // ------------------------------------------------------------------------
  // Toasts & error banner
  // ------------------------------------------------------------------------

  const TOAST_BASE_CLASSES =
    'rounded-lg px-4 py-2.5 text-sm font-medium shadow-xl transition duration-200 ' +
    'motion-reduce:transition-none starting:translate-y-2 starting:opacity-0 ' +
    '[&.is-leaving]:translate-y-2 [&.is-leaving]:opacity-0';
  const TOAST_VARIANT_CLASSES = {
    info: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
    error: 'bg-red-600 text-white',
  };

  function toast(message, type = 'info') {
    const node = document.createElement('div');
    node.className = `${TOAST_BASE_CLASSES} ${TOAST_VARIANT_CLASSES[type] ?? TOAST_VARIANT_CLASSES.info}`;
    node.setAttribute('role', type === 'error' ? 'alert' : 'status');
    node.textContent = message;
    els.toasts.append(node);
    setTimeout(() => animateOut(node).then(() => node.remove()), TOAST_DURATION_MS);
  }

  function showBanner(message) {
    els.bannerMessage.textContent = message;
    els.banner.hidden = false;
  }

  function hideBanner() {
    els.banner.hidden = true;
  }

  /** Report a non-form error: connectivity problems go to the banner, others to a toast. */
  function reportError(err, fallback) {
    if (isConnectivityError(err)) showBanner(err.message);
    else toast(err?.message || fallback, 'error');
  }

  // ------------------------------------------------------------------------
  // Form helpers
  // ------------------------------------------------------------------------

  function validateTask({ title, description }) {
    const errors = {};
    if (!title) errors.title = 'Title is required';
    else if (title.length > TITLE_MAX) errors.title = `Title must be at most ${TITLE_MAX} characters`;

    if (!description) errors.description = 'Description is required';
    else if (description.length > DESCRIPTION_MAX)
      errors.description = `Description must be at most ${DESCRIPTION_MAX} characters`;
    return errors;
  }

  function setFieldError(input, message) {
    const errorEl = document.getElementById(`${input.id}-error`);
    if (errorEl) errorEl.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  /** Apply an `{ field: message }` map to a set of inputs; returns the first invalid input. */
  function setFieldErrors(fields, errors) {
    let firstInvalid = null;
    for (const [name, input] of Object.entries(fields)) {
      setFieldError(input, errors[name]);
      if (errors[name] && !firstInvalid) firstInvalid = input;
    }
    return firstInvalid;
  }

  function showFormError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  /** Show server-side validation errors next to the fields they belong to. */
  function handleFormError(err, fields, formErrorEl) {
    if (err instanceof ApiError && err.status === 400 && Array.isArray(err.details)) {
      const fieldErrors = {};
      const otherMessages = [];
      for (const { field, message } of err.details) {
        if (field && field in fields) fieldErrors[field] ??= message;
        else otherMessages.push(message);
      }
      setFieldErrors(fields, fieldErrors)?.focus();
      showFormError(formErrorEl, otherMessages.join(' '));
      return;
    }

    showFormError(formErrorEl, err?.message || 'Something went wrong. Please try again.');
    if (isConnectivityError(err)) showBanner(err.message);
  }

  function setButtonLoading(button, loading, label) {
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    button.setAttribute('aria-busy', String(loading));
    if (label) button.querySelector('.btn__label').textContent = label;
  }

  function updateCounter(input, counterEl, max) {
    const length = input.value.length;
    counterEl.textContent = `${length}/${max}`;
    counterEl.classList.toggle('is-near-limit', length >= max * 0.9);
  }

  function bindFieldBehaviour(fields, counter) {
    for (const input of Object.values(fields)) {
      input.addEventListener('input', () => setFieldError(input, ''));
    }
    if (counter) {
      counter.input.addEventListener('input', () =>
        updateCounter(counter.input, counter.el, TITLE_MAX),
      );
    }
  }

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------

  const hasActiveFilters = () => Boolean(state.search) || state.status !== 'all';
  const findTask = (id) => state.tasks.find((task) => task.id === id);
  const findTaskNode = (id) => els.list.querySelector(`.task[data-id="${CSS.escape(id)}"]`);

  /** Mirror of the server-side filter, used to keep the list consistent after local changes. */
  function matchesFilters(task) {
    if (state.status === 'completed' && !task.completed) return false;
    if (state.status === 'incomplete' && task.completed) return false;
    if (state.search && !task.title.toLocaleLowerCase().includes(state.search.toLocaleLowerCase())) {
      return false;
    }
    return true;
  }

  function fillTimes(node, task) {
    const created = $('.task__created', node);
    created.dateTime = task.createdAt;
    created.textContent = formatTimestamp(task.createdAt);

    const wasUpdated = new Date(task.updatedAt) - new Date(task.createdAt) > 1000;
    $('.task__updated-wrap', node).hidden = !wasUpdated;
    if (wasUpdated) {
      const updated = $('.task__updated', node);
      updated.dateTime = task.updatedAt;
      updated.textContent = formatTimestamp(task.updatedAt);
    }
  }

  /** Populate a task card. Uses textContent everywhere — user data is never parsed as HTML. */
  function fillTaskNode(node, task) {
    node.dataset.id = task.id;
    node.classList.toggle('is-completed', task.completed);

    const checkbox = $('.task__checkbox', node);
    checkbox.checked = task.completed;
    checkbox.setAttribute(
      'aria-label',
      task.completed ? `Mark "${task.title}" as incomplete` : `Mark "${task.title}" as complete`,
    );

    $('.task__title', node).textContent = task.title;
    $('.task__description', node).textContent = task.description;

    const badge = $('.task__badge', node);
    badge.textContent = task.completed ? 'Completed' : 'Incomplete';

    fillTimes(node, task);

    const editBtn = $('[data-action="edit"]', node);
    editBtn.setAttribute('aria-label', `Edit "${task.title}"`);
    editBtn.title = 'Edit task';

    const deleteBtn = $('[data-action="delete"]', node);
    deleteBtn.setAttribute('aria-label', `Delete "${task.title}"`);
    deleteBtn.title = 'Delete task';
  }

  function createTaskNode(task) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    fillTaskNode(node, task);
    return node;
  }

  /**
   * Keyed reconciliation: reuse existing cards (keeps focus & avoids
   * replaying entry animations), create new ones, drop the rest.
   */
  function renderList() {
    const existing = new Map(
      Array.from(els.list.children, (node) => [node.dataset.id, node]),
    );

    const nodes = state.tasks.map((task) => {
      const node = existing.get(task.id);
      if (node && !node.classList.contains('is-leaving')) {
        fillTaskNode(node, task);
        return node;
      }
      return createTaskNode(task);
    });

    nodes.forEach((node, index) => {
      const current = els.list.children[index];
      if (current !== node) els.list.insertBefore(node, current ?? null);
    });
    while (els.list.children.length > nodes.length) {
      els.list.lastElementChild.remove();
    }

    renderStatus();
  }

  /** Loading / empty / stats UI derived from state. */
  function renderStatus() {
    const count = state.tasks.length;

    els.region.setAttribute('aria-busy', String(state.loading));
    els.loading.hidden = !(state.loading && !state.hasLoaded);
    els.progress.hidden = !(state.loading && state.hasLoaded);

    // Empty / error-placeholder state
    let empty = null;
    if (!state.hasLoaded && state.loadError && !state.loading) {
      empty = {
        title: 'Couldn’t load tasks',
        text: 'The TaskHub API is not responding. Check that the backend is running.',
        action: 'retry',
        actionLabel: 'Try again',
      };
    } else if (state.hasLoaded && count === 0) {
      if (hasActiveFilters()) {
        const statusText = state.status === 'all' ? '' : `${state.status} `;
        empty = {
          title: 'No matching tasks',
          text: state.search
            ? `No ${statusText}tasks match “${state.search}”.`
            : `You have no ${statusText}tasks.`,
          action: 'reset',
          actionLabel: 'Clear filters',
        };
      } else {
        empty = { title: 'No tasks yet', text: 'Create your first task using the form.' };
      }
    }

    els.empty.hidden = !empty;
    if (empty) {
      els.emptyTitle.textContent = empty.title;
      els.emptyText.textContent = empty.text;
      els.emptyAction.hidden = !empty.action;
      els.emptyAction.dataset.action = empty.action || '';
      els.emptyAction.textContent = empty.actionLabel || '';
    }

    // Header stats
    if (state.hasLoaded) {
      const completed = state.tasks.filter((task) => task.completed).length;
      els.stats.textContent =
        state.status === 'all'
          ? `${pluralize(count, 'task')} · ${completed} completed`
          : `${pluralize(count, state.status + ' task')}`;
    } else {
      els.stats.textContent = '';
    }
  }

  function refreshRelativeTimes() {
    for (const node of els.list.children) {
      const task = findTask(node.dataset.id);
      if (task) fillTimes(node, task);
    }
  }

  // ------------------------------------------------------------------------
  // Data operations
  // ------------------------------------------------------------------------

  async function loadTasks() {
    state.listController?.abort();
    const controller = new AbortController();
    state.listController = controller;

    state.loading = true;
    renderStatus();

    try {
      const { data } = await api.list({ search: state.search, status: state.status }, controller.signal);
      state.tasks = data;
      state.hasLoaded = true;
      state.loadError = false;
      hideBanner();
      renderList();
    } catch (err) {
      if (err.name === 'AbortError') return;
      state.loadError = true;
      showBanner(err.message || 'Could not load tasks.');
    } finally {
      if (state.listController === controller) {
        state.listController = null;
        state.loading = false;
        renderStatus();
      }
    }
  }

  /** Replace a task in state (or drop it if it no longer matches the filters). */
  async function applyUpdatedTask(updated) {
    const index = state.tasks.findIndex((task) => task.id === updated.id);
    if (index === -1) return;

    if (matchesFilters(updated)) {
      state.tasks[index] = updated;
      renderList();
    } else {
      state.tasks.splice(index, 1);
      await animateOut(findTaskNode(updated.id));
      renderList();
    }
  }

  async function removeTaskLocally(id) {
    state.tasks = state.tasks.filter((task) => task.id !== id);
    await animateOut(findTaskNode(id));
    renderList();
  }

  async function toggleTask(id, completed) {
    const task = findTask(id);
    const node = findTaskNode(id);
    if (!task || !node) return;

    // Optimistic UI
    node.classList.add('is-busy');
    node.classList.toggle('is-completed', completed);

    try {
      const { data } = await api.update(id, { completed });
      node.classList.remove('is-busy');
      await applyUpdatedTask(data);
    } catch (err) {
      node.classList.remove('is-busy');
      if (err instanceof ApiError && err.status === 404) {
        toast('That task no longer exists.', 'error');
        await removeTaskLocally(id);
        return;
      }
      fillTaskNode(node, task); // revert
      reportError(err, 'Could not update the task.');
    }
  }

  // ------------------------------------------------------------------------
  // Create form
  // ------------------------------------------------------------------------

  async function handleCreateSubmit(event) {
    event.preventDefault();
    showFormError(els.createFormError, '');

    const values = {
      title: els.createTitle.value.trim(),
      description: els.createDescription.value.trim(),
    };

    const firstInvalid = setFieldErrors(createFields, validateTask(values));
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setButtonLoading(els.createSubmit, true, 'Adding…');
    els.createTitle.disabled = true;
    els.createDescription.disabled = true;

    try {
      const { data: task } = await api.create(values);
      els.createForm.reset();
      updateCounter(els.createTitle, els.createTitleCounter, TITLE_MAX);
      hideBanner();

      if (matchesFilters(task)) {
        state.tasks = [task, ...state.tasks];
        state.hasLoaded = true;
        renderList();
        toast('Task created');
      } else {
        toast('Task created — hidden by the current filters');
      }
    } catch (err) {
      handleFormError(err, createFields, els.createFormError);
    } finally {
      setButtonLoading(els.createSubmit, false, 'Add task');
      els.createTitle.disabled = false;
      els.createDescription.disabled = false;
      if (!els.createForm.querySelector('[aria-invalid="true"]')) els.createTitle.focus();
    }
  }

  // ------------------------------------------------------------------------
  // Edit dialog
  // ------------------------------------------------------------------------

  function openEditDialog(id) {
    const task = findTask(id);
    if (!task) return;

    state.editingId = id;
    els.editTitle.value = task.title;
    els.editDescription.value = task.description;
    setFieldErrors(editFields, {});
    showFormError(els.editFormError, '');
    updateCounter(els.editTitle, els.editTitleCounter, TITLE_MAX);

    els.editDialog.showModal();
    els.editTitle.focus();
    els.editTitle.select();
  }

  function setEditBusy(busy) {
    state.editBusy = busy;
    setButtonLoading(els.editSubmit, busy, busy ? 'Saving…' : 'Save changes');
    els.editTitle.disabled = busy;
    els.editDescription.disabled = busy;
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    if (state.editBusy) return;

    const task = findTask(state.editingId);
    if (!task) {
      els.editDialog.close();
      return;
    }

    showFormError(els.editFormError, '');
    const values = {
      title: els.editTitle.value.trim(),
      description: els.editDescription.value.trim(),
    };

    const firstInvalid = setFieldErrors(editFields, validateTask(values));
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    // Only send fields that actually changed.
    const changes = {};
    if (values.title !== task.title) changes.title = values.title;
    if (values.description !== task.description) changes.description = values.description;

    if (Object.keys(changes).length === 0) {
      els.editDialog.close();
      return;
    }

    setEditBusy(true);
    try {
      const { data } = await api.update(task.id, changes);
      setEditBusy(false);
      els.editDialog.close();
      toast('Task updated');
      await applyUpdatedTask(data);
    } catch (err) {
      setEditBusy(false);
      if (err instanceof ApiError && err.status === 404) {
        els.editDialog.close();
        toast('That task no longer exists.', 'error');
        await removeTaskLocally(task.id);
        return;
      }
      handleFormError(err, editFields, els.editFormError);
    }
  }

  // ------------------------------------------------------------------------
  // Delete dialog
  // ------------------------------------------------------------------------

  function openDeleteDialog(id) {
    const task = findTask(id);
    if (!task) return;

    state.deletingId = id;
    els.deleteTaskTitle.textContent = task.title;
    showFormError(els.deleteError, '');
    els.deleteDialog.showModal();
    els.deleteDialog.querySelector('[data-close]').focus(); // safe default
  }

  async function handleDeleteConfirm() {
    if (state.deleteBusy || !state.deletingId) return;
    const id = state.deletingId;

    state.deleteBusy = true;
    setButtonLoading(els.deleteConfirm, true, 'Deleting…');
    showFormError(els.deleteError, '');

    try {
      await api.remove(id);
      finishDelete(id, 'Task deleted');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        finishDelete(id, 'Task was already deleted');
      } else {
        showFormError(els.deleteError, err?.message || 'Could not delete the task.');
        if (isConnectivityError(err)) showBanner(err.message);
      }
    } finally {
      state.deleteBusy = false;
      setButtonLoading(els.deleteConfirm, false, 'Delete');
    }
  }

  function finishDelete(id, message) {
    state.deleteBusy = false;
    els.deleteDialog.close();
    toast(message);
    removeTaskLocally(id);
  }

  // ------------------------------------------------------------------------
  // Search & filters
  // ------------------------------------------------------------------------

  function applySearch(value) {
    const search = value.trim();
    if (search === state.search) return;
    state.search = search;
    loadTasks();
  }

  const debouncedSearch = debounce(applySearch, SEARCH_DEBOUNCE_MS);

  function clearSearch() {
    debouncedSearch.cancel();
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    applySearch('');
  }

  function setStatus(status, { focus = false } = {}) {
    if (!STATUSES.includes(status)) return;

    for (const tab of els.tabs.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.status === status;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }

    if (status === state.status) return;
    state.status = status;
    loadTasks();
  }

  function resetFilters() {
    debouncedSearch.cancel();
    els.searchInput.value = '';
    els.searchClear.hidden = true;
    state.search = '';
    state.status = 'all';
    setStatus('all');
    loadTasks();
  }

  // ------------------------------------------------------------------------
  // Dialog plumbing (shared)
  // ------------------------------------------------------------------------

  function wireDialog(dialog, isBusy, onClose) {
    // Close buttons
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]') && !isBusy()) {
        dialog.close();
        return;
      }
      // Click on the backdrop (the dialog element itself, outside its content box)
      if (event.target === dialog && !isBusy()) {
        const rect = dialog.getBoundingClientRect();
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (!inside) dialog.close();
      }
    });

    // Escape key — block while a request is in flight
    dialog.addEventListener('cancel', (event) => {
      if (isBusy()) event.preventDefault();
    });

    dialog.addEventListener('close', onClose);
  }

  // ------------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------------

  function init() {
    // Create form
    bindFieldBehaviour(createFields, { input: els.createTitle, el: els.createTitleCounter });
    els.createForm.addEventListener('submit', handleCreateSubmit);

    // Edit form
    bindFieldBehaviour(editFields, { input: els.editTitle, el: els.editTitleCounter });
    els.editForm.addEventListener('submit', handleEditSubmit);
    wireDialog(els.editDialog, () => state.editBusy, () => {
      state.editingId = null;
    });

    // Delete dialog
    els.deleteConfirm.addEventListener('click', handleDeleteConfirm);
    wireDialog(els.deleteDialog, () => state.deleteBusy, () => {
      state.deletingId = null;
    });

    // Task card actions (event delegation)
    els.list.addEventListener('change', (event) => {
      const checkbox = event.target.closest('.task__checkbox');
      if (!checkbox) return;
      const id = checkbox.closest('.task').dataset.id;
      toggleTask(id, checkbox.checked);
    });

    els.list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const id = button.closest('.task').dataset.id;
      if (button.dataset.action === 'edit') openEditDialog(id);
      else if (button.dataset.action === 'delete') openDeleteDialog(id);
    });

    // Search
    els.searchInput.addEventListener('input', () => {
      els.searchClear.hidden = els.searchInput.value === '';
      debouncedSearch(els.searchInput.value);
    });
    els.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.searchInput.value) {
        event.preventDefault();
        clearSearch();
      } else if (event.key === 'Enter') {
        debouncedSearch.cancel();
        applySearch(els.searchInput.value);
      }
    });
    els.searchClear.addEventListener('click', () => {
      clearSearch();
      els.searchInput.focus();
    });

    // Filter tabs (click + roving-tabindex keyboard navigation)
    els.tabs.addEventListener('click', (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (tab) setStatus(tab.dataset.status);
    });
    els.tabs.addEventListener('keydown', (event) => {
      const tabs = Array.from(els.tabs.querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(document.activeElement);
      if (current === -1) return;

      let next = null;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;

      if (next !== null) {
        event.preventDefault();
        setStatus(tabs[next].dataset.status, { focus: true });
      }
    });

    // Empty-state action (retry or clear filters)
    els.emptyAction.addEventListener('click', () => {
      if (els.emptyAction.dataset.action === 'reset') resetFilters();
      else loadTasks();
    });

    // Error banner
    els.bannerRetry.addEventListener('click', loadTasks);
    els.bannerClose.addEventListener('click', hideBanner);

    // Reload when the browser comes back online
    window.addEventListener('online', loadTasks);

    // Keep relative timestamps fresh
    setInterval(refreshRelativeTimes, 60_000);

    updateCounter(els.createTitle, els.createTitleCounter, TITLE_MAX);
    loadTasks();
  }

  init();
})();
