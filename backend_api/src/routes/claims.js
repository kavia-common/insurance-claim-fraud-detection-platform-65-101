const express = require('express');
const multer = require('multer');
const claimsController = require('../controllers/claims');
const fraudController = require('../controllers/fraud');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

/**
 * @swagger
 * tags:
 *   - name: Claims
 *     description: Claim ingestion, CRUD, and outcomes
 *   - name: Fraud
 *     description: Fraud scoring, signals catalog, and investigator queue
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Claim:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique claim ID
 *         claimNumber:
 *           type: string
 *         claimantName:
 *           type: string
 *         policyNumber:
 *           type: string
 *         incidentDate:
 *           type: string
 *           description: ISO date string (best effort)
 *         reportDate:
 *           type: string
 *           description: ISO date string (best effort)
 *         amount:
 *           type: number
 *         providerName:
 *           type: string
 *         diagnosisCode:
 *           type: string
 *         procedureCode:
 *           type: string
 *         zip:
 *           type: string
 *         state:
 *           type: string
 *         status:
 *           type: string
 *           example: new
 *         outcome:
 *           type: string
 *         outcomeNotes:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         fraud:
 *           $ref: '#/components/schemas/FraudAssessment'
 *     FraudAssessment:
 *       type: object
 *       properties:
 *         score:
 *           type: number
 *           description: 0-100
 *         riskTier:
 *           type: string
 *           enum: [low, medium, high]
 *         modelVersion:
 *           type: string
 *         signals:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/FraudSignalHit'
 *         explanation:
 *           type: array
 *           items:
 *             type: string
 *     FraudSignalHit:
 *       type: object
 *       properties:
 *         code:
 *           type: string
 *         weight:
 *           type: number
 *         message:
 *           type: string
 *     FraudSignalDefinition:
 *       type: object
 *       properties:
 *         code:
 *           type: string
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         weight:
 *           type: number
 */

/**
 * @swagger
 * /upload-claims:
 *   post:
 *     summary: Upload a CSV of claims
 *     description: Accepts multipart/form-data with file field named `file`. Parses, validates, persists, and scores claims.
 *     tags: [Claims]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Upload succeeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 created: { type: number }
 *                 updated: { type: number }
 *                 count: { type: number }
 *                 claims:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Claim'
 *       400:
 *         description: CSV validation failed
 */
router.post('/upload-claims', upload.single('file'), claimsController.uploadClaims.bind(claimsController));

/**
 * @swagger
 * /claims:
 *   get:
 *     summary: List claims
 *     description: Supports query filters q, status, minFraudScore.
 *     tags: [Claims]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: minFraudScore
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: List of claims
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: number }
 *                 claims:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Claim'
 */
router.get('/claims', claimsController.list.bind(claimsController));

/**
 * @swagger
 * /claims/{id}:
 *   get:
 *     summary: Get claim by id
 *     tags: [Claims]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Claim
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Claim'
 *       404:
 *         description: Not found
 *   put:
 *     summary: Update claim by id
 *     tags: [Claims]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Claim'
 *     responses:
 *       200:
 *         description: Updated claim
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Claim'
 *       404:
 *         description: Not found
 *   delete:
 *     summary: Delete claim by id
 *     tags: [Claims]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.get('/claims/:id', claimsController.getById.bind(claimsController));
router.put('/claims/:id', claimsController.updateById.bind(claimsController));
router.delete('/claims/:id', claimsController.deleteById.bind(claimsController));

/**
 * @swagger
 * /score-fraud:
 *   post:
 *     summary: Score fraud for a claim
 *     description: Accepts { claimId } or { id } to score persisted claim, or { claim: {...} } to score ad-hoc.
 *     tags: [Fraud]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               claimId: { type: string }
 *               id: { type: string }
 *               claim:
 *                 $ref: '#/components/schemas/Claim'
 *     responses:
 *       200:
 *         description: Fraud assessment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 fraud:
 *                   $ref: '#/components/schemas/FraudAssessment'
 *                 claim:
 *                   $ref: '#/components/schemas/Claim'
 *       400:
 *         description: Invalid payload
 *       404:
 *         description: Claim not found
 */
router.post('/score-fraud', fraudController.scoreFraud.bind(fraudController));

/**
 * @swagger
 * /fraud-signals:
 *   get:
 *     summary: Get fraud signals catalog
 *     tags: [Fraud]
 *     responses:
 *       200:
 *         description: Signals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 signals:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/FraudSignalDefinition'
 */
router.get('/fraud-signals', fraudController.signals.bind(fraudController));

/**
 * @swagger
 * /high-risk-queue:
 *   get:
 *     summary: Get high-risk queue
 *     description: Returns claims with HIGH risk tier.
 *     tags: [Fraud]
 *     responses:
 *       200:
 *         description: High-risk claims
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: number }
 *                 claims:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Claim'
 */
router.get('/high-risk-queue', fraudController.highRiskQueue.bind(fraudController));

/**
 * @swagger
 * /update-outcome:
 *   post:
 *     summary: Update claim outcome
 *     description: Updates investigation outcome and optional notes; marks claim as reviewed.
 *     tags: [Claims]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, outcome]
 *             properties:
 *               id: { type: string }
 *               outcome: { type: string, example: confirmed_fraud }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Updated claim
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Claim'
 *       400:
 *         description: Invalid payload
 *       404:
 *         description: Claim not found
 */
router.post('/update-outcome', claimsController.updateOutcome.bind(claimsController));

module.exports = router;

