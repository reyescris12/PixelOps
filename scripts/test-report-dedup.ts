import {
  formatOrganizedReportMarkdown,
  deduplicateReportIntel,
  extractIntelSubjectFromContent,
  getParagraphFingerprint,
  isDuplicateParagraph,
  sanitizeAndDeduplicateReportContent,
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

console.log('\n=== TEST 4: Existing Saved Report Sanitization & Mismatched Tag Repair ===');

const existingSavedReport = `# Good Job Difference Did Markets Intel
**Document ID:** \`reports/2026-11-09_good_job_difference_did_markets_intel.md\`  
**Intelligence Domain:** Seismic & Hazard Telemetry  
**Classification:** OMEGA-RESTRICTED // Safehouse Intelligence  
**Lead Operative:** Safehouse Operative (Intelligence Analyst)  
**Assigned Sector:** LIBRARY  
**Compiled Timestamp:** 2026-11-09 17:19:32 UTC  
**Topic Tags:** \`GEO_HAZARDS\`, \`USGS_SEISMIC\`  

---

## 1. Executive Intelligence Summary

While the US stock market added $1 trillion in value today, November 9, 2026, there has been no corresponding 'tank' or loss of that magnitude in any single global market today. The current market environment is characterized by a rebound from the significant volatility seen earlier in the week. Specifically, on November 5, 2026, the Nasdaq 100 experienced a historic decline, losing approximately $2.3 trillion in market value-the largest one-day loss on record for that index. Today's $1 trillion gain is a partial recovery from that preceding 'tech wreck.' Current telemetry shows investors are balancing equity inflows with record-setting allocations into money-market funds ($172.7 billion in the latest weekly cycle), indicating a cautious 'risk-on' sentiment rather than a synchronized global crash.

---

## 2. Detailed Intelligence & Tactical Findings

While the US stock market added $1 trillion in value today, November 9, 2026, there has been no corresponding 'tank' or loss of that magnitude in any single global market today. The current market environment is characterized by a rebound from the significant volatility seen earlier in the week. Specifically, on November 5, 2026, the Nasdaq 100 experienced a historic decline, losing approximately $2.3 trillion in market value-the largest one-day loss on record for that index. Today's $1 trillion gain is a partial recovery from that preceding 'tech wreck.' Current telemetry shows investors are balancing equity inflows with record-setting allocations into money-market funds ($172.7 billion in the latest weekly cycle), indicating a cautious 'risk-on' sentiment rather than a synchronized global crash.

---

## 3. Telemetry & Verification Matrix
| Telemetry Source / Tool | Findings & Verification Summary | Status |
| :--- | :--- | :--- |
| **1. \`internal_intel_synthesis\`** | Grounded in safehouse OSINT & sector telemetry | **VERIFIED** |
`;

const sanitizedResult = sanitizeAndDeduplicateReportContent(
  existingSavedReport,
  'reports/2026-11-09_good_job_difference_did_markets_intel.md'
);

console.log('Sanitized Output:\n', sanitizedResult.content);

if (!sanitizedResult.changed) {
  console.error('FAIL: Expected changed=true when repairing report with duplicate sections!');
  process.exit(1);
}

if (sanitizedResult.content.includes('GEO_HAZARDS') || sanitizedResult.content.includes('USGS_SEISMIC')) {
  console.error('FAIL: Sanitized report still contains seismic hazard tags for financial report!');
  process.exit(1);
} else {
  console.log('PASS: Mismatched seismic tags repaired to financial tags!');
}

const sSec1 = sanitizedResult.content.match(/## 1\. Executive Intelligence Summary\n\n([\s\S]*?)\n\n---/)?.[1] || '';
const sSec2 = sanitizedResult.content.match(/## 2\. Detailed Intelligence & Tactical Findings\n\n([\s\S]*?)\n\n---/)?.[1] || '';

console.log('Sanitized Sec 1:', sSec1);
console.log('Sanitized Sec 2:', sSec2);

if (sSec1 === sSec2) {
  console.error('FAIL: Section 1 and Section 2 are still identical after sanitization!');
  process.exit(1);
}

if (!sSec1.includes('BLUF:')) {
  console.error('FAIL: Section 1 does not contain BLUF after split!');
  process.exit(1);
}

if (!sSec2.includes('Tactical Analysis & Telemetry Breakdown')) {
  console.error('FAIL: Section 2 does not contain tactical breakdown after split!');
  process.exit(1);
}

console.log('PASS: Section 1 and Section 2 successfully deduplicated into BLUF and tactical telemetry!');

console.log('\n=== ALL TESTS PASSED! ===');
