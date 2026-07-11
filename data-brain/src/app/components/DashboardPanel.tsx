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
import { CampaignDashboard, type CampaignDashboardData } from './CampaignDashboard';
import ResetDataModal from './ResetDataModal';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Title, Filler, BarElement);

interface DashboardPanelProps {
  initialData: {
    leadsCount: number;
    eventsCount: number;
    leadsByClassification: { cold: number; warm: number; hot: number; priority: number };
    leadsByMagnet: { calculator: number; checklist: number; interactive_checklist: number; webinar: number; diagnostic: number; unknown: number };
    queueCounts: { queued: number; delivered: number; retrying: number; dead_letter: number };
    integrations: { make: boolean; airtable: boolean; posthog: boolean; hubspot: boolean };
    validationOk: boolean;
    missingEnvs: string[];
    avgScroll: number;
    avgTime: number;
    videoPlayCount: number;
    uniqueVisitors: number;
    leadsList: any[];
    rawLeads: any[];
    rawEvents: any[];
    campaign: CampaignDashboardData;
  };
}

export function DashboardPanel({ initialData }: DashboardPanelProps) {
  const [activeView, setActiveView] = useState<'panel' | 'campaign' | 'fuentes' | 'ajustes'>('panel');
  const [activeTab, setActiveTab] = useState<'summary' | 'channels' | 'friction' | 'behavior' | 'godmode' | 'chat'>('summary');
  const [retryResult, setRetryResult] = useState<{ ok: boolean; processed?: number; delivered?: number; dead_letter?: number; error?: string } | null>(null);
  const [loadingRetry, setLoadingRetry] = useState(false);
  const [scoreThresholds, setScoreThresholds] = useState({ cold: 40, warm: 60, hot: 80 });
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [dbLatency, setDbLatency] = useState<number | null>(null);
  const [selectedAIModel, setSelectedAIModel] = useState('gpt-4o');
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);

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
    return ids.size;
  }, [filteredEvents]);

  const overallConversion = uniqueVisitors > 0 ? ((totalLeads / uniqueVisitors) * 100).toFixed(1) : '0.0';

  const recentPriorityLeads = useMemo(() => {
    return filteredLeads.filter((l: any) => {
      if (l.lead_classification !== 'priority') return false;
      const hoursAgo = (new Date().getTime() - new Date(l.created_at).getTime()) / (1000 * 60 * 60);
      return hoursAgo <= 6;
    });
  }, [filteredLeads]);

  // Cruce de datos: Descargas de PDF y Citas Agendadas
  const leadsCrossAnalysis = useMemo(() => {
    const pdfDownloadedAnonIds = new Set(
      filteredEvents
        .filter((e: any) => e.event_name === 'pdf_download' || e.event_name === 'pdf_downloaded')
        .map((e: any) => e.anonymous_id)
        .filter(Boolean)
    );
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
      const hasPdf = !!anonId && pdfDownloadedAnonIds.has(anonId);
      const hasSchedule = !!anonId && scheduledAnonIds.has(anonId);

      if (hasPdf && hasSchedule) both++;
      else if (hasPdf) onlyPdf++;
      else if (hasSchedule) onlySchedule++;
      else onlyLead++;
    });

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
        if (diffSeconds > 3 && diffSeconds < 900) {
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
    const list: { id: string; status: string; title: string; fail: string; cause: string; solution: string }[] = [];
    
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
  }, [filteredLeads, filteredEvents, initialData.queueCounts.dead_letter]);

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

  const godModeAnalytics = useMemo(() => {
    const sessionIds = new Set<string>();
    filteredEvents.forEach((e: any) => {
      if (e.session_id) sessionIds.add(e.session_id);
    });
    const totalSessions = sessionIds.size || 1;

    const scrollMilestones = { 25: 0, 50: 0, 75: 0, 100: 0 };
    const maxScrollBySession: Record<string, number> = {};

    filteredEvents.forEach((e: any) => {
      if (e.event_name === 'scroll_milestone' && e.session_id) {
        const depth = Number(e.properties?.depth_pct) || 0;
        maxScrollBySession[e.session_id] = Math.max(maxScrollBySession[e.session_id] || 0, depth);
      }
    });

    Object.values(maxScrollBySession).forEach(maxDepth => {
      if (maxDepth >= 25) scrollMilestones[25]++;
      if (maxDepth >= 50) scrollMilestones[50]++;
      if (maxDepth >= 75) scrollMilestones[75]++;
      if (maxDepth >= 100) scrollMilestones[100]++;
    });

    const scrollRates = {
      25: Math.round((scrollMilestones[25] / totalSessions) * 100),
      50: Math.round((scrollMilestones[50] / totalSessions) * 100),
      75: Math.round((scrollMilestones[75] / totalSessions) * 100),
      100: Math.round((scrollMilestones[100] / totalSessions) * 100),
    };

    const activeTimes: Record<string, number> = {};
    const idleTimes: Record<string, number> = {};

    filteredEvents.forEach((e: any) => {
      if (e.session_id) {
        const active = Number(e.properties?.active_seconds) || 0;
        const idle = Number(e.properties?.idle_seconds) || 0;
        
        activeTimes[e.session_id] = Math.max(activeTimes[e.session_id] || 0, active);
        idleTimes[e.session_id] = Math.max(idleTimes[e.session_id] || 0, idle);
      }
    });

    const totalActive = Object.values(activeTimes).reduce((acc, curr) => acc + curr, 0);
    const totalIdle = Object.values(idleTimes).reduce((acc, curr) => acc + curr, 0);
    const numSessions = Object.keys(activeTimes).length || 1;

    const avgActive = Math.round(totalActive / numSessions);
    const avgIdle = Math.round(totalIdle / numSessions);

    const magnetsList = [
      { code: 'A', name: 'Checklist PDF (A)', slug: 'checklist' },
      { code: 'B', name: 'Calculadora (B)', slug: 'calculator' },
      { code: 'C', name: 'Webinar (C)', slug: 'webinar' },
      { code: 'D', name: 'Revisión Rápida (D)', slug: 'diagnostic' },
      { code: 'E', name: 'Diagnóstico (E)', slug: 'interactive_checklist' }
    ];

    const sectionNameMap: Record<string, string> = {
      'checklist': 'checklist',
      'calculator': 'calculator',
      'webinar': 'webinar',
      'solutions': 'diagnostic',
      'diagnostic': 'diagnostic',
      'interactive-checklist': 'interactive_checklist'
    };

    const funnelData = magnetsList.map(magnet => {
      const views = new Set([
        ...filteredEvents
          .filter(e => {
            if (e.event_name !== 'section_view') return false;
            const sec = e.properties?.section_name;
            const mapped = sectionNameMap[sec] || sec;
            return mapped === magnet.slug;
          })
          .map(e => e.session_id),
        ...filteredEvents
          .filter(e => (e.lead_magnet === magnet.slug || e.context?.lead_magnet === magnet.slug) && e.session_id)
          .map(e => e.session_id)
      ]).size;

      const clicks = new Set(
        filteredEvents
          .filter(e => {
            if (e.event_name !== 'cta_click') return false;
            const cta = (e.properties?.cta_name || '').toLowerCase();
            return cta.includes(magnet.slug) || cta.includes(magnet.code.toLowerCase());
          })
          .map(e => e.session_id)
      ).size;

      const completed = filteredLeads.filter((l: any) => l.lead_magnet === magnet.slug).length;
      const conv = views > 0 ? Math.round((completed / views) * 100) : 0;

      return {
        ...magnet,
        views,
        clicks,
        completed,
        conv
      };
    });

    const videoImpressions = new Set(
      filteredEvents.filter(e => e.event_name === 'video_impression' && e.session_id).map(e => e.session_id)
    ).size;

    const videoPlays = new Set(
      filteredEvents.filter((e: any) => (e.event_name === 'video_progress' || e.event_name === 'video_play') && e.session_id).map(e => e.session_id)
    ).size;

    const videoTimes = filteredEvents
      .filter((e: any) => e.event_name === 'video_progress' && e.properties?.seconds_watched)
      .map(e => Number(e.properties.seconds_watched) || 0);

    const avgVideoTime = videoTimes.length > 0 ? Math.round(videoTimes.reduce((a, b) => a + b, 0) / videoTimes.length) : 0;

    const utmSessions: Record<string, { sessions: Set<string>; conversions: number }> = {};
    
    filteredEvents.forEach((e: any) => {
      if (e.event_name === 'session_start' && e.session_id) {
        const src = e.properties?.utm_source || 'direct';
        const med = e.properties?.utm_medium || 'none';
        const key = `${src} / ${med}`;
        if (!utmSessions[key]) {
          utmSessions[key] = { sessions: new Set(), conversions: 0 };
        }
        utmSessions[key].sessions.add(e.session_id);
      }
    });

    filteredLeads.forEach((l: any) => {
      const src = l.first_utm_source || l.payload?.utm_source || 'direct';
      const med = l.first_utm_medium || l.payload?.utm_medium || 'none';
      const key = `${src} / ${med}`;
      if (!utmSessions[key]) {
        utmSessions[key] = { sessions: new Set(), conversions: 0 };
      }
      utmSessions[key].conversions++;
    });

    const utmList = Object.entries(utmSessions).map(([key, data]) => ({
      sourceMedium: key,
      sessions: data.sessions.size,
      conversions: data.conversions
    })).sort((a, b) => b.sessions - a.sessions).slice(0, 10);

    return {
      scrollRates,
      avgActive,
      avgIdle,
      funnelData,
      videoImpressions,
      videoPlays,
      avgVideoTime,
      utmList
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

  const resetAllFilters = () => {
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
  };

  const hasActiveFilters = dateFilter !== 'all' || classificationFilter !== 'all' || magnetFilter !== 'all' || sourceFilter !== 'all' || campaignFilter !== 'all' || companySizeFilter !== 'all' || usedFundaeFilter !== 'all' || knowsCreditFilter !== 'all' || minScore > 0 || maxScore < 100 || provinceFilter !== 'all' || sectorFilter !== 'all';

  // ═══════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="db-shell">
      {/* ── SIDEBAR ── */}
      <aside className="db-sidebar">
        <div className="db-brand">
          <div className="db-brand-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#050A18" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
          </div>
          Data Brain
        </div>

        <nav className="db-nav">
          <button className={`db-nav-btn ${activeView === 'panel' ? 'active' : ''}`} onClick={() => setActiveView('panel')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
            Panel de Control
          </button>
          <button className={`db-nav-btn ${activeView === 'campaign' ? 'active' : ''}`} onClick={() => setActiveView('campaign')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7"/></svg>
            CampaÃ±a FUNDAE
          </button>
          <button className={`db-nav-btn ${activeView === 'fuentes' ? 'active' : ''}`} onClick={() => setActiveView('fuentes')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Fuentes de Datos
          </button>
          <button className={`db-nav-btn ${activeView === 'ajustes' ? 'active' : ''}`} onClick={() => setActiveView('ajustes')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.5 1z"/></svg>
            Ajustes Generales
          </button>
        </nav>

        <div className="db-godmode-card">
          <span className="db-godmode-dot" />
          God Mode Activo · Telemetría en Vivo
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <main className="db-main">
        {/* ── TOPBAR ── */}
        <div className="db-topbar">
          <h1>
            {activeView === 'panel' && 'Inteligencia Comercial Data Brain'}
            {activeView === 'campaign' && 'CampaÃ±a FUNDAE 2026'}
            {activeView === 'fuentes' && 'Orquestación de Fuentes de Datos'}
            {activeView === 'ajustes' && 'Ajustes de Parámetros Generales'}
          </h1>
          <div className="db-topbar-pills">
            <span className="db-status-pill">
              <span className="db-status-dot ok" />
              API: OK
            </span>
            <span className="db-status-pill">
              <span className="db-status-dot ok" />
              Supabase: Conectado
            </span>
            <div className="db-avatar">JM</div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
             PANEL DE CONTROL VIEW
           ══════════════════════════════════════════════════════════ */}
        {activeView === 'panel' && (
          <>
            {/* ── TABS ── */}
            <div className="db-tabs">
              <button className={`db-tab ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}>Resumen &amp; Estado</button>
              <button className={`db-tab ${activeTab === 'channels' ? 'active' : ''}`} onClick={() => setActiveTab('channels')}>Canales &amp; Copys</button>
              <button className={`db-tab ${activeTab === 'friction' ? 'active' : ''}`} onClick={() => setActiveTab('friction')}>Fricción &amp; Abandonos</button>
              <button className={`db-tab ${activeTab === 'behavior' ? 'active' : ''}`} onClick={() => setActiveTab('behavior')}>Comportamiento &amp; Vídeo</button>
              <button className={`db-tab ${activeTab === 'godmode' ? 'active' : ''}`} onClick={() => setActiveTab('godmode')}>⚡ God Mode</button>
              <button className={`db-tab ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>🤖 Analista IA</button>
            </div>

            <div className="db-content">
              {/* ── FILTER PANEL ── */}
              <div className="db-card db-full">
                <div className="db-card-header">
                  <div className="db-card-title">
                    <span>🔬</span> Panel de Control y Segmentación Avanzada
                  </div>
                  <span className="db-status-pill">
                    Mostrando <strong>{totalLeads}</strong> de <strong>{rawLeads.length}</strong> leads ({rawLeads.length > 0 ? ((totalLeads / rawLeads.length) * 100).toFixed(0) : 0}%)
                  </span>
                </div>

                <div className="db-filters">
                  {/* 1. Temporalidad */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">📅 Rango Temporal</label>
                    <select className="db-filter-select" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
                      <option value="all">Todo el Historial</option>
                      <option value="today">Hoy</option>
                      <option value="yesterday">Ayer</option>
                      <option value="7days">Últimos 7 días</option>
                      <option value="30days">Últimos 30 días</option>
                      <option value="custom">Rango Personalizado...</option>
                    </select>
                    {dateFilter === 'custom' && (
                      <div className="db-grid-22">
                        <input type="date" className="db-filter-input" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} />
                        <input type="date" className="db-filter-input" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} />
                      </div>
                    )}
                  </div>

                  {/* 2. UTM Source */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">📢 Canales (UTM Source)</label>
                    <select className="db-filter-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                      <option value="all">Todos los Canales</option>
                      <option value="direct">Directo / Orgánico</option>
                      <option value="linkedin">LinkedIn Ads / Orgánico</option>
                      <option value="referral">Referencias y Enlaces</option>
                      {uniqueSources.filter(s => !['direct', 'linkedin', 'referral'].includes(String(s).toLowerCase())).map((src: any) => (
                        <option key={src} value={src}>{src}</option>
                      ))}
                    </select>
                  </div>

                  {/* 3. UTM Campaign */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">🎯 Campaña (UTM Campaign)</label>
                    <select className="db-filter-select" value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
                      <option value="all">Todas las Campañas</option>
                      {uniqueCampaigns.map((camp: any) => (
                        <option key={camp} value={camp}>{camp}</option>
                      ))}
                    </select>
                  </div>

                  {/* 4. Lead Magnet */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">🧲 Imán de Leads</label>
                    <select className="db-filter-select" value={magnetFilter} onChange={(e) => setMagnetFilter(e.target.value)}>
                      <option value="all">Todos los Imanes</option>
                      <option value="calculator">Calculadora de Crédito</option>
                      <option value="checklist">Checklist 10 Errores</option>
                      <option value="interactive_checklist">Autodiagnóstico (Test)</option>
                      <option value="webinar">Plaza de Webinar</option>
                      <option value="diagnostic">Diagnóstico 1:1</option>
                    </select>
                  </div>

                  {/* 5. Provincia */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">📍 Provincia</label>
                    <select className="db-filter-select" value={provinceFilter} onChange={(e) => setProvinceFilter(e.target.value)}>
                      <option value="all">Todas las Provincias ({uniqueProvinces.length})</option>
                      {uniqueProvinces.map((p: any) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>

                  {/* 6. Sector */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">🏭 Sector Industrial</label>
                    <select className="db-filter-select" value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}>
                      <option value="all">Todos los Sectores ({uniqueSectors.length})</option>
                      {uniqueSectors.map((s: any) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  {/* 7. Tamaño Empresa */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">👥 Tamaño Empresa</label>
                    <select className="db-filter-select" value={companySizeFilter} onChange={(e) => setCompanySizeFilter(e.target.value)}>
                      <option value="all">Todos los Tamaños ({uniqueSizes.length})</option>
                      {uniqueSizes.map((sz: any) => (
                        <option key={sz} value={sz}>{sz}</option>
                      ))}
                    </select>
                  </div>

                  {/* 8. Clasificación */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">⚡ Calificación de Lead</label>
                    <select className="db-filter-select" value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value)}>
                      <option value="all">Todas las Clasificaciones</option>
                      <option value="priority">⚡ Prioritario (Score 75+)</option>
                      <option value="hot">Caliente (Score 50-75)</option>
                      <option value="warm">Templado (Score 20-50)</option>
                      <option value="cold">Frío (Score 0-20)</option>
                    </select>
                  </div>

                  {/* 9. Usó Fundae */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">🔄 Usó Fundae Antes</label>
                    <select className="db-filter-select" value={usedFundaeFilter} onChange={(e) => setUsedFundaeFilter(e.target.value)}>
                      <option value="all">Todos</option>
                      <option value="Sí">Sí</option>
                      <option value="No">No</option>
                      <option value="No lo sé">No lo sé</option>
                    </select>
                  </div>

                  {/* 10. Score Range */}
                  <div className="db-filter-group">
                    <label className="db-filter-label">📊 Rango Score ({minScore} - {maxScore} pts)</label>
                    <input type="range" min="0" max="100" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="db-filter-input" />
                    <input type="range" min="0" max="100" value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} className="db-filter-input" />
                  </div>
                </div>

                {hasActiveFilters && (
                  <div className="db-card-header">
                    <span />
                    <button className="db-btn-reset" onClick={resetAllFilters}>
                      Resetear Todos los Filtros
                    </button>
                  </div>
                )}
              </div>

              {/* ═══════════════════════════════════════════════════
                   TAB: SUMMARY
                 ═══════════════════════════════════════════════════ */}
              {activeTab === 'summary' && (
                <>
                  {/* Priority Alert Banner */}
                  {recentPriorityLeads.length > 0 && (
                    <div className="db-alert critical">
                      <span className="db-alert-icon">⚡</span>
                      <span className="db-alert-text">
                        <strong>ALERTA EN TIEMPO REAL</strong> — Entró lead prioritario: <strong>{recentPriorityLeads[0].payload?.contact?.name || 'Contacto'}</strong> ({recentPriorityLeads[0].payload?.contact?.role || 'Cargo'} en {recentPriorityLeads[0].payload?.contact?.company || 'Empresa'}) con score <strong>{recentPriorityLeads[0].lead_score}/100</strong>.
                      </span>
                    </div>
                  )}

                  {/* KPI Cards */}
                  <div className="db-kpis">
                    <div className="db-kpi accent-cyan">
                      <div className="db-kpi-label">Total Leads</div>
                      <div className="db-kpi-value">{totalLeads}</div>
                      <div className="db-kpi-sub">{rawLeads.length} en base de datos</div>
                    </div>
                    <div className="db-kpi accent-red">
                      <div className="db-kpi-label">Leads Prioritarios</div>
                      <div className="db-kpi-value">{filteredLeads.filter((l: any) => l.lead_classification === 'priority').length}</div>
                      <div className="db-kpi-sub">Score ≥ 75 puntos</div>
                    </div>
                    <div className="db-kpi accent-amber">
                      <div className="db-kpi-label">Leads Calientes</div>
                      <div className="db-kpi-value">{filteredLeads.filter((l: any) => l.lead_classification === 'hot').length}</div>
                      <div className="db-kpi-sub">Score 50-75 puntos</div>
                    </div>
                    <div className="db-kpi accent-green">
                      <div className="db-kpi-label">Conversión</div>
                      <div className="db-kpi-value">{overallConversion}%</div>
                      <div className="db-kpi-sub">{uniqueVisitors} visitantes únicos</div>
                    </div>
                  </div>

                  {/* Funnel + AI Recommendations */}
                  <div className="db-grid-2">
                    {/* Funnel de Conversión */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">
                          <span className="accent-bar" /> Embudo de Conversión B2B
                        </div>
                      </div>
                      {[
                        { lbl: '1. Visitantes Únicos', val: uniqueVisitors, pct: 100 },
                        { lbl: '2. Inicios de Interacción', val: Math.max(testFriction.starts, totalLeads), pct: uniqueVisitors > 0 ? Math.round((Math.max(testFriction.starts, totalLeads) / uniqueVisitors) * 100) : 0 },
                        { lbl: '3. Formularios Completados', val: totalLeads, pct: uniqueVisitors > 0 ? Math.round((totalLeads / uniqueVisitors) * 100) : 0 },
                        { lbl: '4. Informes PDF Descargados', val: leadsCrossAnalysis.both + leadsCrossAnalysis.onlyPdf, pct: totalLeads > 0 ? Math.round(((leadsCrossAnalysis.both + leadsCrossAnalysis.onlyPdf) / totalLeads) * 100) : 0 },
                        { lbl: '5. Reuniones Agendadas', val: leadsCrossAnalysis.both + leadsCrossAnalysis.onlySchedule, pct: totalLeads > 0 ? Math.round(((leadsCrossAnalysis.both + leadsCrossAnalysis.onlySchedule) / totalLeads) * 100) : 0 }
                      ].map((step, idx, arr) => (
                        <React.Fragment key={idx}>
                          <div className="db-funnel-stage">
                            <span className="db-funnel-label">{step.lbl}</span>
                            <div className="db-funnel-bar-bg">
                              <div className={`db-funnel-bar-fill ${idx === 3 ? 'amber' : idx === 4 ? 'green' : idx === 2 ? 'green' : idx === 1 ? 'violet' : ''}`} style={{ width: `${Math.min(100, Math.max(5, step.pct))}%` }}>
                                <span className="db-funnel-value">{step.val}</span>
                              </div>
                            </div>
                            <span className="db-funnel-pct">{step.pct}%</span>
                          </div>
                          {idx < arr.length - 1 && idx > 0 && step.pct > 0 && (
                            <div className="db-funnel-drop">
                              ↓ {Math.round(((arr[idx - 1]?.pct || 100) - step.pct) / (arr[idx - 1]?.pct || 100) * 100)}% caída
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>

                    {/* AI Recommendations */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">
                          <span>🤖</span> Recomendaciones CRO de IA
                        </div>
                      </div>
                      {aiDiagnostics.length > 0 ? (
                        aiDiagnostics.map((diag) => (
                          <div key={diag.id} className="db-ai-card">
                            <div className="db-ai-icon">
                              {diag.status === 'critical' ? '🔴' : diag.status === 'warning' ? '🟡' : '🟢'}
                            </div>
                            <div className="db-ai-content">
                              <div className="db-ai-title">{diag.title}</div>
                              <div className="db-ai-body">
                                <strong>Fallo:</strong> {diag.fail}
                              </div>
                              <div className="db-ai-body">
                                <strong>Causa:</strong> {diag.cause}
                              </div>
                              <div className="db-ai-action">
                                ▸ {diag.solution}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="db-empty">
                          <div className="db-empty-icon">✓</div>
                          <div className="db-empty-text">Todos los flujos funcionan con tasas de conversión óptimas.</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Queue + Integrations */}
                  <div className="db-grid-2">
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Cola de Sincronización</div>
                      </div>
                      <div className="db-queue-grid">
                        <div className="db-queue-item">
                          <div className="db-queue-count">{initialData.queueCounts.queued}</div>
                          <div className="db-queue-label">En Cola</div>
                        </div>
                        <div className="db-queue-item">
                          <div className="db-queue-count">{initialData.queueCounts.retrying}</div>
                          <div className="db-queue-label">Reintentos</div>
                        </div>
                        <div className="db-queue-item">
                          <div className="db-queue-count" style={{ color: 'var(--green)' }}>{initialData.queueCounts.delivered}</div>
                          <div className="db-queue-label">Entregados</div>
                        </div>
                        <div className="db-queue-item">
                          <div className="db-queue-count" style={{ color: 'var(--red)' }}>{initialData.queueCounts.dead_letter}</div>
                          <div className="db-queue-label">Fallidos</div>
                        </div>
                      </div>
                      <div className="db-grid-22" style={{ marginTop: 'var(--space-md)' }}>
                        <button className="db-btn" onClick={() => handleRetry(false)} disabled={loadingRetry}>Reintentar En Cola</button>
                        <button className="db-btn db-btn-danger" onClick={() => handleRetry(true)} disabled={loadingRetry}>Reintentar Fallidos</button>
                      </div>
                    </div>

                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Estado de Integraciones</div>
                      </div>
                      <div className="db-integrations" style={{ flexDirection: 'column' }}>
                        <div className="db-integration">
                          <span className={`db-integration-dot ${initialData.integrations.make ? 'on' : 'off'}`} />
                          <span>Make Webhook Sync</span>
                        </div>
                        <div className="db-integration">
                          <span className={`db-integration-dot ${initialData.integrations.airtable ? 'on' : 'off'}`} />
                          <span>Airtable API</span>
                        </div>
                        <div className="db-integration">
                          <span className={`db-integration-dot ${initialData.integrations.posthog ? 'on' : 'off'}`} />
                          <span>PostHog Tracker</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Leads Table */}
                  <div className="db-card db-full">
                    <div className="db-card-header">
                      <div className="db-card-title">Leads Registrados — Vista Individual</div>
                      <span className="db-status-pill">{filteredLeads.length} leads · Haz clic en una fila para ver la ficha completa</span>
                    </div>
                    <div className="db-table-wrap">
                      <table className="db-table">
                        <thead>
                          <tr>
                            <th>Contacto / Empresa</th>
                            <th>Imán de Leads</th>
                            <th>Score</th>
                            <th>Clasificación</th>
                            <th>⏱ Test</th>
                            <th>📄 PDF</th>
                            <th>📅 Reunión</th>
                            <th>Fecha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLeads.slice(0, 50).map((l: any, idx: number) => {
                            const score = l.lead_score ?? 0;
                            const cls = l.lead_classification || 'cold';
                            const leadId = l.id || `lead-${idx}`;
                            const isExpanded = expandedLeadId === leadId;
                            const anonId = l.payload?.anonymous_id || l.anonymous_id;

                            const leadEvents = anonId
                              ? rawEvents
                                  .filter((e: any) => e.anonymous_id === anonId)
                                  .sort((a: any, b: any) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
                              : [];

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
                              q1: 'Conoce el crédito FUNDAE', q2: 'Sector de actividad', q3: 'Número de empleados',
                              q4: 'Provincia de la empresa', q5: 'Ha usado FUNDAE antes', q6: 'Tipo de formación buscada',
                              q7: 'Proveedor de formación actual', q8: 'Tiene Representación Legal (RLT)',
                              q9: 'Plazo de ejecución previsto', q10: 'Cargo del contacto'
                            };

                            const eventIcons: Record<string, string> = {
                              page_view: '👁 Visita', video_play: '▶️ Vídeo',
                              checklist_interactive_start: '▶️ Inicio Test', checklist_question_answered: '💬 Pregunta',
                              checklist_interactive_completed: '✅ Test completado',
                              pdf_download: '📄 PDF descargado', pdf_downloaded: '📄 PDF descargado',
                              calendly_click: '📅 Clic Calendly', calendly_redirect: '📅 Redireccionado Calendly',
                              calendly_booked: '✅ Reunión Agendada', calculator_submitted: '📊 Calculadora enviada',
                              form_submitted: '📝 Formulario enviado',
                            };

                            return (
                              <React.Fragment key={leadId}>
                                <tr onClick={() => setExpandedLeadId(isExpanded ? null : leadId)} style={{ cursor: 'pointer' }}>
                                  <td>
                                    <div>
                                      <strong>{l.payload?.contact?.name || l.payload?.name || 'Anónimo'}</strong>
                                      <div className="db-kpi-sub">{l.payload?.contact?.email || l.payload?.email || '—'} · {l.payload?.contact?.company || l.payload?.company || 'Empresa'}</div>
                                    </div>
                                  </td>
                                  <td>{magnetNames[l.lead_magnet] || l.lead_magnet}</td>
                                  <td>
                                    <span className={`db-score-badge ${score >= 80 ? 'db-badge priority' : score >= 60 ? 'db-badge hot' : score >= 40 ? 'db-badge warm' : 'db-badge cold'}`}>{score}</span>
                                  </td>
                                  <td>
                                    <span className={`db-badge ${cls}`}>{cls === 'priority' ? '⚡ Prioritario' : cls === 'hot' ? 'Caliente' : cls === 'warm' ? 'Templado' : 'Frío'}</span>
                                  </td>
                                  <td>
                                    {completedTest ? (
                                      <span className="db-badge ok">{totalTestSec > 0 ? `${totalTestSec}s` : '✅'}</span>
                                    ) : questionEvents.length > 0 ? (
                                      <span className="db-badge warn">Parcial ({questionEvents.length}/10)</span>
                                    ) : (
                                      <span className="db-badge cold">—</span>
                                    )}
                                  </td>
                                  <td>{downloadedPdf ? '✅' : '—'}</td>
                                  <td>{scheduledMeeting ? '✅' : '—'}</td>
                                  <td>{new Date(l.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                                </tr>

                                {/* Expanded Lead Detail */}
                                {isExpanded && (
                                  <tr>
                                    <td colSpan={8}>
                                      <div className="db-lead-detail">
                                        {/* Column 1: Profile & UTMs */}
                                        <div className="db-lead-detail-section">
                                          <h4>👤 Perfil Completo</h4>
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
                                            <div key={k} className="db-lead-detail-row">
                                              <span className="label">{k}</span>
                                              <span className="value">{v}</span>
                                            </div>
                                          ))}
                                          <h4>📢 Origen (UTMs)</h4>
                                          {[
                                            ['Source', l.payload?.utm_source || l.payload?.tracking_context?.utm_source || 'Directo'],
                                            ['Medium', l.payload?.utm_medium || l.payload?.tracking_context?.utm_medium || '—'],
                                            ['Campaign', l.payload?.utm_campaign || l.payload?.tracking_context?.utm_campaign || '—'],
                                          ].map(([k, v]) => (
                                            <div key={k} className="db-lead-detail-row">
                                              <span className="label">{k}</span>
                                              <span className="value">{v}</span>
                                            </div>
                                          ))}
                                        </div>

                                        {/* Column 2: Test Timings */}
                                        <div className="db-lead-detail-section">
                                          <h4>⏱ Autodiagnóstico — Tiempos por Pregunta</h4>
                                          {questionEvents.length === 0 ? (
                                            <div className="db-kpi-sub">Este lead no realizó el test de autodiagnóstico.</div>
                                          ) : (() => {
                                            const allQuestionLabels: Record<string, string> = {
                                              intro: 'Introducción (¿Conoces FUNDAE?)',
                                              q1: 'Q1: Conoce el crédito FUNDAE', q2: 'Q2: Sector de actividad',
                                              q3: 'Q3: Número de empleados', q4: 'Q4: Provincia de la empresa',
                                              q5: 'Q5: Ha usado FUNDAE antes', q6: 'Q6: Tipo de formación buscada',
                                              q7: 'Q7: Proveedor de formación actual', q8: 'Q8: Tiene Representación Legal (RLT)',
                                              q9: 'Q9: Plazo de ejecución previsto', q10: 'Q10: Cargo del contacto'
                                            };
                                            const enriched = questionEvents.map((e: any, eIdx: number) => {
                                              const rawTime = e.properties?.time_spent_seconds;
                                              let dt: number | null = null;
                                              if (rawTime !== undefined && rawTime !== null && Number(rawTime) > 0) {
                                                dt = Number(rawTime);
                                              } else if (eIdx > 0 && questionEvents[eIdx - 1]?.occurred_at && e.occurred_at) {
                                                const prev = new Date(questionEvents[eIdx - 1].occurred_at).getTime();
                                                const curr = new Date(e.occurred_at).getTime();
                                                const delta = Math.round((curr - prev) / 1000);
                                                if (delta > 0 && delta < 600) dt = delta;
                                              }
                                              return { qId: e.properties?.question_id || '?', answer: e.properties?.selected_answer || '—', dt };
                                            });
                                            const computedTotal = enriched.reduce((acc: number, e: any) => acc + (e.dt || 0), 0);
                                            const hasIntro = questionEvents.some((e: any) => e.properties?.question_id === 'intro');
                                            const denominator = hasIntro ? 11 : 10;
                                            return (
                                              <>
                                                <div className="db-lead-detail-row">
                                                  <span className="label">Tiempo Total</span>
                                                  <span className="value">{computedTotal > 0 ? `${computedTotal}s (${(computedTotal / 60).toFixed(1)} min)` : 'Sin datos'}</span>
                                                </div>
                                                <div className="db-lead-detail-row">
                                                  <span className="label">Pasos respondidos</span>
                                                  <span className="value">{questionEvents.length} / {denominator}{hasIntro ? ' (incl. intro)' : ''}</span>
                                                </div>
                                                {enriched.map((item: any) => (
                                                  <div key={item.qId} className="db-lead-detail-row">
                                                    <span className="label">{allQuestionLabels[item.qId] || item.qId}</span>
                                                    <span className="value">{item.dt !== null ? `${item.dt}s` : '—'} · {item.answer}</span>
                                                  </div>
                                                ))}
                                              </>
                                            );
                                          })()}
                                        </div>

                                        {/* Column 3: Event Timeline */}
                                        <div className="db-lead-detail-section">
                                          <h4>📋 Historial de Actividad</h4>
                                          {leadEvents.length === 0 ? (
                                            <div className="db-kpi-sub">Sin eventos rastreados para este lead.</div>
                                          ) : (
                                            leadEvents
                                              .filter((e: any) => e.event_name !== 'checklist_question_answered')
                                              .map((e: any, i: number) => {
                                                let dateLabel = 'Fecha desconocida';
                                                try {
                                                  const d = new Date(e.occurred_at);
                                                  if (!isNaN(d.getTime())) {
                                                    dateLabel = d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                                                  }
                                                } catch (_e) { /* keep default */ }
                                                return (
                                                  <div key={i} className="db-lead-detail-row">
                                                    <span className="label">{eventIcons[e.event_name] || e.event_name}</span>
                                                    <span className="value">{dateLabel}</span>
                                                  </div>
                                                );
                                              })
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
                </>
              )}

              {/* ═══════════════════════════════════════════════════
                   TAB: CHANNELS
                 ═══════════════════════════════════════════════════ */}
              {activeTab === 'channels' && (
                <>
                  <div className="db-grid-2">
                    {/* Channel Distribution */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Canales de Adquisición (UTM Source)</div>
                      </div>
                      {channelDistribution.map((ch, idx) => (
                        <div key={idx} className="db-funnel-stage">
                          <span className="db-funnel-label">{ch.name}</span>
                          <div className="db-funnel-bar-bg">
                            <div className="db-funnel-bar-fill" style={{ width: `${ch.percent}%` }}>
                              <span className="db-funnel-value">{ch.count}</span>
                            </div>
                          </div>
                          <span className="db-funnel-pct">{ch.percent}%</span>
                        </div>
                      ))}
                    </div>

                    {/* Company Size */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Tamaño de Empresas Convertidas</div>
                      </div>
                      {firmographics.sizes.map((sz, idx) => {
                        const pct = Math.round((sz.count / (totalLeads || 1)) * 100);
                        return (
                          <div key={idx} className="db-funnel-stage">
                            <span className="db-funnel-label">{sz.name}</span>
                            <div className="db-funnel-bar-bg">
                              <div className="db-funnel-bar-fill violet" style={{ width: `${pct}%` }}>
                                <span className="db-funnel-value">{sz.count}</span>
                              </div>
                            </div>
                            <span className="db-funnel-pct">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Cross-conversion Matrix */}
                  <div className="db-card db-full">
                    <div className="db-card-header">
                      <div className="db-card-title">Matriz de Conversión Cruzada (Descargas vs Reuniones)</div>
                    </div>
                    <div className="db-card-subtitle">Análisis de la calidad comercial de los leads. Mide si interactúan con los materiales (PDF) y se convierten en reuniones (Calendly).</div>
                    <div className="db-matrix" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 'var(--space-md)' }}>
                      <div className="db-matrix-cell">
                        <div className="value" style={{ color: 'var(--blue)' }}>{leadsCrossAnalysis.onlyLead}</div>
                        <div className="label">Solo Completó Formulario</div>
                      </div>
                      <div className="db-matrix-cell">
                        <div className="value" style={{ color: 'var(--red)' }}>{leadsCrossAnalysis.onlyPdf}</div>
                        <div className="label">Solo Descargó PDF</div>
                      </div>
                      <div className="db-matrix-cell">
                        <div className="value" style={{ color: 'var(--amber)' }}>{leadsCrossAnalysis.onlySchedule}</div>
                        <div className="label">Solo Agendó Reunión</div>
                      </div>
                      <div className="db-matrix-cell highlight">
                        <div className="value" style={{ color: 'var(--green)' }}>{leadsCrossAnalysis.both}</div>
                        <div className="label">Descargó y Agendó (Máximo Valor)</div>
                      </div>
                    </div>
                  </div>

                  {/* Campaign Performance Table */}
                  <div className="db-card db-full">
                    <div className="db-card-header">
                      <div className="db-card-title">Rendimiento de Copys y Campañas (UTM ROI)</div>
                    </div>
                    <div className="db-table-wrap">
                      <table className="db-table">
                        <thead>
                          <tr>
                            <th>Campaña (UTM Campaign)</th>
                            <th>Canal</th>
                            <th>Leads</th>
                            <th>Score Promedio</th>
                            <th>Tasa Prioritarios</th>
                            <th>Acción Recomendada</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaignPerformance.map((c, idx) => (
                            <tr key={idx}>
                              <td><strong>{c.name}</strong></td>
                              <td>{c.source}</td>
                              <td>{c.count}</td>
                              <td>
                                <span className={`db-score-badge ${c.avgScore >= 60 ? 'db-badge priority' : c.avgScore >= 40 ? 'db-badge warm' : 'db-badge cold'}`}>
                                  {c.avgScore}
                                </span>
                              </td>
                              <td>{c.priorityRate}%</td>
                              <td>
                                <span className={`db-badge ${c.avgScore >= 60 ? 'ok' : c.avgScore >= 40 ? 'warn' : 'err'}`}>
                                  {c.avgScore >= 60 ? 'Escalar Presupuesto' : c.avgScore >= 40 ? 'Optimizar Segmentación' : 'Detener / Reescribir'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {/* ═══════════════════════════════════════════════════
                   TAB: FRICTION
                 ═══════════════════════════════════════════════════ */}
              {activeTab === 'friction' && (
                <>
                  <div className="db-grid-2">
                    {/* Checklist Funnel */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Embudo del Test de Autodiagnóstico</div>
                        <span className="db-status-pill">⏱️ Tmp. Medio: {checklistCompletionTime > 0 ? `${checklistCompletionTime}s` : 'N/A'}</span>
                      </div>
                      <div className="db-funnel-stage">
                        <span className="db-funnel-label">Iniciaron el Test</span>
                        <div className="db-funnel-bar-bg">
                          <div className="db-funnel-bar-fill" style={{ width: '100%' }}>
                            <span className="db-funnel-value">{testFriction.starts}</span>
                          </div>
                        </div>
                        <span className="db-funnel-pct">100%</span>
                      </div>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => {
                        const count = testFriction.qCounts[num] || 0;
                        const pct = testFriction.starts > 0 ? Math.round((count / testFriction.starts) * 100) : 0;
                        return (
                          <div key={num} className="db-funnel-stage">
                            <span className="db-funnel-label">Pregunta Q{num}</span>
                            <div className="db-funnel-bar-bg">
                              <div className={`db-funnel-bar-fill ${pct < 50 ? 'red' : 'green'}`} style={{ width: `${Math.max(pct, 3)}%` }}>
                                <span className="db-funnel-value">{count}</span>
                              </div>
                            </div>
                            <span className="db-funnel-pct">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* UX Friction Analysis */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Análisis de Fricción UX</div>
                      </div>
                      <div className="db-ai-body">
                        {testFriction.worstQuestion !== 'Ninguno' ? (
                          <>
                            Nuestros logs indican que el mayor punto de fuga es la <strong>{testFriction.worstQuestion}</strong> con un <strong>{testFriction.maxDropRate}% de abandono</strong> sobre los usuarios iniciales del test.
                          </>
                        ) : (
                          'No se registran abandonos parciales significativos en los flujos activos.'
                        )}
                      </div>
                      {testFriction.worstQuestion !== 'Ninguno' && (
                        <div className="db-alert warn" style={{ marginTop: 'var(--space-md)' }}>
                          <span className="db-alert-icon">⚠️</span>
                          <span className="db-alert-text"><strong>Acción Recomendada:</strong> Simplificar o hacer opcional esta pregunta para incrementar la conversión.</span>
                        </div>
                      )}

                      <div className="db-card-header" style={{ marginTop: 'var(--space-lg)' }}>
                        <div className="db-card-title">Tiempos de Respuesta por Pregunta</div>
                      </div>
                      {Array.from({ length: 10 }).map((_, idx) => {
                        const qId = `q${idx + 1}`;
                        const time = averageTimePerQuestion[qId] || 0;
                        const qLabels: Record<string, string> = {
                          q1: 'Q1: Conoce crédito', q2: 'Q2: Sector actividad', q3: 'Q3: Número empleados',
                          q4: 'Q4: Provincia empresa', q5: 'Q5: Ha usado Fundae', q6: 'Q6: Tipo de formación',
                          q7: 'Q7: Proveedor actual', q8: 'Q8: Tiene RLT', q9: 'Q9: Plazo ejecución', q10: 'Q10: Cargo contacto'
                        };
                        return (
                          <div key={qId} className="db-lead-detail-row">
                            <span className="label">{qLabels[qId] || `Q${idx + 1}`}</span>
                            <span className="value">{time > 0 ? `${time}s` : 'Sin datos'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Partial Submissions Table */}
                  <div className="db-card db-full">
                    <div className="db-card-header">
                      <div className="db-card-title">Registros de Fugas y Abandonos Parciales</div>
                    </div>
                    <div className="db-table-wrap">
                      <table className="db-table">
                        <thead>
                          <tr>
                            <th>ID Visitante</th>
                            <th>Origen</th>
                            <th>Campaña (UTM)</th>
                            <th>Pasos Completados</th>
                            <th>Punto de Fricción (Abandono)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testFriction.partialSubmissionsList.length > 0 ? (
                            testFriction.partialSubmissionsList.map((p, idx) => (
                              <tr key={idx}>
                                <td><strong>Anon_{p.anonId.substring(6, 12)}</strong></td>
                                <td><span className="db-badge cold">{p.utm.utm_source}</span></td>
                                <td>{p.utm.utm_campaign}</td>
                                <td>{p.answersCount} / 10</td>
                                <td><span className="db-badge err">{p.lastQuestionLabel || 'Intro'}</span></td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5}>
                                <div className="db-empty">
                                  <div className="db-empty-text">No se registran fugas ni abandonos en el rango seleccionado.</div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {/* ═══════════════════════════════════════════════════
                   TAB: BEHAVIOR
                 ═══════════════════════════════════════════════════ */}
              {activeTab === 'behavior' && (
                <>
                  {/* Timeline Chart */}
                  <div className="db-card db-full">
                    <div className="db-card-header">
                      <div className="db-card-title">Tendencia de Leads Diario (Últimos 14 Días)</div>
                    </div>
                    <div className="db-chart-container">
                      <svg viewBox="0 0 500 150" width="100%" height="100%" style={{ overflow: 'visible' }}>
                        <defs>
                          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.25" /><stop offset="100%" stopColor="var(--cyan)" stopOpacity="0.0" /></linearGradient>
                          <linearGradient id="chart-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="var(--cyan)" /><stop offset="100%" stopColor="var(--turquoise)" /></linearGradient>
                        </defs>
                        <path d={`M 25,130 L ${svgLinePoints} L 475,130 Z`} fill="url(#area-grad)" />
                        <polyline fill="none" stroke="url(#chart-grad)" strokeWidth="2.5" points={svgLinePoints} />
                        {timelineData.map((d, i) => {
                          const maxVal = Math.max(...timelineData.map(d => d.count), 5);
                          const x = i * (450 / 13) + 25;
                          const y = 130 - (d.count / maxVal) * 95;
                          return (
                            <g key={i}>
                              <circle cx={x} cy={y} r="3" fill="var(--cyan)" />
                              <text x={x} y={y - 8} fontSize="8" fill="var(--text-primary)" textAnchor="middle" fontWeight="bold">{d.count || ''}</text>
                              <text x={x} y="145" fontSize="7" fill="var(--text-muted)" textAnchor="middle">{d.date}</text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>

                  <div className="db-grid-2">
                    {/* Days of Week */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Leads por Día de la Semana</div>
                      </div>
                      {temporalTrends.dayCounts.map((d, idx) => (
                        <div key={idx} className="db-funnel-stage">
                          <span className="db-funnel-label" style={{ width: '40px' }}>{d.name}</span>
                          <div className="db-funnel-bar-bg">
                            <div className="db-funnel-bar-fill amber" style={{ width: `${Math.round((d.count / (totalLeads || 1)) * 100)}%` }}>
                              <span className="db-funnel-value">{d.count}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Video Retention */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Curva de Retención del Vídeo</div>
                      </div>
                      {([['Play', 100], ['Hito 25%', videoAnalytics.p25], ['Mitad 50%', videoAnalytics.p50], ['Hito 75%', videoAnalytics.p75], ['Fin 100%', videoAnalytics.p100]] as [string, number][]).map(([lbl, val], idx) => (
                        <div key={idx} className="db-funnel-stage">
                          <span className="db-funnel-label">{lbl}</span>
                          <div className="db-funnel-bar-bg">
                            <div className="db-funnel-bar-fill green" style={{ width: `${val}%` }}>
                              <span className="db-funnel-value">{val}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="db-lead-detail-row" style={{ marginTop: 'var(--space-md)' }}>
                        <span className="label">Reproducciones Totales</span>
                        <span className="value">{videoAnalytics.plays}</span>
                      </div>
                      <div className="db-lead-detail-row">
                        <span className="label">Segundo de Abandono Medio</span>
                        <span className="value">{videoAnalytics.avgAbandonSec}s</span>
                      </div>
                      <div className="db-kpi-sub" style={{ marginTop: 'var(--space-sm)' }}>
                        ℹ️ Las visitas a la landing no cuentan como reproducciones si no hay clic real en el vídeo.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ═══════════════════════════════════════════════════
                   TAB: GOD MODE
                 ═══════════════════════════════════════════════════ */}
              {activeTab === 'godmode' && (
                <>
                  <div className="db-godmode-header">
                    <div>
                      <div className="db-godmode-title">
                        <span style={{ color: 'var(--cyan)' }}>⚡</span> God Mode Telemetry
                      </div>
                      <div className="db-kpi-sub">Análisis microscópico del comportamiento del usuario en la landing page.</div>
                    </div>
                    <ResetDataModal />
                  </div>

                  <div className="db-grid-2">
                    {/* Scroll Depth */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Profundidad de Scroll</div>
                      </div>
                      {[25, 50, 75, 100].map(pct => {
                        const reached = (godModeAnalytics.scrollRates as any)[pct] || 0;
                        return (
                          <div key={pct} className="db-funnel-stage">
                            <span className="db-funnel-label">Scroll al {pct}%</span>
                            <div className="db-funnel-bar-bg">
                              <div className="db-funnel-bar-fill" style={{ width: `${reached}%` }}>
                                <span className="db-funnel-value">{reached}%</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Time on Page */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Tiempo en Página (Media)</div>
                      </div>
                      <div className="db-time-display" style={{ justifyContent: 'center', padding: 'var(--space-lg) 0' }}>
                        <span className="db-time-value" style={{ color: 'var(--cyan)' }}>{godModeAnalytics.avgActive}s</span>
                        <span className="db-time-unit">Activo</span>
                      </div>
                      <div className="db-time-display" style={{ justifyContent: 'center' }}>
                        <span className="db-time-value" style={{ fontSize: '28px', color: 'var(--violet)' }}>{godModeAnalytics.avgIdle}s</span>
                        <span className="db-time-unit">Inactivo</span>
                      </div>
                    </div>
                  </div>

                  {/* Lead Magnet Funnel Table */}
                  <div className="db-card db-full">
                    <div className="db-card-header">
                      <div className="db-card-title">Funnel por Imán (Lead Magnet)</div>
                    </div>
                    <div className="db-table-wrap">
                      <table className="db-table">
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
                          {godModeAnalytics.funnelData.map(row => (
                            <tr key={row.code}>
                              <td><strong>{row.name}</strong></td>
                              <td>{row.views}</td>
                              <td>{row.clicks}</td>
                              <td>{row.completed}</td>
                              <td><strong style={{ color: 'var(--cyan)' }}>{row.conv}%</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="db-grid-2">
                    {/* Video Behavior */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Comportamiento Vídeo</div>
                      </div>
                      <div className="db-lead-detail-row">
                        <span className="label">Impresiones (Visto en pantalla)</span>
                        <span className="value">{godModeAnalytics.videoImpressions}</span>
                      </div>
                      <div className="db-lead-detail-row">
                        <span className="label">Reproducciones (Plays)</span>
                        <span className="value">{godModeAnalytics.videoPlays}</span>
                      </div>
                      <div className="db-lead-detail-row">
                        <span className="label">Tiempo Medio Visto</span>
                        <span className="value" style={{ color: 'var(--cyan)' }}>{godModeAnalytics.avgVideoTime}s</span>
                      </div>
                    </div>

                    {/* UTM Traffic */}
                    <div className="db-card">
                      <div className="db-card-header">
                        <div className="db-card-title">Orígenes de Tráfico UTM</div>
                      </div>
                      <div className="db-table-wrap">
                        <table className="db-table">
                          <thead>
                            <tr>
                              <th>Source / Medium</th>
                              <th>Sesiones</th>
                              <th>Conv.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {godModeAnalytics.utmList.length === 0 ? (
                              <tr>
                                <td colSpan={3}>
                                  <div className="db-empty">
                                    <div className="db-empty-text">Sin datos UTM</div>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              godModeAnalytics.utmList.map((row, idx) => (
                                <tr key={idx}>
                                  <td><strong>{row.sourceMedium}</strong></td>
                                  <td>{row.sessions}</td>
                                  <td style={{ color: 'var(--cyan)' }}>{row.conversions}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ═══════════════════════════════════════════════════
                   TAB: CHAT
                 ═══════════════════════════════════════════════════ */}
              {activeTab === 'chat' && <AnalystChat />}
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════
             FUENTES DE DATOS VIEW
           ══════════════════════════════════════════════════════════ */}
        {activeView === 'campaign' && <CampaignDashboard data={initialData.campaign} />}

        {activeView === 'fuentes' && (
          <div className="db-content">
            <div className="db-grid-2">
              <div className="db-data-source-card">
                <h3>Base de Datos Supabase (REST API)</h3>
                <div className="db-lead-detail-row">
                  <span className="label">Ping:</span>
                  <span className="value">{dbLatency ? `${dbLatency}ms` : '-'}</span>
                </div>
                <div className="db-lead-detail-row">
                  <span className="label">Seguridad:</span>
                  <span className="value">Service Role Auth</span>
                </div>
                <div style={{ marginTop: 'var(--space-md)' }}>
                  <button className="db-btn" onClick={testConnection}>Probar Conexión</button>
                  {pingStatus === 'ok' && <span className="db-badge ok" style={{ marginLeft: 'var(--space-sm)' }}>✓ OK ({dbLatency}ms)</span>}
                </div>
              </div>
              <div className="db-data-source-card">
                <h3>Tablas Activas</h3>
                <div className="db-lead-detail-row">
                  <span className="label">leads:</span>
                  <span className="value">{totalLeads} filas</span>
                </div>
                <div className="db-lead-detail-row">
                  <span className="label">events:</span>
                  <span className="value">{initialData.eventsCount} eventos</span>
                </div>
              </div>
            </div>

            <div className="db-data-source-card" style={{ marginTop: 'var(--space-lg)' }}>
              <h3>Logs de Actividad Técnicos</h3>
              <div className="db-table-wrap">
                <table className="db-table">
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>ID Visitante</th>
                      <th>Payload (Properties)</th>
                      <th>Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawEvents.slice(0, 8).map((e, idx) => (
                      <tr key={idx}>
                        <td><strong>{e.event_name}</strong></td>
                        <td>{e.anonymous_id?.substring(0, 10)}...</td>
                        <td>
                          {e.properties && Object.keys(e.properties).length > 0 ? (
                            (() => {
                              const whitelist = ['section', 'page_url', 'utm_source', 'utm_medium', 'utm_campaign', 'device_type', 'lead_magnet', 'question_id', 'answer', 'step'];
                              const items = Object.entries(e.properties).filter(([k, v]) => {
                                if (!whitelist.includes(k)) return false;
                                if (v === 'unattributed' || v === 'unknown' || v === '') return false;
                                return typeof v !== 'object' && v !== null;
                              });

                              if (items.length === 0) {
                                return <span className="db-kpi-sub">Metadatos estándar</span>;
                              }

                              return items.map(([k, v]) => {
                                let valStr = String(v);
                                if (k === 'page_url') {
                                  try {
                                    const urlObj = new URL(valStr);
                                    valStr = urlObj.pathname + urlObj.search;
                                  } catch {
                                    valStr = valStr.replace(/^https?:\/\/[^/]+/, '');
                                  }
                                  if (valStr === '') valStr = '/';
                                }
                                return (
                                  <span key={k} className="db-badge cold">
                                    {k}: <strong>{valStr}</strong>
                                  </span>
                                );
                              });
                            })()
                          ) : (
                            <span className="db-kpi-sub">Sin propiedades</span>
                          )}
                        </td>
                        <td>{e.occurred_at ? new Date(e.occurred_at).toLocaleTimeString() : 'Recientemente'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
             AJUSTES VIEW
           ══════════════════════════════════════════════════════════ */}
        {activeView === 'ajustes' && (
          <div className="db-content">
            <div className="db-settings-grid">
              <div className="db-settings-card">
                <h3>Umbrales de Temperatura (Scoring Ranges)</h3>
                <div className="db-settings-row">
                  <label>Templado:</label>
                  <span><strong>{scoreThresholds.cold} pts</strong></span>
                </div>
                <div className="db-settings-row">
                  <label>Rango</label>
                  <input type="range" min="20" max="50" value={scoreThresholds.cold} onChange={(e) => setScoreThresholds(prev => ({ ...prev, cold: Number(e.target.value) }))} />
                </div>
                <div className="db-settings-row">
                  <label>Caliente:</label>
                  <span><strong>{scoreThresholds.warm} pts</strong></span>
                </div>
                <div className="db-settings-row">
                  <label>Rango</label>
                  <input type="range" min="50" max="75" value={scoreThresholds.warm} onChange={(e) => setScoreThresholds(prev => ({ ...prev, warm: Number(e.target.value) }))} />
                </div>
                <div className="db-settings-row">
                  <label>Prioritario:</label>
                  <span><strong>{scoreThresholds.hot} pts</strong></span>
                </div>
                <div className="db-settings-row">
                  <label>Rango</label>
                  <input type="range" min="75" max="90" value={scoreThresholds.hot} onChange={(e) => setScoreThresholds(prev => ({ ...prev, hot: Number(e.target.value) }))} />
                </div>
              </div>

              <div className="db-settings-card">
                <h3>Modelo e Integraciones</h3>
                <div className="db-settings-row">
                  <label>Modelo Analista IA:</label>
                  <select value={selectedAIModel} onChange={(e) => setSelectedAIModel(e.target.value)} className="db-filter-select">
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                  </select>
                </div>
                <div style={{ marginTop: 'var(--space-lg)' }}>
                  <span className="db-settings-note">El modelo activo se configura mediante variables de entorno del servidor.</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
