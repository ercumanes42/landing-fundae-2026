export interface ChecklistOption {
  text: string;
  points: number;
}

export interface ChecklistQuestion {
  id: string;
  question: string;
  options: ChecklistOption[];
  isIntro?: boolean;
  recommendations?: Record<string, string>; // Maps option text (or index) to a recommendation string
}

export const introQuestion: ChecklistQuestion = {
  id: 'intro',
  isIntro: true,
  question: '¿Sabías que tu empresa podría disponer de un crédito anual para formar a sus trabajadores y recuperar parte de esa inversión mediante bonificaciones en los seguros sociales?',
  options: [
    { text: 'Sí, lo sabía y conozco cómo funciona.', points: 0 },
    { text: 'Había oído hablar de ello, pero no tengo claro cómo funciona.', points: 1 },
    { text: 'No, lo desconocía por completo.', points: 2 },
  ],
};

export const checklistQuestions: ChecklistQuestion[] = [
  {
    id: 'q1',
    question: '¿Sabes si tu empresa tiene crédito FUNDAE disponible?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'No', points: 2 },
      { text: 'No estoy seguro/a', points: 2 },
    ],
    recommendations: {
      'No': 'Revisar el crédito disponible antes de contratar formación.',
      'No estoy seguro/a': 'Revisar el crédito disponible antes de contratar formación.',
    },
  },
  {
    id: 'q2',
    question: '¿Tu empresa ha usado FUNDAE en los últimos 2 años?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'No', points: 2 },
      { text: 'No lo sé', points: 2 },
    ],
    recommendations: {
      'No': 'Valorar una primera activación sencilla con una acción formativa de bajo riesgo.',
      'No lo sé': 'Valorar una primera activación sencilla con una acción formativa de bajo riesgo.',
    },
  },
  {
    id: 'q3',
    question: '¿Tienes claro qué formación necesita realmente tu equipo?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'Parcialmente', points: 1 },
      { text: 'No', points: 2 },
    ],
    recommendations: {
      'No': 'Definir 2 o 3 prioridades formativas antes de elegir cursos.',
      'Parcialmente': 'Definir 2 o 3 prioridades formativas antes de elegir cursos.',
    },
  },
  {
    id: 'q4',
    question: '¿Has planificado la formación con suficiente antelación?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'No', points: 2 },
      { text: 'Estamos fuera de plazo o no lo sabemos', points: 2 },
    ],
    recommendations: {
      'No': 'Crear un calendario formativo trimestral o semestral.',
      'Estamos fuera de plazo o no lo sabemos': 'Crear un calendario formativo trimestral o semestral.',
    },
  },
  {
    id: 'q5',
    question: '¿Conoces los requisitos básicos para bonificar correctamente?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'Solo algunos', points: 1 },
      { text: 'No', points: 2 },
    ],
    recommendations: {
      'No': 'Revisar los requisitos básicos antes de iniciar la formación.',
      'Solo algunos': 'Revisar los requisitos básicos antes de iniciar la formación.',
    },
  },
  {
    id: 'q6',
    question: '¿Tienes controlada la asistencia o finalización de la formación?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'Depende del curso', points: 1 },
      { text: 'No', points: 2 },
    ],
    recommendations: {
      'No': 'Definir cómo se registrará asistencia, finalización y evidencias.',
      'Depende del curso': 'Definir cómo se registrará asistencia, finalización y evidencias.',
    },
  },
  {
    id: 'q7',
    question: '¿Sabes si tu empresa debe aportar cofinanciación privada?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'No aplica / no lo sé', points: 1 },
      { text: 'No', points: 2 },
    ],
    recommendations: {
      'No': 'Verificar el tramo de plantilla y las condiciones aplicables.',
      'No aplica / no lo sé': 'Verificar el tramo de plantilla y las condiciones aplicables.',
    },
  },
  {
    id: 'q8',
    question: '¿Tu empresa tiene Representación Legal de los Trabajadores?',
    options: [
      { text: 'No', points: 0 },
      { text: 'Sí', points: 1 },
      { text: 'No lo sé', points: 2 },
    ],
    recommendations: {
      'Sí': 'Revisar si corresponde informar previamente a la Representación Legal de los Trabajadores.',
      'No lo sé': 'Revisar si corresponde informar previamente a la Representación Legal de los Trabajadores.',
    },
  },
  {
    id: 'q9',
    question: '¿Tienes guardada toda la documentación necesaria?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'No tenemos un sistema claro', points: 1 },
      { text: 'No', points: 2 },
    ],
    recommendations: {
      'No': 'Crear una carpeta documental por acción formativa.',
      'No tenemos un sistema claro': 'Crear una carpeta documental por acción formativa.',
    },
  },
  {
    id: 'q10',
    question: '¿Tienes una estrategia para convertir el crédito en impacto real?',
    options: [
      { text: 'Sí', points: 0 },
      { text: 'Estamos empezando', points: 1 },
      { text: 'No', points: 2 },
    ],
    recommendations: {
      'No': 'Conectar el crédito FUNDAE con objetivos de productividad, IA, liderazgo o competencias digitales.',
      'Estamos empezando': 'Conectar el crédito FUNDAE con objetivos de productividad, IA, liderazgo o competencias digitales.',
    },
  },
];

export interface ChecklistResultLevel {
  level: 'low' | 'medium' | 'high';
  title: string;
  text: string;
  color: string;
}

export function calculateChecklistScore(answers: Record<string, string>): number {
  let score = 0;
  
  if (answers[introQuestion.id]) {
    const option = introQuestion.options.find(o => o.text === answers[introQuestion.id]);
    if (option) score += option.points;
  }
  
  for (const q of checklistQuestions) {
    if (answers[q.id]) {
      const option = q.options.find(o => o.text === answers[q.id]);
      if (option) score += option.points;
    }
  }
  return score;
}

export function getChecklistResultLevel(score: number): ChecklistResultLevel {
  if (score <= 5) {
    return {
      level: 'low',
      title: 'Tu empresa parece tener una base razonable',
      text: 'Tus respuestas indican que tienes cierto control sobre el uso de FUNDAE. Aun así, puede ser útil revisar si el crédito se está aprovechando de forma estratégica y si la formación está conectada con objetivos reales de negocio.',
      color: 'emerald', // We can use tailwind color names or hex
    };
  } else if (score <= 12) {
    return {
      level: 'medium',
      title: 'Tu empresa tiene una oportunidad clara de mejora',
      text: 'Tus respuestas indican que puede haber margen para revisar mejor el crédito disponible, planificar la formación y reducir errores administrativos. Una revisión rápida puede ayudarte a convertir FUNDAE en una herramienta útil para tu equipo.',
      color: 'amber',
    };
  } else {
    return {
      level: 'high',
      title: 'Tu empresa podría estar dejando crédito FUNDAE sin usar',
      text: 'Tus respuestas indican falta de claridad en varios puntos críticos: crédito disponible, planificación, requisitos, documentación o estrategia formativa. Antes de activar una formación bonificada, conviene revisar el caso para evitar errores y aprovechar mejor la oportunidad.',
      color: 'rose',
    };
  }
}

export function getChecklistRecommendations(answers: Record<string, string>): string[] {
  const recommendations: string[] = [];
  
  for (const q of checklistQuestions) {
    if (answers[q.id] && q.recommendations) {
      const rec = q.recommendations[answers[q.id]];
      if (rec && recommendations.length < 3 && !recommendations.includes(rec)) {
        recommendations.push(rec);
      }
    }
  }
  
  return recommendations;
}
