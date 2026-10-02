# Tenant review of 1 Oct 2026 ("meeting 7")

Meeting 7 with SMART Logistics & Services, the first and only tenant. Agenda, in Tom's words at
00:00:02: *"today we'll be reviewing service types and VAT … and tax and jurisdictions actually.
So we are about getting the client online."*

| File | What it is |
| --- | --- |
| [register.md](register.md) | Every finding, verified against the code with file:line evidence, plus the owner's decisions and what was built for each. The source of truth for this PR and for its QC. |

Unlike meeting 6 — four findings-to-PR files, four sessions — everything here landed in **one
PR**, on branch `ccr-71fa323f-4dfn5w`. The findings are not independent: the milestone-owner
registry, the two names on a row and the full-width dialog are one screen; the account mapping and
the payroll rates are the same `tax_code` table read by two different engines. Splitting them
would have meant three PRs touching the same two files.

## Reading it

- **§0** is the transcription key. The Gemini transcript renders *Autre* as "ultra", *modal* as
  "model", *feasibility* as "visibility" and *IRPP* as "IRP" — worth having in front of you before
  quoting it.
- **§1 is "do not build".** The tax rates, the IRPP barème and the mobile bar were all checked and
  are all correct; two of them *sound* wrong in the transcript.
- **§3** is the findings, four raised in the meeting and four found while verifying them. 3.7 is
  the one worth reading first: the payroll engine did not read the rate table being demonstrated.
- **§4** records the eight owner decisions, which are final.
- **§5** maps each finding to the code and names the gates added.
