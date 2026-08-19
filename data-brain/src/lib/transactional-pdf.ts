import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const MAX_SCORE = 14;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const PDF_METADATA_DATE = new Date('2026-08-17T00:00:00.000Z');

const QUESTION_LABELS = [
  ['company_size', 'Plantilla aproximada'],
  ['credit_visibility', 'Consulta del credito'],
  ['training_fit', 'Definicion de la formacion'],
  ['planning_process', 'Planificacion y plazos'],
  ['rlpt_process', 'Informacion a la RLPT'],
  ['evidence_tracking', 'Control de asistencia o actividad'],
  ['documentation_control', 'Documentacion y costes'],
  ['cofinancing', 'Cofinanciacion privada'],
  ['review_timing', 'Momento de revision'],
] as const;

const ANSWER_POINTS: Record<string, Record<string, number>> = {
  company_size: { '1-5': 0, '6-9': 0, '10-49': 0, '50-249': 0, '+249': 0, 'No lo sé': 0 },
  credit_visibility: { 'Sí, lo hemos consultado': 0, 'No todavía': 2, 'No lo sé': 2 },
  training_fit: { 'Sí, está definida': 0, 'Tenemos una idea general': 1, 'No o no lo sé': 2 },
  planning_process: { 'Sí, antes de programarla': 0, 'A veces con poco margen': 1, 'No tenemos un proceso claro': 2 },
  rlpt_process: { 'No existe RLPT': 0, 'Sí, se informa antes de iniciar': 0, 'Existe, pero no lo tengo claro': 2, 'No sé si existe': 2 },
  evidence_tracking: { 'Sí, con un control definido': 0, 'Solo en algunos cursos': 1, 'No o no lo sé': 2 },
  documentation_control: { 'Sí, con un sistema claro': 0, Parcialmente: 1, 'No o no lo sé': 2 },
  cofinancing: { 'No aplica: 1-5 personas': 0, 'Sí, la revisamos': 0, 'No o no lo sé': 2 },
  review_timing: { 'Esta semana': 0, 'En los próximos 3 meses': 0, 'Solo estoy explorando': 0 },
};

export interface InteractiveChecklistPdfInput {
  score: number;
  riskLevel: string;
  answers: Record<string, string>;
}

function safeAnswer(key: string, value: unknown): string {
  if (typeof value !== 'string' || !Object.hasOwn(ANSWER_POINTS[key] ?? {}, value)) return 'Sin respuesta valida';
  return value;
}

function resultForScore(score: number): { level: 'low' | 'medium' | 'high'; title: string; summary: string } {
  if (score <= 3) return {
    level: 'low',
    title: 'Base operativa razonable',
    summary: 'Las respuestas apuntan a una base de control. El resultado es orientativo y no valida el credito ni los requisitos de una accion formativa.',
  };
  if (score <= 8) return {
    level: 'medium',
    title: 'Varios puntos para revisar',
    summary: 'Conviene ordenar la consulta de credito, la planificacion y las evidencias antes de aplicar una bonificacion.',
  };
  return {
    level: 'high',
    title: 'Revision recomendada',
    summary: 'Hay varios aspectos para comprobar. No implica incumplimiento: indica que conviene validar el caso antes de aplicar una bonificacion.',
  };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawLines(page: PDFPage, lines: string[], x: number, y: number, font: PDFFont, size: number, color = rgb(0.16, 0.18, 0.24), gap = 4): number {
  let cursor = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, font, size, color });
    cursor -= size + gap;
  }
  return cursor;
}

export async function generateInteractiveChecklistPdf(input: InteractiveChecklistPdfInput): Promise<Uint8Array> {
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > MAX_SCORE) throw new Error('interactive checklist score is invalid');
  if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) throw new Error('interactive checklist answers are invalid');
  const calculatedScore = Object.entries(ANSWER_POINTS).reduce((total, [key, options]) => {
    const answer = input.answers[key];
    return total + (typeof answer === 'string' && Object.hasOwn(options, answer) ? options[answer] : 0);
  }, 0);
  if (calculatedScore !== input.score) throw new Error('interactive checklist score does not match answers');

  const result = resultForScore(input.score);
  if (input.riskLevel && input.riskLevel !== result.level) throw new Error('interactive checklist risk level does not match score');

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 112, width: PAGE_WIDTH, height: 112, color: rgb(0.19, 0.17, 0.48) });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 118, width: PAGE_WIDTH, height: 6, color: rgb(1, 0.13, 0.43) });
  page.drawText('GFS CONSULTING GROUP', { x: MARGIN, y: PAGE_HEIGHT - 40, font: bold, size: 11, color: rgb(1, 1, 1) });
  page.drawText('RESUMEN ORIENTATIVO FUNDAE', { x: MARGIN, y: PAGE_HEIGHT - 70, font: bold, size: 20, color: rgb(1, 1, 1) });
  page.drawText('Autoevaluacion de preparacion', { x: MARGIN, y: PAGE_HEIGHT - 91, font: regular, size: 11, color: rgb(0.9, 0.9, 0.97) });

  let y = PAGE_HEIGHT - 160;
  page.drawText(result.title, { x: MARGIN, y, font: bold, size: 16, color: rgb(0.12, 0.14, 0.2) });
  page.drawText(`Puntos a revisar: ${input.score} / ${MAX_SCORE}`, { x: PAGE_WIDTH - MARGIN - 145, y, font: bold, size: 12, color: rgb(1, 0.13, 0.43) });
  y = drawLines(page, wrapText(result.summary, regular, 10, contentWidth), MARGIN, y - 24, regular, 10);

  y -= 20;
  page.drawRectangle({ x: MARGIN, y: y - 2, width: contentWidth, height: 24, color: rgb(0.19, 0.17, 0.48) });
  page.drawText('DETALLE DE RESPUESTAS', { x: MARGIN + 10, y: y + 6, font: bold, size: 10, color: rgb(1, 1, 1) });
  y -= 24;

  for (const [key, label] of QUESTION_LABELS) {
    const answer = safeAnswer(key, input.answers[key]);
    const answerLines = wrapText(answer, regular, 9, contentWidth - 190);
    const height = Math.max(31, answerLines.length * 13 + 12);
    page.drawRectangle({ x: MARGIN, y: y - height, width: contentWidth, height, color: rgb(0.96, 0.97, 0.98) });
    page.drawText(label, { x: MARGIN + 10, y: y - 18, font: bold, size: 9, color: rgb(0.13, 0.15, 0.2) });
    drawLines(page, answerLines, MARGIN + 190, y - 18, regular, 9, rgb(0.25, 0.28, 0.34), 4);
    y -= height + 5;
  }

  const footer = 'Documento orientativo. No sustituye la validacion administrativa ni el criterio profesional aplicable al caso.';
  page.drawLine({ start: { x: MARGIN, y: 45 }, end: { x: PAGE_WIDTH - MARGIN, y: 45 }, thickness: 1, color: rgb(0.85, 0.86, 0.9) });
  page.drawText(footer, { x: MARGIN, y: 29, font: regular, size: 7.5, color: rgb(0.38, 0.4, 0.46) });

  pdf.setTitle('Resumen orientativo FUNDAE');
  pdf.setAuthor('GFS Consulting Group');
  pdf.setCreator('GFS Consulting Group');
  pdf.setProducer('GFS Consulting Group');
  pdf.setSubject('Autoevaluacion orientativa FUNDAE');
  pdf.setCreationDate(PDF_METADATA_DATE);
  pdf.setModificationDate(PDF_METADATA_DATE);
  return pdf.save({ useObjectStreams: false });
}

const CHECKLIST_CONTROLS = [
  'Consulta el crédito asignado y el saldo disponible antes de planificar.',
  'Define objetivos, contenidos, modalidad, duración y participantes.',
  'Comunica el inicio dentro de plazo y conserva el justificante.',
  'Informa a la representación legal de las personas trabajadoras cuando corresponda.',
  'Controla asistencia, conexión o actividad según la modalidad.',
  'Verifica que los costes sean elegibles y estén correctamente soportados.',
  'Comprueba la cofinanciación privada aplicable a la empresa.',
  'Comunica la finalización y revisa los datos antes de bonificar.',
  'Conserva facturas, evidencias y documentación durante el plazo exigible.',
  'Contrasta el crédito y el estado final en la aplicación de FUNDAE.',
] as const;

export async function generateCanonicalChecklistPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 112, width: PAGE_WIDTH, height: 112, color: rgb(0.19, 0.17, 0.48) });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 118, width: PAGE_WIDTH, height: 6, color: rgb(1, 0.13, 0.43) });
  page.drawText('GFS CONSULTING GROUP', { x: MARGIN, y: PAGE_HEIGHT - 40, font: bold, size: 11, color: rgb(1, 1, 1) });
  page.drawText('CHECKLIST FUNDAE', { x: MARGIN, y: PAGE_HEIGHT - 70, font: bold, size: 20, color: rgb(1, 1, 1) });
  page.drawText('10 controles antes de bonificar', { x: MARGIN, y: PAGE_HEIGHT - 91, font: regular, size: 11, color: rgb(0.9, 0.9, 0.97) });

  let y = PAGE_HEIGHT - 154;
  CHECKLIST_CONTROLS.forEach((control, index) => {
    page.drawText(String(index + 1).padStart(2, '0'), { x: MARGIN, y, font: bold, size: 11, color: rgb(1, 0.13, 0.43) });
    const lines = wrapText(control, regular, 10, contentWidth - 34);
    y = drawLines(page, lines, MARGIN + 34, y, regular, 10);
    y -= 12;
  });

  const footer = 'Guía orientativa. No sustituye la validación administrativa ni el criterio profesional aplicable al caso.';
  page.drawLine({ start: { x: MARGIN, y: 45 }, end: { x: PAGE_WIDTH - MARGIN, y: 45 }, thickness: 1, color: rgb(0.85, 0.86, 0.9) });
  page.drawText(footer, { x: MARGIN, y: 29, font: regular, size: 7.5, color: rgb(0.38, 0.4, 0.46) });
  pdf.setTitle('Checklist FUNDAE - 10 controles');
  pdf.setAuthor('GFS Consulting Group');
  pdf.setCreator('GFS Consulting Group');
  pdf.setProducer('GFS Consulting Group');
  pdf.setSubject('Checklist orientativa FUNDAE');
  pdf.setCreationDate(PDF_METADATA_DATE);
  pdf.setModificationDate(PDF_METADATA_DATE);
  return pdf.save({ useObjectStreams: false });
}
