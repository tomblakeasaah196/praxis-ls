"use strict";
const repo = require("./dashboard.repo");
module.exports = {
  kpis: (client) => repo.kpis(client),
  controlTower: (client) => repo.controlTower(client),
};
