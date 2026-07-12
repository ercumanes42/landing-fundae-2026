/**
 * Generates a professional FUNDAE diagnostic PDF report using jsPDF.
 * This builds the PDF programmatically so it works regardless of DOM state.
 */
import { jsPDF } from 'jspdf';
import type { ChecklistResultLevel } from './checklistScoringV2';

interface PDFReportData {
  userName: string;
  userEmail: string;
  userCompany: string;
  score: number;
  maxScore: number;
  resultLevel: ChecklistResultLevel;
  recommendations: string[];
  answers: Record<string, string>;
  questions: { id: string; question: string }[];
}

export function generateDiagnosticPDF(data: PDFReportData): void {
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  // ── Color palette ───────────────────────────────────────────────
  const colors = {
    primary: [30, 43, 88] as [number, number, number],       // #1E2B58
    accent: [59, 130, 246] as [number, number, number],      // blue-500
    dark: [15, 23, 42] as [number, number, number],          // slate-900
    medium: [100, 116, 139] as [number, number, number],     // slate-500
    light: [241, 245, 249] as [number, number, number],      // slate-100
    white: [255, 255, 255] as [number, number, number],
    low: [16, 185, 129] as [number, number, number],         // emerald-500
    lowBg: [236, 253, 245] as [number, number, number],      // emerald-50
    med: [245, 158, 11] as [number, number, number],         // amber-500
    medBg: [255, 251, 235] as [number, number, number],      // amber-50
    high: [244, 63, 94] as [number, number, number],         // rose-500
    highBg: [255, 241, 242] as [number, number, number],     // rose-50
  };

  const getLevelColors = () => {
    if (data.resultLevel.level === 'low') return { main: colors.low, bg: colors.lowBg, label: 'POCOS PUNTOS A REVISAR' };
    if (data.resultLevel.level === 'medium') return { main: colors.med, bg: colors.medBg, label: 'VARIOS PUNTOS A REVISAR' };
    return { main: colors.high, bg: colors.highBg, label: 'REVISIÓN RECOMENDADA' };
  };

  const levelColors = getLevelColors();

  // Helper: wrap text and return lines
  const splitText = (text: string, maxWidth: number, fontSize: number): string[] => {
    pdf.setFontSize(fontSize);
    return pdf.splitTextToSize(text, maxWidth) as string[];
  };

  // Helper: check page break
  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - 25) {
      pdf.addPage();
      y = 20;
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // HEADER BAR
  // ══════════════════════════════════════════════════════════════════
  pdf.setFillColor(...colors.primary);
  pdf.rect(0, 0, pageWidth, 42, 'F');

  // Accent stripe
  pdf.setFillColor(...colors.accent);
  pdf.rect(0, 42, pageWidth, 3, 'F');

  // Header text
  pdf.setTextColor(...colors.white);
  pdf.setFontSize(22);
  pdf.setFont('helvetica', 'bold');
  pdf.text('RESUMEN ORIENTATIVO FUNDAE', margin, 18);

  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Autoevaluación de preparación · Resumen personalizado', margin, 27);

  // Date
  const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
  pdf.setFontSize(9);
  pdf.text(dateStr, pageWidth - margin, 35, { align: 'right' });

  y = 55;

  // ══════════════════════════════════════════════════════════════════
  // USER INFO BOX
  // ══════════════════════════════════════════════════════════════════
  pdf.setFillColor(...colors.light);
  pdf.roundedRect(margin, y, contentWidth, 28, 3, 3, 'F');

  pdf.setTextColor(...colors.dark);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text('DATOS DEL SOLICITANTE', margin + 6, y + 7);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(...colors.medium);

  const col1 = margin + 6;
  const col2 = margin + 70;
  const col3 = margin + 130;

  pdf.text('Nombre:', col1, y + 16);
  pdf.text('Email:', col2, y + 16);
  pdf.text('Empresa:', col3, y + 16);

  pdf.setTextColor(...colors.dark);
  pdf.setFont('helvetica', 'bold');
  pdf.text(data.userName || '—', col1, y + 22);

  const emailLines = splitText(data.userEmail || '—', 55, 10);
  pdf.text(emailLines[0] || '—', col2, y + 22);

  pdf.text(data.userCompany || '—', col3, y + 22);

  y += 38;

  // ══════════════════════════════════════════════════════════════════
  // RESULT BANNER
  // ══════════════════════════════════════════════════════════════════
  pdf.setFillColor(...levelColors.bg);
  pdf.setDrawColor(...levelColors.main);
  pdf.setLineWidth(0.8);
  pdf.roundedRect(margin, y, contentWidth, 38, 3, 3, 'FD');

  // Level label
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...levelColors.main);
  pdf.text(levelColors.label, margin + 8, y + 10);

  // Score display
  pdf.setFontSize(14);
  pdf.setTextColor(...colors.dark);
  pdf.setFont('helvetica', 'bold');
  const scoreText = `Puntos a revisar: ${data.score} / ${data.maxScore}`;
  pdf.text(scoreText, pageWidth - margin - 8, y + 10, { align: 'right' });

  // Title
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...colors.dark);
  pdf.text(data.resultLevel.title, margin + 8, y + 20);

  // Description
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...colors.medium);
  const descLines = splitText(data.resultLevel.text, contentWidth - 16, 9);
  pdf.text(descLines.slice(0, 3), margin + 8, y + 27);

  y += 48;

  // ══════════════════════════════════════════════════════════════════
  // RECOMMENDATIONS
  // ══════════════════════════════════════════════════════════════════
  if (data.recommendations.length > 0) {
    checkPageBreak(50);

    pdf.setFillColor(...colors.primary);
    pdf.roundedRect(margin, y, contentWidth, 8, 2, 2, 'F');
    pdf.setTextColor(...colors.white);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('RECOMENDACIONES PRIORITARIAS', margin + 6, y + 5.5);
    y += 14;

    data.recommendations.forEach((rec, idx) => {
      checkPageBreak(20);

      pdf.setFillColor(...colors.light);
      const recLines = splitText(rec, contentWidth - 20, 10);
      const recHeight = Math.max(12, recLines.length * 5 + 8);

      pdf.roundedRect(margin, y, contentWidth, recHeight, 2, 2, 'F');

      // Number circle
      pdf.setFillColor(...colors.accent);
      pdf.circle(margin + 7, y + recHeight / 2, 3.5, 'F');
      pdf.setTextColor(...colors.white);
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text(String(idx + 1), margin + 7, y + recHeight / 2 + 1, { align: 'center' });

      // Rec text
      pdf.setTextColor(...colors.dark);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(recLines, margin + 15, y + 7);

      y += recHeight + 4;
    });

    y += 6;
  }

  // ══════════════════════════════════════════════════════════════════
  // ANSWERS TABLE
  // ══════════════════════════════════════════════════════════════════
  checkPageBreak(40);

  pdf.setFillColor(...colors.primary);
  pdf.roundedRect(margin, y, contentWidth, 8, 2, 2, 'F');
  pdf.setTextColor(...colors.white);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text('DETALLE DE TUS RESPUESTAS', margin + 6, y + 5.5);
  y += 12;

  // Table header
  pdf.setFillColor(...colors.dark);
  pdf.rect(margin, y, contentWidth, 8, 'F');
  pdf.setTextColor(...colors.white);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PREGUNTA', margin + 4, y + 5.5);
  pdf.text('TU RESPUESTA', margin + contentWidth * 0.6, y + 5.5);
  y += 8;

  const allQuestions = data.questions;

  allQuestions.forEach((q, idx) => {
    checkPageBreak(14);

    const answer = data.answers[q.id] || '—';
    const bgColor = idx % 2 === 0 ? colors.white : colors.light;

    // Calculate row height
    const qLines = splitText(q.question, contentWidth * 0.55, 8);
    const aLines = splitText(answer, contentWidth * 0.35, 8);
    const rowHeight = Math.max(qLines.length, aLines.length) * 4 + 5;

    pdf.setFillColor(...bgColor);
    pdf.rect(margin, y, contentWidth, rowHeight, 'F');

    pdf.setTextColor(...colors.dark);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text(qLines, margin + 4, y + 5);

    pdf.setFont('helvetica', 'bold');
    pdf.text(aLines, margin + contentWidth * 0.6, y + 5);

    y += rowHeight;
  });

  // ══════════════════════════════════════════════════════════════════
  // FOOTER CTA
  // ══════════════════════════════════════════════════════════════════
  y += 10;
  checkPageBreak(30);

  pdf.setFillColor(...colors.accent);
  pdf.roundedRect(margin, y, contentWidth, 22, 3, 3, 'F');

  pdf.setTextColor(...colors.white);
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text('¿Quieres que analicemos tu caso en profundidad?', pageWidth / 2, y + 9, { align: 'center' });

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Agenda un diagnóstico ejecutivo gratuito de 15 minutos en fundae.tuempresa.com', pageWidth / 2, y + 16, { align: 'center' });

  // ── Confidentiality footer ──────────────────────────────────────
  pdf.setTextColor(...colors.medium);
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'italic');
  pdf.text(
    'Este resumen es orientativo y no valida crédito ni cumplimiento. Consulta con un especialista para revisar tu situación real.',
    pageWidth / 2,
    pageHeight - 10,
    { align: 'center' }
  );

  // ── Save ────────────────────────────────────────────────────────
  pdf.save(`Resumen_Orientativo_FUNDAE_${data.userCompany.replace(/\s+/g, '_') || 'empresa'}.pdf`);
}
