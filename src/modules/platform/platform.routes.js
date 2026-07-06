/**
 * Platform (company dashboard) routes — mounted at /api/platform.
 * Every route is Praxis-only: platformAuth + PLATFORM_ROOT_ADMIN.
 * This is where the dashboard "toggles the controls" wired to the DB scripts.
 */
"use strict";

const express = require("express");
const c = require("./platform.controller");
const { validate } = require("./platform.validator");
const {
  platformAuth,
  requirePlatformRole,
} = require("../../middleware/platform-auth");

const router = express.Router();
router.use(platformAuth, requirePlatformRole("PLATFORM_ROOT_ADMIN"));

// Catalogue (the switchboard the dashboard renders)
router.get("/catalogue/modules", c.listModules);
router.get("/catalogue/features", c.listFeatures);
router.get("/plans", c.listPlans);

// Tenant lifecycle
router.get("/tenants", c.list);
router.post("/tenants", validate("provision"), c.provision);
router.get("/tenants/:slug", c.get);
router.post("/tenants/:slug/suspend", c.suspend);
router.post("/tenants/:slug/resume", c.resume);
router.post("/tenants/:slug/go-live", c.goLive);
router.patch("/tenants/:slug/capacity", validate("capacity"), c.setCapacity);
router.patch("/tenants/:slug/sandbox", validate("sandbox"), c.setSandbox);
router.post("/tenants/:slug/sandbox/wipe", c.wipeSandbox);
router.post("/tenants/:slug/migrate", c.migrate);

// Feature/module on-off (projects into the tenant DB feature_state)
router.get("/tenants/:slug/features", c.features);
router.patch(
  "/tenants/:slug/features/:featureKey",
  validate("feature"),
  c.setFeature,
);
router.delete("/tenants/:slug/features/:featureKey", c.clearFeature);

module.exports = router;
