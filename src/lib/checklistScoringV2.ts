export interface ChecklistOption {
  text: string;
  points: number;
}

export interface ChecklistQuestion {
  id: string;
  question: string;
  options: ChecklistOption[];
  isIntro?: boolean;
  recommendations?: Record<string, string>;
}

export const introQuestion: ChecklistQuestion = {
  id: "company_size",
  isIntro: true,
  question: "¿Cuál fue aproximadamente la plantilla media de tu empresa el año pasado?",
  options: [
    { text: "1-5", points: 0 },
    { text: "6-9", points: 0 },
    { text: "10-49", points: 0 },
    { text: "50-249", points: 0 },
    { text: "+249", points: 0 },
    { text: "No lo sé", points: 0 },
  ],
};

export const checklistQuestions: ChecklistQuestion[] = [
  {
    id: "credit_visibility",
    question: "¿Habéis consultado el crédito de formación asignado para este ejercicio?",
    options: [
      { text: "Sí, lo hemos consultado", points: 0 },
      { text: "No todavía", points: 2 },
      { text: "No lo sé", points: 2 },
    ],
    recommendations: {
      "No todavía": "Comprueba el crédito asignado antes de comprometer una acción formativa.",
      "No lo sé": "Comprueba el crédito asignado antes de comprometer una acción formativa.",
    },
  },
  {
    id: "training_fit",
    question: "¿La formación prevista responde a una necesidad real de la empresa y tendrá al menos 2 horas?",
    options: [
      { text: "Sí, está definida", points: 0 },
      { text: "Tenemos una idea general", points: 1 },
      { text: "No o no lo sé", points: 2 },
    ],
    recommendations: {
      "Tenemos una idea general": "Define el objetivo, las personas participantes y una acción formativa concreta antes de programarla.",
      "No o no lo sé": "Define el objetivo, las personas participantes y una acción formativa concreta antes de programarla.",
    },
  },
  {
    id: "planning_process",
    question: "Antes de iniciar una formación, ¿revisáis los plazos de comunicación y los pasos necesarios?",
    options: [
      { text: "Sí, antes de programarla", points: 0 },
      { text: "A veces con poco margen", points: 1 },
      { text: "No tenemos un proceso claro", points: 2 },
    ],
    recommendations: {
      "A veces con poco margen": "Planifica la formación con antelación para revisar comunicaciones, costes y participantes.",
      "No tenemos un proceso claro": "Planifica la formación con antelación para revisar comunicaciones, costes y participantes.",
    },
  },
  {
    id: "rlpt_process",
    question: "Si existe RLPT en la empresa, ¿recibe la información de la formación antes de empezar?",
    options: [
      { text: "No existe RLPT", points: 0 },
      { text: "Sí, se informa antes de iniciar", points: 0 },
      { text: "Existe, pero no lo tengo claro", points: 2 },
      { text: "No sé si existe", points: 2 },
    ],
    recommendations: {
      "Existe, pero no lo tengo claro": "Confirma si hay RLPT y, si existe, valida la información previa y el plazo correspondiente.",
      "No sé si existe": "Confirma si hay RLPT y, si existe, valida la información previa y el plazo correspondiente.",
    },
  },
  {
    id: "evidence_tracking",
    question: "¿Podéis acreditar la asistencia o actividad de las personas participantes?",
    options: [
      { text: "Sí, con un control definido", points: 0 },
      { text: "Solo en algunos cursos", points: 1 },
      { text: "No o no lo sé", points: 2 },
    ],
    recommendations: {
      "Solo en algunos cursos": "Unifica el control de asistencia presencial o la trazabilidad de actividad en teleformación.",
      "No o no lo sé": "Unifica el control de asistencia presencial o la trazabilidad de actividad en teleformación.",
    },
  },
  {
    id: "documentation_control",
    question: "¿Conserváis la documentación, costes y registro contable de la formación durante el plazo exigible?",
    options: [
      { text: "Sí, con un sistema claro", points: 0 },
      { text: "Parcialmente", points: 1 },
      { text: "No o no lo sé", points: 2 },
    ],
    recommendations: {
      "Parcialmente": "Crea un expediente por acción con evidencias, costes y registros contables para conservarlo durante cuatro años.",
      "No o no lo sé": "Crea un expediente por acción con evidencias, costes y registros contables para conservarlo durante cuatro años.",
    },
  },
  {
    id: "cofinancing",
    question: "Si tenéis más de 5 personas, ¿revisáis la cofinanciación privada necesaria?",
    options: [
      { text: "No aplica: 1-5 personas", points: 0 },
      { text: "Sí, la revisamos", points: 0 },
      { text: "No o no lo sé", points: 2 },
    ],
    recommendations: {
      "No o no lo sé": "Verifica la cofinanciación privada aplicable antes de practicar bonificaciones.",
    },
  },
  {
    id: "review_timing",
    question: "¿Cuándo os gustaría revisar vuestro caso?",
    options: [
      { text: "Esta semana", points: 0 },
      { text: "En los próximos 3 meses", points: 0 },
      { text: "Solo estoy explorando", points: 0 },
    ],
  },
];

export const CHECKLIST_MAX_SCORE = 14;

export interface ChecklistResultLevel {
  level: "low" | "medium" | "high";
  title: string;
  text: string;
  color: string;
}

export function calculateChecklistScore(answers: Record<string, string>): number {
  const allQuestions = [introQuestion, ...checklistQuestions];

  return allQuestions.reduce((score, question) => {
    const selected = question.options.find((option) => option.text === answers[question.id]);
    return score + (selected?.points ?? 0);
  }, 0);
}

export function getChecklistResultLevel(score: number): ChecklistResultLevel {
  if (score <= 3) {
    return {
      level: "low",
      title: "Tienes una base operativa razonable",
      text: "Tus respuestas apuntan a que ya existe una base de control. Esta autoevaluación no valida el crédito ni sustituye la revisión de los requisitos de cada acción formativa.",
      color: "emerald",
    };
  }

  if (score <= 8) {
    return {
      level: "medium",
      title: "Hay varios puntos que conviene revisar",
      text: "Antes de bonificar una formación, conviene ordenar la consulta de crédito, la planificación y las evidencias para reducir incertidumbre operativa.",
      color: "amber",
    };
  }

  return {
    level: "high",
    title: "Conviene validar algunos requisitos antes de bonificar",
    text: "Tus respuestas señalan varios aspectos a revisar. No implica un incumplimiento: indica que es prudente validar el caso antes de aplicar una bonificación.",
    color: "rose",
  };
}

export function getChecklistRecommendations(answers: Record<string, string>): string[] {
  const recommendations: string[] = [];

  for (const question of checklistQuestions) {
    const recommendation = question.recommendations?.[answers[question.id]];
    if (recommendation && !recommendations.includes(recommendation)) {
      recommendations.push(recommendation);
    }

    if (recommendations.length === 3) break;
  }

  return recommendations;
}

export function getChecklistEmployeeRange(answers: Record<string, string>): string | undefined {
  const value = answers.company_size;
  return ["1-5", "6-9", "10-49", "50-249", "+249"].includes(value)
    ? value
    : undefined;
}

export function getChecklistUrgency(answers: Record<string, string>): string | undefined {
  const value = answers.review_timing;
  if (value === "Esta semana") return "Lo antes posible";
  if (value === "En los próximos 3 meses") return "Menos de 3 meses";
  return undefined;
}
