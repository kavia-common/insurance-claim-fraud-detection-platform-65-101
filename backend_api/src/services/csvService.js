const { parse } = require('csv-parse/sync');

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function asStringOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function mapRecordToClaim(rec) {
  // Support a few common header variants; frontend uses flexible preview, backend should accept typical claim schemas.
  const get = (...keys) => {
    for (const k of keys) {
      const v = rec[k];
      if (v !== undefined) return v;
    }
    return undefined;
  };

  return {
    claimNumber: asStringOrNull(get('claim_number', 'claimnumber', 'claim_id', 'claimid')) || undefined,
    claimantName: asStringOrNull(get('claimant_name', 'claimant', 'name')) || undefined,
    policyNumber: asStringOrNull(get('policy_number', 'policynumber', 'policy')) || undefined,
    incidentDate: asStringOrNull(get('incident_date', 'incidentdate', 'loss_date', 'lossdate')) || undefined,
    reportDate: asStringOrNull(get('report_date', 'reportdate', 'reported_date', 'reporteddate')) || undefined,
    amount: toNumberOrNull(get('amount', 'claim_amount', 'claimamount', 'total')) ?? undefined,
    providerName: asStringOrNull(get('provider_name', 'provider', 'facility')) || undefined,
    diagnosisCode: asStringOrNull(get('diagnosis_code', 'diagnosis', 'dx')) || undefined,
    procedureCode: asStringOrNull(get('procedure_code', 'procedure', 'proc')) || undefined,
    zip: asStringOrNull(get('zip', 'zipcode', 'postal_code')) || undefined,
    state: asStringOrNull(get('state')) || undefined,
    status: asStringOrNull(get('status')) || undefined,
  };
}

/**
 * PUBLIC_INTERFACE
 * Parse CSV buffer into claim objects + validation errors.
 * @param {Buffer|string} csvInput
 * @returns {{ rows: Array<object>, claims: Array<object>, errors: Array<{row:number, message:string}>, meta: { rowCount: number, headerCount: number } }}
 */
function parseClaimsCsv(csvInput) {
  const errors = [];
  let records = [];

  try {
    records = parse(csvInput, {
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e) {
    return {
      rows: [],
      claims: [],
      errors: [{ row: 0, message: `CSV parse error: ${e.message}` }],
      meta: { rowCount: 0, headerCount: 0 },
    };
  }

  const claims = [];
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    const claim = mapRecordToClaim(rec);

    // Basic validation: require at least claimNumber OR (policyNumber + claimantName) to identify
    const hasId = Boolean(claim.claimNumber) || (Boolean(claim.policyNumber) && Boolean(claim.claimantName));
    if (!hasId) {
      errors.push({
        row: i + 2, // header row is 1
        message: 'Missing identifying fields: provide claim_number or (policy_number and claimant_name).',
      });
      continue;
    }

    // Amount must be numeric if present
    if (claim.amount !== undefined && claim.amount !== null && typeof claim.amount !== 'number') {
      errors.push({ row: i + 2, message: 'Invalid amount.' });
      continue;
    }

    claims.push(claim);
  }

  const headerCount = records.length ? Object.keys(records[0]).length : 0;

  return {
    rows: records,
    claims,
    errors,
    meta: { rowCount: records.length, headerCount },
  };
}

module.exports = {
  parseClaimsCsv,
};

