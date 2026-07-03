"use client";

/**
 * AskCivitasOnePanel — the chat panel UI for the AI assistant.
 * Handles message list, input form, send handler, and markdown rendering.
 * Stores conversation in sessionStorage per-session.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/LocaleProvider";

const SESSION_KEY = "civitasone.assistant.messages";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface AskCivitasOnePanelProps {
  onClose: () => void;
}

/** Simple markdown-to-HTML renderer (bold, italic, code, links, line breaks). */
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, "<br>");
}

function loadMessages(): ChatMessage[] {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
  } catch {
    // ignore
  }
}

export function AskCivitasOnePanel({ onClose }: AskCivitasOnePanelProps) {
  const t = useT();
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Show welcome message if empty
  useEffect(() => {
    if (messages.length === 0) {
      const welcome: ChatMessage = {
        id: "welcome",
        role: "assistant",
        content: t("assistant.welcome"),
        timestamp: Date.now(),
      };
      setMessages([welcome]);
      saveMessages([welcome]);
    }
    // Focus input on open
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Handle Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Trap focus within panel
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      const updated = [...messages, userMsg];
      setMessages(updated);
      saveMessages(updated);
      setInput("");
      setIsThinking(true);

      // Detect module from pathname
      const module = pathname.split("/").filter(Boolean)[0] ?? "dashboard";

      // Check offline
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const offlineMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: t("assistant.offlineMsg"),
          timestamp: Date.now(),
        };
        const withOffline = [...updated, offlineMsg];
        setMessages(withOffline);
        saveMessages(withOffline);
        setIsThinking(false);
        return;
      }

      try {
        const response = await fetch("/api/proxy/v1/admin/assistant/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: trimmed,
            context: { page: pathname, module },
          }),
        });

        let assistantContent: string;
        if (response.ok) {
          const data = await response.json();
          assistantContent = data.answer ?? data.response ?? data.message ?? t("assistant.errorMsg");
        } else {
          assistantContent = t("assistant.errorMsg");
        }

        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: assistantContent,
          timestamp: Date.now(),
        };
        const withResponse = [...updated, assistantMsg];
        setMessages(withResponse);
        saveMessages(withResponse);
      } catch {
        const errorMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: t("assistant.errorMsg"),
          timestamp: Date.now(),
        };
        const withError = [...updated, errorMsg];
        setMessages(withError);
        saveMessages(withError);
      } finally {
        setIsThinking(false);
      }
    },
    [messages, pathname, t],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("assistant.title")}
      aria-modal="true"
      style={{
        position: "fixed",
        bottom: 90,
        right: 24,
        width: 380,
        height: 500,
        background: "var(--surface, #fff)",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
        display: "flex",
        flexDirection: "column",
        zIndex: 1200,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15 }}>{t("assistant.title")}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("assistant.close")}
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            fontSize: 18,
            padding: 4,
            lineHeight: 1,
            borderRadius: 4,
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages area */}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              padding: "8px 12px",
              borderRadius: 12,
              fontSize: 14,
              lineHeight: 1.5,
              background: msg.role === "user" ? "#2563eb" : "#f3f4f6",
              color: msg.role === "user" ? "#fff" : "#1f2937",
              wordBreak: "break-word",
            }}
          >
            {msg.role === "assistant" ? (
              <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            ) : (
              msg.content
            )}
          </div>
        ))}

        {isThinking && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "8px 12px",
              borderRadius: 12,
              background: "#f3f4f6",
              color: "#6b7280",
              fontSize: 14,
              fontStyle: "italic",
            }}
          >
            {t("assistant.thinking")}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px",
          borderTop: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("assistant.placeholder")}
          aria-label={t("assistant.placeholder")}
          disabled={isThinking}
          style={{
            flex: 1,
            border: "1px solid #d1d5db",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isThinking || !input.trim()}
          aria-label={t("assistant.send")}
          style={{
            border: "none",
            background: "#2563eb",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 14,
            fontWeight: 500,
            cursor: isThinking || !input.trim() ? "not-allowed" : "pointer",
            opacity: isThinking || !input.trim() ? 0.5 : 1,
          }}
        >
          {t("assistant.send")}
        </button>
      </form>
    </div>
  );
}
