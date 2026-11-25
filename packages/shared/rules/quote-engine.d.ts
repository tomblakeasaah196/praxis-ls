/** The quote engine: website service + answers → one ERP service type or desk review. See quote-engine.js. */

export type QeDirection = "IMPORT" | "EXPORT";
export type QeKnows = "YES" | "NO";
export type QeParty = "BUYER" | "SELLER";
export type QeStart = "SUPPLIER_PREMISES" | "ORIGIN_PORT" | "DESTINATION_PORT";
export type QeEnd = "ORIGIN_PORT" | "DESTINATION_PORT" | "PREMISES" | "PREMISES_DUTY_PAID";
export type QeInsured = "YES" | "NO";
export type QeSpan = "O" | "M" | "D" | "OM" | "MD" | "OMD";
export type QeOutcome = "END_TO_END" | "IMPORT" | "EXPORT" | "DESK" | "TYPE";
export type QeKind = "FREIGHT" | "CUSTOMS" | "SIMPLE";
export type QeStepId = "direction" | "knows" | "incoterm" | "party" | "start" | "end" | "insured" | "member";
export type QeIncotermSource = "PICKED" | "DERIVED" | "NOT_SURE" | "NOT_APPLICABLE";
export type QeDeskReason = "NOT_SURE" | "RULE_DESK" | "NO_RULE" | "NO_MEMBER" | "TERM_NOT_OFFERED" | "INVALID";
export type QeScopeFlag =
  | "origin_pickup"
  | "export_clearance"
  | "main_carriage"
  | "import_clearance"
  | "duties_taxes"
  | "final_delivery";
export type QeScope = Record<QeScopeFlag, boolean>;
export type QeText = { en: string; fr: string };

export type QeMember = {
  id: string;
  name?: string;
  flow?: string | null;
  incoterms?: string[] | null;
};

export type QeService = {
  id: string;
  card?: string | null;
  members: QeMember[];
};

export type QeRule = {
  website_service_id?: string | null;
  direction: string;
  span: string;
  outcome: string;
  service_type_id?: string | null;
};

export type QeAnswers = Partial<Record<QeStepId, string | null | undefined>>;

export type QeStep = {
  id: QeStepId;
  /** Codes for every step but `member`, whose options are `{ id, name }`. */
  options: string[] | { id: string; name: string }[];
  not_sure: boolean;
  answer: string | null;
};

export type QeResult = {
  kind: QeKind;
  steps: QeStep[];
  next: QeStepId | null;
  complete: boolean;
  issues: { field: string; message: string }[];
  answers: QeAnswers;
  direction: QeDirection | null;
  incoterm: string | null;
  incoterm_source: QeIncotermSource | null;
  explanation: QeText | null;
  party: QeParty | null;
  scope: QeScope | null;
  span: QeSpan | null;
  outcome: "RESOLVED" | "DESK" | null;
  reason: QeDeskReason | null;
  service_type_id: string | null;
  hinterland_direction: "INTO" | "OUT_OF" | null;
};

export const NOT_SURE: "NOT_SURE";
export const TERM_TBD: "TBD";
export const TERM_NONE: "N/A";
export const INCOTERM_CODES: ReadonlyArray<string>;
export const SEA_ONLY_CODES: ReadonlyArray<string>;
export const SEA_TERM_CARDS: ReadonlyArray<string>;
export const DIRECTIONS: ReadonlyArray<QeDirection>;
export const KNOWS: ReadonlyArray<QeKnows>;
export const PARTIES: ReadonlyArray<QeParty>;
export const INSURED: ReadonlyArray<QeInsured>;
export const STARTS: ReadonlyArray<QeStart>;
export const ENDS: ReadonlyArray<QeEnd>;
export const SELLER_STARTS: ReadonlyArray<QeStart>;
export const SCOPE_FLAGS: ReadonlyArray<QeScopeFlag>;
export const SCOPE_LABELS: Readonly<Record<QeScopeFlag, QeText>>;
export const SPANS: ReadonlyArray<QeSpan>;
export const OUTCOMES: ReadonlyArray<QeOutcome>;
export const ROUTED_FLOWS: ReadonlyArray<string>;
export const DESK_REASONS: ReadonlyArray<QeDeskReason>;
export const DEFAULT_RULES: ReadonlyArray<Required<QeRule>>;
export const BUYER_SHARE: Readonly<Record<string, ReadonlyArray<QeScopeFlag>>>;
export const SELLER_SHARE: Readonly<Record<string, ReadonlyArray<QeScopeFlag>>>;
export const C_TERMS: ReadonlyArray<string>;
export const EXPLAIN: Readonly<Record<QeParty, Readonly<Record<string, QeText>>>>;
export const EXPLAIN_TBD: QeText;

export function kindOf(service: QeService): QeKind;
export function directionsOf(service: QeService): QeDirection[];
export function incotermsOf(service: QeService): string[];
export function scopeForTerm(direction: QeDirection, term: string): { visitor: QeParty; job: QeParty; scope: QeScope };
export function scopeForRoute(party: QeParty, start: QeStart, end: QeEnd): QeScope;
export function spanOf(scope: QeScope | null | undefined): QeSpan | null;
export function evaluate(service: QeService | null | undefined, answers?: QeAnswers | null, rules?: ReadonlyArray<QeRule> | null): QeResult;
export function validateRules(
  rules: ReadonlyArray<QeRule>,
  opts?: { requireComplete?: boolean },
): { index: number | null; field: string; message: string }[];
export function validateService(
  service: QeService,
  rules?: ReadonlyArray<QeRule>,
): { code: string; message: string; member?: string; flow?: string }[];
export function describeScope(scope: QeScope | null | undefined): ({ flag: QeScopeFlag } & QeText)[];
export function enumerate(service: QeService, rules?: ReadonlyArray<QeRule>): { answers: QeAnswers; result: QeResult }[];
