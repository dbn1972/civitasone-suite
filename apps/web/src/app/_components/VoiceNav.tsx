"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Voice Navigation component using Web Speech API.
 * Supports English and Hindi voice commands for page navigation.
 * Graceful degradation: hidden if Speech API is unavailable.
 */

interface SpeechRecognitionEvent {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

const COMMANDS: Record<string, string> = {
  // English commands
  "go to finance": "/finance",
  "go to hr": "/hr",
  "go to procurement": "/procurement",
  "go to dashboard": "/dashboard",
  "go to contracts": "/contracts",
  "go to assets": "/assets",
  "go to projects": "/projects",
  "go to grants": "/grants",
  "go to reports": "/reports",
  "go to settings": "/settings",
  "new voucher": "/finance/vouchers/new",
  "new leave": "/hr/leave/new",
  help: "/help",
  // Hindi commands
  "वित्त": "/finance",
  "मानव संसाधन": "/hr",
  "खरीद": "/procurement",
  "डैशबोर्ड": "/dashboard",
  "सहायता": "/help",
};

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceNav() {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const router = useRouter();

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const handleResult = useCallback(
    (event: SpeechRecognitionEvent) => {
      const transcript =
        event.results[0]?.[0]?.transcript?.toLowerCase().trim() ?? "";

      // Check for "search" / "खोजें" prefix
      if (transcript.startsWith("search ") || transcript.startsWith("खोजें ")) {
        const query = transcript.replace(/^(search |खोजें )/, "");
        // Dispatch Ctrl+K to open GlobalSearch, then set query via custom event
        const event = new CustomEvent("voicenav:search", { detail: query });
        window.dispatchEvent(event);
        // Trigger Ctrl+K to open search
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
        );
        setListening(false);
        return;
      }

      // Direct command matching
      for (const [cmd, route] of Object.entries(COMMANDS)) {
        if (transcript.includes(cmd)) {
          router.push(route);
          setListening(false);
          return;
        }
      }

      // No match — just stop listening
      setListening(false);
    },
    [router]
  );

  const startListening = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = handleResult;
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;

    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [handleResult]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      className="iconbtn voice-nav-btn"
      onClick={listening ? stopListening : startListening}
      aria-label={listening ? "Stop voice navigation" : "Start voice navigation"}
      title={listening ? "Listening…" : "Voice navigation"}
      style={{ position: "relative" }}
    >
      <span style={{ fontSize: 16 }}>{listening ? "🔴" : "🎤"}</span>
      {listening && (
        <span
          className="voice-nav-pulse"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -2,
            borderRadius: "50%",
            border: "2px solid currentColor",
            animation: "voice-pulse 1.2s ease-in-out infinite",
            opacity: 0.6,
          }}
        />
      )}
    </button>
  );
}
