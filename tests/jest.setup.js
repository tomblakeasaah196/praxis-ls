"use strict";

// Deterministic env for unit tests: development mode with dev-safe secrets so
// modules that read config at require-time don't trip the production guard.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";
