const { randomUUID } = require('crypto');

/**
 * Simple in-memory persistence for claims and related fraud analysis.
 * NOTE: This store resets on server restart.
 */

/**
 * @typedef {Object} Claim
 * @property {string} id
 * @property {string=} claimNumber
 * @property {string=} claimantName
 * @property {string=} policyNumber
 * @property {string=} incidentDate
 * @property {string=} reportDate
 * @property {number=} amount
 * @property {string=} providerName
 * @property {string=} diagnosisCode
 * @property {string=} procedureCode
 * @property {string=} zip
 * @property {string=} state
 * @property {string=} status
 * @property {string=} outcome
 * @property {string=} outcomeNotes
 * @property {string=} createdAt
 * @property {string=} updatedAt
 * @property {Object=} fraud
 */

/** @type {Map<string, Claim>} */
const claimsById = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function toNumberOrUndefined(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * PUBLIC_INTERFACE
 * Create a claim record.
 * @param {Partial<Claim>} data
 * @returns {Claim}
 */
function createClaim(data) {
  const id = data.id || randomUUID();
  const ts = nowIso();
  const claim = {
    id,
    claimNumber: normalizeString(data.claimNumber),
    claimantName: normalizeString(data.claimantName),
    policyNumber: normalizeString(data.policyNumber),
    incidentDate: normalizeString(data.incidentDate),
    reportDate: normalizeString(data.reportDate),
    amount: typeof data.amount === 'number' ? data.amount : toNumberOrUndefined(data.amount),
    providerName: normalizeString(data.providerName),
    diagnosisCode: normalizeString(data.diagnosisCode),
    procedureCode: normalizeString(data.procedureCode),
    zip: normalizeString(data.zip),
    state: normalizeString(data.state),
    status: normalizeString(data.status) || 'new',
    outcome: normalizeString(data.outcome),
    outcomeNotes: normalizeString(data.outcomeNotes),
    fraud: data.fraud || undefined,
    createdAt: ts,
    updatedAt: ts,
  };

  claimsById.set(id, claim);
  return claim;
}

/**
 * PUBLIC_INTERFACE
 * Bulk upsert by claimNumber if present; otherwise create.
 * @param {Array<Partial<Claim>>} items
 * @returns {{ created: number, updated: number, claims: Claim[] }}
 */
function bulkUpsert(items) {
  const byClaimNumber = new Map();
  for (const c of claimsById.values()) {
    if (c.claimNumber) byClaimNumber.set(c.claimNumber, c);
  }

  let created = 0;
  let updated = 0;
  const results = [];

  for (const item of items) {
    const claimNumber = normalizeString(item.claimNumber);
    if (claimNumber && byClaimNumber.has(claimNumber)) {
      const existing = byClaimNumber.get(claimNumber);
      const ts = nowIso();
      const merged = {
        ...existing,
        ...item,
        id: existing.id,
        claimNumber,
        amount: typeof item.amount === 'number' ? item.amount : (item.amount !== undefined ? toNumberOrUndefined(item.amount) : existing.amount),
        updatedAt: ts,
      };
      claimsById.set(existing.id, merged);
      updated += 1;
      results.push(merged);
    } else {
      created += 1;
      results.push(createClaim(item));
    }
  }

  return { created, updated, claims: results };
}

/**
 * PUBLIC_INTERFACE
 * List claims with optional filters.
 * @param {{ q?: string, status?: string, minFraudScore?: number }} filters
 * @returns {Claim[]}
 */
function listClaims(filters = {}) {
  const q = normalizeString(filters.q);
  const status = normalizeString(filters.status);
  const minFraudScore = typeof filters.minFraudScore === 'number' ? filters.minFraudScore : undefined;

  let items = Array.from(claimsById.values());

  if (status) {
    items = items.filter((c) => (c.status || '').toLowerCase() === status.toLowerCase());
  }

  if (typeof minFraudScore === 'number') {
    items = items.filter((c) => (c.fraud?.score ?? 0) >= minFraudScore);
  }

  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((c) => {
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

  // Sort by score desc then updated desc
  items.sort((a, b) => {
    const sa = a.fraud?.score ?? 0;
    const sb = b.fraud?.score ?? 0;
    if (sb !== sa) return sb - sa;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });

  return items;
}

/**
 * PUBLIC_INTERFACE
 * Get claim by ID.
 * @param {string} id
 * @returns {Claim|null}
 */
function getClaim(id) {
  return claimsById.get(id) || null;
}

/**
 * PUBLIC_INTERFACE
 * Update claim by ID.
 * @param {string} id
 * @param {Partial<Claim>} patch
 * @returns {Claim|null}
 */
function updateClaim(id, patch) {
  const existing = claimsById.get(id);
  if (!existing) return null;

  const ts = nowIso();
  const merged = {
    ...existing,
    ...patch,
    id: existing.id,
    amount: typeof patch.amount === 'number' ? patch.amount : (patch.amount !== undefined ? toNumberOrUndefined(patch.amount) : existing.amount),
    updatedAt: ts,
  };
  claimsById.set(id, merged);
  return merged;
}

/**
 * PUBLIC_INTERFACE
 * Delete claim by ID.
 * @param {string} id
 * @returns {boolean}
 */
function deleteClaim(id) {
  return claimsById.delete(id);
}

/**
 * PUBLIC_INTERFACE
 * Update investigation outcome for a claim.
 * @param {{ id: string, outcome: string, notes?: string }} payload
 * @returns {Claim|null}
 */
function updateOutcome(payload) {
  const existing = claimsById.get(payload.id);
  if (!existing) return null;

  const ts = nowIso();
  const merged = {
    ...existing,
    outcome: normalizeString(payload.outcome),
    outcomeNotes: normalizeString(payload.notes),
    status: 'reviewed',
    updatedAt: ts,
  };
  claimsById.set(existing.id, merged);
  return merged;
}

module.exports = {
  createClaim,
  bulkUpsert,
  listClaims,
  getClaim,
  updateClaim,
  deleteClaim,
  updateOutcome,
};

