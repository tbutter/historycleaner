import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileRules,
  exportDataToJson,
  exportRulesToText,
  matchUrl,
  mergeRules,
  normalizeRule,
  parseDataFromJson,
  parseRulesFromText,
  sanitizeFlags,
  validateRulePattern,
} from '../src/lib/matcher.js';

test('validateRulePattern rejects empty, whitespace, and syntactically invalid patterns', () => {
  assert.equal(validateRulePattern('').valid, false);
  assert.equal(validateRulePattern('    ').valid, false);
  assert.equal(validateRulePattern('[unclosed-group').valid, false);
  assert.equal(validateRulePattern('^https://example\\.com', 'z').valid, false);
});

test('sanitizeFlags strips stateful g and y flags to prevent lastIndex bugs', () => {
  assert.equal(sanitizeFlags('giy'), 'i');

  const rule = normalizeRule({
    pattern: '^https://example\\.com/secret',
    flags: 'gi',
  });
  assert.equal(rule.flags, 'i');

  const { compiled } = compileRules([rule]);
  // Repeated calls must return true every single time (never alternating true/false)
  for (let i = 0; i < 5; i += 1) {
    assert.equal(matchUrl('https://EXAMPLE.com/secret/page', compiled).matched, true);
  }
});

test('validateRulePattern warns on overly broad catch-all patterns', () => {
  const catchAll = validateRulePattern('.*', 'i');
  assert.equal(catchAll.valid, true);
  assert.ok(catchAll.warning && catchAll.warning.includes('Broad pattern'));

  const targeted = validateRulePattern('^https?://([^/]+\\.)?internal\\.corp/', 'i');
  assert.equal(targeted.valid, true);
  assert.equal(targeted.warning, null);
});

test('compileRules skips disabled rules and respects case sensitivity', () => {
  const rules = [
    normalizeRule({
      id: 'r-disabled',
      pattern: 'disabled\\.example\\.com',
      flags: 'i',
      enabled: false,
    }),
    normalizeRule({
      id: 'r-case-sensitive',
      pattern: 'https://example\\.com/CaseSensitive',
      flags: '',
      enabled: true,
    }),
  ];

  const { compiled, errors } = compileRules(rules);
  assert.equal(errors.length, 0);
  assert.equal(compiled.length, 1);

  assert.equal(matchUrl('https://disabled.example.com/', compiled).matched, false);
  assert.equal(matchUrl('https://example.com/casesensitive', compiled).matched, false);
  assert.equal(matchUrl('https://example.com/CaseSensitive', compiled).matched, true);
});

test('plain-text export and import round-trips patterns, notes, and reports invalid lines', () => {
  const original = [
    normalizeRule({
      pattern: '^https?://localhost(:[0-9]+)?/',
      flags: 'i',
      note: 'Local dev ports',
    }),
    normalizeRule({
      pattern: '[?&]fbclid=',
      flags: 'i',
      note: '',
    }),
  ];

  const text = exportRulesToText(original);
  const parsed = parseRulesFromText(`${text}\n[broken(\n`);

  assert.equal(parsed.rules.length, 2);
  assert.equal(parsed.rules[0].pattern, '^https?://localhost(:[0-9]+)?/');
  assert.equal(parsed.rules[0].note, 'Local dev ports');
  assert.equal(parsed.rules[1].pattern, '[?&]fbclid=');
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, '[broken(');
});

test('JSON export/import preserves flags, enabled state, notes, and schedule', () => {
  const rules = [
    normalizeRule({
      id: 'rule-1',
      pattern: '^https://private\\.example\\.org/',
      flags: '',
      enabled: false,
      note: 'Paused rule',
    }),
  ];
  const schedule = { enabled: true, intervalMinutes: 30, runOnStartup: true };

  const json = exportDataToJson({ rules, schedule });
  const imported = parseDataFromJson(json);

  assert.equal(imported.errors.length, 0);
  assert.equal(imported.rules.length, 1);
  assert.equal(imported.rules[0].flags, '');
  assert.equal(imported.rules[0].enabled, false);
  assert.equal(imported.rules[0].note, 'Paused rule');
  assert.deepEqual(imported.schedule, schedule);
});

test('mergeRules deduplicates in merge mode and overwrites in replace mode', () => {
  const existing = [
    normalizeRule({ id: 'a', pattern: 'foo\\.example\\.com', flags: 'i' }),
  ];
  const incoming = [
    normalizeRule({ id: 'b', pattern: 'foo\\.example\\.com', flags: 'i' }),
    normalizeRule({ id: 'c', pattern: 'bar\\.example\\.com', flags: 'i' }),
  ];

  const merged = mergeRules(existing, incoming, 'merge');
  assert.equal(merged.rules.length, 2);
  assert.equal(merged.addedCount, 1);
  assert.equal(merged.skippedCount, 1);
  assert.equal(merged.rules[0].id, 'a');

  const replaced = mergeRules(existing, [...incoming, incoming[1]], 'replace');
  assert.equal(replaced.rules.length, 2);
  assert.equal(replaced.addedCount, 2);
  assert.equal(replaced.skippedCount, 1);
});
