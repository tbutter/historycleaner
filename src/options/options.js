import { MESSAGE_TYPES } from '../background.js';
import {
  formatCountdown,
  formatIntervalLabel,
  formatRegexLiteral,
  formatRelativePast,
} from '../lib/format.js';
import {
  compileRules,
  exportDataToJson,
  exportRulesToText,
  matchUrl,
  mergeRules,
  parseDataFromJson,
  parseRulesFromText,
  validateRulePattern,
} from '../lib/matcher.js';
import {
  STORAGE_KEYS,
  addRule,
  deleteRule,
  getRules,
  getSchedule,
  saveRules,
  saveSchedule,
  updateRule,
} from '../lib/storage.js';

const PRESET_VALUES = new Set([5, 15, 30, 60, 360, 1440]);

const state = {
  rules: [],
  schedule: { enabled: true, intervalMinutes: 60, runOnStartup: false },
  editingRuleId: null,
  matchedTestRuleIds: new Set(),
};

const els = {
  globalBanner: document.getElementById('global-banner'),
  optPreviewBtn: document.getElementById('opt-preview-btn'),
  optCleanNowBtn: document.getElementById('opt-clean-now-btn'),

  statRules: document.getElementById('opt-stat-rules'),
  statRulesSub: document.getElementById('opt-stat-rules-sub'),
  statSchedule: document.getElementById('opt-stat-schedule'),
  statNextRun: document.getElementById('opt-stat-next-run'),
  statLastRun: document.getElementById('opt-stat-last-run'),
  statLastDetail: document.getElementById('opt-stat-last-detail'),
  statTotalDeleted: document.getElementById('opt-stat-total-deleted'),

  previewPanel: document.getElementById('opt-preview-panel'),
  previewCaption: document.getElementById('opt-preview-caption'),
  previewList: document.getElementById('opt-preview-list'),
  previewCleanBtn: document.getElementById('opt-preview-clean-btn'),
  previewCloseBtn: document.getElementById('opt-preview-close-btn'),

  addRuleForm: document.getElementById('add-rule-form'),
  newPatternInput: document.getElementById('new-pattern-input'),
  newNoteInput: document.getElementById('new-note-input'),
  newCaseCheckbox: document.getElementById('new-case-checkbox'),
  newRuleValidation: document.getElementById('new-rule-validation'),
  emptyRulesState: document.getElementById('empty-rules-state'),
  rulesList: document.getElementById('rules-list'),

  testUrlInput: document.getElementById('test-url-input'),
  clearTestUrlBtn: document.getElementById('clear-test-url-btn'),
  testUrlResult: document.getElementById('test-url-result'),

  scheduleEnabledToggle: document.getElementById('schedule-enabled-toggle'),
  schedulePresetSelect: document.getElementById('schedule-preset-select'),
  customIntervalWrap: document.getElementById('custom-interval-wrap'),
  scheduleCustomMinutes: document.getElementById('schedule-custom-minutes'),
  saveCustomIntervalBtn: document.getElementById('save-custom-interval-btn'),
  scheduleStartupToggle: document.getElementById('schedule-startup-toggle'),

  exportJsonBtn: document.getElementById('export-json-btn'),
  exportTxtBtn: document.getElementById('export-txt-btn'),
  importModeSelect: document.getElementById('import-mode-select'),
  importFileInput: document.getElementById('import-file-input'),
  importFileBtn: document.getElementById('import-file-btn'),
  importTextarea: document.getElementById('import-textarea'),
  importTextBtn: document.getElementById('import-text-btn'),
};

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error(response?.error || 'Background service worker request failed.'));
        return;
      }
      resolve(response.result);
    });
  });
}

function showBanner(message, kind = 'success') {
  els.globalBanner.textContent = message;
  els.globalBanner.className = `banner banner-${kind}`;
  els.globalBanner.hidden = false;
}

function hideBanner() {
  els.globalBanner.hidden = true;
  els.globalBanner.textContent = '';
}

function renderRulesList() {
  els.rulesList.replaceChildren();

  if (state.rules.length === 0) {
    els.emptyRulesState.hidden = false;
    els.rulesList.hidden = true;
    return;
  }

  els.emptyRulesState.hidden = true;
  els.rulesList.hidden = false;

  for (const rule of state.rules) {
    const li = document.createElement('li');
    li.className = 'rule-row';
    if (rule.enabled === false) {
      li.classList.add('is-disabled');
    }
    if (state.matchedTestRuleIds.has(rule.id)) {
      li.classList.add('is-matching-test');
    }

    if (state.editingRuleId === rule.id) {
      li.appendChild(buildInlineEditForm(rule));
    } else {
      li.appendChild(buildRuleDisplayMain(rule));
      li.appendChild(buildRuleDisplayActions(rule));
    }

    els.rulesList.appendChild(li);
  }
}

function buildRuleDisplayMain(rule) {
  const main = document.createElement('div');
  main.className = 'rule-main';

  const switchLabel = document.createElement('label');
  switchLabel.className = 'switch';
  switchLabel.title = rule.enabled !== false ? 'Disable rule' : 'Enable rule';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = rule.enabled !== false;
  checkbox.setAttribute('aria-label', `Toggle rule ${rule.pattern}`);
  checkbox.addEventListener('change', async () => {
    try {
      await updateRule(rule.id, { enabled: checkbox.checked });
      await reloadAll();
    } catch (err) {
      showBanner(err.message, 'error');
      await reloadAll();
    }
  });

  const track = document.createElement('span');
  track.className = 'switch-track';
  switchLabel.append(checkbox, track);

  const details = document.createElement('div');
  details.className = 'rule-details';

  const patternLine = document.createElement('div');
  patternLine.className = 'rule-pattern-line';

  const codeChip = document.createElement('code');
  codeChip.className = 'regex-chip';
  codeChip.textContent = formatRegexLiteral(rule);
  patternLine.appendChild(codeChip);

  const check = validateRulePattern(rule.pattern, rule.flags);
  if (check.warning) {
    const warnBadge = document.createElement('span');
    warnBadge.className = 'badge badge-warn';
    warnBadge.title = check.warning;
    warnBadge.textContent = 'Broad pattern';
    patternLine.appendChild(warnBadge);
  }

  if (state.matchedTestRuleIds.has(rule.id)) {
    const matchBadge = document.createElement('span');
    matchBadge.className = 'badge badge-match';
    matchBadge.textContent = 'Matches test URL';
    patternLine.appendChild(matchBadge);
  }

  details.appendChild(patternLine);

  if (rule.note) {
    const noteEl = document.createElement('span');
    noteEl.className = 'rule-note';
    noteEl.textContent = rule.note;
    details.appendChild(noteEl);
  }

  main.append(switchLabel, details);
  return main;
}

function buildRuleDisplayActions(rule) {
  const actions = document.createElement('div');
  actions.className = 'rule-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-ghost btn-sm';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => {
    state.editingRuleId = rule.id;
    renderRulesList();
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger-ghost btn-sm';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async () => {
    try {
      await deleteRule(rule.id);
      await reloadAll();
    } catch (err) {
      showBanner(err.message, 'error');
    }
  });

  actions.append(editBtn, delBtn);
  return actions;
}

function buildInlineEditForm(rule) {
  const form = document.createElement('form');
  form.className = 'rule-edit-form';
  form.noValidate = true;

  const patternInput = document.createElement('input');
  patternInput.type = 'text';
  patternInput.className = 'input mono';
  patternInput.value = rule.pattern;
  patternInput.spellcheck = false;
  patternInput.setAttribute('aria-label', 'Edit regular expression pattern');

  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.className = 'input';
  noteInput.value = rule.note || '';
  noteInput.placeholder = 'Optional note';
  noteInput.setAttribute('aria-label', 'Edit rule note');

  const flagPill = document.createElement('label');
  flagPill.className = 'flag-toggle-pill';
  const caseBox = document.createElement('input');
  caseBox.type = 'checkbox';
  caseBox.checked = (rule.flags || '').includes('i');
  const flagSpan = document.createElement('span');
  flagSpan.textContent = 'Ignore case (i)';
  flagPill.append(caseBox, flagSpan);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary btn-sm';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    state.editingRuleId = null;
    renderRulesList();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const otherFlags = (rule.flags || '').replace(/i/g, '');
    const flags = caseBox.checked ? `${otherFlags}i` : otherFlags;
    const validation = validateRulePattern(patternInput.value, flags);
    if (!validation.valid) {
      showBanner(validation.error, 'error');
      patternInput.focus();
      return;
    }

    try {
      await updateRule(rule.id, {
        pattern: patternInput.value,
        flags: validation.sanitizedFlags,
        note: noteInput.value,
      });
      state.editingRuleId = null;
      if (validation.warning) {
        showBanner(`Rule updated. ${validation.warning}`, 'warning');
      } else {
        showBanner('Rule updated.', 'success');
      }
      await reloadAll();
    } catch (err) {
      showBanner(err.message, 'error');
    }
  });

  form.append(patternInput, noteInput, flagPill, saveBtn, cancelBtn);
  return form;
}

function syncScheduleControls(schedule) {
  els.scheduleEnabledToggle.checked = schedule.enabled;
  els.scheduleStartupToggle.checked = Boolean(schedule.runOnStartup);
  els.schedulePresetSelect.disabled = !schedule.enabled;
  els.scheduleCustomMinutes.disabled = !schedule.enabled;
  els.saveCustomIntervalBtn.disabled = !schedule.enabled;

  if (PRESET_VALUES.has(schedule.intervalMinutes)) {
    els.schedulePresetSelect.value = String(schedule.intervalMinutes);
    els.customIntervalWrap.hidden = true;
  } else {
    els.schedulePresetSelect.value = 'custom';
    els.scheduleCustomMinutes.value = String(schedule.intervalMinutes);
    els.customIntervalWrap.hidden = false;
  }
}

function evaluateTestUrl() {
  const sampleUrl = els.testUrlInput.value.trim();
  state.matchedTestRuleIds.clear();

  if (!sampleUrl) {
    els.clearTestUrlBtn.hidden = true;
    els.testUrlResult.hidden = true;
    renderRulesList();
    return;
  }

  els.clearTestUrlBtn.hidden = false;
  const { compiled } = compileRules(state.rules);
  const res = matchUrl(sampleUrl, compiled, { collectAll: true });

  for (const m of res.matchedRules) {
    state.matchedTestRuleIds.add(m.id);
  }

  els.testUrlResult.hidden = false;
  if (compiled.length === 0) {
    els.testUrlResult.className = 'banner banner-warning';
    els.testUrlResult.textContent = 'No active regex rules to test against.';
  } else if (res.matched) {
    const literals = res.matchedRules.map(formatRegexLiteral).join(', ');
    els.testUrlResult.className = 'banner banner-success';
    els.testUrlResult.textContent = `Would be REMOVED — matched ${res.matchedRules.length} active rule(s): ${literals}`;
  } else {
    els.testUrlResult.className = 'tester-result';
    els.testUrlResult.textContent = `Would be KEPT — did not match any of the ${compiled.length} active rule(s).`;
  }

  renderRulesList();
}

async function refreshTelemetry() {
  const status = await sendMessage({ type: MESSAGE_TYPES.GET_STATUS });

  els.statRules.textContent = String(status.activeRuleCount);
  els.statRulesSub.textContent = `${status.totalRuleCount} total saved`;

  const { schedule, nextRunTimestamp } = status.scheduler;
  if (schedule.enabled) {
    els.statSchedule.textContent = formatIntervalLabel(schedule.intervalMinutes);
    els.statNextRun.textContent = `Next run ${formatCountdown(nextRunTimestamp)}`;
  } else {
    els.statSchedule.textContent = 'Paused';
    els.statNextRun.textContent = 'Manual trigger only';
  }

  const lastRun = status.stats.lastRun;
  if (lastRun) {
    els.statLastRun.textContent = formatRelativePast(lastRun.timestamp);
    els.statLastDetail.textContent = `${lastRun.deletedCount.toLocaleString()} removed (${lastRun.trigger})`;
  } else {
    els.statLastRun.textContent = 'Never';
    els.statLastDetail.textContent = 'No runs recorded yet';
  }

  els.statTotalDeleted.textContent = status.stats.totalDeleted.toLocaleString();
}

async function reloadAll() {
  const [rules, schedule] = await Promise.all([getRules(), getSchedule()]);
  state.rules = rules;
  state.schedule = schedule;

  syncScheduleControls(schedule);
  evaluateTestUrl();
  await refreshTelemetry();
}

function updateAddRuleValidationHint() {
  const pattern = els.newPatternInput.value;
  if (!pattern.trim()) {
    els.newRuleValidation.hidden = true;
    els.newRuleValidation.textContent = '';
    return;
  }
  const flags = els.newCaseCheckbox.checked ? 'i' : '';
  const check = validateRulePattern(pattern, flags);
  if (!check.valid) {
    els.newRuleValidation.textContent = check.error;
    els.newRuleValidation.className = 'validation-hint is-error';
    els.newRuleValidation.hidden = false;
  } else if (check.warning) {
    els.newRuleValidation.textContent = check.warning;
    els.newRuleValidation.className = 'validation-hint is-warning';
    els.newRuleValidation.hidden = false;
  } else {
    els.newRuleValidation.hidden = true;
    els.newRuleValidation.textContent = '';
  }
}

async function handleAddRule(event) {
  event.preventDefault();
  hideBanner();

  const pattern = els.newPatternInput.value;
  const note = els.newNoteInput.value;
  const flags = els.newCaseCheckbox.checked ? 'i' : '';

  const check = validateRulePattern(pattern, flags);
  if (!check.valid) {
    els.newRuleValidation.textContent = check.error;
    els.newRuleValidation.className = 'validation-hint is-error';
    els.newRuleValidation.hidden = false;
    els.newPatternInput.focus();
    return;
  }

  try {
    await addRule({ pattern, flags: check.sanitizedFlags, note });
    els.newPatternInput.value = '';
    els.newNoteInput.value = '';
    els.newRuleValidation.hidden = true;
    showBanner(
      check.warning ? `Rule added. ${check.warning}` : 'Regular expression rule added.',
      check.warning ? 'warning' : 'success'
    );
    await reloadAll();
  } catch (err) {
    showBanner(err.message, 'error');
  }
}

async function handleCleanNow() {
  hideBanner();
  els.optCleanNowBtn.disabled = true;
  if (els.previewCleanBtn) els.previewCleanBtn.disabled = true;
  const prevText = els.optCleanNowBtn.textContent;
  els.optCleanNowBtn.textContent = 'Cleaning…';

  try {
    const res = await sendMessage({ type: MESSAGE_TYPES.CLEAN_NOW, trigger: 'manual' });
    els.previewPanel.hidden = true;

    if (res.activeRuleCount === 0) {
      showBanner('No active regex rules configured. Add or enable at least one rule first.', 'warning');
    } else {
      const noun = res.deletedCount === 1 ? 'URL' : 'URLs';
      showBanner(
        `Cleanup complete: removed ${res.deletedCount.toLocaleString()} matching ${noun} across ${res.scannedCount.toLocaleString()} history entries (${res.durationMs} ms).`,
        'success'
      );
    }
    await reloadAll();
  } catch (err) {
    showBanner(err.message, 'error');
  } finally {
    els.optCleanNowBtn.disabled = false;
    if (els.previewCleanBtn) els.previewCleanBtn.disabled = false;
    els.optCleanNowBtn.textContent = prevText;
  }
}

async function handlePreviewMatches() {
  hideBanner();
  els.optPreviewBtn.disabled = true;
  const prevText = els.optPreviewBtn.textContent;
  els.optPreviewBtn.textContent = 'Scanning History…';

  try {
    const res = await sendMessage({
      type: MESSAGE_TYPES.PREVIEW_MATCHES,
      maxPreviewItems: 200,
    });

    if (res.activeRuleCount === 0) {
      els.previewPanel.hidden = true;
      showBanner('Add or enable at least one regex rule to preview history matches.', 'warning');
      return;
    }

    els.previewList.replaceChildren();
    els.previewCleanBtn.disabled = res.matchedCount === 0;
    els.previewCaption.textContent = `${res.matchedCount.toLocaleString()} matching URL(s) out of ${res.scannedCount.toLocaleString()} unique history URLs (${res.durationMs} ms). Nothing has been deleted yet.`;

    if (res.previewItems.length === 0) {
      const li = document.createElement('li');
      li.className = 'preview-item';
      li.textContent = 'Zero browsing history URLs currently match your active regular expressions.';
      els.previewList.appendChild(li);
    } else {
      for (const item of res.previewItems) {
        const li = document.createElement('li');
        li.className = 'preview-item';

        const urlLine = document.createElement('span');
        urlLine.className = 'preview-url';
        urlLine.textContent = item.url;

        const metaLine = document.createElement('span');
        metaLine.className = 'preview-meta';
        const visitedText = item.lastVisitTime
          ? `Visited ${formatRelativePast(item.lastVisitTime)}`
          : '';
        metaLine.textContent = [
          `Matched ${formatRegexLiteral(item.matchedRule)}`,
          item.matchedRule.note ? `(${item.matchedRule.note})` : '',
          visitedText,
        ]
          .filter(Boolean)
          .join(' · ');

        li.append(urlLine, metaLine);
        els.previewList.appendChild(li);
      }

      if (res.truncated) {
        const more = document.createElement('li');
        more.className = 'preview-item preview-meta';
        more.textContent = `Showing first ${res.previewItems.length} of ${res.matchedCount.toLocaleString()} matching URLs.`;
        els.previewList.appendChild(more);
      }
    }

    els.previewPanel.hidden = false;
  } catch (err) {
    showBanner(err.message, 'error');
  } finally {
    els.optPreviewBtn.disabled = false;
    els.optPreviewBtn.textContent = prevText;
  }
}

async function applySchedulePatch(patch) {
  try {
    await saveSchedule(patch);
    await sendMessage({ type: MESSAGE_TYPES.RECONCILE_ALARM });
    await reloadAll();
  } catch (err) {
    showBanner(err.message, 'error');
  }
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importContent(rawContent, sourceLabel = 'input') {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    showBanner('Nothing to import—provide JSON or newline-separated regular expressions.', 'warning');
    return;
  }

  const mode = els.importModeSelect.value === 'replace' ? 'replace' : 'merge';
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');

  let parsedRules = [];
  let importedSchedule = null;
  let errorMessages = [];

  if (looksLikeJson) {
    const parsed = parseDataFromJson(trimmed);
    parsedRules = parsed.rules;
    importedSchedule = parsed.schedule;
    errorMessages = parsed.errors.map((e) =>
      e.pattern ? `Entry #${e.index + 1} (${e.pattern}): ${e.error}` : e.error
    );
  } else {
    const parsed = parseRulesFromText(trimmed);
    parsedRules = parsed.rules;
    errorMessages = parsed.errors.map((e) => `Line ${e.lineNumber} (${e.line}): ${e.error}`);
  }

  if (parsedRules.length === 0 && errorMessages.length > 0) {
    showBanner(`Import failed from ${sourceLabel}: ${errorMessages[0]}`, 'error');
    return;
  }

  if (parsedRules.length === 0 && !importedSchedule) {
    showBanner(`No valid regex rules found in ${sourceLabel}.`, 'warning');
    return;
  }

  const merged = mergeRules(state.rules, parsedRules, mode);
  await saveRules(merged.rules);

  if (importedSchedule) {
    await saveSchedule(importedSchedule);
    await sendMessage({ type: MESSAGE_TYPES.RECONCILE_ALARM });
  }

  els.importTextarea.value = '';
  await reloadAll();

  const summaryParts = [
    mode === 'replace'
      ? `Replaced rule list with ${merged.addedCount} rule(s)`
      : `Imported ${merged.addedCount} new rule(s)` +
        (merged.skippedCount > 0 ? ` (${merged.skippedCount} duplicate(s) skipped)` : ''),
  ];

  if (errorMessages.length > 0) {
    summaryParts.push(`${errorMessages.length} invalid entry(s) skipped (${errorMessages[0]})`);
    showBanner(summaryParts.join('. '), 'warning');
  } else {
    showBanner(`${summaryParts.join('. ')}.`, 'success');
  }
}

// Wire Events
els.optCleanNowBtn.addEventListener('click', handleCleanNow);
els.previewCleanBtn.addEventListener('click', handleCleanNow);
els.optPreviewBtn.addEventListener('click', handlePreviewMatches);
els.previewCloseBtn.addEventListener('click', () => {
  els.previewPanel.hidden = true;
});

els.newPatternInput.addEventListener('input', updateAddRuleValidationHint);
els.newCaseCheckbox.addEventListener('change', updateAddRuleValidationHint);
els.addRuleForm.addEventListener('submit', handleAddRule);

for (const chip of document.querySelectorAll('.starter-chip')) {
  chip.addEventListener('click', () => {
    els.newPatternInput.value = chip.dataset.pattern || '';
    els.newNoteInput.value = chip.dataset.note || '';
    updateAddRuleValidationHint();
    els.newPatternInput.focus();
  });
}

els.testUrlInput.addEventListener('input', evaluateTestUrl);
els.clearTestUrlBtn.addEventListener('click', () => {
  els.testUrlInput.value = '';
  evaluateTestUrl();
});

els.scheduleEnabledToggle.addEventListener('change', () => {
  applySchedulePatch({ enabled: els.scheduleEnabledToggle.checked });
});

els.schedulePresetSelect.addEventListener('change', () => {
  const val = els.schedulePresetSelect.value;
  if (val === 'custom') {
    els.customIntervalWrap.hidden = false;
    els.scheduleCustomMinutes.focus();
    return;
  }
  els.customIntervalWrap.hidden = true;
  applySchedulePatch({ intervalMinutes: Number(val) });
});

els.saveCustomIntervalBtn.addEventListener('click', () => {
  const mins = Math.max(1, Math.min(10080, Math.round(Number(els.scheduleCustomMinutes.value) || 60)));
  els.scheduleCustomMinutes.value = String(mins);
  applySchedulePatch({ intervalMinutes: mins });
  showBanner(`Custom cleanup interval set to every ${mins} minute(s).`, 'success');
});

els.scheduleStartupToggle.addEventListener('change', () => {
  applySchedulePatch({ runOnStartup: els.scheduleStartupToggle.checked });
});

els.exportJsonBtn.addEventListener('click', () => {
  const content = exportDataToJson({ rules: state.rules, schedule: state.schedule });
  triggerDownload('history-cleaner-rules.json', content, 'application/json');
});

els.exportTxtBtn.addEventListener('click', () => {
  const content = exportRulesToText(state.rules);
  triggerDownload('history-cleaner-rules.txt', content, 'text/plain;charset=utf-8');
});

els.importFileBtn.addEventListener('click', () => {
  els.importFileInput.value = '';
  els.importFileInput.click();
});

els.importFileInput.addEventListener('change', async () => {
  const file = els.importFileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    await importContent(text, file.name);
  } catch (err) {
    showBanner(`Failed to read file: ${err.message}`, 'error');
  }
});

els.importTextBtn.addEventListener('click', async () => {
  try {
    await importContent(els.importTextarea.value, 'pasted text');
  } catch (err) {
    showBanner(err.message, 'error');
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEYS.STATS] || changes[STORAGE_KEYS.RULES] || changes[STORAGE_KEYS.SCHEDULE]) {
    reloadAll().catch(() => {});
  }
});

reloadAll().catch((err) => {
  showBanner(err.message, 'error');
});
