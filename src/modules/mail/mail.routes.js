/** Mail (read-only) — per-purpose sender identities + outbound send log. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const c = require("./mail.controller");
const router = express.Router();
router.use(authMiddleware);
router.get("/senders", c.senders);
router.get("/sent", c.sent);
router.get("/inbox", c.inbox);
router.patch("/senders/:id", c.updateSender);
router.post("/senders", c.upsertSender);
module.exports = { basePath: "/mail", feature: null, router };
