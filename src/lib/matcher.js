/**
 * Pure regex validation, URL matching, and import/export helpers.
 * Matches exclusively against full URL strings (never page titles).
 */

const STATELESS_FLAGS = new Set(['d', 'i', 'm', 's', 'u', 'v']);
const STATEFUL_STRIPPED_FLAGS = new Set(['g', 'y']);

const PROBE_URLS = Object.freeze([
  'https://www.wikipedia.org/wiki/Main_Page',
  'https://github.com/explore',
  'https://news.ycombinator.com/newest',
  'https://developer.mozilla.org/en-US/docs/Web',
  'https://www.reuters.com/world/',
]);

const TEXT_HEADER_PREFIX = '# History Cleaner Regex Rules';

/**
 * Generates a unique rule identifier.
 * @returns {string}
 */
export function createRuleId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sanitizes regex flags by removing stateful flags (`g`, `y`) and deduplicating.
 * Throws or reports unsupported flags via `inspectFlags`.
 * @param {string} [flags='i']
 * @returns {{ sanitized: string, invalidFlags: string[] }}
 */
export function inspectFlags(flags = 'i') {
  if (typeof flags !== 'string') {
    return { sanitized: 'i', invalidFlags: [] };
  }
  const kept = new Set();
  const invalid = [];

  for (const ch of flags) {
    if (STATELESS_FLAGS.has(ch)) {
      kept.add(ch);
    } else if (!STATEFUL_STRIPPED_FLAGS.has(ch)) {
      invalid.push(ch);
    }
  }

  if (kept.has('u') && kept.has('v')) {
    kept.delete('u');
  }

  const sanitized = Array.from(kept).sort().join('');
  return { sanitized, invalidFlags: invalid };
}

/**
 * Convenience wrapper returning sanitized stateless flags string.
 * @param {string} [flags='i']
 * @returns {string}
 */
export function sanitizeFlags(flags = 'i') {
  return inspectFlags(flags).sanitized;
}

/**
 * Checks whether a compiled RegExp is overly broad (matches nearly all normal URLs).
 * @param {RegExp} regex
 * @returns {string | null} Warning message if broad, else null.
 */
export function detectBroadRegex(regex) {
  let hits = 0;
  for (const probe of PROBE_URLS) {
    regex.lastIndex = 0;
    if (regex.test(probe)) {
      hits += 1;
    }
  }
  if (hits >= 4) {
    return 'Broad pattern: matches nearly all standard URLs. Use "Preview Matches" before cleaning.';
  }
  return null;
}

/**
 * Validates a regular expression pattern and flags.
 * Rejects empty or whitespace-only patterns to prevent accidental catch-alls.
 * @param {string} pattern
 * @param {string} [flags='i']
 * @returns {{ valid: boolean, sanitizedFlags: string, error: string | null, warning: string | null }}
 */
export function validateRulePattern(pattern, flags = 'i') {
  if (typeof pattern !== 'string' || pattern.trim().length === 0) {
    return {
      valid: false,
      sanitizedFlags: '',
      error: 'Pattern cannot be empty or whitespace only.',
      warning: null,
    };
  }

  const { sanitized, invalidFlags } = inspectFlags(flags);
  if (invalidFlags.length > 0) {
    return {
      valid: false,
      sanitizedFlags: sanitized,
      error: `Unsupported regex flag(s): ${invalidFlags.join(', ')}`,
      warning: null,
    };
  }

  try {
    const regex = new RegExp(pattern, sanitized);
    const warning = detectBroadRegex(regex);
    return {
      valid: true,
      sanitizedFlags: sanitized,
      error: null,
      warning,
    };
  } catch (err) {
    return {
      valid: false,
      sanitizedFlags: sanitized,
      error: err instanceof Error ? err.message : String(err),
      warning: null,
    };
  }
}

/**
 * Normalizes and validates a raw rule object.
 * Throws an Error if the rule pattern or flags are invalid.
 * @param {object | string} raw
 * @param {{ defaultFlags?: string, now?: () => number }} [options]
 */
export function normalizeRule(raw, { defaultFlags = 'i', now = Date.now } = {}) {
  const input = typeof raw === 'string' ? { pattern: raw, flags: defaultFlags } : raw || {};
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  const rawFlags = typeof input.flags === 'string' ? input.flags : defaultFlags;
  const validation = validateRulePattern(pattern, rawFlags);

  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid regular expression.');
  }

  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : createRuleId(),
    pattern,
    flags: validation.sanitizedFlags,
    enabled: input.enabled !== false,
    note: typeof input.note === 'string' ? input.note.trim() : '',
    createdAt: typeof input.createdAt === 'number' && Number.isFinite(input.createdAt)
      ? input.createdAt
      : now(),
  };
}

/**
 * Compiles enabled rules into executable matchers.
 * Disabled or malformed rules are safely skipped; malformed ones are reported in `errors`.
 * @param {Array<object>} rules
 * @returns {{ compiled: Array<{ id: string, pattern: string, flags: string, note: string, regex: RegExp }>, errors: Array<{ id?: string, pattern?: string, error: string }> }}
 */
export function compileRules(rules = []) {
  const compiled = [];
  const errors = [];

  if (!Array.isArray(rules)) {
    return { compiled, errors };
  }

  for (const rule of rules) {
    if (!rule || rule.enabled === false) {
      continue;
    }
    const validation = validateRulePattern(rule.pattern, rule.flags ?? '');
    if (!validation.valid) {
      errors.push({
        id: rule.id,
        pattern: rule.pattern,
        error: validation.error || 'Invalid regex',
      });
      continue;
    }
    compiled.push({
      id: rule.id || createRuleId(),
      pattern: rule.pattern,
      flags: validation.sanitizedFlags,
      note: typeof rule.note === 'string' ? rule.note : '',
      regex: new RegExp(rule.pattern, validation.sanitizedFlags),
    });
  }

  return { compiled, errors };
}

/**
 * Tests a full URL string against compiled rules.
 * Never inspects page titles or other metadata.
 * @param {string} url
 * @param {Array<{ id: string, pattern: string, flags: string, note: string, regex: RegExp }>} compiledRules
 * @param {{ collectAll?: boolean }} [options]
 */
export function matchUrl(url, compiledRules, { collectAll = false } = {}) {
  if (typeof url !== 'string' || url.length === 0 || !Array.isArray(compiledRules) || compiledRules.length === 0) {
    return { matched: false, rule: null, matchedRules: [] };
  }

  const matchedRules = [];
  for (const compiledRule of compiledRules) {
    compiledRule.regex.lastIndex = 0;
    if (compiledRule.regex.test(url)) {
      const summary = {
        id: compiledRule.id,
        pattern: compiledRule.pattern,
        flags: compiledRule.flags,
        note: compiledRule.note,
      };
      matchedRules.push(summary);
      if (!collectAll) {
        return { matched: true, rule: summary, matchedRules };
      }
    }
  }

  return {
    matched: matchedRules.length > 0,
    rule: matchedRules[0] || null,
    matchedRules,
  };
}

/**
 * Serializes rules into newline-delimited plain text format (`#` comments + one regex per line).
 * @param {Array<object>} rules
 * @returns {string}
 */
export function exportRulesToText(rules = []) {
  const lines = [
    `${TEXT_HEADER_PREFIX} (one regular expression per line)`,
    '# Lines starting with # are comments.',
    '',
  ];

  for (const rule of rules) {
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
      continue;
    }
    if (rule.note) {
      lines.push(`# ${rule.note.replace(/\r?\n/g, ' ')}`);
    }
    lines.push(rule.pattern);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Parses newline-delimited plain text regex rules.
 * @param {string} text
 * @param {{ defaultFlags?: string, now?: () => number }} [options]
 * @returns {{ rules: Array<object>, errors: Array<{ lineNumber: number, line: string, error: string }> }}
 */
export function parseRulesFromText(text, { defaultFlags = 'i', now = Date.now } = {}) {
  const rules = [];
  const errors = [];

  if (typeof text !== 'string') {
    return { rules, errors: [{ lineNumber: 1, line: '', error: 'Input must be text.' }] };
  }

  const rawLines = text.split(/\r?\n/);
  let pendingNote = '';

  rawLines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1;
    const trimmed = rawLine.trim();

    if (!trimmed) {
      pendingNote = '';
      return;
    }

    if (trimmed.startsWith('#')) {
      const commentBody = trimmed.replace(/^#+\s*/, '').trim();
      const isBoilerplate =
        trimmed.startsWith(TEXT_HEADER_PREFIX) ||
        commentBody.toLowerCase() === 'lines starting with # are comments.';
      if (!isBoilerplate && commentBody) {
        pendingNote = commentBody;
      }
      return;
    }

    // Use rawLine only if trimmed matches rawLine, or trim outer accidental spaces?
    // Keep exact characters except trailing CR already stripped; trim leading/trailing spaces
    // only if the user indented lines—wait: regex rarely needs unescaped leading/trailing literal space
    // in URL patterns (URLs encode spaces as %20), so `trimmed` avoids invisible trailing-space bugs!
    const pattern = trimmed;
    const validation = validateRulePattern(pattern, defaultFlags);
    if (!validation.valid) {
      errors.push({
        lineNumber,
        line: pattern,
        error: validation.error || 'Invalid regular expression.',
      });
      pendingNote = '';
      return;
    }

    rules.push(
      normalizeRule(
        {
          pattern,
          flags: validation.sanitizedFlags,
          enabled: true,
          note: pendingNote,
        },
        { defaultFlags, now }
      )
    );
    pendingNote = '';
  });

  return { rules, errors };
}

/**
 * Exports extension rules and schedule configuration to formatted JSON.
 * @param {{ rules?: Array<object>, schedule?: object, now?: () => number }} payload
 * @returns {string}
 */
export function exportDataToJson({ rules = [], schedule = null, now = Date.now } = {}) {
  const cleanRules = rules.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    flags: sanitizeFlags(r.flags ?? 'i'),
    enabled: r.enabled !== false,
    note: r.note || '',
    createdAt: r.createdAt || now(),
  }));

  const doc = {
    version: 1,
    exportedAt: new Date(now()).toISOString(),
    ...(schedule ? { schedule } : {}),
    rules: cleanRules,
  };

  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Parses and validates JSON rule/settings export data.
 * Accepts either `{ rules: [...], schedule?: {...} }` or a plain JSON array `[...]`.
 * @param {string} jsonText
 * @param {{ defaultFlags?: string, now?: () => number }} [options]
 * @returns {{ rules: Array<object>, schedule: object | null, errors: Array<{ index: number, pattern?: string, error: string }> }}
 */
export function parseDataFromJson(jsonText, { defaultFlags = 'i', now = Date.now } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      rules: [],
      schedule: null,
      errors: [{ index: 0, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` }],
    };
  }

  const rawRules = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray(parsed.rules)
      ? parsed.rules
      : null;

  if (!rawRules) {
    return {
      rules: [],
      schedule: null,
      errors: [{ index: 0, error: 'JSON must contain a "rules" array or be an array of rules.' }],
    };
  }

  const rules = [];
  const errors = [];

  rawRules.forEach((entry, index) => {
    try {
      rules.push(normalizeRule(entry, { defaultFlags, now }));
    } catch (err) {
      errors.push({
        index,
        pattern: typeof entry === 'string' ? entry : entry?.pattern,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  let schedule = null;
  if (parsed && !Array.isArray(parsed) && parsed.schedule && typeof parsed.schedule === 'object') {
    const rawSched = parsed.schedule;
    const interval = Math.max(1, Math.round(Number(rawSched.intervalMinutes) || 60));
    schedule = {
      enabled: rawSched.enabled !== false,
      intervalMinutes: interval,
      runOnStartup: Boolean(rawSched.runOnStartup),
    };
  }

  return { rules, schedule, errors };
}

/**
 * Merges or replaces existing rules with imported rules, deduplicating by `(pattern, flags)`.
 * @param {Array<object>} existingRules
 * @param {Array<object>} importedRules
 * @param {'merge' | 'replace'} [mode='merge']
 */
export function mergeRules(existingRules = [], importedRules = [], mode = 'merge') {
  const makeKey = (r) => `${r.pattern}\u0000${sanitizeFlags(r.flags ?? '')}`;

  if (mode === 'replace') {
    const seen = new Set();
    const deduplicated = [];
    let skippedCount = 0;
    for (const r of importedRules) {
      const key = makeKey(r);
      if (seen.has(key)) {
        skippedCount += 1;
        continue;
      }
      seen.add(key);
      deduplicated.push(r);
    }
    return {
      rules: deduplicated,
      addedCount: deduplicated.length,
      skippedCount,
    };
  }

  const result = [...existingRules];
  const seen = new Set(existingRules.map(makeKey));
  let addedCount = 0;
  let skippedCount = 0;

  for (const r of importedRules) {
    const key = makeKey(r);
    if (seen.has(key)) {
      skippedCount += 1;
      continue;
    }
    seen.add(key);
    result.push(r);
    addedCount += 1;
  }

  return {
    rules: result,
    addedCount,
    skippedCount,
  };
}
