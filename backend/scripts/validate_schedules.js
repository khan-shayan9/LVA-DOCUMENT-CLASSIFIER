const gs02 = require('../data/schedules/gs-02.json');
const gs14 = require('../data/schedules/gs-14.json');
const gs17 = require('../data/schedules/gs-17.json');

const requiredKeys = [
  'schedule_number', 'schedule_title', 'series_number', 'series_title',
  'series_description', 'series_retention_period', 'series_disposition_method',
  'text_to_embed', 'scope_notes', 'key_criteria', 'exclusions'
];

function validate(name, data) {
  const issues = [];
  (data.records || []).forEach((r, i) => {
    requiredKeys.forEach(k => {
      if (r[k] === undefined || r[k] === null || r[k] === '') {
        issues.push('  [' + name + '] Record ' + i + ' (' + r.series_number + ') missing/empty: ' + k);
      }
    });
    if (!Array.isArray(r.key_criteria)) issues.push('  [' + name + '] Record ' + i + ' key_criteria not array');
    if (!Array.isArray(r.exclusions)) issues.push('  [' + name + '] Record ' + i + ' exclusions not array');
    if (Array.isArray(r.key_criteria) && r.key_criteria.length < 3) {
      issues.push('  [' + name + '] Record ' + i + ' (' + r.series_number + ') only ' + r.key_criteria.length + ' key_criteria');
    }
  });
  console.log(name + ': ' + (data.records || []).length + ' records, ' + (issues.length === 0 ? 'ALL OK' : issues.length + ' ISSUES'));
  issues.forEach(i => console.log(i));
}

validate('GS-02', gs02);
validate('GS-14', gs14);
console.log('GS-17: ' + gs17.records.length + ' records, reference');
console.log('\nTotal series across all 3 schedules: ' + (gs02.records.length + gs14.records.length + gs17.records.length));
