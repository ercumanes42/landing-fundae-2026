/**
 * Generates a professional FUNDAE diagnostic PDF report using jsPDF.
 * This builds the PDF programmatically so it works regardless of DOM state.
 */
import { jsPDF } from 'jspdf';
import type { ChecklistResultLevel } from './checklistScoringV2';

interface PDFReportData {
  score: number;
  maxScore: number;
  resultLevel: ChecklistResultLevel;
  recommendations: string[];
  answers: Record<string, string>;
  questions: { id: string; question: string }[];
}

const BRAND = {
  name: 'GFS Consulting Group',
  email: 'administracion@gfs.es',
  phone: '+34 902 120 567',
  address: 'Paseo de la Castellana, 141, 28046 Madrid',
} as const;

export const DIAGNOSTIC_PDF_FILENAME = 'Resumen_Orientativo_FUNDAE.pdf';

export function getBrandLogoUrl(baseUrl = import.meta.env?.BASE_URL ?? '/'): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}gfs-consulting-logo.png`;
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

export async function loadBrandLogoDataUrl(
  fetchLogo: typeof fetch = fetch,
  logoUrl = getBrandLogoUrl(),
): Promise<string | null> {
  try {
    const response = await fetchLogo(logoUrl, { credentials: 'same-origin' });
    if (!response.ok) return null;

    const mimeType = response.headers.get('content-type') || 'image/png';
    return arrayBufferToDataUrl(await response.arrayBuffer(), mimeType);
  } catch {
    return null;
  }
}

export async function generateDiagnosticPDF(data: PDFReportData): Promise<void> {
  // This same-origin request never contains report data. If it fails, the PDF
  // remains downloadable and uses the textual GFS brand fallback below.
  const brandLogoDataUrl = await loadBrandLogoDataUrl();
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  // ── Color palette ───────────────────────────────────────────────
  const colors = {
    primary: [48, 43, 123] as [number, number, number],      // #302B7B
    accent: [255, 32, 110] as [number, number, number],      // #FF206E
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
  const priorityRecommendations = data.recommendations.length > 0
    ? data.recommendations
    : [
        'Confirma el crédito y el saldo oficiales antes de comprometer una acción formativa.',
        'Revisa fechas, participantes, costes y evidencias antes de comunicar el inicio.',
        'Conserva comunicaciones y justificantes en un expediente único por acción.',
      ];

  // Helper: wrap text and return lines
  const splitText = (text: string, maxWidth: number, fontSize: number): string[] => {
    pdf.setFontSize(fontSize);
    return pdf.splitTextToSize(text, maxWidth) as string[];
  };

  // Helper: check page break
  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - 30) {
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

  // The logo sits on a white plate so its original colors remain legible.
  // addImage is also guarded because a malformed response must not block save().
  pdf.setFillColor(...colors.white);
  pdf.roundedRect(pageWidth - margin - 48, 6, 48, 15, 2, 2, 'F');
  let logoRendered = false;
  if (brandLogoDataUrl) {
    try {
      pdf.addImage(brandLogoDataUrl, 'PNG', pageWidth - margin - 45, 8.5, 42, 10);
      logoRendered = true;
    } catch {
      logoRendered = false;
    }
  }

  if (!logoRendered) {
    pdf.setTextColor(...colors.primary);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text(BRAND.name, pageWidth - margin - 24, 15, { align: 'center' });
  }

  // Header text
  pdf.setTextColor(...colors.white);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text('RESUMEN FUNDAE', margin, 18);

  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Autoevaluación de preparación · Documento orientativo', margin, 27);

  // Date
  const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
  pdf.setFontSize(9);
  pdf.text(dateStr, pageWidth - margin, 35, { align: 'right' });

  y = 55;

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
  if (priorityRecommendations.length > 0) {
    checkPageBreak(50);

    pdf.setFillColor(...colors.primary);
    pdf.roundedRect(margin, y, contentWidth, 8, 2, 2, 'F');
    pdf.setTextColor(...colors.white);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('RECOMENDACIONES PRIORITARIAS', margin + 6, y + 5.5);
    y += 14;

    priorityRecommendations.forEach((rec, idx) => {
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
  pdf.roundedRect(margin, y, contentWidth, 26, 3, 3, 'F');

  pdf.setTextColor(...colors.white);
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Siguiente paso: revisa estas prioridades con el responsable de FUNDAE.', pageWidth / 2, y + 10, { align: 'center' });
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Si necesitas contraste, reserva una revisión de 15 minutos con GFS.', pageWidth / 2, y + 18, { align: 'center' });

  // Every page carries the GFS identity and public contact details. The report
  // answers remain local to jsPDF and are never included in the logo request.
  const pageCount = pdf.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    pdf.setPage(pageNumber);
    pdf.setDrawColor(...colors.accent);
    pdf.setLineWidth(0.6);
    pdf.line(margin, pageHeight - 24, pageWidth - margin, pageHeight - 24);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(...colors.primary);
    pdf.text(BRAND.name, margin, pageHeight - 18);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...colors.medium);
    pdf.text(BRAND.address, pageWidth / 2, pageHeight - 18, { align: 'center' });
    pdf.text(`${BRAND.email} · ${BRAND.phone}`, pageWidth - margin, pageHeight - 18, { align: 'right' });
    pdf.setFont('helvetica', 'italic');
    pdf.text('Resumen orientativo: no valida crédito ni cumplimiento.', pageWidth / 2, pageHeight - 10, { align: 'center' });
    pdf.setFont('helvetica', 'normal');
    pdf.text(`${pageNumber}/${pageCount}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
  }

  // ── Save ────────────────────────────────────────────────────────
  pdf.save(DIAGNOSTIC_PDF_FILENAME);
}
