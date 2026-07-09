'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Chart as ChartJS, 
  ArcElement, 
  Tooltip, 
  Legend, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  Title,
  Filler,
  BarElement
} from 'chart.js';
import { Doughnut, Line, Bar } from 'react-chartjs-2';
import { AnalystChat } from './AnalystChat';
import ResetDataModal from './ResetDataModal';

interface DashboardPanelProps {
  initialData: {
    leadsCount: number;
    eventsCount: number;
    leadsByClassification: { cold: number; warm: number; hot: number; priority: number };
    leadsByMagnet: { calculator: number; checklist: number; interactive_checklist: number; webinar: number; diagnostic: number; unknown: number };
    queueCounts: { queued: number; delivered: number; retrying: number; dead_letter: number };
    integrations: { make: boolean; airtable: boolean; posthog: boolean };
    validationOk: boolean;
    missingEnvs: string[];
    avgScroll: number;
    avgTime: number;
    videoPlayCount: number;
    uniqueVisitors: number;
    leadsList: any[];
    rawLeads: any[];
    rawEvents: any[];
  };
}

export function DashboardPanel({ initialData }: DashboardPanelProps) {
  const [activeView, setActiveView] = useState<'panel' | 'fuentes' | 'ajustes'>('panel');
  const [activeTab, setActiveTab] = useState<'summary' | 'channels' | 'friction' | 'behavior' | 'godmode' | 'chat'>('summary');
  const [retryResult, setRetryResult] = useState<{ ok: boolean; processed?: number; delivered?: number; dead_letter?: number; error?: string } | null>(null);
  const [loadingRetry, setLoadingRetry] = useState(false);
  const [scoreThresholds, setScoreThresholds] = useState({ cold: 40, warm: 60, hot: 80 });
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [dbLatency, setDbLatency] = useState<number | null>(null);
  const [selectedAIModel, setSelectedAIModel] = useState('gemini-2.5-flash');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem('data-brain-theme') as 'dark' | 'light';
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('data-brain-theme', nextTheme);
  };

  // ── FILTROS MODO DIOS (DATA SCIENCE) ──────────────────────────────────
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  
  const [classificationFilter, setClassificationFilter] = useState<string>('all');
  const [magnetFilter, setMagnetFilter] = useState<string>('all');
  
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [mediumFilter, setMediumFilter] = useState<string>('all');
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  
  const [companySizeFilter, setCompanySizeFilter] = useState<string>('all');
  const [usedFundaeFilter, setUsedFundaeFilter] = useState<string>('all');
  const [knowsCreditFilter, setKnowsCreditFilter] = useState<string>('all');
  
  const [minScore, setMinScore] = useState<number>(0);
  const [maxScore, setMaxScore] = useState<number>(100);
  
  const [provinceFilter, setProvinceFilter] = useState<string>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('all');

  const rawLeads = initialData.rawLeads || [];
  const rawEvents = initialData.rawEvents || [];

  // Extraer valores únicos de la base de datos real en caliente
  const uniqueProvinces = useMemo(() => {
    const list = rawLeads.map((l: any) => l.payload?.company?.province || l.payload?.province).filter(Boolean);
    return Array.from(new Set(list)).sort();
  }, [rawLeads]);

  const uniqueSectors = useMemo(() => {
    const list = rawLeads.map((l: any) => l.payload?.company?.sector || l.payload?.sector).filter(Boolean);
    return Array.from(new Set(list)).sort();
  }, [rawLeads]);

  const uniqueCampaigns = useMemo(() => {
    const list = rawLeads.map((l: any) => l.payload?.utm_campaign || l.payload?.tracking_context?.utm_campaign).filter(Boolean);
    return Array.from(new Set(list)).sort();
  }, [rawLeads]);

  const uniqueMediums = useMemo(() => {
    const list = rawLeads.map((l: any) => l.payload?.utm_medium || l.payload?.tracking_context?.utm_medium).filter(Boolean);
    return Array.from(new Set(list)).sort();
  }, [rawLeads]);

  const uniqueSources = useMemo(() => {
    const list = rawLeads.map((l: any) => l.payload?.utm_source || l.payload?.tracking_context?.utm_source).filter(Boolean);
    return Array.from(new Set(list)).sort();
  }, [rawLeads]);

  const uniqueSizes = useMemo(() => {
    const list = rawLeads.map((l: any) => l.payload?.company?.employee_range || l.payload?.employee_range).filter(Boolean);
    return Array.from(new Set(list)).sort();
  }, [rawLeads]);

  // Filtrado dinámico de Leads (Data Science Engine)
  const filteredLeads = useMemo(() => {
    return rawLeads.filter((l: any) => {
      // 1. Filtro temporal
      if (dateFilter !== 'all') {
        const leadDate = new Date(l.created_at);
        const now = new Date();
        if (dateFilter === 'today') {
          if (leadDate.toDateString() !== now.toDateString()) return false;
        } else if (dateFilter === 'yesterday') {
          const yesterday = new Date();
          yesterday.setDate(now.getDate() - 1);
          if (leadDate.toDateString() !== yesterday.toDateString()) return false;
        } else if (dateFilter === '7days') {
          const diffDays = Math.ceil(Math.abs(now.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 7) return false;
        } else if (dateFilter === '30days') {
          const diffDays = Math.ceil(Math.abs(now.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 30) return false;
        } else if (dateFilter === 'custom') {
          if (customStartDate && new Date(customStartDate) > leadDate) return false;
          if (customEndDate) {
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
            if (leadDate > end) return false;
          }
        }
      }

      // 2. Filtro por clasificación de temperatura
      if (classificationFilter !== 'all' && l.lead_classification !== classificationFilter) return false;

      // 3. Filtro por Lead Magnet
      if (magnetFilter !== 'all' && l.lead_magnet !== magnetFilter) return false;

      // 4. Rango de Lead Score
      const score = l.lead_score ?? 0;
      if (score < minScore || score > maxScore) return false;

      // 5. Filtros UTM de Tráfico
      const tc = l.payload?.tracking_context || {};
      const src = (l.payload?.utm_source || tc.utm_source || 'Directo / Orgánico').toLowerCase();
      const med = (l.payload?.utm_medium || tc.utm_medium || 'Ninguno').toLowerCase();
      const camp = (l.payload?.utm_campaign || tc.utm_campaign || 'Sin Campaña').toLowerCase();

      if (sourceFilter !== 'all') {
        if (sourceFilter === 'direct' && !src.includes('direct') && !src.includes('orgánico')) return false;
        if (sourceFilter === 'linkedin' && !src.includes('linkedin')) return false;
        if (sourceFilter === 'referral' && !src.includes('referencia') && !src.includes('referral')) return false;
        if (sourceFilter !== 'direct' && sourceFilter !== 'linkedin' && sourceFilter !== 'referral') {
          if (src !== sourceFilter.toLowerCase()) return false;
        }
      }

      if (mediumFilter !== 'all' && med !== mediumFilter.toLowerCase()) return false;
      if (campaignFilter !== 'all' && camp !== campaignFilter.toLowerCase()) return false;

      // 6. Firmográficos & Historial
      const companySize = (l.payload?.company?.employee_range || l.payload?.employee_range || 'Desconocido');
      const usedFundae = (l.payload?.company?.used_fundae_before || l.payload?.used_fundae_before || 'Desconocido');
      const knowsCredit = (l.payload?.company?.knows_credit || l.payload?.knows_credit || 'Desconocido');
      const prov = (l.payload?.company?.province || l.payload?.province || 'No especificada');
      const sec = (l.payload?.company?.sector || l.payload?.sector || 'No especificado');

      if (companySizeFilter !== 'all' && companySize !== companySizeFilter) return false;
      if (usedFundaeFilter !== 'all' && usedFundae !== usedFundaeFilter) return false;
      if (knowsCreditFilter !== 'all' && knowsCredit !== knowsCreditFilter) return false;
      if (provinceFilter !== 'all' && prov !== provinceFilter) return false;
      if (sectorFilter !== 'all' && sec !== sectorFilter) return false;

      return true;
    });
  }, [
    rawLeads, dateFilter, customStartDate, customEndDate,
    classificationFilter, magnetFilter, minScore, maxScore,
    sourceFilter, mediumFilter, campaignFilter,
    companySizeFilter, usedFundaeFilter, knowsCreditFilter,
    provinceFilter, sectorFilter
  ]);

  // Join de Visitantes en tiempo real para eventos
  const leadByAnonId = useMemo(() => {
    const map = new Map<string, any>();
    filteredLeads.forEach((l: any) => {
      const anonId = l.payload?.anonymous_id || l.anonymous_id;
      if (anonId) {
        map.set(anonId, l);
      }
    });
    return map;
  }, [filteredLeads]);

  // Filtrado dinámico de Eventos (Cruzando filtros del Lead en Modo Dios)
  const filteredEvents = useMemo(() => {
    return rawEvents.filter((e: any) => {
      // 1. Filtro temporal directo
      if (dateFilter !== 'all' && e.occurred_at) {
        const eventDate = new Date(e.occurred_at);
        const now = new Date();
        if (dateFilter === 'today') {
          if (eventDate.toDateString() !== now.toDateString()) return false;
        } else if (dateFilter === 'yesterday') {
          const yesterday = new Date();
          yesterday.setDate(now.getDate() - 1);
          if (eventDate.toDateString() !== yesterday.toDateString()) return false;
        } else if (dateFilter === '7days') {
          const diffDays = Math.ceil(Math.abs(now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 7) return false;
        } else if (dateFilter === '30days') {
          const diffDays = Math.ceil(Math.abs(now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 30) return false;
        } else if (dateFilter === 'custom') {
          if (customStartDate && new Date(customStartDate) > eventDate) return false;
          if (customEndDate) {
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
            if (eventDate > end) return false;
          }
        }
      }

      // 2. Si hay filtros avanzados activos (Scoring, Firmográficos, etc.), join por anonymous_id
      const hasLeadFilter = classificationFilter !== 'all' || companySizeFilter !== 'all' || minScore > 0 || maxScore < 100 || usedFundaeFilter !== 'all' || knowsCreditFilter !== 'all' || provinceFilter !== 'all' || sectorFilter !== 'all';
      if (hasLeadFilter) {
        if (!e.anonymous_id || !leadByAnonId.has(e.anonymous_id)) return false;
      }

      return true;
    });
  }, [
    rawEvents, dateFilter, customStartDate, customEndDate, leadByAnonId,
    classificationFilter, companySizeFilter, minScore, maxScore,
    usedFundaeFilter, knowsCreditFilter, provinceFilter, sectorFilter
  ]);

  const totalLeads = filteredLeads.length;
  const uniqueVisitors = useMemo(() => {
    const ids = new Set(filteredEvents.map((e: any) => e.anonymous_id).filter(Boolean));
    return ids.size || Math.max(1, totalLeads);
  }, [filteredEvents, totalLeads]);

  const overallConversion = ((totalLeads / uniqueVisitors) * 100).toFixed(1);

  const recentPriorityLeads = useMemo(() => {
    return filteredLeads.filter((l: any) => {
      if (l.lead_classification !== 'priority') return false;
      const hoursAgo = (new Date().getTime() - new Date(l.created_at).getTime()) / (1000 * 60 * 60);
      return hoursAgo <= 6;
    });
  }, [filteredLeads]);

  // Cruce de datos: Descargas de PDF y Citas Agendadas
  // IMPORTANTE: Solo lee eventos reales de la base de datos — no hace suposiciones por tipo de lead
  const leadsCrossAnalysis = useMemo(() => {
    // Solo IDs de visitantes que dispararon el evento real de descarga de PDF
    const pdfDownloadedAnonIds = new Set(
      filteredEvents
        .filter((e: any) => e.event_name === 'pdf_download' || e.event_name === 'pdf_downloaded')
        .map((e: any) => e.anonymous_id)
        .filter(Boolean)
    );
    // Solo IDs de visitantes que dispararon un evento real de Calendly
    const scheduledAnonIds = new Set(
      filteredEvents
        .filter((e: any) =>
          e.event_name === 'calendly_click' ||
          e.event_name === 'calendly_redirect' ||
          e.event_name === 'calendly_booked'
        )
        .map((e: any) => e.anonymous_id)
        .filter(Boolean)
    );

    let both = 0;
    let onlyPdf = 0;
    let onlySchedule = 0;
    let onlyLead = 0;

    filteredLeads.forEach((l: any) => {
      const anonId = l.payload?.anonymous_id || l.anonymous_id;
      // Verdad basada ÚNICAMENTE en telemetría — sin inferencias por lead_magnet ni form_type
      const hasPdf = !!anonId && pdfDownloadedAnonIds.has(anonId);
      const hasSchedule = !!anonId && scheduledAnonIds.has(anonId);

      if (hasPdf && hasSchedule) both++;
      else if (hasPdf) onlyPdf++;
      else if (hasSchedule) onlySchedule++;
      else onlyLead++;
    });

    // Totals directos desde eventos (no desde leads) para mayor precisión
    const totalPdfEvents = pdfDownloadedAnonIds.size;
    const totalScheduledEvents = scheduledAnonIds.size;

    return { both, onlyPdf, onlySchedule, onlyLead, totalPdfEvents, totalScheduledEvents };
  }, [filteredLeads, filteredEvents]);

  // Tiempo medio de completado de autodiagnóstico
  const checklistCompletionTime = useMemo(() => {
    const startMap: Record<string, number> = {};
    const endMap: Record<string, number> = {};

    filteredEvents.forEach((e: any) => {
      const anonId = e.anonymous_id;
      if (!anonId || !e.occurred_at) return;

      if (e.event_name === 'checklist_interactive_start') {
        const time = new Date(e.occurred_at).getTime();
        if (!startMap[anonId] || time < startMap[anonId]) {
          startMap[anonId] = time;
        }
      }

      if (e.event_name === 'checklist_interactive_completed' || e.event_name === 'checklist_result_view') {
        const time = new Date(e.occurred_at).getTime();
        if (!endMap[anonId] || time > endMap[anonId]) {
          endMap[anonId] = time;
        }
      }
    });

    const diffs: number[] = [];
    Object.keys(endMap).forEach(anonId => {
      if (startMap[anonId]) {
        const diffSeconds = (endMap[anonId] - startMap[anonId]) / 1000;
        if (diffSeconds > 3 && diffSeconds < 900) { // filter out outliers
          diffs.push(diffSeconds);
        }
      }
    });

    if (diffs.length === 0) return 0;
    const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    return Math.round(avg);
  }, [filteredEvents]);

  // Tiempo medio por pregunta del autodiagnóstico
  const averageTimePerQuestion = useMemo(() => {
    const answeredEvents = filteredEvents.filter((e: any) => e.event_name === 'checklist_question_answered' && e.properties?.time_spent_seconds !== undefined);
    const questionTimes: Record<string, { total: number; count: number }> = {};
    answeredEvents.forEach((e: any) => {
      const qId = e.properties.question_id;
      const time = Number(e.properties.time_spent_seconds);
      if (!qId || isNaN(time)) return;
      if (!questionTimes[qId]) questionTimes[qId] = { total: 0, count: 0 };
      questionTimes[qId].total += time;
      questionTimes[qId].count++;
    });

    const res: Record<string, number> = {};
    Object.entries(questionTimes).forEach(([qId, data]) => {
      res[qId] = Math.round(data.total / data.count);
    });
    return res;
  }, [filteredEvents]);

  // AI Diagnostics (Recomendaciones CRO en base a los datos reales filtrados)
  const aiDiagnostics = useMemo(() => {
    const list = [];
    
    // 1. Cola de sincronización fallida
    const deadLetters = initialData.queueCounts.dead_letter || 0;
    if (deadLetters > 0) {
      list.push({
        id: 'sync_fail',
        status: 'critical',
        title: 'Error de Sincronización en CRM (HubSpot/Make)',
        fail: `${deadLetters} registros atascados en la cola de errores (Dead Letters).`,
        cause: 'Credenciales inválidas, webhook inactivo o límites de la API del CRM superados.',
        solution: 'Haz clic en "Reintentar Fallidos" en la sección de Cola de Sincronización. Verifica el estado del webhook de Make en Ajustes.',
      });
    }

    // 2. Tasa de conversión de leads a agendamiento (Calendly)
    // Lee solo eventos reales de calendly — no usa form_type como proxy
    const totalLeadsCount = filteredLeads.length;
    const calendlyAnonIds = new Set(
      filteredEvents
        .filter((e: any) =>
          e.event_name === 'calendly_click' ||
          e.event_name === 'calendly_redirect' ||
          e.event_name === 'calendly_booked'
        )
        .map((e: any) => e.anonymous_id)
        .filter(Boolean)
    );
    const totalScheduled = filteredLeads.filter((l: any) => {
      const anonId = l.payload?.anonymous_id || l.anonymous_id;
      return anonId && calendlyAnonIds.has(anonId);
    }).length;
    const scheduleRate = totalLeadsCount > 0 ? (totalScheduled / totalLeadsCount) * 100 : 0;

    if (totalLeadsCount > 3 && scheduleRate < 35) {
      list.push({
        id: 'scheduling_friction',
        status: 'warning',
        title: 'Fuga en el agendamiento comercial (Calendly)',
        fail: `Solo el ${scheduleRate.toFixed(0)}% de los leads que completan el formulario agendan cita inmediatamente.`,
        cause: 'Falta de urgencia en la página de éxito o redirección lenta a Calendly.',
        solution: 'Optimiza la página de confirmación con un temporizador dinámico que diga: "Tu plaza se guardará por 2 minutos. Agenda tu sesión ahora".',
      });
    } else if (totalLeadsCount > 0) {
      list.push({
        id: 'scheduling_ok',
        status: 'good',
        title: 'Alta Tasa de Agendamiento 1:1',
        fail: `El ${scheduleRate.toFixed(0)}% de tus prospectos agendan directamente.`,
        cause: 'Copy persuasivo y CTAs llamativos al final de los formularios.',
        solution: 'Mantener la estructura simplificada de Calendly sin preguntas redundantes.',
      });
    }

    return list;
  }, [filteredLeads, initialData.queueCounts.dead_letter]);

  const campaignPerformance = useMemo(() => {
    const translateUtmCampaign = (camp: string): string => {
      const normalized = (camp || '').trim().toLowerCase();
      if (!normalized || ['unattributed', 'unknown', 'tráfico orgánico', 'sin campaña'].includes(normalized)) {
        return 'Tráfico Orgánico / Sin Campaña';
      }
      return camp.charAt(0).toUpperCase() + camp.slice(1);
    };

    const translateUtmSource = (src: string): string => {
      const normalized = (src || '').trim().toLowerCase();
      if (!normalized || ['direct', 'directo', 'directo / orgánico', 'unknown', 'unattributed'].includes(normalized)) {
        return 'Directo / Orgánico';
      }
      if (normalized === 'referral' || normalized === 'referido') {
        return 'Referencia (Otros sitios)';
      }
      if (normalized === 'linkedin' || normalized.includes('linkedin')) {
        return 'LinkedIn';
      }
      if (normalized === 'email' || normalized === 'mail' || normalized.includes('email')) {
        return 'Email Marketing';
      }
      if (normalized === 'organic' || normalized.includes('organic')) {
        return 'Buscadores (Orgánico)';
      }
      return src.charAt(0).toUpperCase() + src.slice(1);
    };

    const map: Record<string, { count: number; totalScore: number; priorityCount: number; source: string }> = {};
    filteredLeads.forEach(l => {
      let camp = l.payload?.tracking_context?.utm_campaign || l.payload?.utm_campaign || '';
      camp = translateUtmCampaign(camp);
      let source = l.payload?.tracking_context?.utm_source || l.payload?.utm_source || '';
      source = translateUtmSource(source);

      if (!map[camp]) map[camp] = { count: 0, totalScore: 0, priorityCount: 0, source };
      map[camp].count++;
      map[camp].totalScore += (l.lead_score || 0);
      if ((l.lead_score || 0) >= 80) map[camp].priorityCount++;
    });
    return Object.entries(map).map(([name, data]) => ({
      name,
      source: data.source,
      count: data.count,
      avgScore: Math.round(data.totalScore / data.count),
      priorityRate: Math.round((data.priorityCount / data.count) * 100)
    })).sort((a, b) => b.avgScore - a.avgScore);
  }, [filteredLeads]);

  const channelDistribution = useMemo(() => {
    const translateUtmSource = (src: string): string => {
      const normalized = (src || '').trim().toLowerCase();
      if (!normalized || ['direct', 'directo', 'directo / orgánico', 'unknown', 'unattributed'].includes(normalized)) {
        return 'Directo / Orgánico';
      }
      if (normalized === 'referral' || normalized === 'referido') {
        return 'Referencia (Otros sitios)';
      }
      if (normalized === 'linkedin' || normalized.includes('linkedin')) {
        return 'LinkedIn';
      }
      if (normalized === 'email' || normalized === 'mail' || normalized.includes('email')) {
        return 'Email Marketing';
      }
      if (normalized === 'organic' || normalized.includes('organic')) {
        return 'Buscadores (Orgánico)';
      }
      return src.charAt(0).toUpperCase() + src.slice(1);
    };

    const map: Record<string, number> = {};
    filteredLeads.forEach(l => {
      let src = l.payload?.tracking_context?.utm_source || l.payload?.utm_source || '';
      src = translateUtmSource(src);
      map[src] = (map[src] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({
      name, count, percent: Math.round((count / (totalLeads || 1)) * 100)
    })).sort((a, b) => b.count - a.count);
  }, [filteredLeads, totalLeads]);

  const firmographics = useMemo(() => {
    const sectors: Record<string, number> = {}, provinces: Record<string, number> = {}, sizes: Record<string, number> = {};
    filteredLeads.forEach(l => {
      sectors[l.payload?.company?.sector || 'No especificado'] = (sectors[l.payload?.company?.sector || 'No especificado'] || 0) + 1;
      provinces[l.payload?.company?.province || 'No especificada'] = (provinces[l.payload?.company?.province || 'No especificada'] || 0) + 1;
      sizes[l.payload?.company?.employee_range || 'Desconocido'] = (sizes[l.payload?.company?.employee_range || 'Desconocido'] || 0) + 1;
    });
    return {
      sectors: Object.entries(sectors).map(([k, v]) => ({ name: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 5),
      provinces: Object.entries(provinces).map(([k, v]) => ({ name: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 5),
      sizes: Object.entries(sizes).map(([k, v]) => ({ name: k, count: v })).sort((a, b) => b.count - a.count)
    };
  }, [filteredLeads]);

  const timelineData = useMemo(() => {
    const last14Days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i));
      return d.toISOString().split('T')[0];
    });
    const timelineMap = Object.fromEntries(last14Days.map(d => [d, 0]));
    filteredLeads.forEach(l => {
      const dateStr = new Date(l.created_at).toISOString().split('T')[0];
      if (timelineMap[dateStr] !== undefined) timelineMap[dateStr]++;
    });
    return last14Days.map(dateStr => ({ date: dateStr.split('-').reverse().slice(0, 2).join('/'), count: timelineMap[dateStr] }));
  }, [filteredLeads]);

  const svgLinePoints = useMemo(() => {
    const maxVal = Math.max(...timelineData.map(d => d.count), 5);
    return timelineData.map((d, i) => `${i * (450 / 13) + 25},${130 - (d.count / maxVal) * 95}`).join(' ');
  }, [timelineData]);

  const temporalTrends = useMemo(() => {
    const daysArr = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const daysMap = Array(7).fill(0);
    filteredLeads.forEach(l => daysMap[new Date(l.created_at).getDay()]++);
    return { dayCounts: daysArr.map((name, idx) => ({ name, count: daysMap[idx] })) };
  }, [filteredLeads]);

  const videoAnalytics = useMemo(() => {
    const videoEvents = filteredEvents.filter((e: any) => e.properties?.video_id === 'hero_explicativo_3min');
    const plays = videoEvents.filter((e: any) => e.event_name === 'video_play').length;
    const p25 = videoEvents.filter((e: any) => e.event_name === 'video_progress' && e.properties?.play_percent === 25).length;
    const p50 = videoEvents.filter((e: any) => e.event_name === 'video_progress' && e.properties?.play_percent === 50).length;
    const p75 = videoEvents.filter((e: any) => e.event_name === 'video_progress' && e.properties?.play_percent === 75).length;
    const p100 = videoEvents.filter((e: any) => e.event_name === 'video_progress' && e.properties?.play_percent === 100).length;
    const completes = videoEvents.filter((e: any) => e.event_name === 'video_complete').length;
    const abandons = videoEvents.filter((e: any) => e.event_name === 'video_pause' || e.event_name === 'video_abandon');
    const totalAbandonSeconds = abandons.reduce((acc, curr) => acc + (Number(curr.properties?.current_time_seconds) || 0), 0);
    return { plays, p25: plays > 0 ? Math.round((p25 / plays) * 100) : 0, p50: plays > 0 ? Math.round((p50 / plays) * 100) : 0, p75: plays > 0 ? Math.round((p75 / plays) * 100) : 0, p100: plays > 0 ? Math.round((Math.max(p100, completes) / plays) * 100) : 0, avgAbandonSec: abandons.length > 0 ? Math.round(totalAbandonSeconds / abandons.length) : 0 };
  }, [filteredEvents]);

  const testFriction = useMemo(() => {
    const qCounts = Array(11).fill(0);
    const checklistEvents = filteredEvents.filter((e: any) => e.event_name?.startsWith('checklist_'));
    // IMPORTANTE: usar checklist_interactive_START (clic real del usuario), NO checklist_interactive_open
    // (que se dispara al hacer scroll hasta la sección y produce 143 falsos positivos)
    const starts = checklistEvents.filter((e: any) => e.event_name === 'checklist_interactive_start').length;
    checklistEvents.forEach((e: any) => {
      if (e.event_name === 'checklist_question_answered') {
        const qId = e.properties?.question_id;
        if (qId === 'intro') qCounts[0]++;
        else if (qId?.startsWith('q')) {
          const num = parseInt(qId.substring(1));
          if (num >= 1 && num <= 10) qCounts[num]++;
        }
      }
    });

    const answeredByAnon: Record<string, { lastQuestion: string; answersCount: number; lastTime: string; utm: any }> = {};
    filteredEvents.forEach((e: any) => {
      const anonId = e.anonymous_id;
      if (!anonId) return;
      if (e.event_name === 'checklist_question_answered') {
        if (!answeredByAnon[anonId]) {
          answeredByAnon[anonId] = { 
            lastQuestion: '', 
            answersCount: 0, 
            lastTime: e.occurred_at || '', 
            utm: { 
              utm_source: e.properties?.utm_source || 'Directo / Orgánico', 
              utm_campaign: e.properties?.utm_campaign || 'Sin Campaña' 
            } 
          };
        }
        answeredByAnon[anonId].answersCount++;
        if (e.properties?.question_id) {
          answeredByAnon[anonId].lastQuestion = e.properties.question_id;
        }
      }
    });

    const leadAnonIds = new Set(filteredLeads.map((l: any) => l.payload?.anonymous_id).filter(Boolean));
    
    const partialSubmissionsList = Object.entries(answeredByAnon)
      .filter(([anonId]) => !leadAnonIds.has(anonId))
      .map(([anonId, data]) => ({ 
        anonId, 
        lastQuestionLabel: data.lastQuestion === 'intro' ? 'Inicio' : data.lastQuestion.toUpperCase(), 
        answersCount: data.answersCount, 
        utm: data.utm, 
        time: data.lastTime 
      }))
      .filter(p => p.answersCount > 0 && p.answersCount < 11)
      .sort((a, b) => b.answersCount - a.answersCount)
      .slice(0, 10);

    let worstQuestion = 'Ninguno';
    let maxDropRate = 0;
    if (starts > 0) {
      const stopsCount: Record<string, number> = {};
      Object.entries(answeredByAnon)
        .filter(([anonId]) => !leadAnonIds.has(anonId))
        .forEach(([, data]) => {
          if (data.lastQuestion) {
            stopsCount[data.lastQuestion] = (stopsCount[data.lastQuestion] || 0) + 1;
          }
        });

      Object.entries(stopsCount).forEach(([qId, count]) => {
        const dropRate = Math.round((count / starts) * 100);
        if (dropRate > maxDropRate) {
          maxDropRate = dropRate;
          worstQuestion = qId === 'intro' ? 'Inicio del Test' : `Pregunta ${qId.toUpperCase()}`;
        }
      });
    }

    return { 
      starts, 
      qCounts, 
      completionRate: starts > 0 ? Math.round((qCounts[10] / starts) * 100) : 0, 
      partialSubmissionsList,
      worstQuestion,
      maxDropRate
    };
  }, [filteredEvents, filteredLeads]);

  const testConnection = async () => {
    setPingStatus('testing');
    const start = performance.now();
    try {
      await fetch('/api/deliveries/retry', { method: 'GET' }).catch(() => null);
      setDbLatency(Math.round(performance.now() - start));
      setPingStatus('ok');
    } catch {
      setPingStatus('error');
    }
  };

  const handleRetry = async (retryDead = false) => {
    setLoadingRetry(true);
    setRetryResult(null);
    try {
      const res = await fetch('/api/deliveries/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryDead }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fallo');
      setRetryResult({ ok: true, ...data });
    } catch (err) {
      setRetryResult({ ok: false, error: err instanceof Error ? err.message : 'Error' });
    } finally {
      setLoadingRetry(false);
    }
  };

  return (
    <div className="dashboard-shell">
      <div className="shell">
        <aside className="sidebar">
        <div className="brand">Data Brain</div>
        <nav className="nav">
          <button className={activeView === 'panel' ? 'nav-active' : ''} onClick={() => setActiveView('panel')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
            Panel de Control
          </button>
          <button className={activeView === 'fuentes' ? 'nav-active' : ''} onClick={() => setActiveView('fuentes')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Fuentes de Datos
          </button>
          <button className={activeView === 'ajustes' ? 'nav-active' : ''} onClick={() => setActiveView('ajustes')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.5 1z"/></svg>
            Ajustes Generales
          </button>
        </nav>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>
              {activeView === 'panel' && 'Inteligencia Comercial Data Brain'}
              {activeView === 'fuentes' && 'Orquestación de Fuentes de Datos'}
              {activeView === 'ajustes' && 'Ajustes de Parámetros Generales'}
            </h1>
          </div>
          <div className="pills" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="pill">API: OK</span>
            <span className="pill">Supabase: Conectado</span>
            <button 
              onClick={toggleTheme} 
              aria-label="Cambiar tema" 
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px',
                borderRadius: '6px',
                transition: 'all 0.15s',
              }}
              className="theme-toggle-btn"
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>
          </div>
        </div>

        {activeView === 'panel' && (
          <div className="dashboard-panel">
            <div className="tabs-bar">
              <button className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}>Resumen & Estado</button>
              <button className={`tab-btn ${activeTab === 'channels' ? 'active' : ''}`} onClick={() => setActiveTab('channels')}>Canales & Copys</button>
              <button className={`tab-btn ${activeTab === 'friction' ? 'active' : ''}`} onClick={() => setActiveTab('friction')}>Fricción & Abandonos</button>
              <button className={`tab-btn ${activeTab === 'behavior' ? 'active' : ''}`} onClick={() => setActiveTab('behavior')}>Comportamiento & Vídeo</button>
              <button className={`tab-btn ${activeTab === 'godmode' ? 'active' : ''}`} onClick={() => setActiveTab('godmode')}>⚡ God Mode</button>
              <button className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>🤖 Analista IA</button>
            </div>

            {/* ── PANEL DE CONTROL DE FILTROS AVANZADOS (MODO DIOS - DATA SCIENCE) ──────────────── */}
            <div className="god-mode-filters" style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              padding: '20px',
              borderRadius: '12px',
              marginTop: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔬</span> Panel de Control y Segmentación Avanzada (Data Science - Modo Dios)
                </span>
                <span style={{ fontSize: '11px', background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '4px 8px', borderRadius: '4px' }}>
                  Mostrando <strong>{totalLeads}</strong> de <strong>{rawLeads.length}</strong> leads ({rawLeads.length > 0 ? ((totalLeads / rawLeads.length) * 100).toFixed(0) : 0}%)
                </span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                {/* 1. Temporalidad */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>📅 RANGO TEMPORAL</label>
                  <select 
                    value={dateFilter} 
                    onChange={(e) => setDateFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todo el Historial</option>
                    <option value="today">Hoy</option>
                    <option value="yesterday">Ayer</option>
                    <option value="7days">Últimos 7 días</option>
                    <option value="30days">Últimos 30 días</option>
                    <option value="custom">Rango Personalizado...</option>
                  </select>
                  
                  {dateFilter === 'custom' && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <input 
                        type="date" 
                        value={customStartDate} 
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '4px 6px', color: '#fff', borderRadius: '4px', fontSize: '11px', width: '50%' }}
                      />
                      <input 
                        type="date" 
                        value={customEndDate} 
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '4px 6px', color: '#fff', borderRadius: '4px', fontSize: '11px', width: '50%' }}
                      />
                    </div>
                  )}
                </div>

                {/* 2. Tráfico UTM Source */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>📢 CANALES (UTM SOURCE)</label>
                  <select 
                    value={sourceFilter} 
                    onChange={(e) => setSourceFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todos los Canales</option>
                    <option value="direct">Directo / Orgánico</option>
                    <option value="linkedin">LinkedIn Ads / Orgánico</option>
                    <option value="referral">Referencias y Enlaces</option>
                    {uniqueSources.filter(s => !['direct', 'linkedin', 'referral'].includes(s.toLowerCase())).map((src: any) => (
                      <option key={src} value={src}>{src}</option>
                    ))}
                  </select>
                </div>

                {/* 3. Campaña UTM */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>🎯 CAMPAÑA (UTM CAMPAIGN)</label>
                  <select 
                    value={campaignFilter} 
                    onChange={(e) => setCampaignFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todas las Campañas</option>
                    {uniqueCampaigns.map((camp: any) => (
                      <option key={camp} value={camp}>{camp}</option>
                    ))}
                  </select>
                </div>

                {/* 4. Imán de Leads */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>🧲 IMÁN DE LEADS (MAGNET)</label>
                  <select 
                    value={magnetFilter} 
                    onChange={(e) => setMagnetFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todos los Imanes</option>
                    <option value="calculator">Calculadora de Crédito</option>
                    <option value="checklist">Checklist 10 Errores</option>
                    <option value="interactive_checklist">Autodiagnóstico (Test)</option>
                    <option value="webinar">Plaza de Webinar</option>
                    <option value="diagnostic">Diagnóstico 1:1</option>
                  </select>
                </div>

                {/* 5. Provincia */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>📍 PROVINCIA</label>
                  <select 
                    value={provinceFilter} 
                    onChange={(e) => setProvinceFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todas las Provincias ({uniqueProvinces.length})</option>
                    {uniqueProvinces.map((p: any) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* 6. Sector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>🏭 SECTOR INDUSTRIAL</label>
                  <select 
                    value={sectorFilter} 
                    onChange={(e) => setSectorFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todos los Sectores ({uniqueSectors.length})</option>
                    {uniqueSectors.map((s: any) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* 7. Tamaño de Plantilla */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>👥 TAMAÑO EMPRESA (EMPLEADOS)</label>
                  <select 
                    value={companySizeFilter} 
                    onChange={(e) => setCompanySizeFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todos los Tamaños ({uniqueSizes.length})</option>
                    {uniqueSizes.map((sz: any) => (
                      <option key={sz} value={sz}>{sz}</option>
                    ))}
                  </select>
                </div>

                {/* 8. Scoring Térmico */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>⚡ CALIFICACIÓN DE LEAD</label>
                  <select 
                    value={classificationFilter} 
                    onChange={(e) => setClassificationFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todas las Clasificaciones</option>
                    <option value="priority">⚡ Prioritario (Score 75+)</option>
                    <option value="hot">Caliente (Score 50-75)</option>
                    <option value="warm">Templado (Score 20-50)</option>
                    <option value="cold">Frío (Score 0-20)</option>
                  </select>
                </div>

                {/* 9. Usó Fundae Antes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>🔄 USÓ FUNDAE ANTES</label>
                  <select 
                    value={usedFundaeFilter} 
                    onChange={(e) => setUsedFundaeFilter(e.target.value)}
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '6px', fontSize: '12px', width: '100%' }}
                  >
                    <option value="all">Todos</option>
                    <option value="Sí">Sí</option>
                    <option value="No">No</option>
                    <option value="No lo sé">No lo sé</option>
                  </select>
                </div>

                {/* 10. Rango de Lead Score Exacto */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>📊 RANGO SCORE EXACTO ({minScore} - {maxScore} pts)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={minScore} 
                      onChange={(e) => setMinScore(Number(e.target.value))}
                      style={{ width: '50%', accentColor: '#3b82f6' }} 
                    />
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={maxScore} 
                      onChange={(e) => setMaxScore(Number(e.target.value))}
                      style={{ width: '50%', accentColor: '#ef4444' }} 
                    />
                  </div>
                </div>
              </div>

              {/* Botón de Limpieza Global */}
              {(dateFilter !== 'all' || classificationFilter !== 'all' || magnetFilter !== 'all' || sourceFilter !== 'all' || campaignFilter !== 'all' || companySizeFilter !== 'all' || usedFundaeFilter !== 'all' || knowsCreditFilter !== 'all' || minScore > 0 || maxScore < 100 || provinceFilter !== 'all' || sectorFilter !== 'all') && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                  <button 
                    onClick={() => {
                      setDateFilter('all');
                      setCustomStartDate('');
                      setCustomEndDate('');
                      setClassificationFilter('all');
                      setMagnetFilter('all');
                      setSourceFilter('all');
                      setMediumFilter('all');
                      setCampaignFilter('all');
                      setCompanySizeFilter('all');
                      setUsedFundaeFilter('all');
                      setKnowsCreditFilter('all');
                      setMinScore(0);
                      setMaxScore(100);
                      setProvinceFilter('all');
                      setSectorFilter('all');
                    }}
                    style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Resetear Todos los Filtros
                  </button>
                </div>
              )}
            </div>

            <div className="tab-content">
              {activeTab === 'summary' && (
                <div className="tab-pane" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {recentPriorityLeads.length > 0 && (
                    <div className="priority-alert-banner">
                      <div className="alert-badge">⚡ ALERTA EN TIEMPO REAL</div>
                      <div className="alert-content">
                        Entró lead prioritario: <strong>{recentPriorityLeads[0].payload?.contact?.name || 'Contacto'}</strong> ({recentPriorityLeads[0].payload?.contact?.role || 'Cargo'} en {recentPriorityLeads[0].payload?.contact?.company || 'Empresa'}) con score <strong style={{ color: '#ef4444' }}>{recentPriorityLeads[0].lead_score}/100</strong>.
                      </div>
                      <div className="alert-time">Hace unos minutos</div>
                    </div>
                  )}

                  <div className="stats-row">
                    <div className="metric-card"><span className="label">Total Leads</span><strong className="value">{totalLeads}</strong></div>
                    <div className="metric-card"><span className="label">Leads Prioritarios</span><strong className="value priority-text">{filteredLeads.filter((l: any) => l.lead_classification === 'priority').length}</strong></div>
                    <div className="metric-card"><span className="label">Leads Calientes</span><strong className="value hot-text">{filteredLeads.filter((l: any) => l.lead_classification === 'hot').length}</strong></div>
                    <div className="metric-card"><span className="label">Conversión</span><strong className="value">{overallConversion}%</strong></div>
                  </div>

                  <div className="split-grid" style={{ marginTop: '12px' }}>
                    {/* Visual B2B Funnel Chart */}
                    <div className="panel-card">
                      <h3>Embudo de Conversión B2B Interactivo</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
                        {[
                          { lbl: '1. Visitantes Únicos', val: uniqueVisitors, pct: 100, color: '#60a5fa' },
                          { lbl: '2. Inicios de Interacción', val: Math.max(testFriction.starts, totalLeads), pct: uniqueVisitors > 0 ? Math.round((Math.max(testFriction.starts, totalLeads) / uniqueVisitors) * 100) : 0, color: '#818cf8' },
                          { lbl: '3. Formularios Completados', val: totalLeads, pct: uniqueVisitors > 0 ? Math.round((totalLeads / uniqueVisitors) * 100) : 0, color: '#34d399' },
                          { lbl: '4. Informes PDF Descargados', val: leadsCrossAnalysis.both + leadsCrossAnalysis.onlyPdf, pct: totalLeads > 0 ? Math.round(((leadsCrossAnalysis.both + leadsCrossAnalysis.onlyPdf) / totalLeads) * 100) : 0, color: '#fb7185', isRel: true },
                          { lbl: '5. Reuniones Agendadas', val: leadsCrossAnalysis.both + leadsCrossAnalysis.onlySchedule, pct: totalLeads > 0 ? Math.round(((leadsCrossAnalysis.both + leadsCrossAnalysis.onlySchedule) / totalLeads) * 100) : 0, color: '#fbbf24', isRel: true }
                        ].map((step, idx) => (
                          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
                              <span style={{ fontWeight: 600 }}>{step.lbl}</span>
                              <span className="muted" style={{ fontSize: '11.5px' }}>
                                <strong>{step.val}</strong> ({step.pct}% {step.isRel ? 'de leads' : 'de visitas'})
                              </span>
                            </div>
                            <div style={{ height: '24px', background: '#1c1917', borderRadius: '6px', overflow: 'hidden', position: 'relative', border: '1px solid var(--line)' }}>
                              <div style={{ height: '100%', width: `${Math.min(100, Math.max(5, step.pct))}%`, background: `linear-gradient(90deg, ${step.color}aa, ${step.color})`, borderRadius: '4px', transition: 'all 0.4s ease' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* AI Diagnostics & Recommendations */}
                    <div className="panel-card" style={{ background: 'var(--panel)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '20px' }}>🤖</span>
                          <h3 style={{ margin: 0 }}>Recomendaciones CRO de Inteligencia Artificial</h3>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto', maxHeight: '310px' }}>
                        {aiDiagnostics.length > 0 ? (
                          aiDiagnostics.map((diag) => (
                            <div 
                              key={diag.id} 
                              style={{ 
                                borderLeft: `3px solid ${diag.status === 'critical' ? 'var(--bad)' : diag.status === 'warning' ? 'var(--warn)' : 'var(--good)'}`, 
                                background: 'var(--panel-2)',
                                padding: '12px 16px',
                                borderRadius: '0 8px 8px 0',
                                fontSize: '12.5px'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                <strong style={{ color: 'var(--text)' }}>{diag.title}</strong>
                                <span style={{ fontSize: '10px', color: diag.status === 'critical' ? 'var(--bad)' : diag.status === 'warning' ? 'var(--warn)' : 'var(--good)', fontWeight: 700 }}>
                                  {diag.status === 'critical' ? 'CRÍTICO' : diag.status === 'warning' ? 'MEJORA SUGERIDA' : 'SISTEMA CORRECTO'}
                                </span>
                              </div>
                              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--muted)' }}>
                                <strong>Fallo:</strong> {diag.fail}
                              </p>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '11px', borderTop: '1px solid var(--line)', paddingTop: '6px' }}>
                                <div>
                                  <strong>Causa:</strong> {diag.cause}
                                </div>
                                <div>
                                  <strong style={{ color: 'var(--accent)' }}>Acción:</strong> {diag.solution}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0' }}>
                            ✓ Todos los flujos funcionan con tasas de conversión óptimas.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="split-grid" style={{ marginTop: '12px' }}>
                    <div className="panel-card">
                      <h3>Cola de Sincronización</h3>
                      <div className="queue-status-list">
                        <div className="queue-item"><span>En Cola</span><strong>{initialData.queueCounts.queued}</strong></div>
                        <div className="queue-item"><span>Reintentos</span><strong>{initialData.queueCounts.retrying}</strong></div>
                        <div className="queue-item"><span>Entregados</span><strong style={{ color: '#10b981' }}>{initialData.queueCounts.delivered}</strong></div>
                        <div className="queue-item"><span>Fallidos</span><strong style={{ color: '#ef4444' }}>{initialData.queueCounts.dead_letter}</strong></div>
                      </div>
                      <div className="queue-actions">
                        <button onClick={() => handleRetry(false)} disabled={loadingRetry} className="action-btn">Reintentar En Cola</button>
                        <button onClick={() => handleRetry(true)} disabled={loadingRetry} className="action-btn danger">Reintentar Fallidos</button>
                      </div>
                    </div>
                    <div className="panel-card">
                      <h3>Estado de Integraciones</h3>
                      <div className="integration-list">
                        <div className="integration-item"><span className={`status-dot ${initialData.integrations.make ? 'ok' : 'warn'}`} /><span>Make Webhook Sync</span></div>
                        <div className="integration-item"><span className={`status-dot ${initialData.integrations.airtable ? 'ok' : 'warn'}`} /><span>Airtable API</span></div>
                        <div className="integration-item"><span className={`status-dot ${initialData.integrations.posthog ? 'ok' : 'warn'}`} /><span>PostHog Tracker</span></div>
                      </div>
                    </div>
                  </div>

                  <div className="panel-card wide-card" style={{ marginTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3 style={{ margin: 0 }}>Leads Registrados — Vista Individual</h3>
                      <span style={{ fontSize: '11px', color: 'var(--muted)', background: 'var(--panel-2)', padding: '4px 10px', borderRadius: '4px' }}>
                        {filteredLeads.length} leads · Haz clic en una fila para ver la ficha completa
                      </span>
                    </div>
                    <div className="table-responsive">
                      <table className="leads-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                            <th style={{ padding: '12px 16px' }}>Contacto / Empresa</th>
                            <th style={{ padding: '12px 16px' }}>Imán de Leads</th>
                            <th style={{ padding: '12px 16px', textAlign: 'center' }}>Score</th>
                            <th style={{ padding: '12px 16px' }}>Clasificación</th>
                            <th style={{ padding: '12px 16px', textAlign: 'center' }}>⏱ Test</th>
                            <th style={{ padding: '12px 16px', textAlign: 'center' }}>📄 PDF</th>
                            <th style={{ padding: '12px 16px', textAlign: 'center' }}>📅 Reunión</th>
                            <th style={{ padding: '12px 16px' }}>Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLeads.slice(0, 50).map((l: any, idx: number) => {
                            const score = l.lead_score ?? 0;
                            const cls = l.lead_classification || 'cold';
                            const leadId = l.id || `lead-${idx}`;
                            const isExpanded = expandedLeadId === leadId;
                            const anonId = l.payload?.anonymous_id || l.anonymous_id;

                            // Get all events for this lead via anonymous_id join
                            const leadEvents = anonId
                              ? rawEvents
                                  .filter((e: any) => e.anonymous_id === anonId)
                                  .sort((a: any, b: any) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
                              : [];

                            // Calcular tiempo total del test y por pregunta
                            const questionEvents = leadEvents.filter((e: any) => e.event_name === 'checklist_question_answered');
                            const totalTestSec = questionEvents.reduce((acc: number, e: any) => acc + (e.properties?.time_spent_seconds || 0), 0);
                            const downloadedPdf = leadEvents.some((e: any) => e.event_name === 'pdf_download' || e.event_name === 'pdf_downloaded');
                            const scheduledMeeting = leadEvents.some((e: any) => e.event_name === 'calendly_click' || e.event_name === 'calendly_redirect' || e.event_name === 'calendly_booked');
                            const completedTest = leadEvents.some((e: any) => e.event_name === 'checklist_interactive_completed');

                            const magnetNames: Record<string, string> = {
                              calculator: '📊 Calculadora',
                              checklist: '📋 Checklist',
                              interactive_checklist: '🧠 Autodiagnóstico',
                              webinar: '🎥 Webinar',
                              diagnostic: '📅 Diagnóstico 1:1'
                            };

                            const questionLabels: Record<string, string> = {
                              q1: 'Conoce el crédito FUNDAE',
                              q2: 'Sector de actividad',
                              q3: 'Número de empleados',
                              q4: 'Provincia de la empresa',
                              q5: 'Ha usado FUNDAE antes',
                              q6: 'Tipo de formación buscada',
                              q7: 'Proveedor de formación actual',
                              q8: 'Tiene Representación Legal (RLT)',
                              q9: 'Plazo de ejecución previsto',
                              q10: 'Cargo del contacto'
                            };

                            const eventIcons: Record<string, string> = {
                              page_view: '👁 Visita',
                              video_play: '▶️ Vídeo',
                              checklist_interactive_start: '▶️ Inicio Test',
                              checklist_question_answered: '💬 Pregunta',
                              checklist_interactive_completed: '✅ Test completado',
                              pdf_download: '📄 PDF descargado',
                              pdf_downloaded: '📄 PDF descargado',
                              calendly_click: '📅 Clic Calendly',
                              calendly_redirect: '📅 Redireccionado Calendly',
                              calendly_booked: '✅ Reunión Agendada',
                              calculator_submitted: '📊 Calculadora enviada',
                              form_submitted: '📝 Formulario enviado',
                            };

                            return (
                              <React.Fragment key={leadId}>
                                <tr
                                  style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--line)', fontSize: '13px', cursor: 'pointer', background: isExpanded ? 'rgba(239,68,68,0.06)' : 'transparent', transition: 'background 0.2s' }}
                                  className="lead-row"
                                  onClick={() => setExpandedLeadId(isExpanded ? null : leadId)}
                                >
                                  <td style={{ padding: '14px 16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ fontSize: '12px', color: isExpanded ? 'var(--accent)' : 'var(--muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
                                      <div>
                                        <div style={{ fontWeight: 600 }}>{l.payload?.contact?.name || l.payload?.name || 'Anónimo'}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                          {l.payload?.contact?.email || l.payload?.email || '—'} · {l.payload?.contact?.company || l.payload?.company || 'Empresa'}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding: '14px 16px', color: 'var(--text)' }}>
                                    {magnetNames[l.lead_magnet] || l.lead_magnet}
                                  </td>
                                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                    <span className={`score-badge ${score >= 80 ? 'score-priority' : score >= 60 ? 'score-hot' : score >= 40 ? 'score-warm' : 'score-low'}`}>{score}</span>
                                  </td>
                                  <td style={{ padding: '14px 16px' }}>
                                    <span className={`cls-badge ${cls}`}>{cls === 'priority' ? '⚡ Prioritario' : cls === 'hot' ? 'Caliente' : cls === 'warm' ? 'Templado' : 'Frío'}</span>
                                  </td>
                                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                    {completedTest ? (
                                      <span style={{ color: '#34d399', fontWeight: 600, fontSize: '12px' }}>
                                        {totalTestSec > 0 ? `${totalTestSec}s` : '✅'}
                                      </span>
                                    ) : questionEvents.length > 0 ? (
                                      <span style={{ color: '#eab308', fontSize: '12px' }}>Parcial ({questionEvents.length}/10)</span>
                                    ) : (
                                      <span style={{ color: 'var(--muted)', fontSize: '12px' }}>—</span>
                                    )}
                                  </td>
                                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                    <span style={{ fontSize: '16px' }}>{downloadedPdf ? '✅' : '—'}</span>
                                  </td>
                                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                    <span style={{ fontSize: '16px' }}>{scheduledMeeting ? '✅' : '—'}</span>
                                  </td>
                                  <td style={{ padding: '14px 16px', color: 'var(--muted)', fontSize: '11px' }}>{new Date(l.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                                </tr>

                                {/* ── FICHA EXPANDIBLE DEL LEAD ── */}
                                {isExpanded && (
                                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                                    <td colSpan={8} style={{ padding: '0', background: 'rgba(239,68,68,0.03)' }}>
                                      <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>

                                        {/* Columna 1: Perfil y UTMs */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '4px' }}>👤 Perfil Completo</div>
                                          {[
                                            ['Email', l.payload?.contact?.email || l.payload?.email || '—'],
                                            ['Teléfono', l.payload?.contact?.phone || l.payload?.phone || '—'],
                                            ['Cargo', l.payload?.contact?.role || '—'],
                                            ['Empresa', l.payload?.contact?.company || l.payload?.company || '—'],
                                            ['Sector', l.payload?.company?.sector || l.payload?.sector || '—'],
                                            ['Empleados', l.payload?.company?.employee_range || l.payload?.employee_range || '—'],
                                            ['Provincia', l.payload?.company?.province || l.payload?.province || '—'],
                                            ['Conoce Crédito', l.payload?.company?.knows_credit || l.payload?.knows_credit || '—'],
                                            ['Usó FUNDAE', l.payload?.company?.used_fundae_before || l.payload?.used_fundae_before || '—'],
                                          ].map(([k, v]) => (
                                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                                              <span style={{ color: 'var(--muted)' }}>{k}</span>
                                              <span style={{ fontWeight: 500, maxWidth: '140px', textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
                                            </div>
                                          ))}
                                          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', marginTop: '8px', marginBottom: '4px' }}>📢 Origen (UTMs)</div>
                                          {[
                                            ['Source', l.payload?.utm_source || l.payload?.tracking_context?.utm_source || 'Directo'],
                                            ['Medium', l.payload?.utm_medium || l.payload?.tracking_context?.utm_medium || '—'],
                                            ['Campaign', l.payload?.utm_campaign || l.payload?.tracking_context?.utm_campaign || '—'],
                                          ].map(([k, v]) => (
                                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                                              <span style={{ color: 'var(--muted)' }}>{k}</span>
                                              <span style={{ fontWeight: 500 }}>{v}</span>
                                            </div>
                                          ))}
                                        </div>

                                        {/* Columna 2: Tiempos de respuesta del Test */}
                                        {(() => {
                                          if (questionEvents.length === 0) {
                                            return (
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '4px' }}>⏱ Autodiagnóstico — Tiempos por Pregunta</div>
                                                <div style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>Este lead no realizó el test de autodiagnóstico.</div>
                                              </div>
                                            );
                                          }
                                          const allQuestionLabels: Record<string, string> = {
                                            intro: 'Introducción (¿Conoces FUNDAE?)',
                                            q1: 'Q1: Conoce el crédito FUNDAE',
                                            q2: 'Q2: Sector de actividad',
                                            q3: 'Q3: Número de empleados',
                                            q4: 'Q4: Provincia de la empresa',
                                            q5: 'Q5: Ha usado FUNDAE antes',
                                            q6: 'Q6: Tipo de formación buscada',
                                            q7: 'Q7: Proveedor de formación actual',
                                            q8: 'Q8: Tiene Representación Legal (RLT)',
                                            q9: 'Q9: Plazo de ejecución previsto',
                                            q10: 'Q10: Cargo del contacto'
                                          };
                                          const enriched = questionEvents.map((e: any, idx: number) => {
                                            const rawTime = e.properties?.time_spent_seconds;
                                            let dt: number | null = null;
                                            if (rawTime !== undefined && rawTime !== null && Number(rawTime) > 0) {
                                              dt = Number(rawTime);
                                            } else if (idx > 0 && questionEvents[idx - 1]?.occurred_at && e.occurred_at) {
                                              const prev = new Date(questionEvents[idx - 1].occurred_at).getTime();
                                              const curr = new Date(e.occurred_at).getTime();
                                              const delta = Math.round((curr - prev) / 1000);
                                              if (delta > 0 && delta < 600) dt = delta;
                                            }
                                            return { qId: e.properties?.question_id || '?', answer: e.properties?.selected_answer || '—', dt };
                                          });
                                          const computedTotal = enriched.reduce((acc: number, e: any) => acc + (e.dt || 0), 0);
                                          const hasIntro = questionEvents.some((e: any) => e.properties?.question_id === 'intro');
                                          const denominator = hasIntro ? 11 : 10;
                                          const hasRealTimes = enriched.some((e: any) => e.dt !== null);
                                          return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '4px' }}>⏱ Autodiagnóstico — Tiempos por Pregunta</div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 10px', background: 'rgba(52,211,153,0.08)', borderRadius: '6px', border: '1px solid rgba(52,211,153,0.2)' }}>
                                                <span>Tiempo Total del Test</span>
                                                <strong style={{ color: '#34d399' }}>{computedTotal > 0 ? `${computedTotal}s (${(computedTotal / 60).toFixed(1)} min)` : 'Sin datos de tiempo'}</strong>
                                              </div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '2px' }}>
                                                <span style={{ color: 'var(--muted)' }}>Pasos respondidos</span>
                                                <strong>{questionEvents.length} / {denominator}{hasIntro ? ' (incl. intro)' : ''}</strong>
                                              </div>
                                              {!hasRealTimes && (
                                                <div style={{ fontSize: '10px', color: 'var(--muted)', fontStyle: 'italic' }}>⚠️ Tiempos calculados desde timestamps (sesión anterior al tracking en vivo)</div>
                                              )}
                                              {enriched.map((item: any) => (
                                                <div key={item.qId} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                                                    <span style={{ color: 'var(--muted)' }}>{allQuestionLabels[item.qId] || item.qId}</span>
                                                    <strong style={{ color: item.dt === null ? 'var(--muted)' : item.dt > 20 ? '#eab308' : '#34d399', minWidth: '50px', textAlign: 'right' }}>
                                                      {item.dt !== null ? `${item.dt}s` : '—'}
                                                    </strong>
                                                  </div>
                                                  <div style={{ fontSize: '11px', color: 'var(--text)', paddingLeft: '6px', borderLeft: '2px solid var(--accent)' }}>
                                                    Respuesta: <strong>{item.answer}</strong>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          );
                                        })()}

                                        {/* Columna 3: Historial de Eventos (Timeline) */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '4px' }}>📋 Historial de Actividad</div>
                                          <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                                            <div style={{ flex: 1, padding: '8px 10px', background: downloadedPdf ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${downloadedPdf ? 'rgba(52,211,153,0.3)' : 'var(--line)'}`, borderRadius: '6px', textAlign: 'center' }}>
                                              <div style={{ fontSize: '18px' }}>{downloadedPdf ? '✅' : '❌'}</div>
                                              <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>PDF Descargado</div>
                                            </div>
                                            <div style={{ flex: 1, padding: '8px 10px', background: scheduledMeeting ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${scheduledMeeting ? 'rgba(52,211,153,0.3)' : 'var(--line)'}`, borderRadius: '6px', textAlign: 'center' }}>
                                              <div style={{ fontSize: '18px' }}>{scheduledMeeting ? '✅' : '❌'}</div>
                                              <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>Reunión Agendada</div>
                                            </div>
                                            <div style={{ flex: 1, padding: '8px 10px', background: completedTest ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${completedTest ? 'rgba(52,211,153,0.3)' : 'var(--line)'}`, borderRadius: '6px', textAlign: 'center' }}>
                                              <div style={{ fontSize: '18px' }}>{completedTest ? '✅' : questionEvents.length > 0 ? '⚠️' : '❌'}</div>
                                              <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>Test Completado</div>
                                            </div>
                                          </div>

                                          {leadEvents.length === 0 ? (
                                            <div style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>Sin eventos rastreados para este lead.</div>
                                          ) : (
                                            <div style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                              {leadEvents
                                                .filter((e: any) => e.event_name !== 'checklist_question_answered')
                                                .map((e: any, i: number) => {
                                                  // Robust date parsing — Supabase returns ISO with timezone offset
                                                  let dateLabel = 'Fecha desconocida';
                                                  try {
                                                    const d = new Date(e.occurred_at);
                                                    if (!isNaN(d.getTime())) {
                                                      dateLabel = d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                                                    }
                                                  } catch (_e) { /* keep default */ }
                                                  return (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: '11.5px' }}>
                                                      <span style={{ color: 'var(--accent)', minWidth: '20px' }}>·</span>
                                                      <div style={{ flex: 1 }}>
                                                        <div style={{ fontWeight: 500 }}>{eventIcons[e.event_name] || e.event_name}</div>
                                                        <div style={{ color: 'var(--muted)', fontSize: '10px' }}>{dateLabel}</div>
                                                      </div>
                                                    </div>
                                                  );
                                                })}
                                            </div>
                                          )}
                                        </div>

                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'channels' && (
                <div className="tab-pane" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div className="split-grid">
                    <div className="panel-card">
                      <h3>Canales de Adquisición (UTM Source)</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                        {channelDistribution.map((ch, idx) => (
                          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                              <span>{ch.name}</span>
                              <span className="muted">{ch.count} ({ch.percent}%)</span>
                            </div>
                            <div style={{ height: '6px', background: '#1c1917', borderRadius: '3px' }}>
                              <div style={{ height: '100%', width: `${ch.percent}%`, background: '#3b82f6', borderRadius: '3px' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="panel-card">
                      <h3>Tamaño de Empresas Convertidas</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
                        {firmographics.sizes.map((sz, idx) => {
                          const pct = Math.round((sz.count / (totalLeads || 1)) * 100);
                          return (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                              <span style={{ width: '60px', color: 'var(--muted)' }}>{sz.name}</span>
                              <div style={{ flex: 1, height: '12px', background: '#1c1917', position: 'relative', borderRadius: '3px' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: '#1e3a8a', borderRadius: '3px' }} />
                                <span style={{ position: 'absolute', right: '6px', fontSize: '9px', top: '0', fontWeight: 'bold' }}>{sz.count}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* B2B Conversion Matrix Card */}
                  <div className="panel-card">
                    <h3>Matriz de Conversión Cruzada (Descargas vs Reuniones Agendadas)</h3>
                    <p className="muted" style={{ fontSize: '12.5px', marginTop: '0', marginBottom: '16px' }}>
                      Análisis detallado de la calidad comercial de los leads. Mide si los leads interactúan con los materiales de valor (PDF) y si se convierten en reuniones de venta (Calendly).
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                      <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Solo Completó Formulario</span>
                        <strong style={{ fontSize: '24px', color: '#60a5fa', display: 'block' }}>{leadsCrossAnalysis.onlyLead}</strong>
                        <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Sin PDF ni reunión</span>
                      </div>
                      <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Solo Descargó PDF</span>
                        <strong style={{ fontSize: '24px', color: '#fb7185', display: 'block' }}>{leadsCrossAnalysis.onlyPdf}</strong>
                        <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Tiene informe, sin llamada</span>
                      </div>
                      <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Solo Agendó Reunión</span>
                        <strong style={{ fontSize: '24px', color: '#fbbf24', display: 'block' }}>{leadsCrossAnalysis.onlySchedule}</strong>
                        <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Reunión fijada, sin PDF</span>
                      </div>
                      <div style={{ background: 'rgba(52, 211, 153, 0.05)', border: '1px solid rgba(52, 211, 153, 0.2)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--good)', display: 'block', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 600 }}>Descargó y Agendó (Máximo Valor)</span>
                        <strong style={{ fontSize: '24px', color: '#34d399', display: 'block' }}>{leadsCrossAnalysis.both}</strong>
                        <span style={{ fontSize: '10px', color: 'var(--good)' }}>Lead caliente cualificado</span>
                      </div>
                    </div>
                  </div>

                  <div className="panel-card wide-card" style={{ marginTop: '12px' }}>
                    <h3>Rendimiento de Copys y Campañas (UTM ROI)</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '12px', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: '11px' }}>
                          <th style={{ padding: '10px 16px' }}>Campaña (UTM Campaign)</th>
                          <th style={{ padding: '10px 16px' }}>Canal</th>
                          <th style={{ padding: '10px 16px', textAlign: 'center' }}>Leads</th>
                          <th style={{ padding: '10px 16px', textAlign: 'center' }}>Score Promedio</th>
                          <th style={{ padding: '10px 16px', textAlign: 'center' }}>Tasa Prioritarios</th>
                          <th style={{ padding: '10px 16px' }}>Acción Recomendada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaignPerformance.map((c, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                            <td style={{ padding: '12px 16px', fontWeight: 600 }}>{c.name}</td>
                            <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>{c.source}</td>
                            <td style={{ padding: '12px 16px', textAlign: 'center' }}>{c.count}</td>
                            <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 'bold', color: c.avgScore >= 60 ? '#ef4444' : c.avgScore >= 40 ? '#eab308' : '#3b82f6' }}>{c.avgScore}</td>
                            <td style={{ padding: '12px 16px', textAlign: 'center' }}>{c.priorityRate}%</td>
                            <td style={{ padding: '12px 16px' }}>
                              <span className={`camp-action-pill ${c.avgScore >= 60 ? 'action-escalar' : c.avgScore >= 40 ? 'action-optimizar' : 'action-detener'}`}>
                                {c.avgScore >= 60 ? 'Escalar Presupuesto' : c.avgScore >= 40 ? 'Optimizar Segmentación' : 'Detener / Reescribir Copy'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'friction' && (
                <div className="tab-pane" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div className="split-grid">
                    {/* Checklist Funnel */}
                    <div className="panel-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0 }}>Embudo del Test de Autodiagnóstico</h3>
                        <span style={{ fontSize: '11px', background: 'var(--panel-2)', padding: '4px 8px', borderRadius: '4px', color: 'var(--accent)', fontWeight: 600 }}>
                          ⏱️ Tmp. Medio: {checklistCompletionTime > 0 ? `${checklistCompletionTime}s` : 'N/A'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                          <span>Iniciaron el Test</span>
                          <strong>{testFriction.starts} usuarios</strong>
                        </div>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => {
                          const count = testFriction.qCounts[num] || 0;
                          const pct = testFriction.starts > 0 ? Math.round((count / testFriction.starts) * 100) : 0;
                          return (
                            <div key={num} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
                                <span>Pregunta Q{num}</span>
                                <span>{count} ({pct}%)</span>
                              </div>
                              <div style={{ height: '4px', background: '#1c1917', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: pct < 50 ? '#ef4444' : '#34d399', borderRadius: '2px' }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* UX Friction & Question Timings */}
                    <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div>
                        <h3>Análisis de Fricción UX</h3>
                        <p className="muted" style={{ fontSize: '13px', lineHeight: 1.5, marginTop: '8px' }}>
                          {testFriction.worstQuestion !== 'Ninguno' ? (
                            <>
                              Nuestros logs indican que el mayor punto de fuga es la <strong>{testFriction.worstQuestion}</strong> con un <strong>{testFriction.maxDropRate}% de abandono</strong> sobre los usuarios iniciales del test.
                            </>
                          ) : (
                            'No se registran abandonos parciales significativos en los flujos activos.'
                          )}
                        </p>
                        {testFriction.worstQuestion !== 'Ninguno' && (
                          <div style={{ padding: '10px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '6px', fontSize: '11px', marginTop: '14px' }}>
                            ⚠️ <strong>Acción Recomendada:</strong> Simplificar o hacer opcional esta pregunta para incrementar la conversión.
                          </div>
                        )}
                      </div>

                      <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                        <h3>Tiempos de Respuesta por Pregunta</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px', maxHeight: '200px', overflowY: 'auto', paddingRight: '8px' }}>
                          {Array.from({ length: 10 }).map((_, idx) => {
                            const qId = `q${idx + 1}`;
                            const time = averageTimePerQuestion[qId] || 0;
                            const questionLabels: Record<string, string> = {
                              q1: 'Q1: Conoce crédito',
                              q2: 'Q2: Sector actividad',
                              q3: 'Q3: Número empleados',
                              q4: 'Q4: Provincia empresa',
                              q5: 'Q5: Ha usado Fundae',
                              q6: 'Q6: Tipo de formación',
                              q7: 'Q7: Proveedor actual',
                              q8: 'Q8: Tiene RLT',
                              q9: 'Q9: Plazo ejecución',
                              q10: 'Q10: Cargo contacto'
                            };

                            return (
                              <div key={qId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                                <span>{questionLabels[qId] || `Q${idx + 1}`}</span>
                                <strong style={{ color: time > 15 ? '#eab308' : '#34d399' }}>
                                  {time > 0 ? `${time}s` : 'Sin datos'}
                                </strong>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="panel-card wide-card" style={{ marginTop: '12px' }}>
                    <h3>Registros de Fugas y Abandonos Parciales</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '12px', fontSize: '12.5px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: '11px' }}>
                          <th>ID Visitante</th>
                          <th>Origen</th>
                          <th>Campaña (UTM)</th>
                          <th style={{ textAlign: 'center' }}>Pasos Completados</th>
                          <th>Punto de Fricción (Abandono)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testFriction.partialSubmissionsList.length > 0 ? (
                          testFriction.partialSubmissionsList.map((p, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                              <td style={{ padding: '10px 16px', fontWeight: 'bold' }}>Anon_{p.anonId.substring(6, 12)}</td>
                              <td style={{ padding: '10px 16px' }}><span className="pill">{p.utm.utm_source}</span></td>
                              <td style={{ padding: '10px 16px', color: 'var(--muted)' }}>{p.utm.utm_campaign}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'center' }}>{p.answersCount} / 10</td>
                              <td style={{ padding: '10px 16px', color: '#ef4444', fontWeight: 500 }}>{p.lastQuestionLabel || 'Intro'}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--muted)' }}>
                              No se registran fugas ni abandonos en el rango seleccionado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'behavior' && (
                <div className="tab-pane">
                  <div className="panel-card wide-card">
                    <h3>Tendencia de Leads Diario (Últimos 14 Días)</h3>
                    <div style={{ height: '140px', marginTop: '16px' }}>
                      <svg viewBox="0 0 500 150" width="100%" height="100%" style={{ overflow: 'visible' }}>
                        <defs>
                          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" /><stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" /></linearGradient>
                          <linearGradient id="chart-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#ef4444" /><stop offset="100%" stopColor="#eab308" /></linearGradient>
                        </defs>
                        <path d={`M 25,130 L ${svgLinePoints} L 475,130 Z`} fill="url(#area-grad)" />
                        <polyline fill="none" stroke="url(#chart-grad)" strokeWidth="2.5" points={svgLinePoints} />
                        {timelineData.map((d, i) => {
                          const maxVal = Math.max(...timelineData.map(d => d.count), 5);
                          const x = i * (450 / 13) + 25;
                          const y = 130 - (d.count / maxVal) * 95;
                          return (
                            <g key={i}>
                              <circle cx={x} cy={y} r="3" fill="#ef4444" />
                              <text x={x} y={y - 8} fontSize="8" fill="#fff" textAnchor="middle" fontWeight="bold">{d.count || ''}</text>
                              <text x={x} y="145" fontSize="7" fill="var(--muted)" textAnchor="middle">{d.date}</text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                  <div className="split-grid" style={{ marginTop: '24px' }}>
                    <div className="panel-card">
                      <h3>Leads Registrados por Día de la Semana</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                        {temporalTrends.dayCounts.map((d, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
                            <span style={{ width: '30px', color: 'var(--muted)' }}>{d.name}</span>
                            <div style={{ flex: 1, height: '8px', background: '#1c1917', borderRadius: '4px' }}>
                              <div style={{ height: '100%', width: `${Math.round((d.count / (totalLeads || 1)) * 100)}%`, background: 'linear-gradient(90deg, #eab308, #ef4444)', borderRadius: '4px' }} />
                            </div>
                            <span style={{ width: '12px', textAlign: 'right' }}>{d.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="panel-card">
                      <h3>Curva de Retención del Vídeo explicativo</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', fontSize: '12px' }}>
                        {[['Play', 100], ['Hito 25%', videoAnalytics.p25], ['Mitad 50%', videoAnalytics.p50], ['Hito 75%', videoAnalytics.p75], ['Fin 100%', videoAnalytics.p100]].map(([lbl, val], idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ width: '80px' }}>{lbl}</span>
                            <div style={{ flex: 1, height: '8px', background: '#1c1917', borderRadius: '4px' }}>
                              <div style={{ height: '100%', width: `${val}%`, background: '#10b981', borderRadius: '4px' }} />
                            </div>
                            <span style={{ width: '30px', textAlign: 'right' }}>{val}%</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: '12px', fontSize: '11px', borderTop: '1px solid var(--line)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="muted">Reproducciones Totales (Play clicks):</span>
                          <strong>{videoAnalytics.plays}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="muted">Segundo de Abandono Medio:</span>
                          <strong style={{ color: '#eab308' }}>{videoAnalytics.avgAbandonSec}s</strong>
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '4px', fontStyle: 'italic' }}>
                          ℹ️ Las visitas a la landing no cuentan como reproducciones si no hay clic real en el vídeo. Esto garantiza métricas limpias y verídicas.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'godmode' && (
                <div className="godmode-panel">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <div>
                      <h2 style={{ margin: '0 0 8px', color: 'var(--text)', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--cyan)' }}>⚡</span> God Mode Telemetry
                      </h2>
                      <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
                        Análisis microscópico del comportamiento del usuario en la landing page.
                      </p>
                    </div>
                    <ResetDataModal />
                  </div>

                  <div className="split-grid" style={{ marginBottom: '16px' }}>
                    {/* Scroll Depth */}
                    <div className="panel-card">
                      <h3>Profundidad de Scroll</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {[25, 50, 75, 100].map(pct => {
                          // TODO: compute from events
                          const reached = 0; 
                          return (
                            <div key={pct}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                                <span style={{ color: 'var(--text)', fontWeight: 600 }}>Scroll al {pct}%</span>
                                <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>{reached}%</span>
                              </div>
                              <div className="score-bar-bg">
                                <div className="score-bar-fill" style={{ width: `${reached}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tiempo Activo vs Inactivo */}
                    <div className="panel-card">
                      <h3>Tiempo en Página (Media)</h3>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '20px' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--cyan)', fontFamily: 'JetBrains Mono' }}>
                            0s <span style={{ fontSize: '14px', color: 'var(--muted)' }}>Activo</span>
                          </div>
                          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--purple)', fontFamily: 'JetBrains Mono', marginTop: '8px' }}>
                            0s <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Inactivo</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="split-grid" style={{ marginBottom: '16px' }}>
                    {/* Funnel de Lead Magnet */}
                    <div className="panel-card" style={{ gridColumn: '1 / -1' }}>
                      <h3>Funnel por Imán (Lead Magnet)</h3>
                      <div className="table-responsive">
                        <table>
                          <thead>
                            <tr>
                              <th>Imán</th>
                              <th>Vistas (Section)</th>
                              <th>Clics CTA</th>
                              <th>Completados (Leads)</th>
                              <th>Conversión</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>Esperando datos de la campaña activa...</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  
                  <div className="split-grid" style={{ marginBottom: '16px' }}>
                    {/* Comportamiento Video */}
                    <div className="panel-card">
                      <h3>Comportamiento Vídeo</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
                            <span className="muted">Impresiones (Visto en pantalla)</span>
                            <strong style={{ color: 'var(--text)' }}>0</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
                            <span className="muted">Reproducciones (Plays)</span>
                            <strong style={{ color: 'var(--text)' }}>0</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
                            <span className="muted">Tiempo Medio Visto</span>
                            <strong style={{ color: 'var(--cyan)' }}>0s</strong>
                          </div>
                      </div>
                    </div>

                    {/* Tráfico */}
                    <div className="panel-card">
                      <h3>Orígenes de Tráfico UTM</h3>
                      <div className="table-responsive">
                        <table>
                          <thead>
                            <tr>
                              <th>Source / Medium</th>
                              <th>Sesiones</th>
                              <th>Conv.</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)' }}>Sin datos UTM</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'chat' && <AnalystChat />}
            </div>
          </div>
        )}

        {activeView === 'fuentes' && (
          <div className="dashboard-panel">
            <div className="split-grid">
              <div className="panel-card">
                <h3>Base de Datos Supabase (REST API)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '6px' }}><span className="muted">Ping:</span><span>{dbLatency ? `${dbLatency}ms` : '-'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '6px' }}><span className="muted">Seguridad:</span><span>Service Role Auth</span></div>
                </div>
                <div style={{ marginTop: '16px' }}>
                  <button onClick={testConnection} className="action-btn">Probar Conexión</button>
                  {pingStatus === 'ok' && <span className="good-text" style={{ marginLeft: '10px', fontSize: '12px' }}>✓ OK ({dbLatency}ms)</span>}
                </div>
              </div>
              <div className="panel-card">
                <h3>Tablas Activas</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>leads:</span><strong>{totalLeads} filas</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>events:</span><strong>{initialData.eventsCount} eventos</strong></div>
                </div>
              </div>
            </div>
            <div className="panel-card wide-card" style={{ marginTop: '24px' }}>
              <h3>Logs de Actividad Técnicos</h3>
              <div className="table-responsive">
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '12px', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: '10.5px' }}>
                      <th style={{ padding: '8px 16px' }}>Evento</th>
                      <th style={{ padding: '8px 16px' }}>ID Visitante</th>
                      <th style={{ padding: '8px 16px' }}>Payload (Properties)</th>
                      <th style={{ padding: '8px 16px' }}>Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawEvents.slice(0, 8).map((e, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px 16px', fontFamily: 'monospace', fontWeight: 'bold' }}>{e.event_name}</td>
                        <td style={{ padding: '8px 16px', color: 'var(--muted)' }}>{e.anonymous_id?.substring(0, 10)}...</td>
                        <td style={{ padding: '8px 16px', maxWidth: '500px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {e.properties && Object.keys(e.properties).length > 0 ? (
                              (() => {
                                const whitelist = ['section', 'page_url', 'utm_source', 'utm_medium', 'utm_campaign', 'device_type', 'lead_magnet', 'question_id', 'answer', 'step'];
                                const items = Object.entries(e.properties).filter(([k, v]) => {
                                  if (!whitelist.includes(k)) return false;
                                  if (v === 'unattributed' || v === 'unknown' || v === '') return false;
                                  return typeof v !== 'object' && v !== null;
                                });

                                if (items.length === 0) {
                                  return <span style={{ color: 'var(--muted)', fontSize: '11px', fontStyle: 'italic' }}>Metadatos estándar</span>;
                                }

                                return items.map(([k, v]) => {
                                  let valStr = String(v);
                                  if (k === 'page_url') {
                                    try {
                                      const urlObj = new URL(valStr);
                                      valStr = urlObj.pathname + urlObj.search;
                                    } catch {
                                      valStr = valStr.replace(/^https?:\/\/[^\/]+/, '');
                                    }
                                    if (valStr === '') valStr = '/';
                                  }
                                  return (
                                    <span key={k} style={{ 
                                      background: 'var(--panel-2)', 
                                      border: '1px solid var(--line)', 
                                      padding: '2px 6px', 
                                      borderRadius: '4px', 
                                      fontSize: '10.5px',
                                      color: 'var(--text)',
                                      display: 'inline-flex',
                                      gap: '3px'
                                    }}>
                                      <span style={{ color: 'var(--muted)' }}>{k}:</span>
                                      <strong>{valStr}</strong>
                                    </span>
                                  );
                                });
                              })()
                            ) : (
                              <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Sin propiedades</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '8px 16px', color: 'var(--muted)' }}>{e.occurred_at ? new Date(e.occurred_at).toLocaleTimeString() : 'Recientemente'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeView === 'ajustes' && (
          <div className="dashboard-panel">
            <div className="split-grid">
              <div className="panel-card">
                <h3>Umbrales de Temperatura (Scoring Ranges)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px', fontSize: '12.5px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Templado:</span><strong>{scoreThresholds.cold} pts</strong></div>
                    <input type="range" min="20" max="50" value={scoreThresholds.cold} onChange={(e) => setScoreThresholds(prev => ({ ...prev, cold: Number(e.target.value) }))} style={{ width: '100%', accentColor: '#3b82f6' }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Caliente:</span><strong>{scoreThresholds.warm} pts</strong></div>
                    <input type="range" min="50" max="75" value={scoreThresholds.warm} onChange={(e) => setScoreThresholds(prev => ({ ...prev, warm: Number(e.target.value) }))} style={{ width: '100%', accentColor: '#eab308' }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Prioritario:</span><strong>{scoreThresholds.hot} pts</strong></div>
                    <input type="range" min="75" max="90" value={scoreThresholds.hot} onChange={(e) => setScoreThresholds(prev => ({ ...prev, hot: Number(e.target.value) }))} style={{ width: '100%', accentColor: '#ef4444' }} />
                  </div>
                </div>
              </div>
              <div className="panel-card">
                <h3>Modelo e Integraciones</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px', fontSize: '12.5px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span>Modelo Analista IA:</span>
                    <select value={selectedAIModel} onChange={(e) => setSelectedAIModel(e.target.value)} style={{ background: '#18181b', border: '1px solid var(--line)', padding: '8px', color: '#fff', borderRadius: '4px' }}>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    </select>
                  </div>
                  <div style={{ marginTop: '16px' }}>
                    <button className="action-btn" onClick={() => alert('Parámetros guardados')}>Guardar Configuración</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        .shell { display: flex; height: 100vh; overflow: hidden; background: var(--bg); color: var(--text); }
        .sidebar { width: 250px; border-right: 1px solid var(--line); padding: 24px; display: flex; flex-direction: column; gap: 24px; }
        .brand { font-size: 20px; font-weight: bold; letter-spacing: -0.03em; padding-left: 12px; }
        .nav { display: flex; flex-direction: column; gap: 8px; }
        .nav button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 1px solid transparent; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; text-align: left; transition: all 0.15s; font-size: 13.5px; }
        .nav button:hover { color: var(--text); background: var(--panel-hover); }
        .nav-active { background: var(--panel-2) !important; border-color: var(--line) !important; color: var(--text) !important; }
        .main { flex: 1; height: 100vh; padding: 0 !important; display: flex; flex-direction: column; overflow: hidden; }
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--line);
          margin: 0 !important;
          padding: 20px 32px !important;
          background: var(--bg) !important;
          flex-shrink: 0;
          z-index: 10;
        }
        .topbar h1 { font-size: 22px; font-weight: bold; margin: 0; }
        .pills { display: flex; gap: 8px; }
        .pill { background: var(--panel-2); border: 1px solid var(--line); padding: 4px 10px; border-radius: 100px; font-size: 11px; color: var(--text); }
        .theme-toggle-btn:hover { background: var(--panel-hover) !important; color: var(--text) !important; }
        .dashboard-panel { display: flex; flex-direction: column; gap: 24px; padding: 32px; flex: 1; overflow-y: auto; }
        .tabs-bar { display: flex; gap: 8px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
        .tab-btn { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13.5px; }
        .tab-btn:hover { color: var(--text); background: var(--panel-hover); }
        .tab-btn.active { background: var(--panel-2); color: var(--text); border-color: var(--line); }
        .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
        .metric-card { background: var(--panel); border: 1px solid var(--line); padding: 24px; border-radius: 12px; }
        .metric-card .label { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .metric-card .value { display: block; font-size: 32px; font-weight: bold; }
        .priority-text { color: #ef4444; }
        .hot-text { color: #ef4444; }
        .split-grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 24px; }
        .panel-card { background: var(--panel); border: 1px solid var(--line); padding: 24px; border-radius: 12px; position: relative; }
        .panel-card h3 { margin-top: 0; margin-bottom: 16px; font-size: 15px; font-weight: 600; }
        .wide-card { grid-column: span 2; }
        .queue-status-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; }
        .queue-item { background: var(--panel-2); border: 1px solid var(--line); padding: 12px; border-radius: 8px; display: flex; flex-direction: column; gap: 4px; }
        .queue-item span { font-size: 11px; color: var(--muted); }
        .queue-item strong { font-size: 18px; }
        .queue-actions { display: flex; gap: 8px; }
        .action-btn { flex: 1; background: var(--panel-hover); border: 1px solid var(--line); color: var(--text); padding: 10px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; }
        .action-btn:hover { background: var(--panel-2); }
        .action-btn.danger { background: rgba(239,68,68,0.05); border-color: rgba(239,68,68,0.2); color: #fca5a5; }
        .action-btn.danger:hover { background: rgba(239,68,68,0.1); }
        .integration-list { display: flex; flex-direction: column; gap: 12px; }
        .integration-item { display: flex; align-items: center; gap: 10px; background: var(--panel-hover); border: 1px solid var(--line); padding: 12px; border-radius: 8px; font-size: 13px; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; }
        .status-dot.ok { background: #10b981; }
        .status-dot.warn { background: #eab308; }
        .priority-alert-banner { display: flex; justify-content: space-between; align-items: center; background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.2); padding: 14px 20px; border-radius: 10px; margin-bottom: 20px; font-size: 13px; }
        .alert-badge { background: #ef4444; padding: 3px 6px; border-radius: 4px; font-size: 9px; font-weight: 800; }
        .alert-content { flex: 1; margin-left: 12px; }
        .score-badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-weight: bold; font-size: 11px; min-width: 24px; text-align: center; }
        .score-badge.score-priority { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); }
        .score-badge.score-hot { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); }
        .score-badge.score-warm { background: rgba(234,179,8,0.15); color: #eab308; border: 1px solid rgba(234,179,8,0.25); }
        .score-badge.score-low { background: rgba(59,130,246,0.15); color: #3b82f6; border: 1px solid rgba(59,130,246,0.25); }
        .cls-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10.5px; font-weight: 600; }
        .cls-badge.priority { background: #ef4444; color: #fff; }
        .cls-badge.hot { background: rgba(239,68,68,0.2); color: #ef4444; }
        .cls-badge.warm { background: rgba(234,179,8,0.2); color: #eab308; }
        .cls-badge.cold { background: rgba(59,130,246,0.2); color: #3b82f6; }
        .del-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; }
        .del-badge.delivered { background: rgba(16,185,129,0.1); color: #10b981; }
        .del-badge.queued { background: rgba(245,158,11,0.1); color: #eab308; }
        .camp-action-pill { font-size: 10.5px; padding: 3px 8px; border-radius: 4px; font-weight: 500; }
        .camp-action-pill.action-escalar { background: rgba(16,185,129,0.1); color: #10b981; }
        .camp-action-pill.action-optimizar { background: rgba(234,179,8,0.1); color: #eab308; }
        .camp-action-pill.action-detener { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
        .table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        @media (max-width: 1024px) {
          .shell { flex-direction: column; }
          .sidebar { width: 100%; border-right: none; border-bottom: 1px solid #27272a; }
          .stats-row, .split-grid { grid-template-columns: 1fr; }
          .dashboard-panel { padding: 20px; }
          .topbar { padding: 16px 20px !important; }
        }
      `}</style>
      </div>
    </div>
  );
}
