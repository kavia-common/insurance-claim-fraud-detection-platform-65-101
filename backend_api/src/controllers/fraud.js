const claimsStore = require('../store/claimsStore');
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

class FraudController {
  /**
   * PUBLIC_INTERFACE
   * Score fraud for a claim. Accepts either { claimId } or { claim: {...} }.
   */
  scoreFraud(req, res) {
    const body = req.body || {};
    let claim = null;

    if (body.claimId) {
      claim = claimsStore.getClaim(String(body.claimId));
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
    } else if (body.id) {
      claim = claimsStore.getClaim(String(body.id));
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
    } else if (body.claim && typeof body.claim === 'object') {
      claim = body.claim;
    } else {
      return res.status(400).json({ error: 'Provide claimId (or id) or claim payload.' });
    }

    const allClaims = claimsStore.listClaims({});
    const providerCounts = buildProviderHighValueCounts(allClaims);

    const fraud = fraudService.scoreClaim(claim, { providerHighValueCounts: providerCounts });

    // If claim exists in store, persist fraud results
    if (claim.id && claimsStore.getClaim(claim.id)) {
      const updated = claimsStore.updateClaim(claim.id, { fraud });
      return res.status(200).json({ claim: updated, fraud });
    }

    return res.status(200).json({ fraud });
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
  highRiskQueue(req, res) {
    const claims = claimsStore.listClaims({});
    const high = claims.filter((c) => (c.fraud?.riskTier || 'low') === 'high');
    return res.status(200).json({ claims: high, count: high.length });
  }
}

module.exports = new FraudController();

