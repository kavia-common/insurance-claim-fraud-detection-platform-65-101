/**
 * Rule-based fraud scoring service.
 * Generates signals, score [0..100], risk tier, and explanation strings.
 */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function daysBetween(aIso, bIso) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function normStr(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function normUpper(v) {
  return normStr(v).toUpperCase();
}

function money(v) {
  const n = typeof v === 'number' ? v : Number(String(v || '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * PUBLIC_INTERFACE
 * Returns the fraud signal catalog shown by the UI.
 */
function getFraudSignals() {
  return [
    {
      code: 'HIGH_AMOUNT',
      title: 'High claim amount',
      description: 'Claim amount exceeds a high threshold, indicating higher fraud risk.',
      weight: 30,
    },
    {
      code: 'VERY_HIGH_AMOUNT',
      title: 'Very high claim amount',
      description: 'Claim amount exceeds a very high threshold.',
      weight: 45,
    },
    {
      code: 'LATE_REPORTED',
      title: 'Late reported claim',
      description: 'Large gap between incident date and report date.',
      weight: 15,
    },
    {
      code: 'MISSING_CRITICAL_FIELDS',
      title: 'Missing critical fields',
      description: 'One or more critical fields are missing (policy, claimant, incident date).',
      weight: 10,
    },
    {
      code: 'SUSPICIOUS_ZIP',
      title: 'Suspicious ZIP/state pattern',
      description: 'ZIP or state looks unusual or missing.',
      weight: 8,
    },
    {
      code: 'REPEAT_PROVIDER',
      title: 'Repeat provider across multiple high claims',
      description: 'Provider appears across multiple high-value claims (simple heuristic).',
      weight: 12,
    },
    {
      code: 'DIAG_PROC_MISMATCH',
      title: 'Diagnosis / procedure mismatch',
      description: 'Diagnosis and procedure codes look inconsistent or too generic.',
      weight: 10,
    },
  ];
}

/**
 * @param {object} claim
 * @param {object} context
 * @returns {{score:number, riskTier: 'low'|'medium'|'high', signals: Array<object>, explanation: string[], modelVersion: string}}
 */
function scoreClaim(claim, context = {}) {
  const signals = [];
  let score = 0;

  const amt = money(claim.amount);
  if (amt !== null) {
    if (amt >= 50000) {
      signals.push({
        code: 'VERY_HIGH_AMOUNT',
        weight: 45,
        message: `Claim amount ${amt.toFixed(2)} is very high (>= 50000).`,
      });
      score += 45;
    } else if (amt >= 20000) {
      signals.push({
        code: 'HIGH_AMOUNT',
        weight: 30,
        message: `Claim amount ${amt.toFixed(2)} is high (>= 20000).`,
      });
      score += 30;
    }
  }

  const incidentDate = normStr(claim.incidentDate);
  const reportDate = normStr(claim.reportDate);
  if (incidentDate && reportDate) {
    const gap = daysBetween(incidentDate, reportDate);
    if (gap !== null && gap >= 21) {
      signals.push({
        code: 'LATE_REPORTED',
        weight: 15,
        message: `Claim reported ${gap} days after incident (>= 21).`,
      });
      score += 15;
    }
  }

  const missing = [];
  if (!normStr(claim.policyNumber)) missing.push('policyNumber');
  if (!normStr(claim.claimantName)) missing.push('claimantName');
  if (!normStr(claim.incidentDate)) missing.push('incidentDate');
  if (missing.length) {
    signals.push({
      code: 'MISSING_CRITICAL_FIELDS',
      weight: 10,
      message: `Missing critical fields: ${missing.join(', ')}.`,
    });
    score += 10;
  }

  const zip = normStr(claim.zip);
  const state = normUpper(claim.state);
  if (!zip || zip.length < 5 || !state || state.length !== 2) {
    signals.push({
      code: 'SUSPICIOUS_ZIP',
      weight: 8,
      message: 'ZIP/state is missing or malformed.',
    });
    score += 8;
  }

  // Repeat provider heuristic (requires context)
  const provider = normStr(claim.providerName);
  if (provider && context.providerHighValueCounts && context.providerHighValueCounts[provider] >= 2) {
    signals.push({
      code: 'REPEAT_PROVIDER',
      weight: 12,
      message: `Provider '${provider}' appears on multiple high-value claims.`,
    });
    score += 12;
  }

  const dx = normUpper(claim.diagnosisCode);
  const proc = normUpper(claim.procedureCode);
  if ((dx && dx.startsWith('Z')) || (proc && proc.endsWith('00')) || (!dx && proc) || (dx && !proc)) {
    signals.push({
      code: 'DIAG_PROC_MISMATCH',
      weight: 10,
      message: 'Diagnosis/procedure codes look incomplete or generic.',
    });
    score += 10;
  }

  score = clamp(score, 0, 100);

  /** @type {'low'|'medium'|'high'} */
  let riskTier = 'low';
  if (score >= 70) riskTier = 'high';
  else if (score >= 35) riskTier = 'medium';

  const explanation = [
    `Fraud score computed from ${signals.length} signal(s).`,
    ...signals.map((s) => `• ${s.message} (+${s.weight})`),
    `Final score: ${score}/100 (${riskTier.toUpperCase()} risk).`,
  ];

  return {
    score,
    riskTier,
    signals,
    explanation,
    modelVersion: 'rules_v1',
  };
}

module.exports = {
  getFraudSignals,
  scoreClaim,
};

