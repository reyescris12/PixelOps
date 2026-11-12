// Automated verification for ISW (Institute for the Study of War) report extraction & VFS self-healing
const memoryLs = new Map<string, string>();
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: (k: string) => (memoryLs.has(k) ? memoryLs.get(k)! : null),
    setItem: (k: string, v: string) => memoryLs.set(k, String(v)),
    removeItem: (k: string) => memoryLs.delete(k),
    clear: () => memoryLs.clear(),
  };
}

import assert from 'node:assert/strict';
import {
  writeWorkspaceFile,
  listWorkspaceFiles,
  repairAllStoredReports,
  isWorkspaceFileDeleted,
  isCorruptedScrapedWorkspaceFile,
} from '../src/engine/storageManager';
import {
  isInvalidWebArticlePage,
  cleanISWArticleBody,
  ingestISWResearchHeadless,
  scanISWBriefings,
  retrieveRelevantISWBriefings,
  fetchISWArticleByUrl,
} from '../src/services/iswFeedService';

async function main() {
  console.log('=== TEST 1: Reject 404 / Page Not Found / Challenge Pages ===');
  assert.equal(
    isInvalidWebArticlePage(
      'Page not found - Institute for the Study of War',
      '# Oops! That page can’t be found.\nIt looks like nothing was found at this location. '.repeat(20),
      200
    ),
    true,
    'Should reject WordPress 404 body even if proxy wrapped status as 200'
  );
  assert.equal(
    isInvalidWebArticlePage('Russian Offensive Campaign Assessment', 'Valid content '.repeat(40), 404),
    true,
    'Should reject HTTP 404 status'
  );
  assert.equal(
    isInvalidWebArticlePage('Just a moment...', 'Checking your browser before accessing understandingwar.org '.repeat(10), 200),
    true,
    'Should reject anti-bot interstitial'
  );
  assert.equal(
    isInvalidWebArticlePage(
      'Russian Offensive Campaign Assessment, November 11, 2026',
      '## Toplines\n\nSenior Kremlin officials articulated persistent demands. '.repeat(12),
      200
    ),
    false,
    'Should accept valid ISW assessment'
  );
  console.log('PASS: Error/404 page detector works accurately.');

  console.log('\n=== TEST 2: Purge Corrupted VFS Files Without Blocking Re-Ingestion ===');
  const broken404Path = 'intel/sources/isw_research/2026-11-12_isw_isw_oops_that_page_can_be_found.md';
  const brokenMenuPath = 'intel/sources/isw_research/2026-11-12_isw_isw_research_library.md';
  const validUserReportPath = 'reports/custom_operational_summary.md';

  await writeWorkspaceFile(
    broken404Path,
    `# ISW: Oops! That page can’t be found.\n**Source URL:** https://www.understandingwar.org/research/middle-east\n\n## Detailed Analysis\nPage not found - Institute for the Study of War\n# Oops! That page can’t be found.`,
    'markdown',
    'intel'
  );
  await writeWorkspaceFile(
    brokenMenuPath,
    `# ISW: Research Library\n**Source URL:** https://www.understandingwar.org/research/\n\n- Live tactical assessment ingested from understandingwar.org research archives.\n[Skip to content](https://understandingwar.org/#content)`,
    'markdown',
    'intel'
  );
  await writeWorkspaceFile(
    validUserReportPath,
    `# Custom Operational Summary\n\n## 1. Executive Summary\nAll safehouse telemetry channels nominal across primary relays.\n\n## 2. Detailed Findings\nSecondary fiber uplinks verified with zero packet loss across regional nodes.`,
    'markdown',
    'reports'
  );

  assert.equal(isCorruptedScrapedWorkspaceFile(broken404Path, '# Oops! That page can’t be found.'), true);
  assert.equal(isCorruptedScrapedWorkspaceFile(brokenMenuPath, '# ISW: Research Library'), true);

  const repaired = await repairAllStoredReports();
  assert.ok(repaired >= 2, `Expected >= 2 corrupted files purged, got ${repaired}`);
  assert.equal(isWorkspaceFileDeleted(broken404Path), false, 'System purge must not set user tombstone');
  assert.equal(isWorkspaceFileDeleted(brokenMenuPath), false, 'System purge must not set user tombstone');

  const afterRepair = await listWorkspaceFiles();
  assert.ok(!afterRepair.some((f) => f.path === broken404Path), 'Broken 404 file should be gone');
  assert.ok(!afterRepair.some((f) => f.path === brokenMenuPath), 'Broken menu file should be gone');
  assert.ok(afterRepair.some((f) => f.path === validUserReportPath), 'Valid user report must remain untouched');
  console.log('PASS: Corrupted VFS files purged cleanly without tombstones.');

  console.log('\n=== TEST 3: Live ISW Ingestion & Full-Text Dossier Extraction ===');
  const ingestResult = await ingestISWResearchHeadless({ forceRefresh: true });
  console.log(`Ingested ${ingestResult.ingestedCount} ISW dossiers (${ingestResult.articles.length} discovered).`);
  assert.ok(ingestResult.ingestedCount >= 3, `Expected >= 3 ingested ISW files, got ${ingestResult.ingestedCount}`);

  const intelFiles = (await listWorkspaceFiles('intel')).filter((f) =>
    f.path.startsWith('intel/sources/isw_research/')
  );
  assert.ok(intelFiles.length >= 3, `Expected >= 3 stored ISW VFS files, got ${intelFiles.length}`);

  for (const file of intelFiles) {
    console.log(`  -> Verified VFS file: ${file.path} (${file.sizeBytes} bytes)`);
    assert.ok(file.sizeBytes > 1200, `File ${file.path} too short (${file.sizeBytes} bytes)`);
    assert.ok(
      !/page not found|oops!\s*that page can[’']t be found|just a moment/i.test(file.content),
      `File ${file.path} contains error-page text!`
    );
    assert.ok(
      /^##\s+(?:Toplines|Key Takeaways)/im.test(file.content),
      `File ${file.path} missing analytical sections (## Toplines / ## Key Takeaways)!`
    );
  }

  console.log('\n=== TEST 4: scanISWBriefings & Dead Hub URL Resolution ===');
  const briefings = await scanISWBriefings();
  assert.ok(briefings.length >= 3, 'scanISWBriefings should return stored dossiers');
  for (const b of briefings) {
    assert.ok(b.summary.length > 60 && !b.summary.startsWith('**Source URL:**'), `Clean summary expected, got: ${b.summary}`);
    assert.ok(b.keyTakeaways.length >= 1, `Expected extracted keyTakeaways for ${b.title}`);
  }

  const relevant = await retrieveRelevantISWBriefings('ISW Russia Ukraine Iran', 3);
  assert.ok(relevant.length >= 2, 'retrieveRelevantISWBriefings should correlate theater briefings');

  // Verify that querying the legacy dead 404 URL (/research/middle-east) resolves to a real live article instead of "Page not found"
  const resolvedDeadUrl = await fetchISWArticleByUrl('https://www.understandingwar.org/research/middle-east');
  if (resolvedDeadUrl) {
    assert.ok(!/page not found|oops!/i.test(resolvedDeadUrl.title + ' ' + resolvedDeadUrl.content));
    assert.ok(resolvedDeadUrl.content.length > 1000);
    console.log(`PASS: Dead category URL resolved to live article: "${resolvedDeadUrl.title}" (${resolvedDeadUrl.url})`);
  }

  const sampleCleaned = cleanISWArticleBody(
    '#### Options\n[Skip to content](https://understandingwar.org/#content)\n\n## Toplines\n\n**Bold sentence.**Next sentence.[1]Another sentence.\n\n[1] https://example.com/' + 'a'.repeat(100)
  );
  assert.ok(sampleCleaned.includes('**Bold sentence.** Next sentence.[1] Another sentence.'));
  assert.ok(!sampleCleaned.includes('Skip to content'));

  console.log('\nALL ISW REPORT EXTRACTION & SELF-HEALING TESTS PASSED!');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
