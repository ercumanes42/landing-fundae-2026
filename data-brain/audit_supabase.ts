import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vftwranrgvbtqfiwtqjz.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function audit() {
  console.log("=== SUPABASE AUDIT ===\n");

  const { data: leads, error: leadsErr } = await sb.from("leads").select("*").order("created_at", { ascending: false }).limit(200);
  if (leadsErr) { console.log("LEADS ERROR:", leadsErr.message); return; }

  console.log("LEADS: " + leads.length + " rows");
  console.log("  Columns:", leads[0] ? Object.keys(leads[0]).join(", ") : "none");
  const magnets = [...new Set(leads.map((l) => l.lead_magnet))];
  const cls = [...new Set(leads.map((l) => l.lead_classification))];
  const dels = [...new Set(leads.map((l) => l.delivery_status))];
  console.log("  lead_magnet values:", magnets.join(", "));
  console.log("  lead_classification values:", cls.join(", "));
  console.log("  delivery_status values:", dels.join(", "));
  const hasAnonPayload = leads.filter((l) => l.payload?.anonymous_id).length;
  const hasAnonCol = leads.filter((l) => l.anonymous_id).length;
  console.log("  anonymous_id in payload: " + hasAnonPayload + "/" + leads.length);
  console.log("  anonymous_id as column: " + hasAnonCol + "/" + leads.length);
  if (leads[0]) {
    const l = leads[0];
    console.log("\n  Sample lead payload keys:", l.payload ? Object.keys(l.payload).join(", ") : "NULL");
    if (l.payload?.contact) console.log("  contact:", JSON.stringify(l.payload.contact));
    if (l.payload?.company) console.log("  company:", JSON.stringify(l.payload.company));
    if (l.payload?.tracking_context) console.log("  tracking_context:", JSON.stringify(l.payload.tracking_context));
  }

  const { data: events, error: eventsErr } = await sb.from("events").select("*").order("occurred_at", { ascending: false }).limit(500);
  if (eventsErr) { console.log("\nEVENTS ERROR:", eventsErr.message); return; }

  console.log("\nEVENTS: " + events.length + " rows");
  console.log("  Columns:", events[0] ? Object.keys(events[0]).join(", ") : "none");

  const eventCounts = {};
  events.forEach((e) => { eventCounts[e.event_name] = (eventCounts[e.event_name] || 0) + 1; });
  console.log("\n  Event types:");
  Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => console.log("    " + name + ": " + count));

  const hasAnon = events.filter((e) => e.anonymous_id).length;
  const hasProps = events.filter((e) => e.properties && Object.keys(e.properties).length > 0).length;
  console.log("\n  anonymous_id present: " + hasAnon + "/" + events.length);
  console.log("  properties present: " + hasProps + "/" + events.length);

  const pdf = events.filter((e) => e.event_name === "pdf_download" || e.event_name === "pdf_downloaded");
  const cal = events.filter((e) => ["calendly_click","calendly_redirect","calendly_booked"].includes(e.event_name));
  const vid = events.filter((e) => e.event_name === "video_play");
  const qa = events.filter((e) => e.event_name === "checklist_question_answered");
  const qc = events.filter((e) => e.event_name === "checklist_interactive_completed");

  console.log("\n  --- CRITICAL TELEMETRY ---");
  console.log("  pdf_download/pdf_downloaded: " + pdf.length);
  console.log("  calendly events: " + cal.length);
  console.log("  video_play: " + vid.length);
  console.log("  checklist_question_answered: " + qa.length);
  console.log("  checklist_interactive_completed: " + qc.length);

  if (qa.length > 0) {
    const withTime = qa.filter((e) => e.properties?.time_spent_seconds !== undefined).length;
    console.log("\n  checklist_answered with time_spent_seconds: " + withTime + "/" + qa.length);
    console.log("  Sample qa properties:", JSON.stringify(qa[0]?.properties, null, 2));
  }
  if (pdf.length > 0) console.log("\n  Sample pdf event:", pdf[0]?.event_name, JSON.stringify(pdf[0]?.properties));
  if (cal.length > 0) console.log("  Sample calendly event:", cal[0]?.event_name, JSON.stringify(cal[0]?.properties));

  const leadAnonIds = new Set(leads.map((l) => l.payload?.anonymous_id || l.anonymous_id).filter(Boolean));
  const eventAnonIds = new Set(events.map((e) => e.anonymous_id).filter(Boolean));
  const matched = [...leadAnonIds].filter((id) => eventAnonIds.has(id));
  console.log("\n  --- anonymous_id JOIN HEALTH ---");
  console.log("  Unique anon IDs in leads: " + leadAnonIds.size);
  console.log("  Unique anon IDs in events: " + eventAnonIds.size);
  console.log("  Leads with matching events: " + matched.length + " / " + leadAnonIds.size);
  if (matched.length === 0) console.log("  WARNING: ZERO matches! Per-lead timeline won'\''t work.");
}
audit().catch(console.error);
