// Test suite for Area A: RAG Prompt Engineering & Structured Reasoning
'use strict';

require('dotenv').config();

const { searchSimilarRecords } = require('../services/milvusService');
const { rerankEdgeCandidates } = require('../controllers/uploadController');
const { classifyDocument } = require('../services/classificationService');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  grey: '\x1b[90m',
};

const TEST_CASES = [
  {
    id: 1,
    title: 'Juvenile vs Adult Arrest',
    expectedSeries: '100714', // Arrest Files: Juvenile
    text: `FAIRFAX COUNTY POLICE DEPARTMENT
JUVENILE ARREST AND INTAKE REPORT
Date: 2026-04-18
Subject: Minor Child (Age 15, DOB: 2011-03-12)
Parent/Guardian Contacted: Mother present at station.
Charges: Shoplifting and curfew violation.
Custody: Transferred to Juvenile and Domestic Relations Court intake officer.
Booking photos and juvenile fingerprints taken.`,
  },
  {
    id: 2,
    title: 'Death Notification vs Standard Adult Arrest',
    expectedSeries: '200150', // Arrest Files: Adult - Death Notification
    text: `COMMONWEALTH OF VIRGINIA - CENTRAL CRIMINAL RECORDS EXCHANGE
DEATH NOTIFICATION / ARREST HISTORY CLOSURE
Date: 2026-03-22
Arrestee: James Wilson, DOB: 1980-05-14
Booking Number: BK-2021-9941
Official Notice: State Medical Examiner certified that arrestee/inmate is deceased as of 2026-03-19.
Action: Cumulative arrest file closed upon receipt of formal death notification.`,
  },
  {
    id: 3,
    title: 'Resolved vs Unresolved Serious Case',
    expectedSeries: '100771', // Serious Offenses - Resolved
    text: `PRINCE WILLIAM COUNTY POLICE DEPARTMENT - CRIMINAL INVESTIGATION
CASE FILE #CI-2025-01994
OFFENSE: ARMED ROBBERY (SERIOUS VIOLENT FELONY)
INCIDENT DATE: 2025-02-10
CASE STATUS: CLOSED - RESOLVED
DISPOSITION / OUTCOME: Detective concluded investigation. Suspect entered guilty plea in Circuit Court. Convicted and sentenced to 10 years incarceration. All evidence processed and case resolved.`,
  },
  {
    id: 4,
    title: 'Serious vs Less Serious vs Non-Serious Offense',
    expectedSeries: '200148', // Non-Serious Offenses - Unresolved
    text: `RICHMOND POLICE DEPARTMENT - INCIDENT REPORT
Case Number: 2026-00341
Offense: Curfew Violation and Disorderly Conduct (Non-Serious Misdemeanor Offense)
Incident Date: 2026-05-01
Case Status: Unresolved - Active Investigation
Details: Group of individuals observed violating local curfew ordinance and causing public disorder. Suspects fled area on foot. Suspects remain at large. Inquiry active for non-serious offense.`,
  },
  {
    id: 5,
    title: 'Used as Evidence vs Not Used as Evidence',
    expectedSeries: '200152', // Traffic Light Signals - Used as evidence
    text: `CITY OF CHESAPEAKE - AUTOMATED PHOTO ENFORCEMENT REPORT
System: Red Light Camera Monitoring System
Location: Kempsville Rd & Greenbrier Pkwy
Violation Date: 2026-02-14
Evidence Collected: High-resolution camera photograph and video sequence documenting vehicle entering intersection on steady red light.
Legal Action: Camera footage used as evidence for formal violation notice. Citation issued and $50 civil penalty assessed.`,
  },
  {
    id: 6,
    title: 'CAD Log vs Audio Dispatch',
    expectedSeries: '200164', // Dispatch: Supporting Documentation
    text: `FAIRFAX 911 COMMUNICATIONS - COMPUTER AIDED DISPATCH (CAD) REPORT
Calls-for-Service (CFS) Incident Printout #CAD-2026-10492
Call Type: Commercial Fire Alarm
CAD Event History Log:
11:02:14 - Call entry created by Call Taker #42
11:02:40 - Dispatch assigned to Engine 402, Truck 401
11:08:12 - First unit on scene
11:24:00 - Incident cleared
Electronic CAD log record and CFS dispatch history documentation.`,
  },
  {
    id: 7,
    title: 'Citizen Crash vs Law Enforcement Vehicle Crash',
    expectedSeries: '005670', // Reports: Traffic Accident/Crash - Law Enforcement
    text: `VIRGINIA STATE POLICE - DEPARTMENT VEHICLE COLLISION REPORT
Incident: Motor Vehicle Crash Involving Law Enforcement Vehicle
Date: 2026-03-30
Department Vehicle: Patrol Cruiser Unit #108 (Marked Sheriff Vehicle)
Officer Operating: Deputy K. Thompson #814
Details: Deputy operating patrol unit with emergency lights activated collided with another vehicle at intersection. Patrol unit sustained front-end damage. Internal investigation and agency insurance review initiated.`,
  },
  {
    id: 8,
    title: 'EMS Patient Care (PCR) vs Fire Incident',
    expectedSeries: '007046', // Pre-hospital Patient Care Reports
    text: `VIRGINIA OFFICE OF EMERGENCY MEDICAL SERVICES
PRE-HOSPITAL PATIENT CARE REPORT (PCR) - 12VAC5-31-530
Run #: EMS-2026-0812 | Unit: Medic 204
Patient: 62 y/o female | Chief Complaint: Respiratory distress
Vital Signs:
- 09:12 | BP: 148/92 | Pulse: 94 | Resp: 24 | SpO2: 91%
- 09:20 | BP: 132/84 | Pulse: 82 | Resp: 18 | SpO2: 98%
Treatment: Albuterol nebulizer 2.5mg, Supplemental O2 administered.
Transport: Patient handoff to Emergency Department medical staff.`,
  },
  {
    id: 9,
    title: 'Missing Persons Resolved vs Unresolved',
    expectedSeries: '100779', // Missing Persons: Resolved
    text: `ALEXANDRIA POLICE DEPARTMENT - MISSING PERSON REPORT UPDATE
Case Number: MP-2026-00481
Subject: Sarah Jenkins
Initial Report Date: 2026-02-10
CASE STATUS: CLOSED - RESOLVED - PERSON LOCATED
Outcome: Missing individual located in good health at relative's residence. Family notified and subject returned safely. Case officially closed and resolved. Retention: 1 year after closed.`,
  },
  {
    id: 10,
    title: 'Missing Persons With History vs Normal Resolved',
    expectedSeries: '100755', // Missing Persons: With History - Resolved
    text: `HENRICO COUNTY POLICE DIVISION - REPEAT RUNAWAY / MISSING PERSON REPORT
Case Number: MP-2026-00912
Subject: Tyler Brooks (Chronic repeat missing individual)
History: Subject has been reported missing on 4 prior occasions over past 18 months.
Current Incident: Subject reported missing from group home on 2026-04-01.
Resolution: Subject located safely at shopping center. Return to custody documented.
CASE STATUS: CLOSED - RESOLVED WITH REPEAT MISSING HISTORY
Retention: 5 years after closed per repeat runaway schedule series.`,
  },
  {
    id: 11,
    title: 'Prior Override: Juvenile Minor with Adult Candidate #1',
    expectedSeries: '100714', // Arrest Files: Juvenile
    forceCandidateOrder: ['100713', '100714', '100718'], // Force Adult Arrest to be Candidate #1
    text: `ARLINGTON COUNTY POLICE DEPARTMENT
JUVENILE CUSTODY AND INTAKE REPORT
Subject: Minor Child (Age 14, DOB: 2012-08-04)
Incident: Shoplifting at commercial retail store.
Parent Notification: Father notified and arrived at precinct.
Intake: Matter referred to Juvenile and Domestic Relations District Court intake.
Minor placed in parental custody pending juvenile delinquency hearing.`,
  },
];

async function runAreaATests() {
  console.log(`\n${C.bold}══════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  🧪 AREA A: RAG PROMPT & STRUCTURED REASONING TEST SUITE${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════════════════${C.reset}\n`);

  const results = [];
  let passedCount = 0;

  for (const tc of TEST_CASES) {
    console.log(`${C.cyan}───────────────────────────────────────────────────────────────${C.reset}`);
    console.log(`${C.bold}Case #${tc.id}: ${tc.title}${C.reset}`);
    console.log(`Expected Series : ${C.bold}${tc.expectedSeries}${C.reset}`);

    try {
      // 1. Vector Search + Area C Reranking
      const rawCandidates = await searchSimilarRecords(tc.text, 8);
      const rawMapped = rawCandidates.map((c, i) => ({
        rank: i + 1,
        series_number: c.series_number,
        schedule_title: c.schedule_title,
        series_title: c.series_title,
        retention_period: c.series_retention_period,
        disposition_method: c.series_disposition_method,
        description: c.series_description,
        similarity_score: c.similarity_score,
      }));

      let reranked = rerankEdgeCandidates(tc.text, rawMapped);
      
      if (Array.isArray(tc.forceCandidateOrder) && tc.forceCandidateOrder.length > 0) {
        const gs17Records = require('../data/schedules/gs-17.json').records;
        const forced = [];
        for (let idx = 0; idx < tc.forceCandidateOrder.length; idx++) {
          const num = tc.forceCandidateOrder[idx];
          const existing = reranked.find(c => String(c.series_number) === String(num));
          if (existing) {
            forced.push({ ...existing, similarity_score: 0.85 - (idx * 0.02) });
          } else {
            const fromJson = gs17Records.find(r => String(r.series_number) === String(num));
            if (fromJson) {
              forced.push({
                rank: idx + 1,
                series_number: fromJson.series_number,
                schedule_title: fromJson.schedule_title,
                series_title: fromJson.series_title,
                retention_period: fromJson.series_retention_period,
                disposition_method: fromJson.series_disposition_method,
                description: fromJson.series_description,
                similarity_score: 0.85 - (idx * 0.02),
              });
            }
          }
        }
        reranked = forced;
      }

      const cand1 = reranked[0]?.series_number;

      console.log(`Candidate #1    : Series ${cand1} ("${reranked[0]?.series_title}")`);

      // 2. Area A Classification
      const classificationCandidates = reranked.slice(0, 5);
      const llmResult = await classifyDocument(tc.text, classificationCandidates);

      const selected = String(llmResult.selected_series_number).trim();
      const isCorrect = selected === String(tc.expectedSeries).trim();
      const selectedOtherThan1 = selected !== String(cand1).trim();
      const certainty = llmResult.confidence_components?.ai_confidence_level || 'MEDIUM';

      console.log(`LLM Selection   : Series ${selected}`);
      console.log(`Certainty Level : ${certainty}`);
      console.log(`Selected != #1? : ${selectedOtherThan1 ? `${C.yellow}YES${C.reset} (overrode prior)` : 'NO (matched #1)'}`);
      console.log(`AI Reasoning    : ${llmResult.ai_reasoning}`);
      console.log(`Status          : ${isCorrect ? `${C.green}✔ CORRECT${C.reset}` : `${C.red}✘ INCORRECT${C.reset}`}`);

      if (isCorrect) passedCount++;

      results.push({
        id: tc.id,
        title: tc.title,
        expected: tc.expectedSeries,
        cand1,
        selected,
        isCorrect,
        certainty,
        selectedOtherThan1,
        reasoning: llmResult.ai_reasoning,
      });

      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      console.error(`${C.red}Error in Case #${tc.id}:${C.reset}`, err.message);
      results.push({
        id: tc.id,
        title: tc.title,
        expected: tc.expectedSeries,
        isCorrect: false,
        error: err.message,
      });
    }
  }

  console.log(`\n${C.bold}===============================================================${C.reset}`);
  console.log(`${C.bold}  📊 AREA A STATUTORY DISAMBIGUATION RESULTS TABLE${C.reset}`);
  console.log(`${C.bold}===============================================================${C.reset}\n`);

  console.log(`ID | Category / Scenario                       | Expected | Cand #1 | LLM Pick | Certainty | != #1? | Result`);
  console.log(`---|-------------------------------------------|----------|---------|----------|-----------|--------|-------`);
  results.forEach((r) => {
    const idStr = String(r.id).padStart(2);
    const catStr = r.title.padEnd(41);
    const expStr = String(r.expected).padEnd(8);
    const c1Str = String(r.cand1 || 'N/A').padEnd(7);
    const selStr = String(r.selected || 'ERR').padEnd(8);
    const certStr = String(r.certainty || 'N/A').padEnd(9);
    const diffStr = r.selectedOtherThan1 ? 'YES   ' : 'NO    ';
    const resStr = r.isCorrect ? `${C.green}CORRECT${C.reset}` : `${C.red}FAIL${C.reset}`;
    console.log(`${idStr} | ${catStr} | ${expStr} | ${c1Str} | ${selStr} | ${certStr} | ${diffStr} | ${resStr}`);
  });

  console.log(`\nTotal Tested : ${results.length}`);
  console.log(`Accuracy     : ${passedCount} / ${results.length} (${((passedCount / results.length) * 100).toFixed(1)}%)\n`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
  process.exit(0);
}

runAreaATests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
