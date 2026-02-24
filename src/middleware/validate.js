const Joi = require('joi');

// Validation schemas
const schemas = {
  // User schemas
  register: Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string().min(8).max(100).required(),
    role: Joi.string().valid('user', 'admin').default('user')
  }),

  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required()
  }),

  // Website schemas
  createWebsite: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
    check_interval: Joi.number().integer().min(10000).max(3600000).default(30000),
    timeout: Joi.number().integer().min(1000).max(60000).default(10000),
    expected_status: Joi.number().integer().min(100).max(599).default(200),
    enabled: Joi.boolean().default(true)
  }),

  updateWebsite: Joi.object({
    name: Joi.string().min(1).max(100),
    url: Joi.string().uri({ scheme: ['http', 'https'] }),
    check_interval: Joi.number().integer().min(10000).max(3600000),
    timeout: Joi.number().integer().min(1000).max(60000),
    expected_status: Joi.number().integer().min(100).max(599),
    enabled: Joi.boolean()
  }).min(1),

  // Alert schemas
  createAlert: Joi.object({
    website_id: Joi.string().uuid().allow(null),
    alert_type: Joi.string().valid('email', 'discord', 'slack', 'webhook').required(),
    config: Joi.object().required(),
    enabled: Joi.boolean().default(true)
  }),

  updateAlert: Joi.object({
    website_id: Joi.string().uuid().allow(null),
    alert_type: Joi.string().valid('email', 'discord', 'slack', 'webhook'),
    config: Joi.object(),
    enabled: Joi.boolean()
  }).min(1),

  // Query params
  pagination: Joi.object({
    limit: Joi.number().integer().min(1).max(1000).default(100),
    offset: Joi.number().integer().min(0).default(0)
  }),

  historyQuery: Joi.object({
    limit: Joi.number().integer().min(1).max(1000).default(100),
    hours: Joi.number().integer().min(1).max(720)
  }),

  statsQuery: Joi.object({
    days: Joi.number().integer().min(1).max(365).default(30)
  })
};

// Validation middleware factory
function validate(schemaName, property = 'body') {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) {
      return res.status(500).json({ 
        success: false, 
        error: `Validation schema '${schemaName}' not found` 
      });
    }

    const { error, value } = schema.validate(req[property], { 
      abortEarly: false,
      stripUnknown: true 
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({ 
        success: false, 
        error: 'Validation failed',
        details: errors
      });
    }

    // Replace with validated/sanitized values
    req[property] = value;
    next();
  };
}

module.exports = { validate, schemas };
