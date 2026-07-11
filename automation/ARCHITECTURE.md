# Campaign Architecture

```text
Excel master (private, immutable)
  -> Google Sheets operational copy
  -> Make Data Store lock + Outlook 365 delivery
  -> Data Brain signed operations endpoint
  -> HubSpot contact, company, stage and deal updates

Landing with cid
  -> Data Brain campaign events endpoint
  -> Campaign dashboard and funnel metrics
```

Ownership is deliberately separated:

- Excel: original campaign specification and recovery source.
- Google Sheets: visible execution queue for Make.
- Make + Outlook: sends, reply monitoring, bounce handling and sequence stops.
- HubSpot: commercial CRM and sales process.
- Data Brain/Supabase: attribution, audit trail, scoring, dashboard and AI summaries.

The four campaign variants are Checklist, Calculadora, Webinar and Revision rapida. The diagnosis/Calendly flow is the shared conversion, not a fifth lead magnet.

`cid` equals the external `contact_id`. It is an opaque campaign identifier, never an email address, and is accepted only after the contact has been imported into Data Brain.
