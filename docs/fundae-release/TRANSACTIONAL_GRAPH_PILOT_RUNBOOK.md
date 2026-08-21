# Transactional Graph 4/4 pilot

Status: implemented and locally tested. Live execution remains OFF and has not
been authorized or run.

## Purpose

The pilot proves the four transactional resources through the canonical Graph
path: calculator, interactive_checklist, checklist and webinar.

The legacy Make-Outlook send command is superseded and fails closed. Make may
schedule the canonical internal HTTP endpoint later, but it is not an email
sender or state authority.

## Safety contract

- Dry-run is the default command and cannot mutate outbound controls.
- Live requires --live, TRANSACTIONAL_GRAPH_PILOT_LIVE_ENABLED=true, the exact
  confirmation SEND_4_INTERNAL_TRANSACTIONAL_EMAILS_WITH_GRAPH_V1, a fresh
  authorization UUID, an explicit run_id UUID, one allowlisted internal
  lead_id, and four unique submission IDs.
- SQL binds the exact four submissions, four resources, one lead identity,
  run_id, one-shot authorization nonce hash, approval evidence hash and TTL
  (120-900 seconds).
- The sender cannot mint its own authorization. A postgres operator registers
  a private grant from a separately approved, hash-only grant request. The
  service_role cannot read, insert or execute that grant boundary.
- Preview never returns a consumable authorization token. Start consumes the
  exact grant atomically; replay, expiry, actor/scope/lead/run/TTL mismatch and
  concurrent reuse fail closed before any lane becomes active.
- While the pilot scope is active, claim, reserve and just-in-time send
  authorization reject any dispatch outside that cohort.
- Every non-confirmed result stops the sequence. Ambiguity halts the lane.
- Every RPC has an abortable deadline. SIGINT/SIGTERM attempt an independent
  bounded emergency halt. finally calls the scoped finish RPC; if that fails
  it calls the emergency halt RPC.
- Supabase Cron runs the private watchdog every minute. An expired scope,
  orphaned pilot control or control mismatch closes the run and sets master,
  transactional and cold controls OFF even if the CLI process died.
- The ledger returns hashes only. It proves four unique dispatches,
  reservations and ImmutableIds plus confirmed Sent Items evidence.

## Input

Pass JSON by stdin. Do not place recipient addresses, secrets or tokens in the
command line. Required fields are schema_version, run_id, authorization_id and
four resource/submission_id objects. Live additionally requires the exact
confirmation field described above.

Dry-run command:

    npm.cmd --prefix data-brain run pilot:graph:dry-run

Prepare the hash-only grant request from the same stdin document:

    npm.cmd --prefix data-brain run pilot:graph:grant-request

That command performs no network or database work and never echoes the
authorization UUID. A postgres operator, outside the sender CLI, must bind its
run_id, actor_hash, authorization_nonce_hash, allowed_lead_id, submission_ids,
max_ttl_seconds and expires_at to an independently recorded
approval_evidence_hash by calling:

    fundae_private.register_transactional_graph_pilot_grant(...)

The function is deliberately unavailable to service_role and returns no raw
authorization token. The input document containing authorization_id must be
handled as a short-lived secret and must not be committed or logged.

Immediately before live, the local preflight requires the complete Graph
configuration, TRANSACTIONAL_PILOT_MODE=true, master+transactional application
switches true, cold/provisioning/legacy switches false, and valid mailbox,
worker, capability and identity bindings. Database controls still start OFF
and are enabled only inside the atomic start transaction.

For a separately authorized live run, use pilot:graph:live. Do not execute that
command until OAuth, Exchange Application RBAC, mailbox identity, staging
postcheck, alert receiver and direct user authorization are all evidenced.

## Required evidence

- Dry-run returns status=validated, resources=4, outbound_off=true.
- Live returns status=confirmed_sent, confirmed=4, outbound_off=true.
- Four ledger entries contain only resource and SHA-256 evidence fields.
- Database postcheck confirms all outbound controls OFF and no active pilot.
- Database postcheck confirms the one-shot grant ACL, consumed binding and the
  exact active Supabase Cron watchdog job.
- OAuth/RBAC, mailbox binding and Sent Items evidence are retained separately
  without recipient PII.
