import { useState, useRef, useEffect } from "react";
import { Play } from "lucide-react";
import { Button } from "../ui/Button";
import { copy } from "../../config/copy";
import { motion } from "motion/react";
import { trackEvent } from "../../lib/tracking";

// Helper to generate a unique play session UUID
function generateUUID(): string {
  return "vplay_" + crypto.randomUUID().replaceAll("-", "");
}

export function VideoSection() {
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const playSessionIdRef = useRef<string>("");
  const progressMarksRef = useRef<Set<number>>(new Set());
  const isVideoActiveRef = useRef<boolean>(false);
  const abandonSentRef = useRef<boolean>(false);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Helper to obtain current page scroll depth
  const getScrollDepth = (): number => {
    if (typeof window === "undefined") return 0;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    return docHeight > 0 ? Math.round((window.scrollY / docHeight) * 100) : 0;
  };

  // Unified event sender helper
  const trackVideoEvent = (
    eventName: "video_start" | "video_quartile" | "video_complete" | "video_abandon",
    video: HTMLVideoElement,
    extraPercent?: number,
    reason?: "pagehide" | "visibility_hidden",
  ) => {
    const currentTime = video.currentTime;
    const duration = video.duration || 180;
    const percent = extraPercent ?? Math.round((currentTime / duration) * 100);

    trackEvent(eventName as any, {
      section: "video",
      video_id: "hero_explicativo_3min",
      duration_seconds: Math.round(duration),
      current_time_seconds: parseFloat(currentTime.toFixed(2)),
      quartile: percent,
      play_session_id: playSessionIdRef.current,
      is_muted: video.muted,
      playback_rate: video.playbackRate || 1.0,
      scroll_depth_percent: getScrollDepth(),
      reason,
    });
  };

  const handlePlay = () => {
    setIsPlaying(true);
    isVideoActiveRef.current = true;
    abandonSentRef.current = false;
    
    // Create new play session session ID and reset marks
    playSessionIdRef.current = generateUUID();
    progressMarksRef.current.clear();

    requestAnimationFrame(() => {
      if (videoRef.current) {
        videoRef.current.play();
        trackVideoEvent("video_start", videoRef.current, 0);
      }
    });
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    
    const percent = Math.round((video.currentTime / video.duration) * 100);
    
    // Track major visual milestones
    for (const mark of [25, 50, 75]) {
      if (percent >= mark && !progressMarksRef.current.has(mark)) {
        progressMarksRef.current.add(mark);
        trackVideoEvent("video_quartile", video, mark);
      }
    }
  };

  const handleEnded = () => {
    const video = videoRef.current;
    if (!video) return;

    isVideoActiveRef.current = false;
    
    if (!progressMarksRef.current.has(100)) {
      progressMarksRef.current.add(100);
      trackVideoEvent("video_quartile", video, 100);
    }
    
    trackVideoEvent("video_complete", video, 100);
  };

  // Safe tracking for tab close/window exit (avoid missing events on mobile/fast exit)
  useEffect(() => {
    const handleAbandonment = (reason: "pagehide" | "visibility_hidden") => {
      const video = videoRef.current;
      if (video && isVideoActiveRef.current && !video.ended && video.currentTime > 0 &&
          !abandonSentRef.current) {
        abandonSentRef.current = true;
        trackVideoEvent("video_abandon", video, undefined, reason);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        handleAbandonment("visibility_hidden");
      }
    };
    const handlePageHide = () => handleAbandonment("pagehide");

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  return (
    <section className="py-24 bg-[#1E2B58] relative overflow-hidden" id="video">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-br from-blue-400/20 via-emerald-400/10 to-purple-400/20 rounded-full blur-[100px] -z-10 pointer-events-none" />

      <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl font-extrabold text-white sm:text-4xl mb-6">
            {copy.video.title}
          </h2>
          <p className="text-lg text-white/80 mb-12 max-w-2xl mx-auto leading-relaxed font-light">
            {copy.video.subtitle}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          className="relative aspect-video w-full max-w-4xl mx-auto rounded-3xl bg-slate-900 overflow-hidden shadow-2xl group flex items-center justify-center border border-slate-200 ring-4 ring-slate-50"
        >
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-emerald-400 to-purple-500 opacity-30 group-hover:opacity-60 blur-xl transition-all duration-1000 pointer-events-none" />

          <div className="relative w-full h-full rounded-3xl overflow-hidden bg-[#0A0A0A] border border-white/10 z-10 flex items-center justify-center">
            {!isPlaying && (
              <div className="absolute inset-0 bg-gradient-to-tr from-blue-900/40 to-transparent z-10 mix-blend-overlay pointer-events-none" />
            )}

            {!isPlaying ? (
              <>
                <video
                  className="absolute inset-0 w-full h-full object-cover opacity-40 transition-transform duration-1000 group-hover:scale-105"
                  src="/hero_video.mp4"
                  muted
                  loop
                  autoPlay
                  playsInline
                />
                <button
                  data-track-cta="video_play"
                  onClick={handlePlay}
                  className="relative z-20 flex h-20 w-20 items-center justify-center rounded-full bg-[#FF206E] text-[#050A18] shadow-[0_0_50px_rgba(255,32,110,0.4)] transition-all duration-300 hover:scale-110 group-hover:shadow-[0_0_80px_rgba(255,32,110,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-[#07152E]"
                  aria-label="Reproducir vídeo"
                >
                  <span className="absolute inset-0 rounded-full bg-[#FF206E] animate-ping opacity-20" aria-hidden="true" />
                  <Play className="h-8 w-8 ml-1" fill="currentColor" />
                </button>
              </>
            ) : (
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover z-20"
                src="/hero_video.mp4"
                controls
                autoPlay
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
              />
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-14"
        >
          <Button size="lg" data-track-cta="video_calculator" onClick={() => scrollTo("calculadora")} className="shadow-lg hover:shadow-xl transition-shadow">
            {copy.entryDoors.doors[0].cta}
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
