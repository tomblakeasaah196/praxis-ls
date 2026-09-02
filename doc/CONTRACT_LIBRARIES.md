# Contract clause libraries — what they say, on whose authority, and what is not settled

**Status: TEMPLATES, NOT LEGAL ADVICE.** Everything here is drafted against
**Loi n° 92/007 du 14 août 1992 portant Code du Travail** de la République du
Cameroun, and against the practice evidenced by the tenant's own signed
contracts. None of it has been settled by counsel. This document is the review
log: it lists every clause beside the provision it implements, so a licensed
Cameroonian lawyer can read the two together and sign off, clause by clause,
rather than having to reconstruct the intent from the code.

It takes the same posture `doc/OHADA_KB.md` takes with tax rates. **[VERIFY]**
marks a clause whose scope or figure must be confirmed before it is relied on.

---

## Why there are eighteen files and not one with conditions

A CDD is not a CDI with a date on it. The Code caps its term and its renewals
(art. 25), converts it to a CDI if the work continues past the term (art. 26),
and gives an early termination a damages regime a CDI has no concept of
(art. 37). A *stage* is not a contract of employment at all. Expressing those
as flags on a shared body would make the conditional logic the thing counsel
has to audit — and counsel reads contracts, not code.

So each library is **one document, readable end to end, in one language**.
Nine keys × two languages = eighteen files, in
`src/services/contracts/libraries/`. What is shared between them is the token
vocabulary and the composer, never the clause text.

## One language per contract. Never side by side.

A contract is signed in a language. A bilingual instrument raises
which-version-governs the first time the two columns are read differently, and
that question is worth more in a dispute than the convenience is worth on the
day it is printed. `hr_contract.language` records the choice, and the renderer
takes it from the record rather than from the operator's print-time toggle.

## What is fixed and what a model may touch

The clause text is authored. A model is given ONE clause — the one a library
marks `aiEditable`, in practice the duties clause — with its placeholders
intact, and asked to rephrase it for the particular job. What comes back is
checked before it is accepted: the same placeholders, the same figures, no
heading, a plausible length. Anything else is discarded and the authored clause
stands. **A model never writes a term and never sees a salary, a date or a
national identity number.**

## The mechanisms a reviewer needs to know

| Mechanism | What it does |
| --- | --- |
| `basis` | The provision the article implements. Every article has one; `check:contract-libraries` fails the build on an article without. |
| `requires` | Optional facts THIS document cannot do without — a fixed term with no term is not a fixed-term contract. |
| `omitWhenMissing` | The only way a clause may disappear. Art. 28 makes probation a stipulation, so an engagement with none agreed has no probation article — and the omission is recorded, never silent. |
| `aiEditable` | The leash. False everywhere except the duties clause. |

Anything else that is missing **refuses**: generation stops and names every
absent fact at once. A contract with a blank where a legal identification
belongs is worse than no contract.

---

## The libraries — revision `2026-09-CM-1`

Sign-off column is for the reviewer. Leave it empty until a named lawyer has
read the clause and the provision beside it.

### CDI

*CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE* — *CONTRACT OF EMPLOYMENT OF INDEFINITE DURATION*

12 articles · laid out as `articles`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| 1 | ENGAGEMENT ET DURÉE | ENGAGEMENT AND DURATION | Code du Travail, art. 23 (formation du contrat) et art. 28 (engagement à l'essai) | |
| 2 | PÉRIODE D'ESSAI | PROBATIONARY PERIOD | Code du Travail, art. 28 — l'engagement à l'essai est stipulé par écrit ; sa durée, renouvellement compris, ne peut excéder six (06) mois<br>*dropped when `term.probation_months` is absent* | |
| 3 | FONCTIONS ET ATTRIBUTIONS | DUTIES AND RESPONSIBILITIES | Code du Travail, art. 23 — la nature de l'emploi est un élément essentiel du contrat<br>*AI may rephrase* | |
| 4 | RÉMUNÉRATION | REMUNERATION | Code du Travail, art. 61 à 68 (salaire) ; art. 62 — le salaire ne peut être inférieur au SMIG | |
| 5 | LIEU DE TRAVAIL ET MOBILITÉ | PLACE OF WORK AND MOBILITY | Code du Travail, art. 23 — le lieu d'exécution est un élément du contrat | |
| 6 | HORAIRES DE TRAVAIL | HOURS OF WORK | Code du Travail, art. 80 — durée légale hebdomadaire de quarante (40) heures dans les établissements non agricoles | |
| 7 | OBLIGATIONS PROFESSIONNELLES ET ÉTHIQUE | PROFESSIONAL OBLIGATIONS AND CONDUCT | Code du Travail, art. 23 et art. 39 (faute lourde) ; règlement intérieur, art. 29 | |
| 8 | CONFIDENTIALITÉ ET NON-CONCURRENCE | CONFIDENTIALITY AND NON-COMPETITION | Code du Travail, art. 23 ; obligation de loyauté. [VERIFY] La portée d'une clause de non-concurrence post-contractuelle doit être limitée dans le temps, l'espace et l'objet — à faire valider par le conseil du tenant. | |
| 9 | USAGE DES OUTILS INFORMATIQUES ET D'INTERNET | USE OF IT SYSTEMS AND THE INTERNET | Règlement intérieur ; protection des données à caractère personnel — Loi n° 2010/012 du 21 décembre 2010 relative à la cybersécurité et à la cybercriminalité | |
| 10 | PROTECTION SOCIALE ET CONGÉS | SOCIAL PROTECTION AND LEAVE | Code du Travail, art. 89 — congé payé à raison d'un jour et demi ouvrable par mois de service effectif ; affiliation CNPS (Loi n° 69/LF/18 du 10 novembre 1969) | |
| 11 | RUPTURE DU CONTRAT | TERMINATION OF THE CONTRACT | Code du Travail, art. 34 (préavis), art. 36 (indemnité de licenciement), art. 39 (faute lourde) et art. 40 (motif économique) | |
| 12 | RÈGLEMENT DES DIFFÉRENDS | SETTLEMENT OF DISPUTES | Code du Travail, art. 130 et suivants — règlement des différends individuels du travail ; tentative de conciliation devant l'inspecteur du travail préalable à la saisine du tribunal | |

### CDD

*CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE* — *FIXED-TERM CONTRACT OF EMPLOYMENT*

12 articles · laid out as `articles` · requires `term.end_date`, `term.duration_months`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| 1 | ENGAGEMENT, TERME ET RENOUVELLEMENT | ENGAGEMENT, TERM AND RENEWAL | Code du Travail, art. 25 — le CDD ne peut être conclu pour une durée supérieure à deux (02) ans, renouvelable une seule fois ; art. 26 — la poursuite de la relation au-delà du terme emporte requalification en contrat à durée indéterminée ; art. 28 — engagement à l'essai | |
| 2 | PÉRIODE D'ESSAI | PROBATIONARY PERIOD | Code du Travail, art. 28 — l'engagement à l'essai est stipulé par écrit ; sa durée, renouvellement compris, ne peut excéder six (06) mois<br>*dropped when `term.probation_months` is absent* | |
| 3 | FONCTIONS ET ATTRIBUTIONS | DUTIES AND RESPONSIBILITIES | Code du Travail, art. 23 — la nature de l'emploi est un élément essentiel du contrat<br>*AI may rephrase* | |
| 4 | RÉMUNÉRATION | REMUNERATION | Code du Travail, art. 61 à 68 (salaire) ; art. 62 — le salaire ne peut être inférieur au SMIG | |
| 5 | LIEU DE TRAVAIL | PLACE OF WORK | Code du Travail, art. 23 — le lieu d'exécution est un élément du contrat | |
| 6 | HORAIRES DE TRAVAIL | HOURS OF WORK | Code du Travail, art. 80 — durée légale hebdomadaire de quarante (40) heures dans les établissements non agricoles | |
| 7 | OBLIGATIONS PROFESSIONNELLES | PROFESSIONAL OBLIGATIONS | Code du Travail, art. 23 et art. 39 (faute lourde) ; règlement intérieur, art. 29 | |
| 8 | CONFIDENTIALITÉ | CONFIDENTIALITY | Code du Travail, art. 23 ; obligation de loyauté | |
| 9 | PROTECTION SOCIALE ET CONGÉS | SOCIAL PROTECTION AND LEAVE | Code du Travail, art. 89 — congé payé à raison d'un jour et demi ouvrable par mois de service effectif ; affiliation CNPS (Loi n° 69/LF/18 du 10 novembre 1969) | |
| 10 | RUPTURE ANTICIPÉE | EARLY TERMINATION | Code du Travail, art. 37 — la rupture anticipée d'un CDD en dehors de la faute lourde ou de la force majeure ouvre droit à des dommages-intérêts correspondant aux salaires restant dus jusqu'au terme. [VERIFY] Le montant exact et son plafonnement sont à confirmer par le conseil du tenant. | |
| 11 | EXPIRATION DU CONTRAT | EXPIRY OF THE CONTRACT | Code du Travail, art. 25 et 26 — expiration de plein droit au terme ; requalification en CDI en cas de poursuite de la relation | |
| 12 | RÈGLEMENT DES DIFFÉRENDS | SETTLEMENT OF DISPUTES | Code du Travail, art. 130 et suivants — tentative de conciliation devant l'inspecteur du travail préalable à la saisine du tribunal | |

### STAGE

*CONVENTION DE STAGE* — *INTERNSHIP AGREEMENT*

9 articles · laid out as `articles` · requires `term.end_date`, `term.duration_months`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| 1 | OBJET ET NATURE DE LA CONVENTION | PURPOSE AND NATURE OF THIS AGREEMENT | Code du Travail, art. 23 a contrario — la présente convention a pour objet une formation pratique et ne constitue pas un contrat de travail. [VERIFY] Seuil de requalification à confirmer. | |
| 2 | DURÉE ET LIEU DU STAGE | DURATION AND PLACE OF THE INTERNSHIP | [VERIFY] Durée maximale du stage à confirmer selon le texte réglementaire applicable et, le cas échéant, la convention collective de branche. | |
| 3 | PROGRAMME DE FORMATION | TRAINING PROGRAMME | Objet de la convention — la formation pratique est la contrepartie de la présence du/de la stagiaire<br>*AI may rephrase* | |
| 4 | GRATIFICATION | TRAINING ALLOWANCE | [VERIFY] La gratification de stage n'est pas un salaire. Son caractère obligatoire, son montant minimal et son régime social au Cameroun sont à confirmer par le conseil du tenant. | |
| 5 | OBLIGATIONS DU/DE LA STAGIAIRE | THE INTERN'S OBLIGATIONS | Règlement intérieur ; obligation de discrétion | |
| 6 | CONFIDENTIALITÉ ET PROPRIÉTÉ DES TRAVAUX | CONFIDENTIALITY AND OWNERSHIP OF WORK | Obligation de discrétion ; dévolution des travaux réalisés dans le cadre du stage | |
| 7 | COUVERTURE DES ACCIDENTS | ACCIDENT COVER | [VERIFY] La couverture du stagiaire au titre des accidents survenus pendant le stage — affiliation CNPS ou assurance privée — est à confirmer selon la situation du/de la stagiaire. | |
| 8 | FIN ET RUPTURE DU STAGE | END AND EARLY TERMINATION | Liberté contractuelle ; la convention prend fin de plein droit à son terme | |
| 9 | RÈGLEMENT DES DIFFÉRENDS | SETTLEMENT OF DISPUTES | Règlement amiable ; compétence du tribunal du ressort | |

### INTERIM

*CONTRAT DE TRAVAIL INTÉRIMAIRE* — *TEMPORARY REPLACEMENT CONTRACT OF EMPLOYMENT*

8 articles · laid out as `articles` · requires `term.end_date`, `term.duration_months`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| 1 | OBJET, ENGAGEMENT ET TERME | PURPOSE, ENGAGEMENT AND TERM | Code du Travail, art. 25(4) — contrat conclu pour une tâche temporaire ; art. 26 — requalification en CDI si la relation se poursuit au-delà du terme. [VERIFY] Durée maximale de l'intérim à confirmer. | |
| 2 | FONCTIONS | DUTIES | Code du Travail, art. 23 — la nature de l'emploi est un élément essentiel du contrat<br>*AI may rephrase* | |
| 3 | RÉMUNÉRATION | REMUNERATION | Code du Travail, art. 61 à 68 ; principe d'égalité de traitement avec le travailleur remplacé pour un travail de valeur égale | |
| 4 | LIEU ET HORAIRES DE TRAVAIL | PLACE AND HOURS OF WORK | Code du Travail, art. 23 et art. 80 — durée légale hebdomadaire de quarante (40) heures | |
| 5 | OBLIGATIONS PROFESSIONNELLES | PROFESSIONAL OBLIGATIONS | Code du Travail, art. 23 et art. 39 ; règlement intérieur | |
| 6 | PROTECTION SOCIALE ET CONGÉS | SOCIAL PROTECTION AND LEAVE | Code du Travail, art. 89 — congé payé à raison d'un jour et demi ouvrable par mois de service effectif ; affiliation CNPS | |
| 7 | FIN DE LA MISSION | END OF THE ASSIGNMENT | Code du Travail, art. 25(4) et art. 37 — la mission prend fin à son terme ; rupture anticipée en dehors de la faute lourde ou de la force majeure | |
| 8 | RÈGLEMENT DES DIFFÉRENDS | SETTLEMENT OF DISPUTES | Code du Travail, art. 130 et suivants | |

### CONSULTANT

*CONTRAT DE PRESTATION DE SERVICES* — *CONTRACT FOR THE PROVISION OF SERVICES*

9 articles · laid out as `articles` · requires `term.end_date`, `term.duration_months`, `term.notice_days`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| 1 | OBJET ET QUALIFICATION DU CONTRAT | PURPOSE AND CHARACTERISATION | Code du Travail, art. 23 a contrario — l'absence de lien de subordination exclut la qualification de contrat de travail. Acte uniforme OHADA relatif au droit commercial général pour la qualité de commerçant/prestataire indépendant. | |
| 2 | ÉTENDUE DE LA MISSION | SCOPE OF THE ASSIGNMENT | Liberté contractuelle ; l'objet défini de la mission est ce qui distingue la prestation de l'emploi<br>*AI may rephrase* | |
| 3 | DURÉE | DURATION | Liberté contractuelle ; durée déterminée par l'objet de la mission | |
| 4 | HONORAIRES ET MODALITÉS DE PAIEMENT | FEES AND PAYMENT | Prestation de services : rémunération sur facture, non soumise au régime du salaire. [VERIFY] Retenue à la source applicable aux prestataires (précompte / acompte) à confirmer selon le CGI en vigueur — voir doc/OHADA_KB.md §17. | |
| 5 | INDÉPENDANCE ET ABSENCE D'EXCLUSIVITÉ | INDEPENDENCE AND ABSENCE OF EXCLUSIVITY | Critère de la subordination ; l'absence d'exclusivité et la liberté d'organisation écartent la qualification de contrat de travail | |
| 6 | CONFIDENTIALITÉ ET PROPRIÉTÉ INTELLECTUELLE | CONFIDENTIALITY AND INTELLECTUAL PROPERTY | Obligation de confidentialité contractuelle ; dévolution des droits sur les livrables. [VERIFY] La cession des droits d'auteur doit être expresse et détaillée — à valider par le conseil du tenant. | |
| 7 | RESPONSABILITÉ ET ASSURANCE | LIABILITY AND INSURANCE | Responsabilité contractuelle de droit commun du prestataire | |
| 8 | RÉSILIATION | TERMINATION | Liberté contractuelle ; résiliation moyennant préavis, sans indemnité de licenciement — laquelle n'existe pas hors contrat de travail | |
| 9 | RÈGLEMENT DES DIFFÉRENDS | SETTLEMENT OF DISPUTES | Compétence de droit commun — le contentieux d'une prestation de services ne relève pas de l'Inspection du Travail | |

### TEMPORARY

*CONTRAT DE TRAVAIL OCCASIONNEL OU SAISONNIER* — *OCCASIONAL OR SEASONAL CONTRACT OF EMPLOYMENT*

8 articles · laid out as `articles` · requires `term.end_date`, `term.duration_months`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| 1 | OBJET, ENGAGEMENT ET TERME | PURPOSE, ENGAGEMENT AND TERM | Code du Travail, art. 25(4) — contrats occasionnel et saisonnier ; art. 26 — requalification en CDI si la relation se poursuit au-delà du terme. [VERIFY] Durées maximales à confirmer. | |
| 2 | NATURE DE LA TÂCHE | NATURE OF THE TASK | Code du Travail, art. 23 et art. 25(4) — la tâche doit être identifiée, sa nature occasionnelle étant la condition du recours<br>*AI may rephrase* | |
| 3 | RÉMUNÉRATION | REMUNERATION | Code du Travail, art. 61 à 68 ; art. 62 — le salaire ne peut être inférieur au SMIG | |
| 4 | LIEU ET HORAIRES DE TRAVAIL | PLACE AND HOURS OF WORK | Code du Travail, art. 23 et art. 80 — durée légale hebdomadaire de quarante (40) heures | |
| 5 | OBLIGATIONS PROFESSIONNELLES | PROFESSIONAL OBLIGATIONS | Code du Travail, art. 23 et art. 39 ; règlement intérieur | |
| 6 | PROTECTION SOCIALE ET CONGÉS | SOCIAL PROTECTION AND LEAVE | Code du Travail, art. 89 — congé payé à raison d'un jour et demi ouvrable par mois de service effectif ; affiliation CNPS dès le premier jour | |
| 7 | FIN DU CONTRAT | END OF THE CONTRACT | Code du Travail, art. 25(4) et art. 37 — le contrat prend fin à l'achèvement de la tâche ; rupture anticipée en dehors de la faute lourde ou de la force majeure | |
| 8 | RÈGLEMENT DES DIFFÉRENDS | SETTLEMENT OF DISPUTES | Code du Travail, art. 130 et suivants | |

### OFFER_LETTER

*OFFRE D'EMPLOI* — *OFFER OF EMPLOYMENT*

4 articles · laid out as `letter` · requires `term.offer_valid_until`, `term.probation_months`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| — | L'OFFRE | THE OFFER | Code du Travail, art. 23 — la formation du contrat suppose l'accord des parties sur l'emploi et la rémunération | |
| — | LES CONDITIONS PROPOSÉES | THE TERMS OFFERED | Code du Travail, art. 61 à 68 (salaire) et art. 80 (durée du travail) — les éléments essentiels doivent être portés à la connaissance du candidat avant l'engagement | |
| — | CE QUI RESTE À FAIRE | WHAT REMAINS TO BE DONE | Liberté contractuelle — l'offre peut être assortie de conditions ; le contrat définitif est l'instrument qui engage | |
| — | VOTRE RÉPONSE | YOUR REPLY | Formation du contrat par l'acceptation | |

### CONFIRMATION

*CONFIRMATION D'EMPLOI* — *CONFIRMATION OF EMPLOYMENT*

3 articles · laid out as `letter` · requires `term.probation_months`, `term.probation_end_date`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| — | CONFIRMATION | CONFIRMATION | Code du Travail, art. 28 — à l'expiration de la période d'essai, l'engagement devient définitif | |
| — | CE QUE CELA CHANGE | WHAT THIS CHANGES | Code du Travail, art. 28 et art. 34 — l'essai prend fin, le régime du préavis de droit commun s'applique | |
| — | *(no heading — a letter's sign-off)* | *(no heading)* | Formule de politesse — sans portée juridique propre | |

### TERMINATION

*NOTIFICATION DE RUPTURE DU CONTRAT DE TRAVAIL* — *NOTICE OF TERMINATION OF THE CONTRACT OF EMPLOYMENT*

5 articles · laid out as `letter` · requires `term.notice_days`.

| # | Clause (fr) | Clause (en) | Authority | Sign-off |
| --- | --- | --- | --- | --- |
| — | NOTIFICATION | NOTIFICATION | Code du Travail, art. 34 — la rupture doit être notifiée par écrit à l'autre partie | |
| — | MOTIF DE LA RUPTURE | GROUND FOR TERMINATION | Code du Travail, art. 34 et art. 39 — l'énonciation du motif conditionne le caractère légitime de la rupture ; l'absence de motif la rend abusive<br>*AI may rephrase* | |
| — | PRÉAVIS | NOTICE | Code du Travail, art. 34 — durée du préavis fixée selon la catégorie professionnelle et l'ancienneté ; art. 39 — la faute lourde prive du préavis | |
| — | SOLDE DE TOUT COMPTE ET DOCUMENTS | FINAL ACCOUNT AND DOCUMENTS | Code du Travail, art. 36 (indemnité de licenciement), art. 89 et 90 (indemnité compensatrice de congé payé) et art. 43 (certificat de travail) | |
| — | VOIES DE RECOURS | RIGHT OF CHALLENGE | Code du Travail, art. 130 et suivants — tentative de conciliation devant l'inspecteur du travail préalable à la saisine du tribunal | |

---

## How long they actually are

Measured, not estimated: each library composed from a real employee record and
rendered through the product's own template with the same
`page.pdf({ format: "A4" })` the PDF service uses.

| Library | Sections | A4 pages |
| --- | --- | --- |
| CDI (fr / en) | 13 | 3 |
| CDD (fr / en) | 13 | 3 |
| CONSULTANT | 10 | 3 |
| STAGE | 10 | 2 |
| INTERIM | 9 | 2 |
| TEMPORARY | 9 | 2 |
| TERMINATION | 6 | 2 |
| OFFER\_LETTER | 5 | 2 |

Three pages is the worst case, on the longest contract in the longest language,
with a probation clause and two pay lines. A clause added to CDI or CDD is
worth re-measuring — the reproduction is in the commit that added this table.

Two things bought that. The composer's articles are the whole document, so
there is no second parties block above a preamble that already names both
parties; and the closing lives in its own column rather than as a trailing
paragraph of the last clause.

---

## Open questions for counsel

Every **[VERIFY]** above, plus these, which are design decisions rather than
drafting ones:

1. **Non-competition.** The CDI carries a post-contractual restriction on
   using the employer's client information. A non-competition clause must be
   limited in time, space and subject matter to be enforceable, and the
   drafting here is deliberately narrow for that reason. Whether it is narrow
   *enough*, and whether consideration is required, is for counsel.
2. **The consultancy library.** It is written to avoid requalification as
   employment — no subordination, no imposed hours, fees on invoice. That is a
   drafting posture, not a guarantee: requalification turns on how the
   relationship is actually conducted, and no template can control that.
3. **The internship library.** It states in terms that a stage is not a
   contract of employment. The line between a genuine training placement and a
   disguised engagement is a question of fact.
4. **The termination letter** is the most exposed document here. It states the
   ground, the notice due and an enumerated final account, because art. 34 and
   art. 39 make each of those the substance of the notification. A tenant
   should not send one without advice on the particular case.
5. **The occupational category** is not yet recorded per employee, so no
   library states one. Notice periods under art. 34 are set by category and
   seniority in an implementing order, which is why the clauses refer to that
   order rather than printing a number.

## Changing a library

1. Edit the French and the English **together**. They are one document in two
   languages; the gate fails if their articles differ in key, order,
   `requires`, `aiEditable` or `omitWhenMissing`.
2. Bump `LIBRARY_VERSION` in `_shape.js`. Every contract records the revision
   it was composed from, and that is the only thing that can tell a contract
   issued in March from one issued in September.
3. Run `node scripts/check-contract-libraries.js`.
4. Add the clause and its authority to the table above.

Contracts already composed are **not** affected: `body_md`, the closing and
the signature panels are stored on the row, and the employee and pay snapshots
are frozen at composition. A revised library changes the next contract, never
one that has been issued.
