import { MESSAGE_TYPES } from '../background.js';
import {
  formatCountdown,
  formatIntervalLabel,
  formatRegexLiteral,
  formatRelativePast,
} from '../lib/format.js';
import { validateRulePattern } from '../lib/matcher.js';
import { addRule } from '../lib/storage.js';

const els = {
  scheduleSummary: document.getElementById('schedule-summary-text'),
  statActiveRules: document.getElementById('stat-active-rules'),
  statLastRun: document.getElementById('stat-last-run'),
  statTotalDeleted: document.getElementById('stat-total-deleted'),
  cleanNowBtn: document.getElementById('clean-now-btn'),
  previewBtn: document.getElementById('preview-btn'),
  feedback: document.getElementById('popup-feedback'),
  previewSection: document.getElementById('popup-preview-section'),
  previewSummary: document.getElementById('popup-preview-summary'),
  previewList: document.getElementById('popup-preview-list'),
  closePreviewBtn: document.getElementById('close-preview-btn'),
  quickForm: document.getElementById('quick-add-form'),
  quickInput: document.getElementById('quick-pattern-input'),
  quickCaseCheckbox: document.getElementById('quick-case-checkbox'),
  quickValidation: document.getElementById('quick-validation-msg'),
  totalRulesFooter: document.getElementById('total-rules-footer'),
  openOptionsBtn: document.getElementById('open-options-btn'),
  manageAllBtn: document.getElementById('manage-all-rules-btn'),
};

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error(response?.error || 'Background request failed.'));
        return;
      }
      resolve(response.result);
    });
  });
}

function showFeedback(text, kind = 'success') {
  els.feedback.textContent = text;
  els.feedback.className = `banner banner-${kind}`;
  els.feedback.hidden = false;
}

function clearFeedback() {
  els.feedback.hidden = true;
  els.feedback.textContent = '';
}

async function refreshStatus() {
  try {
    const status = await sendMessage({ type: MESSAGE_TYPES.GET_STATUS });
    els.statActiveRules.textContent = String(status.activeRuleCount);
    els.statTotalDeleted.textContent = status.stats.totalDeleted.toLocaleString();
    els.statLastRun.textContent = status.stats.lastRun
      ? formatRelativePast(status.stats.lastRun.timestamp)
      : 'Never';

    const { schedule, nextRunTimestamp } = status.scheduler;
    if (schedule.enabled) {
      els.scheduleSummary.textContent = `${formatIntervalLabel(schedule.intervalMinutes)} · Next ${formatCountdown(nextRunTimestamp)}`;
    } else {
      els.scheduleSummary.textContent = 'Manual trigger only (schedule paused)';
    }

    const noun = status.totalRuleCount === 1 ? 'rule' : 'rules';
    els.totalRulesFooter.textContent = `${status.totalRuleCount} ${noun} stored locally`;
  } catch (err) {
    showFeedback(err.message, 'error');
  }
}

async function handleCleanNow() {
  clearFeedback();
  els.cleanNowBtn.disabled = true;
  els.previewBtn.disabled = true;
  const originalLabel = els.cleanNowBtn.textContent;
  els.cleanNowBtn.textContent = 'Cleaning…';

  try {
    const res = await sendMessage({ type: MESSAGE_TYPES.CLEAN_NOW, trigger: 'manual' });
    els.previewSection.hidden = true;

    if (res.activeRuleCount === 0) {
      showFeedback('No active regex rules yet. Add a rule below or open Settings.', 'warning');
    } else {
      const noun = res.deletedCount === 1 ? 'URL' : 'URLs';
      showFeedback(
        `Removed ${res.deletedCount.toLocaleString()} matching ${noun} (scanned ${res.scannedCount.toLocaleString()}).`,
        'success'
      );
    }
    await refreshStatus();
  } catch (err) {
    showFeedback(err.message, 'error');
  } finally {
    els.cleanNowBtn.disabled = false;
    els.previewBtn.disabled = false;
    els.cleanNowBtn.textContent = originalLabel;
  }
}

async function handlePreviewMatches() {
  clearFeedback();
  els.previewBtn.disabled = true;
  const originalLabel = els.previewBtn.textContent;
  els.previewBtn.textContent = 'Scanning…';

  try {
    const res = await sendMessage({
      type: MESSAGE_TYPES.PREVIEW_MATCHES,
      maxPreviewItems: 50,
    });

    if (res.activeRuleCount === 0) {
      els.previewSection.hidden = true;
      showFeedback('Add or enable at least one regex rule to preview matches.', 'warning');
      return;
    }

    els.previewList.replaceChildren();
    const matchNoun = res.matchedCount === 1 ? 'URL matches' : 'URLs match';
    els.previewSummary.textContent = `${res.matchedCount.toLocaleString()} ${matchNoun} (out of ${res.scannedCount.toLocaleString()})`;

    if (res.previewItems.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'preview-item';
      emptyLi.textContent = 'No current history entries match your active rules.';
      els.previewList.appendChild(emptyLi);
    } else {
      for (const item of res.previewItems) {
        const li = document.createElement('li');
        li.className = 'preview-item';

        const urlSpan = document.createElement('span');
        urlSpan.className = 'preview-url';
        urlSpan.textContent = item.url;

        const metaSpan = document.createElement('span');
        metaSpan.className = 'preview-meta';
        metaSpan.textContent = `Matched ${formatRegexLiteral(item.matchedRule)}`;

        li.append(urlSpan, metaSpan);
        els.previewList.appendChild(li);
      }

      if (res.truncated) {
        const moreLi = document.createElement('li');
        moreLi.className = 'preview-item preview-meta';
        moreLi.textContent = `Showing first ${res.previewItems.length} of ${res.matchedCount.toLocaleString()} matches. Open Settings for more.`;
        els.previewList.appendChild(moreLi);
      }
    }

    els.previewSection.hidden = false;
  } catch (err) {
    showFeedback(err.message, 'error');
  } finally {
    els.previewBtn.disabled = false;
    els.previewBtn.textContent = originalLabel;
  }
}

function updateLiveValidation() {
  const raw = els.quickInput.value;
  if (!raw.trim()) {
    els.quickValidation.hidden = true;
    els.quickValidation.textContent = '';
    return;
  }
  const flags = els.quickCaseCheckbox.checked ? 'i' : '';
  const check = validateRulePattern(raw, flags);
  if (!check.valid) {
    els.quickValidation.textContent = check.error;
    els.quickValidation.className = 'validation-hint is-error';
    els.quickValidation.hidden = false;
  } else if (check.warning) {
    els.quickValidation.textContent = check.warning;
    els.quickValidation.className = 'validation-hint is-warning';
    els.quickValidation.hidden = false;
  } else {
    els.quickValidation.hidden = true;
    els.quickValidation.textContent = '';
  }
}

async function handleQuickAdd(event) {
  event.preventDefault();
  clearFeedback();

  const pattern = els.quickInput.value;
  const flags = els.quickCaseCheckbox.checked ? 'i' : '';
  const validation = validateRulePattern(pattern, flags);

  if (!validation.valid) {
    els.quickValidation.textContent = validation.error;
    els.quickValidation.className = 'validation-hint is-error';
    els.quickValidation.hidden = false;
    els.quickInput.focus();
    return;
  }

  try {
    await addRule({ pattern, flags });
    els.quickInput.value = '';
    els.quickValidation.hidden = true;
    showFeedback(
      validation.warning
        ? `Rule added. ${validation.warning}`
        : 'Regex rule saved locally.',
      validation.warning ? 'warning' : 'success'
    );
    await refreshStatus();
  } catch (err) {
    showFeedback(err.message, 'error');
  }
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

els.cleanNowBtn.addEventListener('click', handleCleanNow);
els.previewBtn.addEventListener('click', handlePreviewMatches);
els.closePreviewBtn.addEventListener('click', () => {
  els.previewSection.hidden = true;
});
els.quickInput.addEventListener('input', updateLiveValidation);
els.quickCaseCheckbox.addEventListener('change', updateLiveValidation);
els.quickForm.addEventListener('submit', handleQuickAdd);
els.openOptionsBtn.addEventListener('click', openOptions);
els.manageAllBtn.addEventListener('click', openOptions);

refreshStatus();
