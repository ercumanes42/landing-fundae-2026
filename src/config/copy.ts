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
      'Estima el crédito formativo de tu empresa y revisa los puntos necesarios para gestionarlo con criterio. Calculadora, checklist, autoevaluación y webinar.',
  },

  // ── Header ──────────────────────────────────────────────────────────
  header: {
    brand: 'FUNDAE',
    nav: [
      { label: 'Inicio', href: '#inicio' },
      { label: 'Calculadora', href: '#calculadora' },
      { label: 'Checklist', href: '#checklist' },
      { label: 'Webinar', href: '#webinar' },
      { label: 'FAQ', href: '#faq' },
    ],
    cta: 'Ver herramientas',
  },

  // ── Hero ─────────────────────────────────────────────────────────────
  hero: {
    badge: 'Formación bonificada FUNDAE',
    headline: 'Aclara qué crédito formativo podría corresponder a tu empresa',
    subheadline:
      'Calcula una referencia, detecta puntos pendientes y decide el siguiente paso con información comprensible y fuentes oficiales.',
    primaryCta: 'Empezar la autoevaluación',
    secondaryCta: 'Ver herramientas',
    stats: [
      { value: '420 €', label: 'Crédito mínimo 1-5' },
      { value: '5', label: 'Tramos de plantilla' },
      { value: '< 2 min', label: 'Para el test' },
    ],
  },

  // ── Stats section ───────────────────────────────────────────────────
  stats: {
    sectionTitle: 'Tres referencias para orientarte',
    items: [
      {
        value: '420 €',
        label: 'Crédito mínimo 1-5',
        description: 'Referencia publicada por FUNDAE para empresas de 1 a 5 personas.',
      },
      {
        value: '4',
        label: 'Tramos superiores',
        description: 'La estimación aplica 100%, 75%, 60% o 50% sobre la cuota de FP.',
      },
      {
        value: '< 2 min',
        label: 'Resultado rápido',
        description: 'Puedes obtener una orientación inicial sin facilitar datos personales.',
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
          'Obtén una referencia comprensible usando tu plantilla y, si la conoces, la cuota de Formación Profesional.',
        cta: 'Calcular ahora',
        href: '#calculadora',
      },
      {
        title: 'Checklist gratuito',
        description:
          'Descarga diez controles prácticos para revisar antes de comunicar o bonificar formación.',
        cta: 'Descargar checklist',
        href: '#checklist',
      },
      {
        title: 'Webinar informativo',
        description:
          'Aprende en 45 minutos cómo funciona FUNDAE y cómo activar tu crédito.',
        cta: 'Reservar plaza',
        href: '#webinar',
      },
      {
        title: 'Autoevaluación FUNDAE',
        description:
          'Responde unas preguntas y recibe el nivel y las prioridades sin facilitar datos personales.',
        cta: 'Empezar autoevaluación',
        href: '#interactive-checklist',
      },
    ],
  },

  // ── Calculator section ──────────────────────────────────────────────
  calculator: {
    badge: 'Herramienta gratuita',
    title: '¿Cuánto crédito FUNDAE podría tener tu empresa?',
    subtitle:
      'Responde unas preguntas rápidas y recibe una estimación orientativa del crédito anual. No calcula el saldo disponible.',
    steps: [
      { number: 1, label: 'Tu empresa' },
      { number: 2, label: 'Formación' },
      { number: 3, label: 'Datos de contacto' },
    ],
    labels: {
      employeeRange: '¿Cuál es el tamaño de la plantilla?',
      province: '¿En qué provincia está tu empresa?',
      sector: '¿Cuál es tu sector de actividad?',
      usedFundae: '¿Habéis utilizado FUNDAE antes?',
      knowsCredit: '¿Conoces tu crédito disponible?',
      trainingArea: '¿En qué área te interesa formar a tu equipo?',
      name: 'Nombre completo',
      company: 'Nombre de la empresa',
      email: 'Correo profesional',
      phone: 'Teléfono (opcional)',
      privacy: 'He leído la política de privacidad',
    },
    cta: 'Ver mi estimación',
    resultTitle: 'Estimación anual orientativa',
    resultDisclaimer:
      'Esta es una estimación orientativa. Contrasta el crédito y el saldo disponibles en la aplicación oficial y con los datos de TGSS.',
  },

  // ── Checklist section ───────────────────────────────────────────────
  checklist: {
    badge: 'Recurso gratuito',
    title: 'Checklist gratuito: 10 errores que pueden hacerte perder tu crédito FUNDAE',
    subtitle:
      'Revisa diez puntos habituales de gestión y contrástalos con tu expediente.',
    bullets: [
      'Los 10 errores más frecuentes al gestionar FUNDAE',
      'Qué evidencias y controles conviene revisar',
      'Plantilla de planificación descargable',
      'Fuentes oficiales y límites de la orientación',
    ],
    labels: {
      name: 'Nombre',
      email: 'Correo profesional',
      company: 'Empresa',
      privacy: 'He leído la política de privacidad',
    },
    cta: 'Descargar checklist',
    successTitle: 'Solicitud registrada',
    successMessage:
      'El recurso está disponible para descarga. El correo solo se mostrará como enviado cuando esté confirmado.',
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
      'Sesión de preguntas y respuestas en directo',
    ],
    labels: {
      name: 'Nombre',
      email: 'Correo profesional',
      company: 'Empresa',
      phone: 'Teléfono (opcional)',
      privacy: 'He leído la política de privacidad',
    },
    cta: 'Reservar mi plaza',
    successTitle: 'Solicitud de plaza registrada',
    successMessage:
      'La confirmación y el enlace solo se mostrarán como enviados cuando el sistema lo verifique.',
  },

  // ── Diagnostic section ──────────────────────────────────────────────
  diagnostic: {
    badge: 'Sin compromiso',
    title: 'Diagnóstico FUNDAE gratuito',
    subtitle:
      'Un especialista revisará tu caso y te ayudará a validar el crédito con los datos oficiales disponibles antes de utilizarlo.',
    bullets: [
      'Revisión inicial de los datos disponibles y puntos pendientes',
      'Plan de formación personalizado',
      'Asesoramiento sobre la gestión de la bonificación',
      'Sin compromiso ni coste',
    ],
    labels: {
      name: 'Nombre completo',
      email: 'Correo profesional',
      company: 'Empresa',
      phone: 'Teléfono',
      role: 'Cargo / Puesto',
      employeeRange: 'Tamaño de la plantilla',
      sector: 'Sector',
      trainingArea: 'Área de formación de interés',
      urgency: '¿Para cuándo necesitas la formación?',
      message: 'Cuéntanos más sobre tu caso (opcional)',
      privacy: 'He leído la política de privacidad',
      marketing: 'Acepto recibir comunicaciones comerciales',
    },
    cta: 'Reservar diagnóstico',
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
        title: 'Te ayudamos a ordenar la gestión',
        description:
          'Revisamos contigo documentación, plazos y próximos pasos. El alcance se acuerda antes de contratar.',
      },
      {
        number: 4,
        title: 'Aplica la bonificación que proceda',
        description:
          'La bonificación efectiva depende del crédito, los costes y los requisitos aplicables a cada acción.',
      },
    ],
  },

  // ── Reasons / Benefits ──────────────────────────────────────────────
  reasons: {
    sectionTitle: '¿Por qué actuar ahora?',
    items: [
      {
        title: 'El crédito se gestiona por ejercicio',
        description:
          'Las empresas de menos de 50 personas pueden reservar crédito no dispuesto para los dos ejercicios siguientes si cumplen el procedimiento aplicable.',
      },
      {
        title: 'Control documental y trazabilidad',
        description:
          'Ordenamos datos, comunicaciones, costes y evidencias para reducir incidencias, sin prometer un resultado que depende del expediente real.',
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
    subtitle: 'Formación vinculada a necesidades reales y sujeta al crédito, costes y requisitos aplicables.',
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
          'No. Estima el crédito anual con los datos que facilites, pero no accede a la aplicación de FUNDAE ni conoce el crédito utilizado o reservado. El crédito y el saldo oficiales deben validarse con la información de TGSS y del expediente.',
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
    title: '¿Quieres revisar el crédito formativo de tu empresa?',
    subtitle:
      'Reserva un diagnóstico gratuito para contrastar tu situación con los datos oficiales disponibles.',
    primaryCta: 'Reservar diagnóstico',
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
    invalidEmail: 'Introduce un correo válido',
    invalidPhone: 'Introduce un teléfono válido',
    privacyRequired: 'Debes confirmar que has leído la política de privacidad',
    genericError:
      'Ha ocurrido un error. Inténtalo de nuevo o contacta con nosotros.',
    submitting: 'Enviando…',
    retrying: 'Reintentando…',
  },
} as const;

export type CopyKeys = typeof copy;
