import * as React from "react";

export type LegalPageKind = "aviso-legal" | "privacidad" | "cookies";

const CONTACT = {
  legalName: "Gestión de Formación y Selección, S.L.",
  taxId: "B13306428",
  brand: "GFS Consulting Group",
  address: "Paseo de la Castellana, 141, 28046 Madrid",
  phone: "+34 902 120 567",
  email: "administracion@gfs.es",
  registry: "Registro Mercantil de Madrid, tomo 30.635, folio 159, sección 8, hoja M-551314",
};

type LegalPageDefinition = {
  title: string;
  verificationStatus: "verified" | "draft";
  reviewedAt: string;
  sections: Array<{ heading: string; body: React.ReactNode }>;
};

const CONTENT: Record<LegalPageKind, LegalPageDefinition> = {
  "aviso-legal": {
    title: "Aviso legal",
    verificationStatus: "verified",
    reviewedAt: "19 de agosto de 2026",
    sections: [
      {
        heading: "Titular del sitio",
        body: (
          <>
            <p><strong>Razón social:</strong> {CONTACT.legalName}</p>
            <p><strong>Nombre comercial:</strong> {CONTACT.brand}</p>
            <p><strong>NIF:</strong> {CONTACT.taxId}</p>
            <p><strong>Domicilio:</strong> {CONTACT.address}</p>
            <p><strong>Teléfono:</strong> {CONTACT.phone}</p>
            <p><strong>Contacto:</strong> <a href={"mailto:" + CONTACT.email}>{CONTACT.email}</a></p>
          </>
        ),
      },
      {
        heading: "Datos registrales",
        body: (
          <>
            <p>{CONTACT.registry}.</p>
            <p className="text-sm text-slate-500">
              Los datos registrales proceden de actos publicados en el BORME. Esta comprobación pública no sustituye una certificación registral vigente.
            </p>
          </>
        ),
      },
      {
        heading: "Alcance",
        body: <p>Este sitio ofrece información y herramientas orientativas sobre formación programada por las empresas. GFS Consulting Group no es FUNDAE ni actúa como organismo público.</p>,
      },
      {
        heading: "Responsabilidad",
        body: <p>Las estimaciones y autoevaluaciones son orientativas. No sustituyen la consulta del expediente, la aplicación oficial, los datos de TGSS ni una revisión profesional adaptada al caso.</p>,
      },
      {
        heading: "Propiedad intelectual",
        body: <p>Los contenidos y recursos propios no pueden reutilizarse con fines comerciales sin autorización. Las marcas y enlaces de terceros pertenecen a sus titulares.</p>,
      },
    ],
  },
  privacidad: {
    title: "Política de privacidad",
    verificationStatus: "verified",
    reviewedAt: "20 de agosto de 2026",
    sections: [
      {
        heading: "Responsable y canal de privacidad",
        body: <p>{CONTACT.legalName} (NIF {CONTACT.taxId}), con domicilio en {CONTACT.address}, es responsable del tratamiento. Puedes contactar y ejercer tus derechos en <a href={"mailto:" + CONTACT.email}>{CONTACT.email}</a>. No se ha designado un delegado de protección de datos para estos tratamientos.</p>,
      },
      {
        heading: "Datos, procedencia y finalidades",
        body: <><p>Tratamos los datos que facilitas en formularios o reservas —identificación, contacto, cargo, empresa, respuestas e interés— para entregar el recurso solicitado, responder consultas, gestionar webinars o reuniones y prestar seguimiento comercial relacionado.</p><p>Con consentimiento analítico tratamos eventos de navegación, atribución e identificadores seudónimos. Para campañas a clientes previos usamos exclusivamente datos obtenidos lícitamente de la relación profesional y registramos bajas, oposiciones y rebotes para impedir nuevos envíos.</p></>,
      },
      {
        heading: "Legitimación",
        body: <><p>La entrega de recursos, respuesta a consultas y gestión de reuniones se basa en tu solicitud y en medidas precontractuales. La analítica opcional se basa en tu consentimiento, que puedes retirar sin afectar al uso de la web.</p><p>El seguimiento comercial se basa en el consentimiento cuando sea exigible o, para clientes previos y servicios propios similares, en el interés legítimo y la excepción del artículo 21.2 LSSI. Puedes oponerte siempre, gratuitamente y desde cada mensaje. La seguridad, prevención de abuso, auditoría y defensa de reclamaciones se basan en obligaciones legales y en el interés legítimo del responsable.</p></>,
      },
      {
        heading: "Conservación",
        body: <ul className="list-disc space-y-1 pl-5"><li>Solicitudes sin contratación: hasta 12 meses desde la última interacción.</li><li>Clientes y documentación contractual: durante la relación y los plazos legales aplicables; con carácter general, 6 años para documentación mercantil y 4 años para obligaciones tributarias.</li><li>Evidencia de entrega, comunicaciones y CRM: hasta 24 meses desde la última interacción, salvo relación vigente o reclamación.</li><li>Eventos analíticos seudónimos: 90 días; los agregados irreversiblemente anónimos pueden conservarse sin ese límite.</li><li>Logs de seguridad y operación: hasta 12 meses.</li><li>Solicitudes de derechos: hasta 3 años desde su cierre.</li><li>Supresiones y bajas: el mínimo necesario para respetarlas y evitar recontacto; se revisan cada 5 años.</li></ul>,
      },
      {
        heading: "Destinatarios y proveedores",
        body: <p>Pueden acceder a los datos, bajo contrato y solo para prestar el servicio, proveedores de alojamiento y base de datos (Vercel y Supabase), correo (Microsoft 365), CRM (HubSpot), reservas (Calendly), analítica consentida (PostHog) y apoyo de IA (OpenAI, únicamente con una proyección minimizada). Make puede actuar como orquestador técnico cuando se habilite. No vendemos datos. Si un proveedor trata datos fuera del Espacio Económico Europeo, exigimos una decisión de adecuación o garantías apropiadas, como las cláusulas contractuales tipo de la Comisión Europea.</p>,
      },
      {
        heading: "Derechos",
        body: <p>Puedes solicitar acceso, rectificación, supresión, oposición, limitación y portabilidad, o retirar un consentimiento, escribiendo a <a href={"mailto:" + CONTACT.email}>{CONTACT.email}</a>. Solo pediremos información adicional para verificar tu identidad cuando exista una duda razonable. También puedes reclamar ante la <a href="https://www.aepd.es" rel="noreferrer">Agencia Española de Protección de Datos</a>.</p>,
      },
      {
        heading: "Decisiones automatizadas",
        body: <p>La autoevaluación, el scoring y los resúmenes asistidos por IA sirven para orientación y priorización interna. No adoptamos decisiones exclusivamente automatizadas que produzcan efectos jurídicos o similares; existe revisión humana.</p>,
      },
      {
        heading: "Seguridad y cambios",
        body: <p>Aplicamos minimización, control de acceso, seudonimización, cifrado en tránsito, trazabilidad y mecanismos de baja. Actualizaremos esta política cuando cambien las finalidades, proveedores o normas y solicitaremos una nueva decisión cuando el cambio afecte al consentimiento.</p>,
      },
    ],
  },
  cookies: {
    title: "Política de cookies",
    verificationStatus: "verified",
    reviewedAt: "20 de agosto de 2026",
    sections: [
      {
        heading: "Qué utiliza esta landing",
        body: <p>Esta versión no instala cookies publicitarias. Utiliza almacenamiento del navegador para recordar tu preferencia y, solo si aceptas, medir de forma seudónima el uso de la landing. Rechazar no bloquea formularios, recursos ni reuniones.</p>,
      },
      {
        heading: "Inventario",
        body: <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="pr-4">Elemento</th><th className="pr-4">Finalidad</th><th>Duración</th></tr></thead><tbody><tr><td className="pr-4"><code>fundae_analytics_consent_v1</code></td><td className="pr-4">Recordar aceptar o rechazar</td><td>24 meses o hasta cambio de política</td></tr><tr><td className="pr-4"><code>fundae_journey_v2</code></td><td className="pr-4">Journey analítico seudónimo</td><td>30 días renovables</td></tr><tr><td className="pr-4"><code>fundae_session_v2</code></td><td className="pr-4">Agrupar eventos de una sesión</td><td>Sesión; rota tras 30 minutos de inactividad</td></tr><tr><td className="pr-4"><code>fundae_first_touch_v2</code> / <code>fundae_last_touch_v2</code></td><td className="pr-4">Atribución de origen</td><td>Hasta retirar el consentimiento o cambiar la política</td></tr><tr><td className="pr-4"><code>fundae_campaign_context_v1</code></td><td className="pr-4">Conservar contexto de campaña</td><td>Sesión</td></tr></tbody></table></div>,
      },
      {
        heading: "Analítica opcional",
        body: <p>Si aceptas, podemos enviar eventos minimizados a PostHog alojado en la UE o al sistema analítico propio. No enviamos el contenido libre de formularios a la analítica. La landing no carga Google Analytics ni LinkedIn Insight en esta versión. Al seguir un enlace a Calendly, ese tercero aplicará su propia política en su dominio.</p>,
      },
      {
        heading: "Aceptar, rechazar o retirar",
        body: <p>Puedes aceptar o rechazar con opciones equivalentes. El control permanente “Preferencias de privacidad” permite cambiar la decisión en cualquier momento. Al rechazar o retirar el consentimiento se detienen nuevos eventos opcionales y se eliminan los identificadores analíticos de esta landing. También puedes borrar el almacenamiento desde la configuración del navegador.</p>,
      },
      {
        heading: "Responsable y actualización",
        body: <p>El responsable es {CONTACT.legalName}. La preferencia se renovará como máximo cada 24 meses y antes si cambian las finalidades o proveedores. Para consultas escribe a <a href={"mailto:" + CONTACT.email}>{CONTACT.email}</a>.</p>,
      },
    ],
  },
};

export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const page = CONTENT[kind];
  const isVerified = page.verificationStatus === "verified";

  return (
    <main className="bg-slate-50 py-16 sm:py-20">
      <article className="container mx-auto max-w-3xl px-4 sm:px-6">
        <a href="/" className="font-semibold text-[#302B7B] underline">Volver a la landing</a>
        <div className="mt-6 border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <p className="text-sm font-bold uppercase tracking-wide text-[#FF206E]">GFS Consulting Group</p>
          <h1 className="mt-2 text-3xl font-bold text-[#302B7B] sm:text-4xl">{page.title}</h1>
          <p className="mt-3 text-sm text-slate-500">
            {isVerified ? "Versión vigente" : "Versión operativa no definitiva"} · Revisión: {page.reviewedAt}.
          </p>
          <div className="mt-10 space-y-8">
            {page.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-xl font-bold text-slate-950">{section.heading}</h2>
                <div className="mt-3 space-y-2 leading-7 text-slate-700">{section.body}</div>
              </section>
            ))}
          </div>
        </div>
      </article>
    </main>
  );
}
