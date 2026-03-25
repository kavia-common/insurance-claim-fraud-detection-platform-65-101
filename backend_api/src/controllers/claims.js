const claimsRepository = require('../store/claimsRepository');
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

function isSupabaseConfigError(err) {
  return Boolean(err && typeof err.message === 'string' && err.message.toLowerCase().includes('supabase is not configured'));
}

class ClaimsController {
  /**
   * PUBLIC_INTERFACE
   * Upload CSV of claims. Accepts multipart/form-data with field "file".
   */
  async uploadClaims(req, res) {
    try {
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
      const upsertResult = await claimsRepository.bulkUpsert(claims);

      // Score persisted claims and write fraud field back
      const allClaims = await claimsRepository.listClaims({});
      const providerCounts = buildProviderHighValueCounts(allClaims);

      const scored = await Promise.all(
        upsertResult.claims.map((c) => {
          const fraud = fraudService.scoreClaim(c, { providerHighValueCounts: providerCounts });
          // Persist fraud assessment to DB
          return claimsRepository.updateClaim(c.id, { fraud });
        })
      );

      return res.status(200).json({
        status: 'ok',
        meta,
        created: upsertResult.created,
        updated: upsertResult.updated,
        count: scored.length,
        claims: scored,
      });
    } catch (err) {
      if (isSupabaseConfigError(err)) {
        return res.status(500).json({
          error: 'Supabase not configured',
          message: err.message,
        });
      }
      // Let global middleware handle unexpected errors
      throw err;
    }
  }

  /**
   * PUBLIC_INTERFACE
   * List claims with optional query filters: q, status, minFraudScore.
   */
  async list(req, res) {
    try {
      const minFraudScore = req.query.minFraudScore !== undefined ? Number(req.query.minFraudScore) : undefined;
      const filters = {
        q: req.query.q,
        status: req.query.status,
        minFraudScore: Number.isFinite(minFraudScore) ? minFraudScore : undefined,
      };
      const claims = await claimsRepository.listClaims(filters);
      return res.status(200).json({ claims, count: claims.length });
    } catch (err) {
      if (isSupabaseConfigError(err)) {
        return res.status(500).json({ error: 'Supabase not configured', message: err.message });
      }
      throw err;
    }
  }

  /**
   * PUBLIC_INTERFACE
   * Get a claim by id.
   */
  async getById(req, res) {
    try {
      const claim = await claimsRepository.getClaim(req.params.id);
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      return res.status(200).json(claim);
    } catch (err) {
      if (isSupabaseConfigError(err)) {
        return res.status(500).json({ error: 'Supabase not configured', message: err.message });
      }
      throw err;
    }
  }

  /**
   * PUBLIC_INTERFACE
   * Update a claim by id (basic patch semantics).
   */
  async updateById(req, res) {
    try {
      const patch = req.body || {};
      const updated = await claimsRepository.updateClaim(req.params.id, patch);
      if (!updated) return res.status(404).json({ error: 'Claim not found' });
      return res.status(200).json(updated);
    } catch (err) {
      if (isSupabaseConfigError(err)) {
        return res.status(500).json({ error: 'Supabase not configured', message: err.message });
      }
      throw err;
    }
  }

  /**
   * PUBLIC_INTERFACE
   * Delete a claim by id.
   */
  async deleteById(req, res) {
    try {
      const ok = await claimsRepository.deleteClaim(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Claim not found' });
      return res.status(204).send();
    } catch (err) {
      if (isSupabaseConfigError(err)) {
        return res.status(500).json({ error: 'Supabase not configured', message: err.message });
      }
      throw err;
    }
  }

  /**
   * PUBLIC_INTERFACE
   * Update outcome for a claim.
   */
  async updateOutcome(req, res) {
    try {
      const { id, outcome, notes } = req.body || {};
      if (!id || !outcome) {
        return res.status(400).json({ error: 'Missing required fields: id, outcome' });
      }
      const updated = await claimsRepository.updateOutcome({ id, outcome, notes });
      if (!updated) return res.status(404).json({ error: 'Claim not found' });
      return res.status(200).json(updated);
    } catch (err) {
      if (isSupabaseConfigError(err)) {
        return res.status(500).json({ error: 'Supabase not configured', message: err.message });
      }
      throw err;
    }
  }
}

module.exports = new ClaimsController();
