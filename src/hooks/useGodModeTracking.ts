'use client';

import { useEffect, useRef } from 'react';
import { 
  trackSessionStart, 
  trackSessionPing, 
  trackScrollMilestone, 
  trackGodModeSectionView, 
  trackGodModeCtaClick,
  trackPageExit,
  trackActiveToolAbandons,
  trackPageView,
  getCurrentTrackingContext,
} from '../lib/tracking';
import { subscribeAnalyticsConsent } from '../lib/consent';

export function useGodModeTracking() {
  const sessionRef = useRef({
    id: '',
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
  const abandonSentRef = useRef(false);

  // MODULE A - Session Init
  useEffect(() => {
    const s = sessionRef.current;
    if (typeof window === 'undefined') return;

    const initialize = () => {
      const trackingContext = getCurrentTrackingContext();
      if (!trackingContext) return;
      s.id = trackingContext.session_id;
      trackSessionStart({
        section: 'hero',
        lead_magnet: trackingContext.lead_magnet,
      });
      trackPageView();
    };
    initialize();
    return subscribeAnalyticsConsent((state) => {
      if (state === 'accepted') initialize();
      if (state === 'rejected') s.id = '';
    });
  }, []);

  // MODULE B - Time on Site (active vs inactive)
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
          active_seconds: sessionRef.current.activeSeconds,
          idle_seconds: sessionRef.current.idleSeconds,
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

  // MODULE C - Scroll Depth
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
            depth_pct: m,
            active_seconds: sessionRef.current.activeSeconds,
            section: sessionRef.current.lastVisibleSection
          });
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // MODULE D - Section Visibility
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
                section: sectionName,
                active_seconds: timeVisibleSecs,
                max_scroll_percent: sessionRef.current.maxScrollPct
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

  // MODULE F - CTA Tracking
  useEffect(() => {
    const handleCtaClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const ctaEl = target.closest('[data-track-cta]');
      if (ctaEl) {
        const ctaName = ctaEl.getAttribute('data-track-cta');
        if (ctaName) {
          sessionRef.current.ctasClicked.push(ctaName);
          trackGodModeCtaClick({
            cta_id: ctaName,
            location: sessionRef.current.lastVisibleSection,
            active_seconds: sessionRef.current.activeSeconds
          });
        }
      }
    };
    
    document.addEventListener('click', handleCtaClick, { passive: true });
    return () => document.removeEventListener('click', handleCtaClick);
  }, []);

  // MODULE G - Exit & Bounce
  useEffect(() => {
    const handleExit = (reason: 'pagehide' | 'visibility_hidden') => {
      if (abandonSentRef.current) return;
      abandonSentRef.current = true;
      trackActiveToolAbandons(reason);
      trackPageExit({
        active_seconds: sessionRef.current.activeSeconds,
        idle_seconds: sessionRef.current.idleSeconds,
        last_section: sessionRef.current.lastVisibleSection,
        max_scroll_percent: sessionRef.current.maxScrollPct,
        reason,
      });
    };

    const handlePageHide = () => handleExit('pagehide');
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleExit('visibility_hidden');
    };
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibility);
    
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}

