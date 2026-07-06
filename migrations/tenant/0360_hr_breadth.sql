-- ============================================================================
-- TENANT DB — 0360 HR breadth (MOD-11,12,13,16,18,19). Attendance/leave/payroll
-- already exist in 0330; this fills vacancies, contracts, appraisals, SOPs,
-- onboarding, trainings, talent/succession.
-- ============================================================================

-- MOD-11 Vacancies + public applicants ---------------------------------------
CREATE TABLE vacancy (
  vacancy_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  department       text,
  description      text,
  ai_generated     boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('DRAFT','OPEN','CLOSED')),
  posted_to_website boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_applicant (
  applicant_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id       uuid REFERENCES vacancy(vacancy_id) ON DELETE CASCADE,
  full_name        text NOT NULL, email citext, phone text,
  cv_vault_id      uuid REFERENCES document_vault(doc_id),
  answers_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','SHORTLISTED','INTERVIEWED','HIRED','REJECTED','TALENT_POOL')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-12 Legal contracts (offer/contract/confirmation/termination) -----------
CREATE TABLE hr_contract (
  hr_contract_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid REFERENCES employee(employee_id),
  kind             text NOT NULL CHECK (kind IN ('OFFER_LETTER','EMPLOYMENT','CONFIRMATION','TERMINATION')),
  effective_on     date,
  end_on           date,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','SIGNED','ENDED')),
  pdf_vault_id     uuid REFERENCES document_vault(doc_id),
  approved_by      uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-13 KPI appraisals ------------------------------------------------------
CREATE TABLE kpi_target (
  kpi_target_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid REFERENCES employee(employee_id),
  set_by           uuid REFERENCES app_user(user_id),   -- line manager
  period_code      text NOT NULL,                    -- '2026-01'
  metric           text NOT NULL,
  target_value     numeric(18,4),
  weight           numeric(5,2),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE appraisal (
  appraisal_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_target_id    uuid REFERENCES kpi_target(kpi_target_id) ON DELETE CASCADE,
  employee_id      uuid REFERENCES employee(employee_id),
  period_code      text NOT NULL,
  actual_value     numeric(18,4),
  rating           numeric(5,2),
  comments         text,
  rated_by         uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- MOD-16 SOPs & onboarding ---------------------------------------------------
CREATE TABLE sop_document (
  sop_document_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  category         text,
  vault_id         uuid REFERENCES document_vault(doc_id),
  version_no       integer NOT NULL DEFAULT 1,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE onboarding_checklist (
  onboarding_checklist_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid REFERENCES employee(employee_id),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE onboarding_item (
  onboarding_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_checklist_id uuid NOT NULL REFERENCES onboarding_checklist(onboarding_checklist_id) ON DELETE CASCADE,
  label            text NOT NULL,
  is_done          boolean NOT NULL DEFAULT false,
  done_at          timestamptz
);

-- MOD-18 Trainings -----------------------------------------------------------
CREATE TABLE training (
  training_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  scheduled_on     date,
  facilitator      text,
  status           text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','DONE','CANCELLED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE training_attendance (
  training_attendance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id      uuid NOT NULL REFERENCES training(training_id) ON DELETE CASCADE,
  employee_id      uuid REFERENCES employee(employee_id),
  attended         boolean NOT NULL DEFAULT false,
  certificate_vault_id uuid REFERENCES document_vault(doc_id)
);

-- MOD-19 Talent pool & succession -------------------------------------------
CREATE TABLE talent_pool (
  talent_pool_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id     uuid REFERENCES job_applicant(applicant_id),
  full_name        text NOT NULL,
  skills           text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE succession_plan (
  succession_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_title       text NOT NULL,
  incumbent_id     uuid REFERENCES employee(employee_id),
  successor_id     uuid REFERENCES employee(employee_id),
  readiness        text,                             -- 'ready_now' | '1_2_years' ...
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
