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
    verificationStatus: "draft",
    reviewedAt: "19 de agosto de 2026",
    sections: [
      {
        heading: "Responsable y contacto",
        body: <p>{CONTACT.legalName} (NIF {CONTACT.taxId}), con domicilio en {CONTACT.address}. El canal mostrado para consultas es <a href={"mailto:" + CONTACT.email}>{CONTACT.email}</a>; debe confirmarse documentalmente como canal de ejercicio de derechos antes de publicar esta política como definitiva.</p>,
      },
      {
        heading: "Datos y finalidades previstas",
        body: <p>El sistema está diseñado para tratar los datos facilitados en formularios o reservas y los datos técnicos mínimos necesarios para entregar recursos, responder consultas y gestionar reuniones. La medición opcional solo se activa tras aceptación expresa y usa identificadores seudónimos.</p>,
      },
      {
        heading: "Comunicaciones y exclusiones",
        body: <p>Las comunicaciones sobre servicios propios similares deben respetar bajas, oposiciones, rebotes permanentes, supresiones y duplicados. Cada comunicación debe identificar al remitente y ofrecer una baja sencilla.</p>,
      },
      {
        heading: "Información pendiente de validación",
        body: <p>Antes de publicar una versión definitiva deben aprobarse las bases jurídicas por finalidad, los plazos de conservación, el inventario efectivo de encargados y transferencias, el procedimiento de derechos y la existencia o no de un delegado de protección de datos.</p>,
      },
      {
        heading: "Decisiones automatizadas",
        body: <p>La autoevaluación y el lead scoring sirven para orientación y priorización interna. No producen por sí solos efectos jurídicos ni sustituyen una revisión humana.</p>,
      },
    ],
  },
  cookies: {
    title: "Política de cookies",
    verificationStatus: "draft",
    reviewedAt: "19 de agosto de 2026",
    sections: [
      {
        heading: "Almacenamiento necesario",
        body: <p>El sitio puede utilizar almacenamiento estrictamente necesario para recordar preferencias y mantener funciones solicitadas.</p>,
      },
      {
        heading: "Analítica opcional",
        body: <p>La analítica opcional solo debe activarse después de aceptar. Rechazar no impide usar las herramientas ni enviar formularios. Retirar el consentimiento detiene la emisión de nuevos eventos opcionales.</p>,
      },
      {
        heading: "Cambiar la preferencia",
        body: <p>Puedes borrar las preferencias desde el navegador o usar el control de consentimiento del sitio. Al rechazar, se eliminan los identificadores analíticos guardados por esta landing.</p>,
      },
      {
        heading: "Inventario pendiente de validación",
        body: <p>Antes de publicar una versión definitiva debe verificarse en el dominio desplegado el inventario de cookies y almacenamiento, indicando para cada elemento responsable, finalidad, tipo y duración.</p>,
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
            {isVerified ? "Contenido contrastado con fuentes públicas" : "Versión operativa no definitiva"} · Revisión: {page.reviewedAt}.
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
