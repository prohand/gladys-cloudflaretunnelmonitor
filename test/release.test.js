import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-cloudflaretunnelmonitor';

test('the first release moves Unreleased under the version and links its tag', () => {
  const before = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- First version.',
    '',
    `[Unreleased]: ${REPO}/commits/main`,
    '',
  ].join('\n');
  const after = rollChangelog(before, '1.0.0', '2026-10-18');
  assert.match(
    after,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-18\n\n### Added\n\n- First version\./,
  );
  assert.match(after, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.HEAD`));
  assert.match(after, new RegExp(`\\[1\\.0\\.0\\]: ${REPO}/releases/tag/v1\\.0\\.0`));
});

test('a later release compares with the previous tag', () => {
  const before = [
    '## [Unreleased]',
    '',
    '- A fix.',
    '',
    '## [1.0.0] - 2026-10-18',
    '',
    `[Unreleased]: ${REPO}/compare/v1.0.0...HEAD`,
    '',
  ].join('\n');
  const after = rollChangelog(before, '1.0.1', '2026-10-20');
  assert.match(after, new RegExp(`\\[1\\.0\\.1\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.v1\\.0\\.1`));
});

test('a release with nothing listed still gets its heading, and runs only once', () => {
  const before = `## [Unreleased]\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const after = rollChangelog(before, '1.0.1', '2026-10-20');
  assert.match(after, /## \[1\.0\.1\] - 2026-10-20\n\n- Maintenance release/);
  assert.equal(rollChangelog(after, '1.0.1', '2026-10-20'), after);
});
