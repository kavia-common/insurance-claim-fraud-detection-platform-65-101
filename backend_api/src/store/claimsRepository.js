const { randomUUID } = require('crypto');
const { requireSupabaseAdmin } = require('../supabaseClient');

/**
 * Supabase persistence for claims and related fraud analysis.
 *
 * Table expected: public.claims
 * See assets/supabase.md for SQL schema.
 */

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function claimToRow(payload) {
  // Map API claim shape to DB columns.
  const fraud = payload.fraud && typeof payload.fraud === 'object' ? payload.fraud : null;

  return {
    id: payload.id || null,
    claim_number: normalizeString(payload.claimNumber),
    claimant_name: normalizeString(payload.claimantName),
    policy_number: normalizeString(payload.policyNumber),
    incident_date: normalizeString(payload.incidentDate),
    report_date: normalizeString(payload.reportDate),
    amount: payload.amount === undefined ? null : (typeof payload.amount === 'number' ? payload.amount : toNumberOrNull(payload.amount)),
    provider_name: normalizeString(payload.providerName),
    diagnosis_code: normalizeString(payload.diagnosisCode),
    procedure_code: normalizeString(payload.procedureCode),
    zip: normalizeString(payload.zip),
    state: normalizeString(payload.state),
    status: normalizeString(payload.status) || 'new',
    outcome: normalizeString(payload.outcome),
    outcome_notes: normalizeString(payload.outcomeNotes),
    fraud_score: fraud ? (typeof fraud.score === 'number' ? fraud.score : toNumberOrNull(fraud.score)) : null,
    fraud_risk_tier: fraud ? normalizeString(fraud.riskTier) : null,
    fraud_model_version: fraud ? normalizeString(fraud.modelVersion) : null,
    fraud_signals: fraud ? fraud.signals || null : null,
    fraud_explanation: fraud ? fraud.explanation || null : null,
    updated_at: nowIso(),
  };
}

function rowToClaim(row) {
  if (!row) return null;
  const fraud =
    row.fraud_score === null &&
    row.fraud_risk_tier === null &&
    row.fraud_model_version === null &&
    row.fraud_signals === null &&
    row.fraud_explanation === null
      ? undefined
      : {
          score: row.fraud_score ?? 0,
          riskTier: row.fraud_risk_tier ?? 'low',
          modelVersion: row.fraud_model_version ?? 'unknown',
          signals: row.fraud_signals ?? [],
          explanation: row.fraud_explanation ?? [],
        };

  return {
    id: row.id,
    claimNumber: row.claim_number ?? undefined,
    claimantName: row.claimant_name ?? undefined,
    policyNumber: row.policy_number ?? undefined,
    incidentDate: row.incident_date ?? undefined,
    reportDate: row.report_date ?? undefined,
    amount: row.amount ?? undefined,
    providerName: row.provider_name ?? undefined,
    diagnosisCode: row.diagnosis_code ?? undefined,
    procedureCode: row.procedure_code ?? undefined,
    zip: row.zip ?? undefined,
    state: row.state ?? undefined,
    status: row.status ?? undefined,
    outcome: row.outcome ?? undefined,
    outcomeNotes: row.outcome_notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fraud,
  };
}

async function fetchAllClaims() {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToClaim);
}

function applyFilters(items, filters = {}) {
  const q = normalizeString(filters.q);
  const status = normalizeString(filters.status);
  const minFraudScore = typeof filters.minFraudScore === 'number' ? filters.minFraudScore : undefined;

  let out = items;

  if (status) {
    out = out.filter((c) => (c.status || '').toLowerCase() === status.toLowerCase());
  }

  if (typeof minFraudScore === 'number') {
    out = out.filter((c) => (c.fraud?.score ?? 0) >= minFraudScore);
  }

  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((c) => {
      const hay = [
        c.id,
        c.claimNumber,
        c.claimantName,
        c.policyNumber,
        c.providerName,
        c.state,
        c.zip,
        c.diagnosisCode,
        c.procedureCode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  out.sort((a, b) => {
    const sa = a.fraud?.score ?? 0;
    const sb = b.fraud?.score ?? 0;
    if (sb !== sa) return sb - sa;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });

  return out;
}

/**
 * PUBLIC_INTERFACE
 * Create a claim record.
 * @param {object} data Partial claim payload.
 * @returns {Promise<object>} created claim
 */
async function createClaim(data) {
  const supabase = requireSupabaseAdmin();
  const id = data.id || randomUUID();

  const row = {
    ...claimToRow({ ...data, id }),
    id,
    created_at: nowIso(),
  };

  const { data: inserted, error } = await supabase.from('claims').insert(row).select('*').single();
  if (error) throw error;
  return rowToClaim(inserted);
}

/**
 * PUBLIC_INTERFACE
 * Bulk upsert by claimNumber if present; otherwise create.
 * Requires a UNIQUE constraint on claims.claim_number to work correctly.
 * @param {Array<object>} items
 * @returns {Promise<{ created: number, updated: number, claims: object[] }>}
 */
async function bulkUpsert(items) {
  const supabase = requireSupabaseAdmin();

  // Pre-fetch to estimate created/updated counts.
  const { data: existingRows, error: existingErr } = await supabase
    .from('claims')
    .select('id, claim_number')
    .not('claim_number', 'is', null);

  if (existingErr) throw existingErr;
  const existingSet = new Set((existingRows || []).map((r) => r.claim_number));

  const rows = items.map((it) => {
    const id = it.id || randomUUID();
    return {
      ...claimToRow({ ...it, id }),
      id,
      // created_at should remain stable; for new rows set it, for upserts DB default will handle if omitted
      created_at: nowIso(),
    };
  });

  const { data: upserted, error } = await supabase
    .from('claims')
    // onConflict uses DB column name
    .upsert(rows, { onConflict: 'claim_number' })
    .select('*');

  if (error) throw error;

  let created = 0;
  let updated = 0;
  for (const r of upserted || []) {
    if (r.claim_number && existingSet.has(r.claim_number)) updated += 1;
    else created += 1;
  }

  return { created, updated, claims: (upserted || []).map(rowToClaim) };
}

/**
 * PUBLIC_INTERFACE
 * List claims with optional filters.
 * @param {{ q?: string, status?: string, minFraudScore?: number }} filters
 * @returns {Promise<object[]>}
 */
async function listClaims(filters = {}) {
  const all = await fetchAllClaims();
  return applyFilters(all, filters);
}

/**
 * PUBLIC_INTERFACE
 * Get claim by ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getClaim(id) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase.from('claims').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToClaim(data) : null;
}

/**
 * PUBLIC_INTERFACE
 * Update claim by ID.
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object|null>}
 */
async function updateClaim(id, patch) {
  const supabase = requireSupabaseAdmin();

  // Verify exists (also avoids silent upsert behavior).
  const existing = await getClaim(id);
  if (!existing) return null;

  const rowPatch = claimToRow({ ...existing, ...patch, id });
  delete rowPatch.id;

  const { data, error } = await supabase
    .from('claims')
    .update({ ...rowPatch, updated_at: nowIso() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return rowToClaim(data);
}

/**
 * PUBLIC_INTERFACE
 * Delete claim by ID.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function deleteClaim(id) {
  const supabase = requireSupabaseAdmin();
  const { error } = await supabase.from('claims').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/**
 * PUBLIC_INTERFACE
 * Update investigation outcome for a claim.
 * @param {{ id: string, outcome: string, notes?: string }} payload
 * @returns {Promise<object|null>}
 */
async function updateOutcome(payload) {
  const supabase = requireSupabaseAdmin();
  const existing = await getClaim(payload.id);
  if (!existing) return null;

  const patch = {
    outcome: normalizeString(payload.outcome),
    outcomeNotes: normalizeString(payload.notes),
    status: 'reviewed',
    updatedAt: nowIso(),
  };

  const rowPatch = claimToRow({ ...existing, ...patch, id: payload.id });
  delete rowPatch.id;

  const { data, error } = await supabase
    .from('claims')
    .update({ ...rowPatch, updated_at: nowIso() })
    .eq('id', payload.id)
    .select('*')
    .single();

  if (error) throw error;
  return rowToClaim(data);
}

module.exports = {
  createClaim,
  bulkUpsert,
  listClaims,
  getClaim,
  updateClaim,
  deleteClaim,
  updateOutcome,
  rowToClaim,
  claimToRow,
};
