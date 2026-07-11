/** Worker job: send one email via SMTP. Job data: { to, subject, html, text, from }. */
"use strict";
const email = require("../../services/email.service");
module.exports = async function emailSend(job) {
  const { to, subject, html, text, from } = job.data || {};
  return email.send({ to, subject, html, text, from });
};
