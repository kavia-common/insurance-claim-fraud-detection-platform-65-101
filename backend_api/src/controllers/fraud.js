const claimsRepository = require('../store/claimsRepository');
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

class FraudController {
  /**
   * PUBLIC_INTERFACE
   * Score fraud for a claim. Accepts either { claimId } or { claim: {...} }.
   */
  async scoreFraud(req, res) {
    try {
      const body = req.body || {};
      let claim = null;

      if (body.claimId) {
        claim = await claimsRepository.getClaim(String(body.claimId));
        if (!claim) return res.status(404).json({ error: 'Claim not found' });
      } else if (body.id) {
        claim = await claimsRepository.getClaim(String(body.id));
        if (!claim) return res.status(404).json({ error: 'Claim not found' });
      } else if (body.claim && typeof body.claim === 'object') {
        claim = body.claim;
      } else {
        return res.status(400).json({ error: 'Provide claimId (or id) or claim payload.' });
      }

      const allClaims = await claimsRepository.listClaims({});
      const providerCounts = buildProviderHighValueCounts(allClaims);

      const fraud = fraudService.scoreClaim(claim, { providerHighValueCounts: providerCounts });

      // If claim exists in DB, persist fraud results
      if (claim.id) {
        const existing = await claimsRepository.getClaim(claim.id);
        if (existing) {
          const updated = await claimsRepository.updateClaim(claim.id, { fraud });
          return res.status(200).json({ claim: updated, fraud });
        }
      }

      return res.status(200).json({ fraud });
    } catch (err) {
      if (isSupabaseConfigError(err)) {
        return res.status(500).json({ error: 'Supabase not configured', message: err.message });
      }
      throw err;
    }
  }

  /**
   * PUBLIC_INTERFACE
   * Return fraud signals catalog.
   */
  signals(req, res) {
    return res.status(200).json({ signals: fraudService.getFraudSignals() });
  }

  /**
   * PUBLIC_INTERFACE
   * Return high-risk queue (claims with high risk tier).
   */
  async highRiskQueue(req, res) {
    try {
      const claims = await claimsRepository.listClaims({});
      const high = claims.filter((c) => (c.fraud?.riskTier || 'low') === 'high');
      return res.status(200).json({ claims: high, count: high.length });
    } catch (err) {
      if (isSupabaseConfigError(err)) {
        return res.status(500).json({ error: 'Supabase not configured', message: err.message });
      }
      throw err;
    }
  }
}

module.exports = new FraudController();
