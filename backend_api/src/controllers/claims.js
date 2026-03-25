const claimsStore = require('../store/claimsStore');
const { parseClaimsCsv } = require('../services/csvService');
const fraudService = require('../services/fraudService');

function buildProviderHighValueCounts(claims) {
  const counts = {};
  for (const c of claims) {
    const provider = c.providerName;
    const amt = typeof c.amount === 'number' ? c.amount : null;
    if (!provider || amt === null) continue;
    if (amt >= 20000) counts[provider] = (counts[provider] || 0) + 1;
  }
  return counts;
}

class ClaimsController {
  /**
   * PUBLIC_INTERFACE
   * Upload CSV of claims. Accepts multipart/form-data with field "file".
   */
  uploadClaims(req, res) {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Missing file. Upload multipart/form-data with field name "file".' });
    }

    const { claims, errors, meta } = parseClaimsCsv(req.file.buffer);
    if (errors.length) {
      return res.status(400).json({
        error: 'CSV validation failed',
        details: { errors, meta },
      });
    }

    // Persist first
    const upsertResult = claimsStore.bulkUpsert(claims);

    // Score persisted claims and write fraud field back
    const allClaims = claimsStore.listClaims({});
    const providerCounts = buildProviderHighValueCounts(allClaims);

    const scored = upsertResult.claims.map((c) => {
      const fraud = fraudService.scoreClaim(c, { providerHighValueCounts: providerCounts });
      return claimsStore.updateClaim(c.id, { fraud });
    });

    return res.status(200).json({
      status: 'ok',
      meta,
      created: upsertResult.created,
      updated: upsertResult.updated,
      count: scored.length,
      claims: scored,
    });
  }

  /**
   * PUBLIC_INTERFACE
   * List claims with optional query filters: q, status, minFraudScore.
   */
  list(req, res) {
    const minFraudScore = req.query.minFraudScore !== undefined ? Number(req.query.minFraudScore) : undefined;
    const filters = {
      q: req.query.q,
      status: req.query.status,
      minFraudScore: Number.isFinite(minFraudScore) ? minFraudScore : undefined,
    };
    const claims = claimsStore.listClaims(filters);
    return res.status(200).json({ claims, count: claims.length });
  }

  /**
   * PUBLIC_INTERFACE
   * Get a claim by id.
   */
  getById(req, res) {
    const claim = claimsStore.getClaim(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    return res.status(200).json(claim);
  }

  /**
   * PUBLIC_INTERFACE
   * Update a claim by id (basic patch semantics).
   */
  updateById(req, res) {
    const patch = req.body || {};
    const updated = claimsStore.updateClaim(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: 'Claim not found' });
    return res.status(200).json(updated);
  }

  /**
   * PUBLIC_INTERFACE
   * Delete a claim by id.
   */
  deleteById(req, res) {
    const ok = claimsStore.deleteClaim(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Claim not found' });
    return res.status(204).send();
  }

  /**
   * PUBLIC_INTERFACE
   * Update outcome for a claim.
   */
  updateOutcome(req, res) {
    const { id, outcome, notes } = req.body || {};
    if (!id || !outcome) {
      return res.status(400).json({ error: 'Missing required fields: id, outcome' });
    }
    const updated = claimsStore.updateOutcome({ id, outcome, notes });
    if (!updated) return res.status(404).json({ error: 'Claim not found' });
    return res.status(200).json(updated);
  }
}

module.exports = new ClaimsController();

