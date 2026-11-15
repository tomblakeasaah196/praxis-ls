"use strict";
/**
 * The people a training video is filmed as (doc/TRAINING_VIDEOS.md §3).
 *
 * Every one of them is invented. No member of a tenant's real staff is the subject of a
 * demonstration, so a video can be shown to anyone and a person's name on screen is never a
 * decision somebody has to defend. They live on the filming copy's LIVE side (a login needs an
 * employee) and, because the product copies every live employee into TEST, they are in TEST too.
 *
 * Keys are what a scene names (`as: "nadege"`); the rest is the profile the ground gives them.
 * Add people here, never in a scene, so the next video meets the same colleagues.
 *
 * The domain is `.test`, which can never reach a real mailbox.
 */
const DOMAIN = "smartls.test";

const CAST = Object.freeze({
  patrick: {
    full_name: "Patrick Etoundi",
    job_title: "Managing Director",
    department: "Management",
    roles: ["CEO"],
    reports_to: null,
    hired_on: "2018-03-01",
    mobile: "+237 677 10 20 30",
    place_of_work: "Douala, Akwa",
    gender: "MALE", civility: "MR",
  },
  nadege: {
    full_name: "Nadège Tchouameni",
    job_title: "Operations Manager",
    department: "Operations",
    roles: ["MANAGEMENT", "OPERATIONS"],
    reports_to: "patrick",
    hired_on: "2026-11-02",
    mobile: "+237 699 45 12 87",
    place_of_work: "Douala, Akwa",
    gender: "FEMALE", civility: "MS",
  },
  brice: {
    full_name: "Brice Mbarga",
    job_title: "Import Operations Lead",
    department: "Operations",
    roles: ["OPERATIONS"],
    reports_to: "nadege",
    hired_on: "2021-06-14",
    mobile: "+237 677 88 31 02",
    place_of_work: "Douala Port",
    gender: "MALE", civility: "MR",
  },
  carine: {
    full_name: "Carine Fokou",
    job_title: "Export Operations Lead",
    department: "Operations",
    roles: ["OPERATIONS"],
    reports_to: "nadege",
    hired_on: "2022-01-10",
    mobile: "+237 691 27 64 15",
    place_of_work: "Douala Port",
    gender: "FEMALE", civility: "MS",
  },
  serge: {
    full_name: "Serge Ndzana",
    job_title: "Finance Manager",
    department: "Finance",
    roles: ["FINANCE"],
    reports_to: "patrick",
    hired_on: "2019-09-02",
    mobile: "+237 655 73 90 44",
    place_of_work: "Douala, Akwa",
    gender: "MALE", civility: "MR",
  },
});

/** An email as the ground makes it: nadege.tchouameni@smartls.test (accents dropped). */
const emailOf = (key) => {
  const plain = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]+/g, "");
  const [first, ...rest] = CAST[key].full_name.split(" ");
  return `${plain(first)}.${plain(rest.join(" "))}@${DOMAIN}`;
};

module.exports = { CAST, DOMAIN, emailOf };
