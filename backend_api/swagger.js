const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Insurance Claim Fraud Detection API',
      version: '1.0.0',
      description:
        'REST API for uploading insurance claims, scoring fraud with rule-based signals, managing investigator queues, and updating outcomes.',
    },
    tags: [
      { name: 'Claims', description: 'Claim ingestion, CRUD, and outcomes' },
      { name: 'Fraud', description: 'Fraud scoring, signal catalog, and high-risk queue' },
    ],
  },
  apis: ['./src/routes/*.js', './src/routes/**/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
