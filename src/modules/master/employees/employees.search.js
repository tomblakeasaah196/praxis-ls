/**
 * ⌘K search provider — employees by name, staff number or work email (MOD-02).
 *
 * Gated on the module's `view` grant by the search service, run on the
 * request's LIVE or TEST connection, bounded by the service's limit
 * (src/services/search/provider.js has the contract).
 */
"use strict";
const { recordProvider } = require("../../../services/search/provider.js");

module.exports = recordProvider({
  type: "employee",
  module: "MOD-02",
  label: { en: "Employees", fr: "Employés" },
  route: "/hr/employees",
  from: "employee e",
  columns: ["e.full_name", "e.staff_no", "e.email"],
  select: "e.employee_id AS id, e.staff_no AS ref, e.full_name AS title, NULLIF(concat_ws(' · ', e.job_title, e.department), '') AS sub",
  order: "e.full_name",
  url: (r) => `/hr/employees?focus=${encodeURIComponent(r.id)}`,
});
