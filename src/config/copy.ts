/**
 * Centralized copy / text strings for the entire FUNDAE landing page.
 *
 * Organised by section. This makes it easy for a copy-optimization pass
 * (Agent 04) to update wording without touching component code.
 */

export const copy = {
  // ── Global / Meta ───────────────────────────────────────────────────
  meta: {
    title: 'FUNDAE para empresas — Activa tu crédito de formación',
    description:
      'Descubre cuánto crédito FUNDAE tiene tu empresa y cómo aprovecharlo al 100%. Calculadora, checklist, webinar y diagnóstico gratuitos.',
  },

  // ── Header ──────────────────────────────────────────────────────────
  header: {
    brand: 'FUNDAE',
    nav: [
      { label: 'Inicio', href: '#inicio' },
      { label: 'Calculadora', href: '#calculadora' },
      { label: 'Checklist', href: '#interactive-checklist' },
      { label: 'Webinar', href: '#webinar' },
      { label: 'FAQ', href: '#faq' },
    ],
    cta: 'Diagnóstico gratuito',
  },

  // ── Hero ─────────────────────────────────────────────────────────────
  hero: {
    badge: 'Formación bonificada FUNDAE',
    headline: 'El 79,5% de las empresas deja perder su crédito de formación cada año',
    subheadline:
      'Capacita a tu equipo utilizando sus cotizaciones de formación. Gestión profesional con 100% de garantía de cumplimiento normativo (Compliance) y tranquilidad jurídica.',
    primaryCta: 'Hacer revisión rápida',
    secondaryCta: 'Diagnóstico gratuito',
    stats: [
      { value: '79,5%', label: 'No usa su crédito' },
      { value: '420 €', label: 'Crédito mínimo/año' },
      { value: '< 2 min', label: 'Para el test' },
    ],
  },

  // ── Stats section ───────────────────────────────────────────────────
  stats: {
    sectionTitle: 'La realidad de la formación bonificada en España',
    items: [
      {
        value: '79,5%',
        label: 'No aprovecha el crédito',
        description: 'De las empresas españolas pierden su inversión anual.',
      },
      {
        value: '20,5%',
        label: 'Tasa de adopción actual',
        description: 'Solo 1 de cada 5 empresas optimiza su cotización.',
      },
      {
        value: '52%',
        label: 'Crédito ejecutado',
        description: 'La mitad del fondo nacional se queda sin asignar.',
      },
    ],
  },

  // ── Entry Doors ─────────────────────────────────────────────────────
  entryDoors: {
    sectionTitle: '¿Por dónde empezar?',
    sectionSubtitle:
      'Elige la opción que mejor se ajuste a tu situación actual.',
    doors: [
      {
        title: 'Calculadora de crédito',
        description:
          'Obtén una estimación rápida del crédito FUNDAE que podría corresponder a tu empresa.',
        cta: 'Calcular ahora',
        href: '#calculadora',
      },
      {
        title: 'Checklist gratuito',
        description:
          'Descarga los 10 errores más comunes que hacen perder el crédito a las empresas.',
        cta: 'Descargar checklist',
        href: '#interactive-checklist',
      },
      {
        title: 'Webinar informativo',
        description:
          'Aprende en 45 minutos cómo funciona FUNDAE y cómo activar tu crédito.',
        cta: 'Reservar plaza',
        href: '#webinar',
      },
      {
        title: 'Diagnóstico personalizado',
        description:
          'Agenda una sesión 1:1 con un especialista que analice tu caso concreto.',
        cta: 'Solicitar diagnóstico',
        href: '#diagnostico',
      },
    ],
  },

  // ── Calculator section ──────────────────────────────────────────────
  calculator: {
    badge: 'Herramienta gratuita',
    title: '¿Cuánto crédito FUNDAE podría tener tu empresa?',
    subtitle:
      'Responde unas preguntas rápidas y recibe una estimación orientativa de tu crédito disponible.',
    steps: [
      { number: 1, label: 'Tu empresa' },
      { number: 2, label: 'Formación' },
      { number: 3, label: 'Datos de contacto' },
    ],
    labels: {
      employeeRange: '¿Cuántos trabajadores tiene tu empresa?',
      province: '¿En qué provincia está tu empresa?',
      sector: '¿Cuál es tu sector de actividad?',
      usedFundae: '¿Habéis utilizado FUNDAE antes?',
      knowsCredit: '¿Conoces tu crédito disponible?',
      trainingArea: '¿En qué área te interesa formar a tu equipo?',
      name: 'Nombre completo',
      company: 'Nombre de la empresa',
      email: 'Email profesional',
      phone: 'Teléfono (opcional)',
      privacy: 'Acepto la política de privacidad',
    },
    cta: 'Ver mi estimación',
    resultTitle: 'Tu crédito estimado',
    resultDisclaimer:
      'Esta es una estimación orientativa. El crédito final depende de las cotizaciones reales de tu empresa. Solicita un diagnóstico gratuito para conocer el dato exacto.',
  },

  // ── Checklist section ───────────────────────────────────────────────
  checklist: {
    badge: 'Recurso gratuito',
    title: 'Checklist gratuito: 10 errores que pueden hacerte perder tu crédito FUNDAE',
    subtitle:
      'Descubre los fallos más comunes que cometen las empresas y cómo evitarlos.',
    bullets: [
      'Los 10 errores más frecuentes al gestionar FUNDAE',
      'Cómo evitar sanciones y devoluciones',
      'Plantilla de planificación descargable',
      'Guía paso a paso actualizada',
    ],
    labels: {
      name: 'Nombre',
      email: 'Email profesional',
      company: 'Empresa',
      privacy: 'Acepto la política de privacidad',
    },
    cta: 'Descargar checklist',
    successTitle: '¡Checklist enviado!',
    successMessage:
      'Revisa tu bandeja de entrada. Recibirás el PDF en los próximos minutos.',
  },

  // ── Webinar section ─────────────────────────────────────────────────
  webinar: {
    badge: 'Evento online',
    title: 'Webinar: Cómo activar tu crédito FUNDAE paso a paso',
    subtitle: 'En 45 minutos aprenderás todo lo que necesitas saber.',
    bullets: [
      'Cómo funciona el sistema de bonificaciones',
      'Requisitos y plazos clave',
      'Errores que debes evitar',
      'Sesión de preguntas y respuestas en vivo',
    ],
    labels: {
      name: 'Nombre',
      email: 'Email profesional',
      company: 'Empresa',
      phone: 'Teléfono (opcional)',
      privacy: 'Acepto la política de privacidad',
    },
    cta: 'Reservar mi plaza',
    successTitle: '¡Plaza reservada!',
    successMessage:
      'Recibirás un email con el enlace de acceso y un recordatorio antes del evento.',
  },

  // ── Diagnostic section ──────────────────────────────────────────────
  diagnostic: {
    badge: 'Sin compromiso',
    title: 'Diagnóstico personalizado gratuito',
    subtitle:
      'Un especialista analizará tu caso concreto y te dirá exactamente cuánto crédito tienes y cómo utilizarlo.',
    bullets: [
      'Revisión completa de tu crédito disponible',
      'Plan de formación personalizado',
      'Asesoramiento sobre la gestión de la bonificación',
      'Sin compromiso ni coste',
    ],
    labels: {
      name: 'Nombre completo',
      email: 'Email profesional',
      company: 'Empresa',
      phone: 'Teléfono',
      role: 'Cargo / Puesto',
      employeeRange: 'Número de trabajadores',
      sector: 'Sector',
      trainingArea: 'Área de formación de interés',
      urgency: '¿Para cuándo necesitas la formación?',
      message: 'Cuéntanos más sobre tu caso (opcional)',
      privacy: 'Acepto la política de privacidad',
      marketing: 'Acepto recibir comunicaciones comerciales',
    },
    cta: 'Solicitar diagnóstico gratuito',
    successTitle: '¡Solicitud enviada!',
    successMessage:
      'Un especialista se pondrá en contacto contigo en las próximas 24 horas laborables.',
  },

  // ── How It Works ────────────────────────────────────────────────────
  howItWorks: {
    sectionTitle: 'Así de fácil es activar tu crédito',
    steps: [
      {
        number: 1,
        title: 'Calcula tu crédito',
        description:
          'Usa nuestra calculadora para obtener una estimación en menos de 2 minutos.',
      },
      {
        number: 2,
        title: 'Elige tu formación',
        description:
          'Selecciona las áreas que más necesita tu equipo: IA, liderazgo, ventas…',
      },
      {
        number: 3,
        title: 'Nosotros gestionamos todo',
        description:
          'Nos encargamos del papeleo, la documentación y la bonificación ante FUNDAE.',
      },
      {
        number: 4,
        title: 'Tu equipo se forma gratis',
        description:
          'La formación se bonifica íntegramente en los seguros sociales.',
      },
    ],
  },

  // ── Reasons / Benefits ──────────────────────────────────────────────
  reasons: {
    sectionTitle: '¿Por qué actuar ahora?',
    items: [
      {
        title: 'El crédito es anual y no se acumula',
        description:
          'Es una partida con fecha de caducidad. Si no se inicia la formación antes del 31 de diciembre, ese derecho formativo se pierde de forma definitiva.',
      },
      {
        title: '100% Garantía de Cumplimiento (Compliance)',
        description:
          'Nuestra prioridad es la seguridad jurídica de tu empresa. Gestionamos todo el proceso cumpliendo estrictamente la normativa para darte absoluta tranquilidad legal.',
      },
      {
        title: 'Educación y claridad en la gestión',
        description:
          'Te enseñamos cómo funciona el sistema de forma transparente, sin tecnicismos ni letra pequeña, para que tomes decisiones informadas y seguras.',
      },
      {
        title: 'Un derecho que ya estás financiando',
        description:
          'No es una subvención ni un coste extra. Tu empresa ya aporta mensualmente a la formación profesional a través de sus cotizaciones obligatorias.',
      },
    ],
  },

  // ── Solutions ───────────────────────────────────────────────────────
  solutions: {
    sectionTitle: 'Áreas de formación que podemos activar',
    subtitle: 'Formación de alto impacto, bonificada al 100%.',
  },

  // ── Video section ───────────────────────────────────────────────────
  video: {
    title: 'Descubre cómo funciona FUNDAE en 3 minutos',
    subtitle:
      'Te explicamos el proceso completo de forma visual y sencilla.',
  },

  // ── FAQ ─────────────────────────────────────────────────────────────
  faq: {
    sectionTitle: 'Preguntas frecuentes',
    items: [
      {
        question: '¿FUNDAE es una subvención?',
        answer:
          'No exactamente. Es un sistema de bonificaciones ligado a las cotizaciones por formación profesional que la empresa ya realiza durante el año.',
      },
      {
        question: '¿Todas las empresas tienen crédito?',
        answer:
          'Depende de su situación, plantilla y cotizaciones. Por eso conviene revisar cada caso.',
      },
      {
        question: '¿Puedo saber el crédito exacto con la calculadora?',
        answer:
          'No. La calculadora ofrece una orientación inicial. El importe exacto debe validarse con la información oficial correspondiente.',
      },
      {
        question: '¿Qué tipo de formación puedo activar?',
        answer:
          'Formación relacionada con la actividad de la empresa: competencias digitales, liderazgo, idiomas, PRL, etc.',
      },
      {
        question: '¿Cuánto tarda el proceso?',
        answer:
          'La planificación puede empezar de inmediato. La comunicación a FUNDAE debe hacerse con al menos 7 días de antelación al inicio de la formación.',
      },
      {
        question: '¿Tiene algún coste vuestro servicio?',
        answer:
          'El diagnóstico inicial es gratuito y sin compromiso. Si decides avanzar, te presentamos opciones transparentes.',
      },
    ],
  },

  // ── Final CTA ───────────────────────────────────────────────────────
  finalCta: {
    title: '¿Listo para dejar de perder tu crédito de formación?',
    subtitle:
      'Solicita tu diagnóstico gratuito y descubre cuánto puedes recuperar este año.',
    primaryCta: 'Solicitar diagnóstico gratuito',
    secondaryCta: 'Calcular mi crédito',
  },

  // ── Footer ──────────────────────────────────────────────────────────
  footer: {
    copyright: `© ${new Date().getFullYear()} FUNDAE Landing. Todos los derechos reservados.`,
    links: [
      { label: 'Política de privacidad', href: '/privacidad' },
      { label: 'Aviso legal', href: '/aviso-legal' },
      { label: 'Cookies', href: '/cookies' },
    ],
  },

  // ── Shared form messages ────────────────────────────────────────────
  form: {
    required: 'Este campo es obligatorio',
    invalidEmail: 'Introduce un email válido',
    invalidPhone: 'Introduce un teléfono válido',
    privacyRequired: 'Debes aceptar la política de privacidad',
    genericError:
      'Ha ocurrido un error. Inténtalo de nuevo o contacta con nosotros.',
    submitting: 'Enviando…',
    retrying: 'Reintentando…',
  },
} as const;

export type CopyKeys = typeof copy;
