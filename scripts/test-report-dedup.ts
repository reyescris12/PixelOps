import {
  formatOrganizedReportMarkdown,
  deduplicateReportIntel,
  extractIntelSubjectFromContent,
  getParagraphFingerprint,
  isDuplicateParagraph,
} from '../src/services/ReportService';

console.log('=== TEST 1: User Screenshot Report Deduplication & Classification ===');

const userReportText = `While the US stock market added $1 trillion in value today, November 9, 2026, there has been no corresponding 'tank' or loss of that magnitude in any single global market today. The current market environment is characterized by a rebound from the significant volatility seen earlier in the week. Specifically, on November 5, 2026, the Nasdaq 100 experienced a historic decline, losing approximately $2.3 trillion in market value-the largest one-day loss on record for that index. Today's $1 trillion gain is a partial recovery from that preceding 'tech wreck.' Current telemetry shows investors are balancing equity inflows with record-setting allocations into money-market funds ($172.7 billion in the latest weekly cycle), indicating a cautious 'risk-on' sentiment rather than a synchronized global crash.`;

const prompt = 'good job difference did markets tank';

const result1 = formatOrganizedReportMarkdown({
  prompt,
  agentName: 'Cipher',
  agentRole: 'Threat Analyst',
  existingDialogue: userReportText,
});

console.log('Title:', result1.title);
console.log('File Path:', result1.filePath);

// Extract Section 1 and Section 2 from markdown
const sec1Match = result1.markdown.match(/## 1\. Executive Intelligence Summary\n\n([\s\S]*?)\n\n---/);
const sec2Match = result1.markdown.match(/## 2\. Detailed Intelligence & Tactical Findings\n\n([\s\S]*?)\n\n---/);

const sec1 = sec1Match ? sec1Match[1].trim() : '';
const sec2 = sec2Match ? sec2Match[1].trim() : '';

console.log('\n--- SECTION 1 ---');
console.log(sec1);
console.log('\n--- SECTION 2 ---');
console.log(sec2);

// Assertions for Test 1
if (sec1 === sec2) {
  console.error('FAIL: Section 1 and Section 2 are identical!');
  process.exit(1);
} else {
  console.log('PASS: Section 1 and Section 2 are distinct!');
}

if (result1.markdown.includes('GEO_HAZARDS') || result1.markdown.includes('USGS_SEISMIC')) {
  console.error('FAIL: Classified as seismic hazard!');
  process.exit(1);
} else {
  console.log('PASS: Correctly classified (NOT seismic hazard)!');
}

if (!result1.markdown.includes('FININT') && !result1.markdown.includes('MARKET_RECON')) {
  console.error('FAIL: Missing financial market tags!');
  process.exit(1);
} else {
  console.log('PASS: Contains financial market topic tags!');
}

console.log('\n=== TEST 2: Multi-Paragraph Input Deduplication ===');

const multiParaText = `Summary: Global maritime logistics through the Suez Canal remained at 42 daily vessel transits with zero asymmetric missile interruptions detected.

Detailed Findings: Naval escort task forces in the southern Red Sea confirmed normal AIS vessel traffic. Automated sensor beacons reported baseline thermal readings across all primary maritime choke points.

Summary: Global maritime logistics through the Suez Canal remained at 42 daily vessel transits with zero asymmetric missile interruptions detected.`;

const result2 = formatOrganizedReportMarkdown({
  prompt: 'Analyze Suez Canal maritime transit security',
  agentName: 'Nyx',
  agentRole: 'Signals Operative',
  existingDialogue: multiParaText,
});

const mSec1 = result2.markdown.match(/## 1\. Executive Intelligence Summary\n\n([\s\S]*?)\n\n---/)?.[1] || '';
const mSec2 = result2.markdown.match(/## 2\. Detailed Intelligence & Tactical Findings\n\n([\s\S]*?)\n\n---/)?.[1] || '';

console.log('Multi-Para Sec 1:', mSec1);
console.log('Multi-Para Sec 2:', mSec2);

if (mSec2.includes('42 daily vessel transits')) {
  console.error('FAIL: Section 2 repeats the executive summary paragraph!');
  process.exit(1);
} else {
  console.log('PASS: Section 2 does not repeat the executive summary paragraph!');
}

console.log('\n=== TEST 3: Preceding Intelligence Deduplication ===');

const primary = `Confirmed patch CVE-2026-4412 in safehouse perimeter firewall. No external port scans detected on port 443.`;
const preceding = `Confirmed patch CVE-2026-4412 in safehouse perimeter firewall.\n\nAdditional signal: BGP route announcement AS13335 verified stable.`;

const deduped = deduplicateReportIntel(primary, preceding);
console.log('Deduplicated output:\n', deduped);

if ((deduped.match(/CVE-2026-4412/g) || []).length > 1) {
  console.error('FAIL: Duplicate CVE-2026-4412 paragraph was not stripped!');
  process.exit(1);
} else {
  console.log('PASS: Duplicate paragraph stripped, only novel signal added!');
}

console.log('\n=== ALL TESTS PASSED! ===');
