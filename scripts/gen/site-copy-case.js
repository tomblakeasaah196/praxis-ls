"use strict";
/**
 * LABEL or PROSE — every `site.*` and `portal.*` key, classified. The ONE
 * maintained list behind the Title Case standard.
 *
 * ── THE STANDARD (owner decision D5, tenant review of 29 Sep 2026) ─────────
 *
 * Every LABEL renders in Title Case, in English AND in French: nav and footer
 * links and column titles, buttons and calls to action, page and section
 * headings (the hero headline included), eyebrows, card titles, tabs, form
 * field labels, pills and status chips — "Our Work", "Client Portal",
 * "Request a Quote"; "Nos Réalisations", "Portail Client", "Demander un
 * Devis". The client portal's chrome follows the same rule.
 *
 * PROSE stays exactly as written: sentences and paragraphs, hints,
 * placeholders, toasts and status lines, error messages, legal text, alt text
 * and screen-reader labels — and anything that is DATA rather than words
 * (a filename, a sample reference, a value code compares, a quick-reply chip
 * whose words are sent as the message).
 *
 * The rule is applied at RENDER by one i18next post-processor
 * (public-web/src/lib/label-case.ts) using `titleCase` from
 * packages/shared/text/title-case.js — the financial dictionary's function,
 * unchanged. No string in a dictionary is retyped, so a tenant's own override
 * from the copy editor is cased by the same path, and a tenant who chooses
 * "Label capitalisation: As written" (Website › Theme) gets the words exactly
 * as typed. The staff ERP (client/) is out of scope.
 *
 * ── HOW TO READ AND EDIT THIS FILE ──────────────────────────────────────────
 *
 * Keys are grouped by section: `site.<section>` / `portal.<section>`, and the
 * portal's top-level leaves under `portal`. Each section is either
 *
 *   - `LABEL` or `PROSE` — every key in it, present and future, is that kind;
 *   - `{ LABEL: [...], PROSE: [...] }` — each key below the section, by its
 *     path relative to the section. An array index is written `*`
 *     (`items.*.t`), so a new card in a list is classified with its siblings.
 *
 * Adding a key? Put it in one of the two lists. `npm run check:i18n`
 * (public-web) FAILS on a key this file does not classify, and on an entry
 * that names no key — so no new label escapes the standard and no stale entry
 * outlives its string. Then run `node scripts/gen/gen-site-copy-catalogue.js`:
 * it writes the LABEL sets the site and the portal load at runtime, and its
 * `--check` gate fails CI when they are stale.
 *
 * Deciding? A string a person READS AS A NAME for something — what to click,
 * where they are, what a field or column is called — is a LABEL. A string they
 * read as a statement is PROSE, even when it is short ("Sent — thank you").
 * A heading written as a full sentence with its full stop ("Your CV is on
 * file.") is a statement. A key that ends a split headline (`titleAccent`,
 * `taglineAccent`) continues its `…Main`, so its first word is cased as the
 * middle of a phrase, not the start of one ("The People Behind" + "the
 * Freight").
 */
const LABEL = "LABEL";
const PROSE = "PROSE";

const CASES = {
  "portal": {
    LABEL: [
      "setPasswordTitle", "brandFallback",
    ],
    PROSE: [
      "offline",
    ],
  },
  "portal.account": {
    LABEL: [
      "editName", "nameTitle", "nameLabel", "addName", "security", "device",
      "thisDevice", "lastSeen", "signOutDevice", "deviceOutTitle", "preferences",
      "language", "theme", "light", "dark", "auto", "signOut", "signOutForget",
      "signOutTitle", "forgetTitle", "portal",
    ],
    PROSE: [
      "nameBody", "nameSaved", "deviceOut", "forgetBody",
    ],
  },
  "portal.ask": {
    LABEL: [
      "title", "short", "aboutStep", "aboutThis", "chatInstead", "yourQuestion",
      "addDetail", "send", "yours", "question", "reply", "status.OPEN",
      "status.IN_PROGRESS", "status.RESOLVED",
    ],
    PROSE: [
      "quick.when", "quick.needMe", "quick.faster", "quick.other", "sent",
    ],
  },
  "portal.audit": {
    LABEL: [
      "title", "until", "trialBalance", "account", "debit", "credit", "noMovements",
      "trail", "noPostings", "system", "dataRoom", "ask", "what", "send",
      "noRequests", "noDocs", "room.OPEN", "room.ANSWERED",
    ],
    PROSE: [
      "asked",
    ],
  },
  "portal.bill": {
    LABEL: [
      "toPay", "nothingDue", "ivePaid", "pay", "inReviewCount", "howToPay", "holder",
      "account", "iban", "swift", "filter", "tab.open", "tab.paid", "tab.payments",
      "allClear", "noPaid", "noProofs", "invoice", "invoices", "dueWhen", "wasDue",
      "state.DUE", "state.OVERDUE", "state.PART_PAID", "state.PAID",
      "state.IN_REVIEW", "state.CANCELLED", "leftToPay", "total", "paidAmount",
      "inReviewAmount", "issued", "dueOn", "lines", "services", "disbursements",
      "vat", "docs.title", "docs.count", "docs.all", "docs.show", "docs.hide",
      "docs.about", "proof.SUBMITTED", "proof.CONFIRMED", "proof.REJECTED",
    ],
    PROSE: [
      "overdueAmount", "howToPayHint", "ofTotal", "atCost", "receiptFile",
      "docs.shared", "docs.downloadOne", "docs.info", "docs.zipName",
    ],
  },
  "portal.chat": {
    LABEL: [
      "open", "title", "send", "emptyTitle", "team", "thisShipment", "untag",
      "general", "shipment", "all", "newAbout", "pickShipment", "noShipments", "you",
      "unread", "earlier", "newMessages", "aboutStage", "removeStage", "attach",
      "aboutQuotation", "aboutProposal", "removeAbout",
      "takePhoto", "photosFiles", "location", "locationLabel", "sendLocation",
      "openMap", "record", "recording", "sendVoice", "deleteVoice", "play", "pause",
      "viewPhoto", "photo", "downloadOriginal", "kind.IMAGE", "kind.FILE",
      "kind.VOICE", "kind.LOCATION",
    ],
    PROSE: [
      "placeholder", "caption", "emptyHint", "retry", "generalHint", "sending",
      "sent", "seen", "removeFile", "tooMany", "locating", "locationPlaceholder",
      "locationOff", "locationFailed", "micOff", "micUnsupported", "download",
    ],
  },
  "portal.common": {
    LABEL: [
      "back", "close", "notNow", "retry", "seeAll", "cancel", "save", "next",
      "download", "pdf", "copy", "copied", "clear", "calendar",
    ],
    PROSE: [
      "loading", "datePlaceholder",
    ],
  },
  "portal.docs": LABEL,
  "portal.err": PROSE,
  "portal.fin": {
    LABEL: [
      "title", "period", "revenue", "netResult", "cash", "bsTotal", "incomeStatement",
      "produits", "charges", "hao", "balanceSheet", "actif", "passif", "result",
      "total", "cashPosition", "noTreasury",
    ],
    PROSE: [
      "unbalanced",
    ],
  },
  "portal.home": {
    LABEL: [
      "greet.morning", "greet.afternoon", "greet.evening", "hello.morning",
      "hello.afternoon", "hello.evening", "needsYou", "glance", "onTheMove", "toPay",
      "toSend", "moving", "shortcuts",
    ],
    PROSE: [
      "noneMoving", "allClear",
    ],
  },
  "portal.install": {
    LABEL: [
      "title", "button", "done", "howLabel", "iosTitle", "inAppChrome",
    ],
    PROSE: [
      "hint", "ios1", "ios2", "ios3", "inAppTitle", "inAppAndroidHint", "inAppIos1",
      "inAppIos2", "inAppOther",
    ],
  },
  "portal.kind": LABEL,
  "portal.mode": LABEL,
  "portal.nav": {
    LABEL: [
      "home", "shipments", "quotes", "requests", "quotations", "billing", "documents",
      "account",
    ],
    PROSE: [
      "label",
    ],
  },
  "portal.noAccess": {
    LABEL: [
      "title",
    ],
    PROSE: [
      "hint",
    ],
  },
  "portal.notify": {
    LABEL: [
      "title", "thisDevice", "switchLabel", "test", "email", "push", "topic.MESSAGES",
      "topic.REQUESTS", "topic.QUOTES", "topic.BILLING", "topic.PROPOSALS",
      "topic.SHIPMENTS", "infoTitle", "blockedTitle",
    ],
    PROSE: [
      "state.on", "state.off", "state.blocked", "state.unsupported",
      "state.installFirst", "state.unconfigured", "turnedOn", "turnedOff", "testSent",
      "testNone", "saved", "infoLabel", "info1", "info2", "info3", "blockedHow",
    ],
  },
  "portal.offer": {
    LABEL: [
      "tab.all", "tab.quotations", "tab.proposals", "none", "quotation", "answers",
      "status.SENT", "status.ACCEPTED", "status.REJECTED", "status.EXPIRED",
      "status.CONVERTED", "switchRequests", "switchQuotations", "back", "details",
      "service", "route", "incoterm", "validUntil", "paymentTerms", "onReceipt",
      "request", "file", "pricing", "atCost", "ht", "vat", "ttc", "download", "ask",
      "acceptTitle", "declineSend",
    ],
    PROSE: [
      "sub", "noneHint", "awaiting", "daysAfterInvoice", "accepted", "declined",
      "declinedTitle", "signAgree",
    ],
  },
  "portal.passkey": {
    LABEL: [
      "offerTitle.face", "offerTitle.touch", "offerTitle.hello", "offerTitle.finger",
      "turnOn", "label.face", "label.touch", "label.hello", "label.finger",
    ],
    PROSE: [
      "offerBody", "on.face", "on.touch", "on.hello", "on.finger", "off",
      "thisDevice",
    ],
  },
  "portal.pay": {
    LABEL: [
      "step1", "step2", "step3", "progress", "which", "amount", "how", "method.BANK",
      "method.MOBILE_MONEY", "method.CASH", "method.CHEQUE", "wallet", "otherWallet",
      "when", "day.today", "day.yesterday", "day.other", "reference", "txId",
      "chequeNo", "note", "send",
    ],
    PROSE: [
      "oneCurrency", "moreThanPicked", "sent",
    ],
  },
  "portal.place": {
    LABEL: [
      "search", "clear", "change", "recent", "popular", "matches", "world",
      "searchWorld", "useTyped", "none", "results", "kind.SEAPORT", "kind.AIRPORT",
      "kind.TERMINAL", "kind.RAIL_TERMINAL", "kind.BORDER_POST", "kind.WAREHOUSE",
      "kind.INLAND", "kind.CITY", "kind.ADDRESS", "kind.OTHER",
    ],
    PROSE: [
      "worldNote", "searchingWorld", "searching", "useTypedHint", "typed",
      "unavailable", "failed",
    ],
  },
  "portal.prop": {
    LABEL: [
      "proposal", "status.SENT", "status.ACCEPTED", "status.REJECTED", "expired",
      "validUntil", "total", "pricing", "accept", "acceptSign", "decline",
      "acceptTitle", "declineTitle", "declineNote", "declineSend", "awaitingCount",
      "review", "sign.step1", "sign.step2", "sign.codeLabel", "sign.resend",
      "sign.how", "sign.card.STAMP", "sign.card.DRAWN", "sign.name", "sign.role",
      "sign.draw", "sign.clear", "sign.aboutTitle", "sign.submit", "sign.signedBy",
      "sign.verify",
    ],
    PROSE: [
      "acceptBody", "accepted", "declined", "sign.sending", "sign.sentTo",
      "sign.resent", "sign.rolePlaceholder", "sign.agree", "sign.about",
    ],
  },
  "portal.quote": {
    LABEL: [
      "request", "new", "none", "step1", "step2", "step3", "from", "to",
      "sameAsLast", "likeShipment", "describe", "fill", "filledPill", "route.pol", "route.pod", "route.aol", "route.aod",
      "route.collection", "route.collectionAdd", "route.delivery",
      "route.deliveryAdd", "route.doorToDoor", "route.withCollection",
      "route.withDelivery", "incoterm", "notSure", "what", "weight", "send",
      "status.RECEIVED", "status.UNDER_REVIEW", "status.CLARIFICATION_REQUIRED",
      "status.QUOTED", "status.CONVERTED_TO_OPPORTUNITY", "status.CLOSED_NO_ACTION",
      "stepStorage", "stepDocs", "detail.title", "detail.loading", "detail.scope",
      "detail.weight", "detail.documents", "detail.document", "detail.progress",
      "detail.answer",
    ],
    PROSE: [
      "describeHint", "filling", "filled", "route.portHint", "route.airportHint",
      "route.placeHint", "route.collectionAddHint", "route.deliveryAddHint",
      "route.doorHint", "route.remove", "whatHint", "sent", "errCargo", "docCount",
      "detail.toBeDetermined", "detail.noDocuments", "detail.added",
      "detail.waiting",
    ],
  },
  "portal.req": {
    LABEL: [
      "status.OPEN", "status.REJECTED", "status.SUBMITTED", "status.ACCEPTED",
      "status.CANCELLED", "due", "upload", "answer", "again", "replace",
      "replaceTitle", "send", "sendAnswer", "sentBack", "fromTeam", "yourAnswer",
    ],
    PROSE: [
      "sent", "acceptedHint", "reviewHint",
    ],
  },
  "portal.setPassword": {
    LABEL: [
      "title", "new", "confirm", "cta", "badLinkTitle",
    ],
    PROSE: [
      "sub", "mismatch", "badLink", "rule.length", "rule.upper", "rule.lower",
      "rule.digit", "rule.symbol",
    ],
  },
  "portal.share": {
    LABEL: [
      "title", "short", "what", "more", "other", "which", "noShipment", "file",
      "note", "send",
    ],
    PROSE: [
      "sent",
    ],
  },
  "portal.ship": LABEL,
  "portal.signin": {
    LABEL: [
      "title", "eyebrow", "taglineMain", "taglineAccent", "trackLink", "whatsInside",
      "email", "continue", "usePassword", "emailMeCode", "welcomeBackNamed",
      "welcomeBack", "keep", "checkEmail", "codeLabel", "resend", "passwordTitle",
      "password", "signIn", "forgot", "back", "showPassword", "hidePassword",
      "bio.face", "bio.touch", "bio.hello", "bio.finger",
    ],
    PROSE: [
      "sub", "themeDark", "themeLight", "feature.track", "feature.documents",
      "feature.send", "feature.pay", "feature.chat", "feature.team", "accessNote",
      "emailPlaceholder", "notYou", "keepHint", "codeSent", "digit", "resendIn",
      "checking", "resetSent",
    ],
  },
  "portal.team": {
    LABEL: [
      "title", "invite", "inviteTitle", "name", "access", "scope.ALL",
      "scope.OPERATIONS", "scope.BILLING", "makeAdmin", "admin", "sendInvite",
      "invited", "you", "remove", "removeTitle",
    ],
    PROSE: [
      "nameHint", "scopeHint.ALL", "scopeHint.OPERATIONS", "scopeHint.BILLING",
      "adminHint", "inviteSent", "saved", "removeBody", "removed",
    ],
  },
  "portal.upload": {
    LABEL: [
      "takePhoto", "chooseFile", "complete", "remove",
    ],
    PROSE: [
      "preparing", "sending", "was", "badType", "tooBig", "unreadable",
    ],
  },
  "site.about": {
    LABEL: [
      "title", "kicker", "titleMain", "titleAccent", "founded", "hq", "storyKicker",
      "storyTitle", "mission", "vision", "principles", "messageKicker",
      "messageTitle", "timelineKicker", "timelineTitle", "timelineYear",
      "peopleKicker", "peopleTitle", "readBio", "linkedin", "networkKicker",
      "networkTitle", "networkPlaces", "entityFocus", "entityCoverage",
      "entityAddress", "entityPeople", "proofKicker", "proofTitle",
      "credentialsTitle", "credentialRef", "credentialIssued", "credentialValid",
      "membershipsTitle", "clientsTitle", "carriersTitle",
    ],
    PROSE: [
      "sub", "linkedinOf", "portraitAlt", "networkLead", "networkLabel",
      "entityCoverAlt", "carriersLead", "markAlt",
    ],
  },
  "site.announce": LABEL,
  "site.careers": {
    LABEL: [
      "title", "titleMain", "titleAccent", "list", "empty", "quietCta", "openTitle",
      "openCta", "openFormTitle", "openWanted", "openSubmit", "alertTitle",
      "alertEmail", "alertName", "alertCta", "unsubTitle", "cultureTitle",
      "cultureMore", "apply", "seeOther", "lookingFor", "back", "published",
      "applyTitle", "fullName", "email", "phone", "address", "experience",
      "expectedSalary", "portfolio", "coverNote", "cv", "optional", "submit",
      "anotherRole",
    ],
    PROSE: [
      "sub", "emptyHint", "quietNote", "openLead", "openWantedHint", "openSentTitle",
      "openSentCv", "openSentNoCv", "openSentNote", "alertLead", "alertSending",
      "alertSentTitle", "alertSentNote", "alertConsent", "unsubBusy", "unsubDone",
      "unsubNote", "closeNote", "closed", "closedHint", "testPosting", "salaryFrom",
      "salaryUpTo", "years", "coverHint", "cvHint", "cvRequired", "sending",
      "sentTitle", "sentCv", "sentNoCv", "sentNote", "err", "limited",
    ],
  },
  "site.chrome": {
    LABEL: [
      "skip", "language", "theme", "themeLight", "themeDark", "menu", "closeMenu",
      "login", "portalEntry", "home",
    ],
    PROSE: [
      "toEnglish", "toFrench",
    ],
  },
  "site.contact": {
    LABEL: [
      "title", "kicker", "titleMain", "titleAccent", "bandCta", "otherTitle",
      "coverageKicker", "coverageTitle", "offices", "covers", "otherGo", "subject",
      "type", "typeGeneral", "typePartnership", "typeCareers", "typeMedia", "message",
      "send", "promise.*.t",
    ],
    PROSE: [
      "sub", "bandLead", "otherTrack", "coverageAlt", "coverageNone", "otherPortal",
      "otherQuote", "sending", "sent", "err", "limited", "promise.*.d",
    ],
  },
  "site.corridor": {
    LABEL: [
      "eyebrow", "title",
    ],
    PROSE: [
      "sub", "subAbstract", "figureLabel", "figureLabelAbstract", "present", "files",
      "tilt",
    ],
  },
  "site.crash": {
    LABEL: [
      "title", "reload", "home",
    ],
    PROSE: [
      "hint",
    ],
  },
  "site.esg": {
    LABEL: [
      "kicker", "title", "titleAccent", "environment", "social", "governance",
    ],
    PROSE: [
      "figureAlt",
    ],
  },
  /*
   * The verification portal. LABEL is only what NAMES something — the field
   * labels, the section headings, the submit button. The callout titles
   * ("Signature verified", "This signature has been revoked") are PROSE
   * because the gate classifies by COMPONENT and those render in a callout,
   * which is a message whatever words it carries; so is "How is this
   * verified?", which ends in a question mark and is therefore a sentence.
   */
  "site.verify": {
    LABEL: [
      "title", "enterTitle", "codeLabel", "submit", "signatureH", "signedBy", "onBehalf", "method", "signingWindow", "reason", "signedAt", "network", "device", "asSigned", "changed", "issuer", "code", "contentHash", "howTitle", "close", "identityH", "integrityH", "traceH", "revokedReasonLabel", "langSwitch",
    ],
    PROSE: [
      "lead", "testEnvTitle", "testEnvBody", "enterLead", "checking", "notFoundTitle", "notFoundBody", "revokedTitle", "revokedBody", "amendedTitle", "amendedBody", "validTitle", "internal", "external", "asSignedNote", "noSummary", "howLink", "identityB", "integrityB", "traceB", "privacy",
    ],
  },
  "site.footer": {
    LABEL: [
      "company", "services", "clients", "legal", "powered", "about", "contact",
      "portfolio", "careers", "track", "portal", "quote", "privacy", "terms",
      "newsletterCta", "newsletterEmail", "social", "verify",
    ],
    PROSE: [
      "rights", "newsletter", "sending", "newsletterOk", "newsletterLimited",
      "newsletterErr", "socialOn", "credentials", "legalEntity",
    ],
  },
  "site.hero": {
    LABEL: [
      "eyebrow", "title", "titleMain", "titleAccent", "cta", "cta2", "scrollCue",
    ],
    PROSE: [
      "sub",
    ],
  },
  "site.how": {
    LABEL: [
      "eyebrow", "title", "steps.*.t",
    ],
    PROSE: [
      "sub", "steps.*.d",
    ],
  },
  "site.insights": {
    LABEL: [
      "kicker", "title", "titleMain", "titleAccent", "filterLabel", "kindLabel",
      "kindAll", "kindArticle", "kindAnnouncement", "all", "pagination", "previous",
      "next", "pageOf", "none", "noneForTag", "showAll", "by", "backToIndex", "gone",
      "gallery",
    ],
    PROSE: [
      "sub", "loading", "loadingArticle", "noneHint", "noneForTagHint", "goneHint",
      "otherLanguageOnly",
    ],
  },
  "site.nav": {
    LABEL: [
      "about", "services", "track", "portfolio", "insights", "careers", "contact",
      "servicesAll", "servicesMore",
    ],
    PROSE: [
      "servicesToggle", "servicesPitch",
    ],
  },
  "site.notFound": {
    LABEL: [
      "kicker", "title", "home",
    ],
    PROSE: [
      "hint",
    ],
  },
  "site.portalBand": {
    LABEL: [
      "eyebrow", "title", "cta",
    ],
    PROSE: [
      "sub", "invited",
    ],
  },
  "site.portfolioPage": {
    LABEL: [
      "title", "titleMain", "titleAccent", "unavailable", "back", "summary",
      "execution", "results", "client",
    ],
    PROSE: [
      "sub", "empty",
    ],
  },
  "site.preview": {
    LABEL: [
      "status", "stages.*.label",
    ],
    PROSE: [
      "reference", "stages.*.state",
    ],
  },
  "site.proof": {
    LABEL: [
      "eyebrow", "title", "more", "lanes", "stripLabel",
    ],
    PROSE: [
      "sub", "empty", "lanesSub", "files",
    ],
  },
  "site.proposals": {
    LABEL: [
      "title", "client", "route", "lines", "download", "print",
    ],
    PROSE: [
      "expireNote", "unavailable", "unavailableHint",
    ],
  },
  "site.quote": {
    LABEL: [
      "title", "kicker", "titleMain", "titleAccent", "whatHappens", "bandCta",
      "bandTrack", "name", "company", "email", "phone", "service", "servicePick",
      "origin", "destination", "incoterm", "incotermPick", "cargo", "stepsLabel",
      "stepNeed", "stepRoute", "stepStorage", "stepDetails", "stepContact", "next",
      "mode", "modeSEA", "modeAIR", "modeROAD", "modeMore", "modeRAIL",
      "modeCUSTOMS", "stepCounter", "originPort", "destinationPort", "originAirport",
      "destinationAirport", "originPlace", "destinationPlace", "placeSuggestions",
      "warehouseLocation", "warehouseDuration", "durationPick",
      "durationLESS_THAN_7_DAYS", "durationDAYS_7_TO_14", "durationDAYS_15_TO_30",
      "durationOVER_30_DAYS", "durationUNKNOWN", "weight", "projectCargo",
      "attachment", "fileRemove", "notes", "submit", "steps.*.t", "modeSTORAGE",
      "stepDocuments",
    ],
    PROSE: [
      "sub", "bandLead", "servicePlaceholder", "originPlaceholder",
      "destinationPlaceholder", "cargoHint", "stepHint_need", "stepHint_route",
      "stepHint_details", "stepHint_contact", "modeSEAHint", "modeAIRHint",
      "modeROADHint", "modeRAILHint", "modeCUSTOMSHint", "placeHint", "incotermHint",
      "warehousePlaceholder", "weightHint", "projectCargoHint", "attachmentHint",
      "fileType", "fileTooLarge", "fileUnreadable", "notesHint", "errMode",
      "errService", "errOrigin", "errDestination", "errIncoterm", "errWarehouse",
      "errName", "errEmail", "sending", "sent", "reference", "err", "limited",
      "privacy", "requiredNote", "steps.*.d", "modeSTORAGEHint",
      "stepHint_documents",
    ],
  },
  "site.quoteSteps": {
    LABEL: [
      "transport", "otherServices", "flow", "flowIMPORT", "flowEXPORT",
      "flowEND_TO_END", "flowINLAND", "flowHINTERLAND", "hinterland",
      "hinterlandINTO", "hinterlandOUT_OF", "incotermNotSure", "docsKind",
      "docCOMMERCIAL_INVOICE", "docPROFORMA", "docPACKING_LIST", "docBL_AWB",
      "docCARGO_PHOTOS", "docOTHER", "docRecommended", "docsAdd", "docsAddAs",
    ],
    PROSE: [
      "otherServicesHint", "hinterlandINTOHint", "hinterlandOUT_OFHint", "errFlow",
      "errHinterland", "docsWhy", "docsRequired", "docsOptional", "docsWas",
      "docsPreparing", "docsSending", "docsComplete", "docsRemove", "docsTooBig",
      "docsTooMany", "docsTotalTooBig", "docsUnreadable", "errDocs",
    ],
  },
  "site.services": {
    LABEL: [
      "eyebrow", "title", "more", "all", "items.*.t",
    ],
    PROSE: [
      "sub", "items.*.d",
    ],
  },
  "site.servicesPage": {
    LABEL: [
      "title", "titleMain", "titleAccent", "coverage", "highlights", "faq", "related",
      "gallery", "updated", "cta", "back", "video", "onThisPage", "readMore",
      "readLess",
    ],
    PROSE: [
      "sub", "empty", "unavailable", "noLong",
    ],
  },
  "site.track": {
    LABEL: [
      "kicker", "title", "label", "submit", "reference", "current",
    ],
    PROSE: [
      "placeholder", "busy", "hint", "notFound", "empty", "notFoundHint", "limited",
      "limitedHint",
    ],
  },
  "site.trackPage": {
    LABEL: [
      "title", "titleMain", "titleAccent", "progress", "current", "timeline",
      "origin", "destination", "openPortal", "service", "lastUpdate", "noStages",
      "searchAgain", "theAnswer", "verdictOpened", "verdictMoving", "verdictDone",
      "scheduled", "noMatch", "askDesk", "tooMany", "failedTitle",
    ],
    PROSE: [
      "sub", "ofStages", "needAccount", "lastUpdateNone", "closed", "noStagesHint",
      "loading", "noSchedule", "whereRef", "notFoundNotLost",
    ],
  },
};

/** `site.quote.steps.2.t` → `["site.quote", "steps.*.t"]`; `portal.offline` → `["portal", "offline"]`. */
function split(key) {
  const parts = String(key).replace(/\.\d+(?=\.|$)/g, ".*").split(".");
  return parts.length > 2
    ? [parts.slice(0, 2).join("."), parts.slice(2).join(".")]
    : [parts[0], parts.slice(1).join(".")];
}

/** LABEL, PROSE, or null when this file does not classify the key. */
function classify(key) {
  const [section, rel] = split(key);
  const entry = CASES[section];
  if (entry === LABEL || entry === PROSE) return entry;
  if (!entry) return null;
  if (entry.LABEL.includes(rel)) return LABEL;
  if (entry.PROSE.includes(rel)) return PROSE;
  return null;
}

/** Every explicit entry, as a full key with `*` for an array index — for the stale-entry check. */
function explicitKeys() {
  const out = [];
  for (const [section, entry] of Object.entries(CASES)) {
    if (typeof entry === "string") continue;
    for (const kind of [LABEL, PROSE]) for (const rel of entry[kind]) out.push({ key: `${section}.${rel}`, kind, section });
  }
  return out;
}

module.exports = { CASES, LABEL, PROSE, split, classify, explicitKeys };
