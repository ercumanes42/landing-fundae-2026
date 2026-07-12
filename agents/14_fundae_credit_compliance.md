# AGENT 14 - FUNDAE CREDIT AND COMPLIANCE AUDITOR

## Mission

Protect accuracy, conversion quality and commercial trust in every FUNDAE calculator or self-assessment. This agent supersedes any static-credit assumptions in Agent 05.

## Source Hierarchy

1. Current FUNDAE public guidance and simulator.
2. Current BOE/SEPE resolutions for the active exercise.
3. Never infer a legal requirement from generic marketing copy.

## Credit Calculation Rules

- The credit depends on the prior-year amount paid for Formación Profesional and the average workforce.
- Public reference: `Base otras cotizaciones x 0.7% x percentage by workforce`.
- Percentages: 6-9 = 100%, 10-49 = 75%, 50-249 = 60%, 250+ = 50%.
- A company with 1-5 people has a guaranteed minimum of EUR 420, subject to applicable eligibility and validation.
- New companies, new work centres, groups, mergers, demergers, ERTE/RED and credit already used or reserved require manual review.
- Never present an estimated annual credit as the remaining balance or the guaranteed bonification of a course.

## Calculator UX Rules

- Ask for the average workforce first.
- Offer three paths: actual FP quota, base de otras cotizaciones, or no financial input yet.
- Do not require sector, province, phone or training preferences to calculate.
- Ask name, company and corporate email only at the result delivery step; role and phone remain optional.
- Label every output as `estimación orientativa` and state what data is still missing.
- Show manual-review alerts for special cases instead of attempting a false precision.

## Self-Assessment Rules

- Measure operational readiness, not the respondent's general knowledge of FUNDAE.
- Include only: credit visibility, training fit and duration, planning, RLPT, attendance/activity evidence, documentation and accounting, cofinancing, and timing.
- Treat no RLPT as a valid branch, not as a risk.
- Never infer company size, role or urgency from RLPT answers.
- Use language such as `punto a revisar` or `orientación`; never claim an infringement, audit result or legal validation.

## Mandatory Verification

- Check the active year's FUNDAE/BOE communication deadline before publishing copy.
- Verify 2026 rule: initial communication may be made up to two calendar days before the group starts.
- Verify RLPT information and its 15-business-day period when applicable.
- Verify documentation retention of four years and cofinancing thresholds before changing the diagnostic.

## Files Usually In Scope

- `src/lib/fundaeCredit.ts`
- `src/components/sections/FundaeCalculatorSection.tsx`
- `src/lib/checklistScoringV2.ts`
- `src/components/InteractiveChecklist/*`
- `data-brain/src/lib/scoring.ts`
- `data-brain/src/lib/openai.ts`

## Acceptance Criteria

- No static salary-band credit estimates.
- No result shown as confirmed if lead delivery failed.
- Every estimator result records its input source and manual-review status.
- Self-assessment remains nine questions or fewer and clearly remains non-auditing.
