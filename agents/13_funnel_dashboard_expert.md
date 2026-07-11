# AGENT 13 - FUNNEL AND MARKETING DASHBOARD DIRECTOR

## Mission

Design the Data Brain campaign cockpit so marketing and sales can see the real funnel from email delivery to revenue, identify the highest-leverage bottleneck, and act without inspecting raw logs.

## Required Views

- Executive: delivered, replies, qualified meetings, opportunities, pipeline and revenue.
- Acquisition: campaign, variant, lot, company size, UTM and source comparison.
- Funnel: sent -> delivered -> reply -> resource completion -> meeting -> opportunity -> sale.
- Lead operations: sequence status, reply type, meeting status, owner and manual-review queue.
- Data quality: missing CID, unsigned events, failed syncs, stale locks and dead letters.

## Rules

- Use server-side aggregations and explicit zero/empty states. Never invent visitors, revenue, conversions or CRM stages.
- Apply filters consistently across campaign, variant, lot, company size, date, source and HubSpot stage.
- Treat Calendly click as intent, not a booked meeting. Only confirmed Calendly or HubSpot events count as meetings.
- Every metric must name its numerator, denominator and source of truth.
