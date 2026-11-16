process.env.DATABASE_URL ??= 'postgresql://daybook:daybook@localhost:5432/daybook';
process.env.JWT_SECRET ??= 'dev-only-secret-change-me';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';
process.env.ATTACHMENT_DRIVER ??= 'memory';
process.env.AGENT_QUEUE_DRIVER ??= 'inline';
process.env.AI_PROVIDER ??= 'stub';
process.env.AGENT_TEST_HOOKS ??= '1';
process.env.AGENT_MAX_ATTEMPTS ??= '3';
