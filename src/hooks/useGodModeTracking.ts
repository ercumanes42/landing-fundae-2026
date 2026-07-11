'use client';

import { useEffect, useRef } from 'react';
import { 
  trackSessionStart, 
  trackSessionPing, 
  trackScrollMilestone, 
  trackGodModeSectionView, 
  trackVideoImpression,
  trackVideoProgress,
  trackVideoAbandoned,
  trackGodModeCtaClick,
  trackPageExit,
  getCurrentTrackingContext,
} from '../lib/tracking';

export function useGodModeTracking() {
  const sessionRef = useRef({
    id: typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(),
    startTime: Date.now(),
    activeSeconds: 0,
    idleSeconds: 0,
    maxScrollPct: 0,
    lastActiveAt: Date.now(),
    isIdle: false,
    lastVisibleSection: 'hero',
    videoWatchedSeconds: 0,
    ctasClicked: [] as string[],
    magnetsInteracted: [] as string[]
  });

  // MÃ“DULO A â€” Session Init
  useEffect(() => {
    const s = sessionRef.current;
    if (typeof window === 'undefined') return;

    const trackingContext = getCurrentTrackingContext();
    s.id = trackingContext.session_id;
    const initPayload = {
      session_id: s.id,
      utm_source: trackingContext.utm_source,
      utm_medium: trackingContext.utm_medium,
      utm_campaign: trackingContext.utm_campaign,
      utm_content: trackingContext.utm_content,
      utm_term: trackingContext.utm_term,
      timestamp_start: new Date().toISOString(),
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      viewport_size: `${window.innerWidth}x${window.innerHeight}`
    };
    
    trackSessionStart(initPayload);
  }, []);

  // MÃ“DULO B â€” Time on Site (activo vs inactivo)
  useEffect(() => {
    let idleTimeout: ReturnType<typeof setTimeout>;
    let heartbeatInterval: ReturnType<typeof setInterval>;

    const handleActivity = () => {
      sessionRef.current.isIdle = false;
      sessionRef.current.lastActiveAt = Date.now();
      
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        sessionRef.current.isIdle = true;
      }, 30000); // 30s debounce
    };

    window.addEventListener('mousemove', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity, { passive: true });
    window.addEventListener('click', handleActivity, { passive: true });
    window.addEventListener('scroll', handleActivity, { passive: true });
    
    handleActivity(); // Init

    // Heartbeat & Timer every 1 second
    const timerInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        if (sessionRef.current.isIdle) {
          sessionRef.current.idleSeconds += 1;
        } else {
          sessionRef.current.activeSeconds += 1;
        }
      }
    }, 1000);

    // Heartbeat every 60 seconds
    heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        trackSessionPing({
          session_id: sessionRef.current.id,
          active_seconds: sessionRef.current.activeSeconds,
          idle_seconds: sessionRef.current.idleSeconds,
          timestamp: new Date().toISOString()
        });
      }
    }, 60000);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      clearTimeout(idleTimeout);
      clearInterval(heartbeatInterval);
      clearInterval(timerInterval);
    };
  }, []);

  // MÃ“DULO C â€” Scroll Depth
  useEffect(() => {
    const milestones = new Set([25, 50, 75, 100]);
    const reached = new Set<number>();

    const handleScroll = () => {
      const h = document.documentElement;
      const b = document.body;
      const scrollY = h.scrollTop || b.scrollTop;
      const scrollHeight = (h.scrollHeight || b.scrollHeight) - h.clientHeight;
      const scrollPct = scrollHeight > 0 ? Math.round((scrollY / scrollHeight) * 100) : 0;
      
      if (scrollPct > sessionRef.current.maxScrollPct) {
        sessionRef.current.maxScrollPct = scrollPct;
      }

      milestones.forEach(m => {
        if (scrollPct >= m && !reached.has(m)) {
          reached.add(m);
          trackScrollMilestone({
            session_id: sessionRef.current.id,
            depth_pct: m,
            timestamp: new Date().toISOString(),
            active_seconds: sessionRef.current.activeSeconds,
            section_visible: sessionRef.current.lastVisibleSection
          });
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // MÃ“DULO D â€” Section Visibility
  useEffect(() => {
    const sectionTimers = new Map<string, number>();

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const sectionName = entry.target.getAttribute('data-section') || 'unknown';
        if (entry.isIntersecting) {
          sessionRef.current.lastVisibleSection = sectionName;
          sectionTimers.set(sectionName, Date.now());
        } else {
          const entryTime = sectionTimers.get(sectionName);
          if (entryTime) {
            const timeVisibleSecs = Math.round((Date.now() - entryTime) / 1000);
            if (timeVisibleSecs > 0) {
              trackGodModeSectionView({
                session_id: sessionRef.current.id,
                section_name: sectionName,
                time_visible_seconds: timeVisibleSecs,
                max_scroll_pct_in_section: sessionRef.current.maxScrollPct
              });
            }
            sectionTimers.delete(sectionName);
          }
        }
      });
    }, { threshold: [0, 0.5, 1.0] });

    document.querySelectorAll('[data-section]').forEach(el => observer.observe(el));
    
    return () => observer.disconnect();
  }, []);

  // MÃ“DULO F â€” CTA Tracking
  useEffect(() => {
    const handleCtaClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const ctaEl = target.closest('[data-track-cta]');
      if (ctaEl) {
        const ctaName = ctaEl.getAttribute('data-track-cta');
        if (ctaName) {
          sessionRef.current.ctasClicked.push(ctaName);
          trackGodModeCtaClick({
            session_id: sessionRef.current.id,
            cta_name: ctaName,
            section_name: sessionRef.current.lastVisibleSection,
            timestamp: new Date().toISOString(),
            active_seconds_at_click: sessionRef.current.activeSeconds
          });
        }
      }
    };
    
    document.addEventListener('click', handleCtaClick, { passive: true });
    return () => document.removeEventListener('click', handleCtaClick);
  }, []);

  // MÃ“DULO G â€” Exit & Bounce
  useEffect(() => {
    const handleExit = () => {
      trackPageExit({
        session_id: sessionRef.current.id,
        active_seconds: sessionRef.current.activeSeconds,
        idle_seconds: sessionRef.current.idleSeconds,
        last_section_visible: sessionRef.current.lastVisibleSection,
        max_scroll_depth_pct: sessionRef.current.maxScrollPct,
        video_seconds_watched: sessionRef.current.videoWatchedSeconds,
        ctas_clicked: sessionRef.current.ctasClicked,
        magnets_interacted: sessionRef.current.magnetsInteracted,
        exit_timestamp: new Date().toISOString()
      });
    };

    window.addEventListener('beforeunload', handleExit);
    window.addEventListener('pagehide', handleExit);
    
    return () => {
      window.removeEventListener('beforeunload', handleExit);
      window.removeEventListener('pagehide', handleExit);
    };
  }, []);
}

