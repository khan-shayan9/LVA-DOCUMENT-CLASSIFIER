// GS-17 text_to_embed enrichment and Milvus re-embedding script
'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { MilvusClient, MetricType } = require('@zilliz/milvus2-sdk-node');

const MILVUS_ADDRESS  = process.env.MILVUS_ADDRESS;
const MILVUS_TOKEN    = process.env.MILVUS_TOKEN;
const CF_ACCOUNT_ID   = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN    = process.env.CLOUDFLARE_API_TOKEN;
const COLLECTION_NAME = 'gs17_records';
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIM   = 768;
const GS17_PATH       = path.resolve(__dirname, '../data/schedules/gs-17.json');

// Enriched text_to_embed map (series_number -> text_to_embed)
const ENRICHED = {


  '200146': `Investigative Case Files: Less Serious Offenses - Resolved (Series 200146): This series documents CLOSED and RESOLVED criminal investigations involving less serious offenses. Case status: CLOSED - RESOLVED. Retention: 30 years after closed. Offense types (less serious): assault, burglary, destruction of property, drug/narcotic offenses, extortion, gambling, identity theft, intimidation, larceny, pornography, prostitution, robbery, arson, suicide, vandalism, weapons law violations. Records include: incident report, detective notes, evidence (fingerprints, photographs, lab reports), suspect and victim information, witness statements, arrest records, case disposition, guilty plea or conviction, breath alcohol test. This series is for resolved/closed cases only — not ongoing investigations.`,

  '200147': `Investigative Case Files: Less Serious Offenses - Unresolved (Series 200147): This series documents OPEN, ONGOING, and UNRESOLVED criminal investigations involving less serious offenses. Case status: UNRESOLVED - OPEN - ACTIVE. Retention: 50 years after creation. Offense types (less serious): assault, burglary, destruction of property, drug/narcotic offenses, extortion, gambling, identity theft, intimidation, larceny, pornography, prostitution, robbery, arson, suicide, vandalism, weapons law violations. Records include: open case file, active investigation notes, field notes, ongoing evidence collection (fingerprints, photographs, lab analysis), suspect leads, witness interviews, VCIN/NCIC entries, dispatch communications. This series covers active, unsolved cases where investigation is still in progress.`,

  '000266': `Investigative Case Files: Non-Serious Offenses - Resolved (Series 000266): This series documents CLOSED and RESOLVED criminal investigations involving minor or non-serious offenses. Case status: CLOSED - RESOLVED. Retention: 10 years after closed. Offense types (non-serious/minor): blackmail, bribery, counterfeiting, curfew violations, disorderly conduct, DUI, embezzlement, forgery, fraud, gambling, identity theft, loitering, peeping tom, prostitution, runaway, simple assault, trespassing, vagrancy, vandalism, minor thefts. Records include: incident report, resolved case summary, misdemeanor disposition, arrest record, court summons, fine payment, probation records. Short retention (10 years) distinguishes this as a minor/non-serious resolved category.`,

  '200148': `Investigative Case Files: Non-Serious Offenses - Unresolved (Series 200148): This series documents OPEN, ONGOING, and UNRESOLVED investigations into minor or non-serious criminal offenses. Case status: UNRESOLVED - OPEN - ACTIVE. Retention: 5 years after creation (shortest retention of all investigative file series). Offense types (non-serious/minor): blackmail, bribery, counterfeiting, curfew violations, disorderly conduct, DUI, embezzlement, forgery, fraud, loitering, simple assault, trespassing, vagrancy. Records include: open incident report, field notes, ongoing inquiry, summons, VCIN entries. Short 5-year retention indicates minor offense with active but brief investigation window.`,

  '000345': `Investigative Case Files: Historically Significant (Series 000345): This series documents criminal investigations that local law enforcement has determined to have PERMANENT HISTORICAL VALUE. Disposition: Permanent, In Agency — records are NEVER destroyed. Includes landmark cases, cold cases of historical importance, notorious crimes, significant civil rights cases, or investigations that shaped law enforcement policy. Distinguished from other investigative file series by permanent retention and historical significance designation. May include any offense type — the defining characteristic is the historical/archival value determination by law enforcement leadership.`,

  '200145': `Investigative Case Files: Serious Offenses - Unresolved (Series 200145): This series documents OPEN, ONGOING, and UNRESOLVED investigations into the most serious violent felony crimes. Case status: UNRESOLVED - OPEN - ACTIVE - UNSOLVED. Retention: 100 years after creation (longest retention of all investigative file series — reflects severity and ongoing nature). Serious offense types: homicide, murder, manslaughter, kidnapping, abduction, aggravated assault, sex crimes, rape, incest, crimes against children, armed robbery. Records include: active homicide investigation, cold case files, ongoing evidence, DNA evidence pending analysis, latent fingerprints, unsolved murder file, missing suspect, open felony warrant. This series is for the most serious crimes where the case remains open and unsolved.`,

  // ── Arrest Files (4 variants) ─────────────────────────────

  '200150': `Arrest Files: Adult - Death Notification (Series 200150): This series documents the arrest history of an adult individual whose DEATH has been officially reported to the law enforcement department. Triggering event: death notification received. Retention: 1 year after death notification (short — case closed by death). Records include: arrest history, deceased subject's warrants, fingerprints, summonses, mugshots/photographs, court disposition, Central Criminal Records Exchange (CCRE) data, death notification document. Distinguished from standard Arrest Files: Adult (100713) by the death notification trigger and very short 1-year retention.`,

  '200969': `Arrest Files: Adult - Pre-1974 (Series 200969): This series documents the historical arrest records of adult individuals created BEFORE 1974. These are legacy/historical arrest records predating modern records management systems. Retention: 100 years after birth. Records include: historical arrest files, pre-1974 fingerprint cards, historical photographs/mugshots, old-format booking records, pre-computerization arrest documentation. Distinguished by the historical pre-1974 date restriction and archival nature of these records.`,

  '100714': `Arrest Files: Juvenile (Series 100714): This series documents the arrest and booking history of JUVENILE offenders (minors, under 18 years of age). Retention: 5 years after 18th birthday (short, age-based retention protecting juvenile records). Records include: juvenile arrest report, juvenile booking sheet, juvenile mugshots/photographs, charges filed against minor, juvenile court disposition, juvenile diversion records, youth detention records. Strictly limited to minor subjects — distinguished from adult arrest files by subject age and age-based retention. Confidential destruction required.`,

  '100718': `Arrest Logs/Books (Series 100718): This series documents a chronological agency-wide log of all arrests made by the law enforcement agency. This is an administrative log/registry, not an individual's arrest file. Retention: 5 years after last action. Records include: arrest log book, chronological arrest register, sequential booking log, arrest date, arrested person name, charge, arresting officer — recorded in order of occurrence. Distinguished from individual Arrest Files by its chronological log/register format covering all arrests agency-wide, not a single person's cumulative history.`,

  // ── Missing Persons (3 variants) ─────────────────────────

  '100780': `Missing Persons Files (Series 100780): This series documents ACTIVE, ONGOING missing persons cases and runaways that remain UNRESOLVED or open. Retention: 75 years after creation (long retention for unresolved/active cases). Records include: missing person report, initial notification, subject photographs, physical description, witness statements, investigative notes, VCIN/NCIC missing person entry, law enforcement response actions, search and rescue coordination. This covers cases that are still open or where resolution status is not yet confirmed.`,

  '100779': `Missing Persons: Resolved (Series 100779): This series documents missing persons and runaway cases that have been FOUND and RESOLVED — the person has been located. Case status: CLOSED - RESOLVED - PERSON LOCATED. Retention: 1 year after closed (short — person found, case resolved). Records include: resolved missing persons report, location confirmation, return to family documentation, resolution notes. Distinguished from ongoing Missing Persons Files (100780) by the resolved/closed status and very short 1-year retention after the person is found.`,

  '100755': `Missing Persons: With History - Resolved (Series 100755): This series documents REPEAT missing person or runaway cases — individuals who have been reported missing MULTIPLE TIMES — and where the current case has been resolved. Retention: 5 years after closed (longer than single-incident resolved cases due to repeat history). Records include: repeated missing person reports, history of prior missing incidents, previous locations where person was found, pattern documentation, guardian or family contact history, prior runaway incidents. Distinguished by the repeated/multiple missing person history and the 5-year retention for repeat cases.`,

  // ── Recording/Surveillance variants (5 series) ────────────

  '100796': `Recording, Surveillance, or Monitoring Systems: Not Used as Evidence (Series 100796): This series documents general law enforcement surveillance recordings NOT used as evidence in any case. Retention: 30 days after event (very short — routine surveillance discarded). Records include: patrol vehicle dash camera recordings, body-worn camera footage, officer monitoring recordings, suspect/bystander video — where footage is NOT relevant to any investigation. Distinguished by very short 30-day retention and non-evidentiary status.`,

  '000187': `Recording, Surveillance, or Monitoring Systems: Locality-Wide - Not used as evidence (Series 000187): This series documents fixed-location CITY-WIDE or LOCALITY-WIDE surveillance camera recordings NOT used as evidence. Retention: 7 days after event (extremely short — 7-day overwrite cycle). Records include: fixed-mount surveillance cameras covering large public areas, neighborhoods, or districts (not traffic corridors). Distinguished from other surveillance series by the locality-wide/area-wide fixed camera scope and extremely short 7-day retention.`,

  '200151': `Recording, Surveillance, or Monitoring Systems: Traffic Light Signals - Not used as evidence (Series 200151): This series documents RED LIGHT CAMERA recordings where NO SUMMONS was issued — decision made not to prosecute. Retention: 2 days after decision (extremely short — record discarded when no action taken). Records include: automated traffic camera photographs, red light violation video, license plate image — where law enforcement decided NOT to issue a citation. Distinguished by 2-day retention and the no-summons/no-action outcome.`,

  '200152': `Recording, Surveillance, or Monitoring Systems: Traffic Light Signals - Used as evidence (Series 200152): This series documents RED LIGHT CAMERA recordings USED AS EVIDENCE for issuing citations and collecting civil penalties. Retention: 60 days after final payment. Records include: automated traffic enforcement camera photographs, red light violation video footage, license plate capture, citation issued, civil penalty, payment records. Distinguished from the non-evidence traffic light series (200151) by the use as evidence and the payment/civil penalty outcome.`,

  // ── VCIN/NCIC variants (3 series) ────────────────────────

  '005673': `Virginia Criminal Information Network (VCIN/NCIC): Administrative Messages - Not part of an Investigative Case File (Series 005673): This series documents ADMINISTRATIVE MESSAGES sent to or received from VCIN or NCIC that are NOT incorporated into any investigative case file. Retention: 2 years after end of calendar year. Records include: VCIN/NCIC administrative correspondence, system notifications, database administrative messages, inter-agency communications through the network — standalone administrative messages only. Distinguished from VCIN/NCIC series that are part of case files, and from NCIC Validation Records (005675).`,

  '005675': `Virginia Criminal Information Network (VCIN/NCIC): NCIC Validation Records (Series 005675): This series documents the monthly VALIDATION process — verifying active entries and removing outdated or invalid entries from the National Crime Information Center (NCIC) database per State Police requirements. Retention: 2 years after event. Records include: monthly NCIC validation reports, State Police validation list, entry verification records, removal of invalid/outdated NCIC entries, compliance documentation per 28CFR20.37. This is a database maintenance/audit series — not individual case records or messages.`,

  '005674': `Virginia Criminal Information Network (VCIN/NCIC): Original Entry Printouts or Worksheets - Not related to an Investigative Case File (Series 005674): This series documents the WORKSHEETS and PRINTOUTS used during the DATA ENTRY process for entering or removing records from VCIN/NCIC — standalone documents not attached to any case file. Retention: 0 years after closed (immediate destruction after entry is complete). Records include: VCIN/NCIC data entry worksheets, system printouts used only for data verification, entry forms — retained only until data entry is confirmed, then destroyed immediately.`,

  // ── Traffic Accident variants ─────────────────────────────

  '100781': `Reports: Traffic Accident/Crash - Citizen (Series 100781): This series documents motor vehicle accidents and crashes involving NON-LAW-ENFORCEMENT civilian vehicles and citizen drivers. Retention: 3 years after event. Records include: traffic accident report, crash report form, citizen driver information, vehicle damage assessment, VIN, insurance information, witness statements, scene photographs, contributing factors (failure to yield, inattention, speeding), citations issued (traffic code violations), EMS response, estimated property damage, injury report. Distinguished from law enforcement vehicle crashes by civilian/citizen vehicle involvement.`,

  '005670': `Reports: Traffic Accident/Crash - Law Enforcement (Series 005670): This series documents motor vehicle accidents and crashes involving LAW ENFORCEMENT VEHICLES (police cars, sheriff vehicles, patrol units). Retention: 3 years after closed. Records include: law enforcement vehicle crash report, officer/deputy involved, patrol unit damage, department liability documentation, internal review, insurance claim, scene photographs. Distinguished from citizen traffic accident reports (100781) by the involvement of a law enforcement agency vehicle.`,

  // ── Sparse records (< 150 chars originally) ───────────────

  '005666': `Logs (Series 005666): This series consists of ALL law enforcement logs not specifically listed elsewhere in the GS-17 schedule. Covers general operational logs including key-control logs, equipment sign-out logs, shift logs, visitor logs, and any other miscellaneous law enforcement log or register not captured by another series. Retention: 2 years after closed. This is a catch-all log series for miscellaneous law enforcement logging activities not covered by more specific series on this schedule.`,

  // ── Other series needing enrichment ──────────────────────
  // (series that are short, lack distinctive keywords, or
  //  could be confused with neighboring series)

  '100712': ``, // placeholder — series not in dataset

  '100812': `Abandoned/Impounded Vehicles (Series 100812): This series documents the identification, retrieval, processing, storage, return, or disposal/auction of abandoned or impounded vehicles. Retention: 3 years after vehicle sold or no longer in use. Records include: tow sheet, impound form, vehicle identification (VIN, license plate, make, model), disposition form (returned to owner, auctioned, destroyed), storage fees, owner notification, legal hold documentation. Distinct from Towed Vehicle Files (100805) which covers law enforcement-ordered towing.`,

  '100711': `Animal Control Files (Series 100711): This series documents law enforcement participation in local animal control activities. Retention: 5 years after last action. Records include: animal bite reports, animal complaints, dangerous/vicious animal investigations, animal custody records, animal disposition (shelter, euthanasia, return to owner), bite victim information, rabies exposure documentation. COV 3.2-6557(B). Distinct from Dangerous Dog Records (000342) which specifically covers dogs determined dangerous or vicious.`,

  '000342': `Dangerous Dog Records (Series 000342): This series documents DANGEROUS or VICIOUS DOG cases — complaints, investigations, and incidents involving dogs officially determined to be dangerous or vicious under Virginia law. COV 3.2-6540. Retention: 5 years after closed. Records include: dangerous dog determination order, court finding, dog owner information, incident reports, attack/bite documentation, dangerous dog registration, required muzzle/restraint compliance. Distinguished from general Animal Control Files (100711) by the official dangerous/vicious designation under COV 3.2-6540.`,

  '100706': `Alarm: Security - Activated (Series 100706): This series documents ACTIVATIONS of home or business security alarm systems that triggered law enforcement response. Retention: 1 year after closed. Records include: alarm activation report, dispatch notes, incident report, officer response log, cause of activation (break-in, false alarm), false alarm citation, billable false alarm invoice, alarm company information. Distinct from Alarm Security Permit (100707) which covers registration — this covers each activation event.`,

  '100707': `Alarm: Security - Permit/Registration (Series 100707): This series documents the REGISTRATION and PERMITTING of home and business security alarm systems linked to law enforcement response. Retention: 1 year after superseded or rescinded. Records include: alarm system registration application, owner contact information, alarm company data, permit number, emergency contacts, system type, billing information for false alarms. This is the registration/permit record — distinct from Alarm Activated (100706) which covers individual activation events.`,

  '100708': `Alcoholic Beverage Control (ABC) Permit Files (Series 100708): This series documents law enforcement's local review and approval process for Alcoholic Beverage Control (ABC) permits for businesses selling or serving alcohol. Retention: 1 year after last action. Records include: ABC permit application, applicant background check, business location verification, supporting documentation, approval or denial letter. Distinct from general background checks — specifically for alcohol-serving business licensing.`,

  '200879': `Applicant Safety Assessments (Series 200879): This series documents law enforcement agency safety concerns about JOB APPLICANTS based on employment psychological assessments and evaluations. Retention: until no longer administratively useful. Records include: safety assessment reports, psychological evaluation results, employment suitability findings, risk assessment notes, applicant screening correspondence. Confidential — relates to pre-employment screening of law enforcement officer candidates.`,

  '100726': `Community Crime Prevention Program Files (Series 100726): This series documents law enforcement-led community crime prevention initiatives. Retention: until superseded or obsolete. Records include: neighborhood watch program records, National Night Out event documentation, community outreach program files, crime prevention workshop materials, Block Watch coordinator lists, Citizen Patrol program documentation. Distinct from Community Educational Programs (100746) which focuses on citizen education academies.`,

  '100746': `Community Educational Programs (Series 100746): This series documents law enforcement participation in CITIZEN EDUCATION programs including police academies for civilians and drug/gang awareness programs. Retention: until superseded or obsolete. Records include: Citizen Police Academy rosters, Youth Police Academy program materials, substance abuse awareness program records, gang prevention education files, school resource officer program documentation. Distinct from Crime Prevention Program Files (100726) which focuses on neighborhood watch and patrol programs.`,

  '100728': `Confidential Informant Files (Series 100728): This series documents the identity, contacts, history, and reliability assessments of law enforcement CONFIDENTIAL INFORMANTS (CIs). Retention: 75 years after birth. Records include: informant identification number, informant identity (confidential), reliability rating, handler/detective contact logs, payments made, information provided, background checks, photographs, agreements signed. Highly confidential — long retention due to ongoing safety concerns.`,

  '100729': `Confiscated or Surrendered Firearms Files (Series 100729): This series documents LAW ENFORCEMENT SEIZURE or ACCEPTANCE of surrendered firearms and their subsequent disposition. Retention: 75 years after last action. Records include: firearm description (make, model, caliber, serial number), court order authorizing confiscation, chain of custody, method of acquisition (confiscated or voluntarily surrendered), disposition (destroyed, transferred, returned), supporting documentation. Distinct from Evidence firearms in case files.`,

  '100733': `Court Appearance Files (Series 100733): This series documents the scheduling and attendance of law enforcement OFFICERS AND STAFF at court proceedings related to cases they worked. Retention: 2 years after event. Records include: court appearance schedule, overtime cards, time sheets, supplemental incident reports used in testimony, court appearance logs, subpoena records, officer court duty roster. Administrative record of officer court appearances — not the case files themselves.`,

  '100735': `Crime Analysis Files (Series 100735): This series documents statistical and geographic CRIME ANALYSIS — identifying crime patterns, trends, and hotspots. Retention: until superseded or obsolete. Records include: crime pattern analysis, PIN maps, crime mapping data, criminal activity statistics, crime hotspot reports, offender profiles, trend analysis reports, crime forecasting data. Analytical/intelligence records used for law enforcement resource allocation and crime prevention strategy.`,

  '100739': `Criminal History Records: Local Information Requests and Challenges (Series 100739): This series documents individuals requesting or challenging their own LOCAL CRIMINAL HISTORY records. Retention: 2 years after closed. COV 9.1-132. Records include: individual request for own criminal history, challenge to record accuracy, investigation of challenge, response letter, correction documentation, inquiry closure notice. Distinct from general criminal records — this covers the citizen-initiated review and challenge process.`,

  '100745': `Duty Rosters (Series 100745): This series documents OFFICER ASSIGNMENTS — work schedules, patrol areas, equipment, tasks, and duties assigned to individual law enforcement officers. Retention: 1 year after last action. Records include: duty roster, shift schedule, patrol zone assignment, equipment assignment, weapon assignment, special detail assignments, officer work hours log. Administrative scheduling record — distinct from Roll Call Files (100802) which documents attendance at specific meetings.`,

  '000121': `Expungements (Series 000121): This series documents the COURT-ORDERED DESTRUCTION AND SEALING of law enforcement arrest and criminal records. COV 19.2-392.2. Retention: 3 years after expungement order. Records include: court expungement order, list of records ordered expunged, confirmation of record destruction, indexes/finding aids destroyed, copies and references removed. This is the administrative record of the expungement process — not the underlying criminal records (which are destroyed).`,

  '200445': `FCC License Records (Series 200445): This series documents FCC (Federal Communications Commission) licensing of law enforcement RADIO COMMUNICATION SITES and frequencies. Retention: 3 years after event. Records include: FCC license certificate, radio frequency authorization, license renewal documentation, communications site registration, supporting documentation. Administrative licensing records for law enforcement radio infrastructure.`,

  '000344': `Field Notes: Not Retained as Evidence (Series 000344): This series documents OFFICER FIELD NOTES from interviews and contacts with suspects, known offenders, or witnesses that are NOT incorporated into any case file as evidence. 28CFR23.20(h). Retention: 5 years after last action. Records include: officer's handwritten or digital field notes, interview notes, modus operandi observations, contact logs, complaint resolution notes. Distinguished from case file evidence — these notes are standalone and not submitted as court evidence.`,

  '100758': `Fingerprints and Photographs: Juvenile - No Warrant or Petition Filed (Series 100758): This series documents fingerprints and photographs taken of a JUVENILE in connection with an alleged law violation where NO WARRANT OR PETITION was subsequently filed. COV 16.1-299(C). Retention: 60 days after creation (very short — destroyed quickly when no charges filed). Records include: juvenile fingerprint cards, juvenile photographs/mugshots taken at time of contact — destroyed within 60 days when prosecution does not proceed.`,

  '007043': `Fire Code Compliance Inspection Reports (Series 007043): This series documents VIRGINIA FIRE PREVENTION CODE compliance inspections conducted by fire and emergency services personnel. Retention: 10 years after submission. Records include: fire inspection report, building inspection findings, violations noted, notice of violation, required corrective actions, re-inspection records, photographs of violations, compliance confirmation. Distinct from Fire & Rescue Incident Reports (007037) — these are scheduled compliance inspections, not emergency response incidents.`,

  '200392': `Fire Training: Class Records (Series 200392): This series documents FIREFIGHTER TRAINING classes including all aspects of instruction and attendance. Retention: 5 years after end of calendar year. Records include: training class roster, intern/recruit sheets, lesson plans, curriculum, instructor information, attendance records, course completion records, instructor evaluations, training certification. Personnel training documentation for fire and rescue staff — distinct from field incident reports.`,

  '100761': `Firearms Qualifications (Series 100761): This series documents law enforcement OFFICER FIREARMS PROFICIENCY TESTING and qualification through scheduled range testing. Retention: 5 years after event. Records include: firearms qualification test results, scoring sheets, passing/failing status, weapon type tested, certification of proficiency, qualification date, officer name and badge number. Annual or periodic qualification record — distinct from Weapons: Internal Assignments (100762) which covers weapon custody.`,

  '100765': `General Orders and Regulations (Series 100765): This series documents the internal POLICY ORDERS, RULES, AND REGULATIONS governing law enforcement operations. Retention: until no longer administratively useful. Records include: general orders, special orders, department policies, standard operating procedures (SOPs), regulations, policy manuals, law enforcement directives. Administrative policy records — not operational field records.`,

  '007100': `Hazardous Materials Files (Series 007100): This series documents HAZMAT INCIDENTS responded to by certified/qualified emergency response personnel. Retention: 50 years after event (long due to environmental and health liability). Records include: hazardous materials incident report, spill/release/leak documentation, hazmat response team records, lab analysis reports, environmental samples, exposure records, remediation actions, explosives incident. Distinct from regular Fire & Rescue Incident Reports by the hazardous materials context and very long 50-year retention.`,

  '100767': `House Watch Checklists and Reports (Series 100767): This series documents PATROL OFFICER house watch checks performed on citizen properties (typically while owners are away). Retention: until no longer administratively useful. Records include: citizen request form, property address and description, officer check-in verification, patrol schedule, contact information. Administrative patrol coordination record — not an incident or investigation.`,

  '007037': `Incident Reports: Emergency Services, Fire and Rescue (Series 007037): This series documents EMERGENCY INCIDENTS responded to by fire and rescue / emergency services units. Retention: 6 years after event. Records include: fire incident report, structure fire documentation, rescue incident report, emergency medical response report, responding units (engine, ladder, rescue, paramedic), incident commander, responding personnel, address, arrival time, incident duration, occupant information, evacuation status, injuries, cause of fire (unattended cooking, electrical, arson), damage assessment, estimated loss, insurance information, photographs. Covers fire suppression, technical rescue, and emergency medical incidents.`,

  '100770': `Internal Affairs Complaints (Series 100770): This series documents CONFIDENTIAL INTERNAL AFFAIRS investigations into complaints against law enforcement officers or agency offices. Retention: until no longer administratively useful. Records include: citizen or internal complaint, investigation notes, interview transcripts, findings report, founded or unfounded determination, disciplinary action or exoneration records. Strictly confidential — distinct from operational case files and citizen-facing reports.`,

  '100775': `K-9/Horse Management Records (Series 100775): This series documents the management, health, and training of POLICE DOGS (K-9 units) and POLICE HORSES used in law enforcement. Retention: 3 years after separation from service. Records include: K-9 service history, handler assignment, health and veterinary records, training records, certification, deployment logs, horse management records. Distinct from all other GS-17 series — unique to animal-assisted law enforcement.`,

  '200186': `License Plate Tag Reader Records: Not Used as Evidence (Series 200186): This series documents AUTOMATED LICENSE PLATE READER (ALPR/LPR) surveillance recordings that are NOT used as evidence in any case. Retention: 0 years after decision not to use (immediate destruction). Records include: license plate tag reader scans, digital photographs of license plates, vehicle location data — retained only until decision made not to use as evidence, then immediately destroyed.`,

  '200149': `Master Name File (Series 200149): This series documents legal names and ALL ALIASES (AKAs) used by suspected or convicted offenders. Retention: 100 years after birth. Records include: legal name, all known aliases and nicknames, last known address, previous addresses, alternate dates of birth, alternate social security numbers, alternate identifiers, associated criminal records cross-reference. An intelligence/identification index — not individual arrest or case files.`,

  '100783': `Parking Tickets (Series 100783): This series documents PARKING CITATIONS issued for parking regulation violations. Retention: 3 years after issuance. Records include: parking ticket/citation, vehicle license plate, location of violation, parking regulation violated, fine amount, payment or non-payment status, hearing request. Strictly administrative civil citation — distinct from criminal charges or traffic accident reports.`,

  '100785': `Pawnshop and Precious Metals Dealers: History Files (Series 100785): This series documents the LOCATION, LICENSING, and HISTORY of pawnshops and precious metals dealers registered with law enforcement. Retention: until superseded or obsolete. Records include: pawnshop registration application, owner fingerprints, owner photographs, business license, location information, permit history. Distinct from Pawnshop Reports (005667) which covers transaction-level reporting of pawned items.`,

  '005667': `Pawnshop and Precious Metals Dealers: Reports (Series 005667): This series documents TRANSACTION-LEVEL REPORTS submitted by pawnshops and precious metals dealers as required by local ordinance — item descriptions, serial numbers, seller identity data. Retention: 3 years after submission. Records include: pawn transaction reports, item description, serial number, estimated value, seller identification, transaction date. Distinct from Pawnshop History Files (100785) which covers business licensing — these are item-level transaction records used to track stolen property.`,

  '005668': `Permit Review and Investigation Files (Series 005668): This series documents law enforcement INVESTIGATION OF PERMIT APPLICANTS for permits not listed elsewhere on this schedule. Retention: 3 years after closed. Records include: permit application, investigation notes, background check results, final investigation report, permit approval or denial. A general-purpose permit investigation series — distinct from specific permit types (ABC, Concealed Handgun, Operational Permits).`,

  '007103': `Permits: Operational (Series 007103): This series documents permits issued by fire/emergency services for OPERATIONAL ACTIVITIES including bonfires, explosives use, fireworks displays, fumigation operations, and temporary tents at public events. Retention: 2 years after expiration. Records include: permit application, approved operational permit, event details, safety inspection, supporting documentation. Fire and emergency services operational permit — distinct from law enforcement parade permits (100786).`,

  '100786': `Permits: Parade (Series 100786): This series documents permits for PARADES, parade routes, and associated traffic control. Retention: 6 months after expiration. Records include: parade permit application, proposed route, approval/denial letter, traffic control plan, supporting documentation, event sponsor information. Law enforcement permit for public procession events — distinct from fire department operational permits (007103).`,

  '100791': `Photographs and Evidence: Traffic Tickets (Series 100791): This series documents PHOTOGRAPHIC EVIDENCE collected for TRAFFIC VIOLATIONS (speed, signal violations — not intersection cameras). Retention: 1 year after last action. Records include: photographs of violation, dash camera recordings, speed measurement evidence, traffic citation supporting photographs — not used for accident reconstruction. Distinguished from Traffic Accident reports and red-light camera series by focus on standalone moving violation documentation.`,

  '007046': `Pre-hospital Patient Care Reports (Series 007046): This series documents EMERGENCY MEDICAL CARE provided by EMS/paramedic personnel before hospital arrival. 12VAC5-31-530. Retention: 6 years after event. Records include: pre-hospital patient care report (PCR), EMS run report, patient presenting condition, vital signs, treatment administered, medications given, transport hospital, paramedic unit, crew members, patient name, age, medical history. Distinct from Fire & Rescue Incident Reports (007037) — specifically covers the medical/patient care component of emergency response.`,

  '100796': `Recording, Surveillance, or Monitoring Systems: Not Used as Evidence (Series 100796): This series documents general law enforcement surveillance recordings NOT used as evidence. Retention: 30 days after event. Records: dash camera, body camera, in-car surveillance recordings of officers/suspects/bystanders — where footage has no evidentiary value. Short 30-day routine retention.`,

  '100800': `Reports: No Investigative Value (Series 100800): This series documents NON-CRIMINAL incidents determined NOT to require further investigation. COV 15.2-1722. Retention: 5 years after closed. Records include: accidental death report, suicide report, lost and found property report, non-criminal occurrence report, incident report closed without investigation. Distinguished from investigative case files by the explicit determination that no criminal investigation is warranted.`,

  '100802': `Roll Call Files (Series 100802): This series documents officer ATTENDANCE at roll call meetings, briefings, inspections, and other law enforcement gatherings, including any training provided at those meetings. Retention: 1 year after event. Records include: roll call log, officer attendance roster, briefing notes, training topics covered at roll call, inspection records. Distinct from Duty Rosters (100745) which is the assignment schedule — this documents actual attendance at roll calls.`,

  '200446': `Special Assignment Records (Series 200446): This series documents law enforcement assignments for SPECIAL EVENTS — dignitary visits, protests, demonstrations, large public events, and other extraordinary assignments. Retention: 2 years after project completion. Records include: operational plan, security plan, personnel assignment list, traffic control documentation, event logs, dignitary protection plan. Distinct from routine duty rosters — covers non-standard, event-specific deployments.`,

  '100804': `Taxi Records (Series 100804): This series documents the REGISTRATION AND PERMITTING of taxi cabs and cab drivers. Retention: 3 years after expiration. Records include: taxi permit application, vehicle identification (make, model, VIN), rate card, driver identification, driver fingerprint cards, driving record check, cab license. Regulatory compliance records for taxi industry oversight by law enforcement.`,

  '100805': `Towed Vehicle Files (Series 100805): This series documents law enforcement's TOWING ACTIONS for abandoned/damaged vehicles, accident vehicles, and parking/compliance violations. Retention: 3 years after event. Records include: tow sheet, towing request, vehicle identification (plate, VIN, make), tow truck company used, reason for tow (abandoned, accident, parking violation, non-compliance), storage location, owner notification, disposition. Distinct from Abandoned/Impounded Vehicles (100812) and Towing Company Records (000347).`,

  '000347': `Towing Company Records (Series 000347): This series documents the REGISTRATION OF TOWING COMPANIES AND OPERATORS authorized to work with law enforcement. Retention: 3 years after event. Records include: towing company registration, Tow Truck Driver Authorization Document, driver identification, vehicle identification, rate cards, fingerprint cards, driving records, insurance documentation. Business registration for tow operators — distinct from Towed Vehicle Files (100805) which documents individual tow events.`,

  '100806': `Traffic Management and Control (Series 100806): This series documents TRAFFIC CONTROL ANALYSIS, problem reporting, and resolution — statistical and investigative traffic management. Retention: 1 year after last action. Records include: crash report statistics, traffic safety checkpoint data, traffic control problem analysis, speed zone studies, traffic count data, intersection analysis. Statistical/administrative traffic management records — distinct from individual accident reports or citations.`,

  '200153': `Warrants: Unexecuted (Series 200153): This series documents UNEXECUTED CRIMINAL WARRANTS that have been ordered destroyed by the court. COV 19.2-76.1. Retention: 0 years after court destruction order (immediate). Records include: unexecuted arrest warrants, summonses, capiases — not served within 7 years (felony) or 3 years (misdemeanor), or issued for deceased persons, cases of mistaken identity, or technical/legal error. Distinguished from executed warrants in case files — these are voided/cancelled warrants ordered destroyed.`,

  '100762': `Weapons: Internal Assignments (Series 100762): This series documents the ASSIGNMENT OF WEAPONS to individual law enforcement officers for official use. Retention: 5 years after weapon sold or retired. Records include: weapon assignment log, officer receiving weapon (name, badge), weapon description (type, serial number, make), assignment date, return/transfer record. Custody tracking — distinct from Weapons Inventory (100635) which is asset control, and Firearms Qualifications (100761) which is proficiency testing.`,

  '100635': `Weapons: Inventory (Series 100635): This series documents the INVENTORY AND ASSET CONTROL of all law enforcement weapons and ammunition — the agency's complete weapons asset list. Retention: until no longer administratively useful. Records include: weapons inventory list, ammunition inventory, asset control logs, weapon count by type and serial number. Agency-wide asset control record — distinct from Weapons: Internal Assignments (100762) which tracks individual officer custody.`,

  '200132': `Compensation Board Certification Program Records (Series 200132): This series documents compliance with the Virginia Compensation Board's CAREER DEVELOPMENT PROGRAM FOR SHERIFFS. Retention: 4 years after audit. Records include: compliance forms, certification standards, proof of compliance, audit reports, career development program documentation for sheriff's offices. Distinct from general accreditation (CALEA, VLEPSC) — specifically for the Compensation Board's sheriff career development certification.`,

  '200141': `Accreditation Records: Supporting documentation - CALEA (Series 200141): This series documents compliance with the Commission on Accreditation for Law Enforcement Agencies (CALEA) national accreditation program. Retention: 6 years after creation. Records include: CALEA accreditation standards compliance documentation, annual compliance reports, self-assessment files, accreditation award documentation, on-site assessment records. National law enforcement accreditation — distinct from the state-level VLEPSC accreditation (100814).`,

  '100814': `Accreditation Records: Supporting documentation - VLEPSC (Series 100814): This series documents compliance with the Virginia Law Enforcement Professional Standards Commission (VLEPSC) state accreditation program. Retention: 8 years after creation (longer than CALEA). Records include: VLEPSC accreditation standards compliance files, annual compliance reports, self-assessment documentation, Virginia state accreditation records. State-level Virginia accreditation — distinct from the national CALEA accreditation (200141).`,

  '100727': `Concealed Handgun Permit Checks or Logs (Series 100727): This series documents law enforcement's role in CONCEALED HANDGUN PERMIT (CHP) applications — providing information to courts and receiving permit decisions. COV 18.2-308(D). Retention: 2 years after expiration. Records include: CHP applicant background check results, court consultation reports, permit granted/denied notification, permit appeal records. Distinct from general background checks (100772) — specifically for concealed carry firearm permit applications.`,

  '200163': `Dispatch (Communications) and Emergency Call Recordings: Not Retained as Evidence (Series 200163): This series documents AUDIO AND VIDEO RECORDINGS of radio dispatch communications and 911/emergency calls NOT retained as evidence. Retention: 6 months after event. Records include: radio dispatch audio recordings, 911 call recordings, Next Generation 911 recordings, body camera communications, text message communications, photographs — where content is NOT needed as evidence. Short 6-month retention distinguishes from the supporting documentation series (200164).`,

  '200164': `Dispatch (Communications) and Emergency Call Records: Supporting Documentation (Series 200164): This series documents COMPUTER-AIDED DISPATCH (CAD) LOGS, reports, and supporting records — the written/electronic documentation of dispatch operations. Retention: 10 years after creation (much longer than the recordings series). Records include: CAD system logs, Calls-for-Service (CFS) reports, dispatch activity reports, incident logs, radio communication reports, Computer Aided Dispatch software records. Distinguished from the recordings series (200163) by being written/digital logs rather than audio/video recordings, and by the much longer 10-year retention.`,

  '100769': ``, // not in dataset

};

// ── Color helpers ─────────────────────────────────────────────
const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m' };
const ok    = (s) => `${C.green}✔${C.reset} ${s}`;
const fail  = (s) => `${C.red}✘${C.reset} ${s}`;
const info  = (s) => `${C.cyan}→${C.reset} ${s}`;
const warn  = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const bold  = (s) => `${C.bold}${s}${C.reset}`;
const dim   = (s) => `${C.grey}${s}${C.reset}`;

// ── Embedding helper ──────────────────────────────────────────
async function generateEmbedding(text) {
  const url  = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body:   JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error(`Embedding API HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
  const json = await resp.json();
  if (!json.success) throw new Error(`Embedding API failure: ${JSON.stringify(json.errors)}`);
  const vec = json.result.data[0];
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) throw new Error(`Unexpected dim: ${vec?.length}`);
  if (vec.every(v => v === 0)) throw new Error('All-zero vector returned');
  return vec;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n${bold('  🔧 Full GS-17 text_to_embed Enrichment + Re-embedding')}\n`);

  // 1. Load gs-17.json
  const raw     = fs.readFileSync(GS17_PATH, 'utf8');
  const dataset = JSON.parse(raw);
  const records = dataset.records;
  console.log(info(`Loaded ${records.length} records from gs-17.json`));

  // 2. Identify which records need updating
  const toUpdate = [];
  for (const rec of records) {
    const newText = ENRICHED[rec.series_number];
    if (newText === undefined) continue;   // not in enrichment map — skip
    if (newText === '') continue;           // empty placeholder — skip
    if (newText.trim() === rec.text_to_embed.trim()) continue; // unchanged
    toUpdate.push({ rec, newText: newText.trim() });
  }

  console.log(info(`${toUpdate.length} series need text_to_embed updates`));
  toUpdate.forEach(({ rec, newText }) => {
    const delta = newText.length - rec.text_to_embed.length;
    const sign  = delta >= 0 ? '+' : '';
    console.log(`  • ${rec.series_number.padEnd(10)} "${rec.series_title.slice(0, 50)}"  (${sign}${delta} chars)`);
  });

  if (toUpdate.length === 0) {
    console.log(ok('Nothing to update — all series already enriched.'));
    return;
  }

  // 3. Write enriched gs-17.json
  console.log('');
  console.log(info('Applying enriched text_to_embed to gs-17.json...'));
  for (const { rec, newText } of toUpdate) {
    rec.text_to_embed = newText;
  }
  fs.writeFileSync(GS17_PATH, JSON.stringify(dataset, null, 2), 'utf8');
  console.log(ok(`gs-17.json updated and saved (${toUpdate.length} series changed)`));

  // 4. Connect to Milvus
  console.log('');
  console.log(info('Connecting to Milvus...'));
  const client = new MilvusClient({ address: MILVUS_ADDRESS, token: MILVUS_TOKEN });
  try {
    const ver = await client.getVersion();
    console.log(ok(`Connected (version: ${ver.version})`));
  } catch (e) {
    console.log(fail(`Cannot connect to Milvus: ${e.message}`));
    process.exit(1);
  }
  await client.loadCollection({ collection_name: COLLECTION_NAME });
  console.log(ok(`Collection "${COLLECTION_NAME}" loaded`));

  // 5. Fetch Milvus IDs for all series to update
  console.log('');
  console.log(info('Fetching Milvus record IDs for changed series...'));
  const milvusMap = {};
  for (const { rec } of toUpdate) {
    const q = await client.query({
      collection_name: COLLECTION_NAME,
      filter:          `series_number == "${rec.series_number}"`,
      output_fields:   ['id', 'series_number', 'series_title', 'schedule_number', 'schedule_title',
                        'series_description', 'series_retention_period', 'series_disposition_method'],
      limit: 1,
    });
    if (!q.data || q.data.length === 0) {
      console.log(warn(`  Series ${rec.series_number} not found in Milvus — skipping`));
      continue;
    }
    milvusMap[rec.series_number] = q.data[0];
  }
  console.log(ok(`Found ${Object.keys(milvusMap).length} / ${toUpdate.length} series in Milvus`));

  // 6. Generate embeddings and upsert — with rate limiting
  console.log('');
  console.log(bold(`  Embedding and upserting ${toUpdate.length} series...`));
  console.log(dim('  (Each API call ~0.5s — estimated time: ~' + Math.ceil(toUpdate.length * 0.6) + 's)\n'));

  let success = 0;
  let errors  = 0;
  const errorLog = [];

  for (let i = 0; i < toUpdate.length; i++) {
    const { rec, newText } = toUpdate[i];
    const milvus = milvusMap[rec.series_number];
    if (!milvus) { errors++; continue; }

    const label = `[${i + 1}/${toUpdate.length}] ${rec.series_number}  "${rec.series_title.slice(0, 45)}"`;
    process.stdout.write(`  ${label}\n    Embedding ... `);

    try {
      const vector = await generateEmbedding(newText);
      process.stdout.write(`dim=${vector.length}  Upserting ... `);

      await client.upsert({
        collection_name: COLLECTION_NAME,
        data: [{
          id:                        milvus.id,
          schedule_number:           milvus.schedule_number,
          schedule_title:            milvus.schedule_title,
          series_number:             milvus.series_number,
          series_title:              milvus.series_title,
          series_description:        milvus.series_description,
          series_retention_period:   milvus.series_retention_period,
          series_disposition_method: milvus.series_disposition_method,
          text_to_embed:             newText,
          embedding:                 vector,
        }],
      });

      process.stdout.write(`${C.green}done${C.reset}\n`);
      success++;

    } catch (e) {
      process.stdout.write(`${C.red}FAILED: ${e.message}${C.reset}\n`);
      errors++;
      errorLog.push({ series_number: rec.series_number, error: e.message });
    }

    // Small delay to avoid rate limiting
    if (i < toUpdate.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  // 7. Summary
  console.log('');
  console.log(`${bold('  Summary:')}`);
  console.log(`  Total series processed : ${toUpdate.length}`);
  console.log(`  Successfully updated   : ${C.green}${success}${C.reset}`);
  if (errors > 0) {
    console.log(`  Errors                 : ${C.red}${errors}${C.reset}`);
    errorLog.forEach(e => console.log(`    ${fail(`${e.series_number}: ${e.error}`)}`));
  }
  console.log('');
  if (success === toUpdate.length) {
    console.log(ok('All series successfully enriched and re-embedded!'));
    console.log(info('Run the diagnostic to verify: node scripts/diagnose-milvus.js'));
  } else {
    console.log(warn('Some series failed. Re-run to retry failed series.'));
  }
  console.log('');
}

main().catch(err => {
  console.error(`\n\x1b[31mFatal error:\x1b[0m ${err.message}`);
  process.exit(1);
});
