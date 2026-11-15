process.env.DATABASE_URL ??= 'postgresql://daybook:daybook@localhost:5432/daybook';
process.env.JWT_SECRET ??= 'dev-only-secret-change-me';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';
process.env.ATTACHMENT_DRIVER ??= 'memory';
