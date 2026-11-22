import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('manifest.json conforms to Manifest V3 with least-privilege permissions and existing files', () => {
  const manifestPath = path.join(ROOT, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist at repository root');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name.length > 0 && manifest.name.length <= 45, 'CWS name should be <= 45 chars');
  assert.ok(manifest.short_name.length > 0 && manifest.short_name.length <= 12, 'CWS short_name must be <= 12 chars');
  assert.ok(manifest.description.length > 0 && manifest.description.length <= 132, 'CWS description must be <= 132 chars');
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ['alarms', 'history', 'storage'],
    'Should request only alarms, history, and storage permissions'
  );
  assert.equal(manifest.host_permissions, undefined, 'Must not request host_permissions');
  assert.equal(manifest.background?.type, 'module');

  const referencedPaths = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];

  for (const relPath of referencedPaths) {
    const abs = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(abs), `Referenced asset missing: ${relPath}`);
    assert.ok(fs.statSync(abs).size > 0, `Referenced asset empty: ${relPath}`);
  }
});

test('HTML pages comply with Manifest V3 CSP (no inline scripts or inline event handlers)', () => {
  const htmlFiles = ['src/popup/popup.html', 'src/options/options.html'];

  for (const rel of htmlFiles) {
    const abs = path.join(ROOT, rel);
    const html = fs.readFileSync(abs, 'utf8');

    // No inline event handlers like onclick="..."
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `${rel} must not contain inline event handlers`);

    // Every <script> tag must have a src attribute
    const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
    assert.ok(scriptTags.length > 0, `${rel} should load a module script`);
    for (const tag of scriptTags) {
      assert.ok(/\bsrc\s*=/i.test(tag), `${rel} contains inline <script> violating MV3 CSP: ${tag}`);
    }
  }
});

test('all JS modules pass syntax check and every getElementById matches HTML markup', async () => {
  const { execFileSync } = await import('node:child_process');
  const jsFiles = [
    'src/background.js',
    'src/lib/cleaner.js',
    'src/lib/format.js',
    'src/lib/matcher.js',
    'src/lib/scheduler.js',
    'src/lib/storage.js',
    'src/popup/popup.js',
    'src/options/options.js',
  ];

  for (const rel of jsFiles) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)]);
  }

  const pairs = [
    ['src/popup/popup.html', 'src/popup/popup.js'],
    ['src/options/options.html', 'src/options/options.js'],
  ];

  for (const [htmlRel, jsRel] of pairs) {
    const html = fs.readFileSync(path.join(ROOT, htmlRel), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, jsRel), 'utf8');

    const htmlIds = new Set(
      Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1])
    );
    const queriedIds = Array.from(
      js.matchAll(/getElementById\('([^']+)'\)/g),
      (m) => m[1]
    );

    assert.ok(queriedIds.length > 0);
    for (const id of queriedIds) {
      assert.ok(
        htmlIds.has(id),
        `${jsRel} queries #${id}, which is missing from ${htmlRel}`
      );
    }
  }

  const {
    formatCountdown,
    formatIntervalLabel,
    formatRegexLiteral,
    formatRelativePast,
  } = await import('../src/lib/format.js');

  assert.equal(formatRelativePast(null), 'Never');
  assert.equal(formatRelativePast(95_000, 100_000), 'Just now');
  assert.equal(formatRelativePast(40_000, 160_000), '2m ago');
  assert.equal(formatCountdown(100_000 + 30 * 60_000, 100_000), 'in 30m');
  assert.equal(formatIntervalLabel(60), 'Every hour');
  assert.equal(formatIntervalLabel(1440), 'Daily');
  assert.equal(
    formatRegexLiteral({ pattern: '^https://a.com/b', flags: 'i' }),
    '/^https:\\/\\/a.com\\/b/i'
  );
});

