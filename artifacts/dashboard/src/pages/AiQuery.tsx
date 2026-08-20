import { useState, useRef, useEffect } from "react";
import {
  BrainCircuit,
  Send,
  User,
  Bot,
  Loader2,
  CircleDot,
  Sparkles,
  Copy,
  Check,
  KeyRound,
  Trash2,
  ChevronDown,
  ChevronUp,
  Wrench,
  Brain,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useLang, type Lang } from "@/lib/i18n";
import { InfoCard } from "@/components/InfoCard";
import { apiUrl } from "@/lib/api-origin";

interface ToolUsage {
  tool: string;
  args: Record<string, unknown>;
}

type TraceEvent =
  | { kind: "status"; phase: "thinking" | "synthesizing"; loop: number }
  | { kind: "tool_call"; tool: string; args: Record<string, unknown> }
  | { kind: "tool_result"; tool: string; preview: string };

interface Turn {
  id: string;
  question: string;
  status: "streaming" | "done" | "error";
  events: TraceEvent[];
  liveTokens: string;
  finalAnswer: string;
  toolsUsed: ToolUsage[];
  errorMessage?: string;
  createdAt: number;
}

interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
}

interface ProviderInfo {
  id: string;
  label: string;
  defaultModel: string;
}

interface AiStatus {
  configured: boolean;
  model?: string;
  quota?: QuotaInfo;
  providers?: ProviderInfo[];
}

const USER_KEY_STORAGE = "gbif:userApiKey";
const USER_PROVIDER_STORAGE = "gbif:userApiProvider";

const EXAMPLES_BY_LANG: Record<Lang, string[]> = {
  ko: [
    "브라질에서 가장 위협받는 종은?",
    "Felidae 과에서 위협 비율이 가장 높은 종은?",
    "Panthera leo의 분포 국가는?",
    "호주에서 가장 많이 기록된 종은?",
  ],
  en: [
    "What is the most endangered species in Brazil?",
    "Which families have the highest threatened ratio?",
    "Where is Panthera leo recorded?",
    "What are the most observed species in Australia?",
  ],
  fr: [
    "Quelle est l'espèce la plus menacée au Brésil ?",
    "Quelles familles ont le taux de menace le plus élevé ?",
    "Où Panthera leo est-il observé ?",
    "Quelles sont les espèces les plus observées en Australie ?",
  ],
  es: [
    "¿Cuál es la especie más amenazada en Brasil?",
    "¿Qué familias tienen la mayor proporción de amenaza?",
    "¿Dónde se ha registrado Panthera leo?",
    "¿Cuáles son las especies más observadas en Australia?",
  ],
  ru: [
    "Какой самый угрожаемый вид в Бразилии?",
    "У каких семейств самая высокая доля угроз?",
    "Где зафиксирован Panthera leo?",
    "Какие виды чаще всего наблюдают в Австралии?",
  ],
  zh: [
    "巴西最濒危的物种是什么？",
    "哪些科的受威胁比例最高？",
    "Panthera leo 在哪些国家有记录？",
    "澳大利亚观测最多的物种有哪些？",
  ],
  ar: [
    "ما هو النوع الأكثر تهديداً في البرازيل؟",
    "أي العائلات تملك أعلى نسبة تهديد؟",
    "أين تم تسجيل Panthera leo؟",
    "ما هي الأنواع الأكثر رصداً في أستراليا؟",
  ],
};

function StatusBadge({ status }: { status: "checking" | "online" | "offline" }) {
  const { t } = useLang();
  const cfg = {
    checking: { cls: "bg-slate-100 text-slate-600", label: t("aiChecking") },
    online: { cls: "bg-emerald-100 text-emerald-700", label: t("aiOnline") },
    offline: { cls: "bg-red-100 text-red-700", label: t("aiOffline") },
  }[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.cls}`}
    >
      <CircleDot
        className={`w-2.5 h-2.5 ${
          status === "online"
            ? "fill-emerald-600 text-emerald-600"
            : status === "offline"
              ? "fill-red-600 text-red-600"
              : "fill-slate-400 text-slate-400 animate-pulse"
        }`}
      />
      {cfg.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const { t } = useLang();
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="text-[11px] text-slate-400 hover:text-slate-700 inline-flex items-center gap-1 transition-colors"
      title={t("copy")}
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      <span>{done ? t("copied") : t("copy")}</span>
    </button>
  );
}

function KeyPanel({
  userKey,
  setUserKey,
  provider,
  setProvider,
  providers,
  forced,
}: {
  userKey: string;
  setUserKey: (k: string) => void;
  provider: string;
  setProvider: (p: string) => void;
  providers: ProviderInfo[];
  forced: boolean;
}) {
  const { t } = useLang();
  const [draft, setDraft] = useState(userKey);
  // Quota-exhausted banner starts collapsed so it doesn't cover the chat.
  // If the user already has a key, start expanded.
  const [collapsed, setCollapsed] = useState(forced && !userKey);
  useEffect(() => setDraft(userKey), [userKey]);

  const wrapCls = forced
    ? "bg-amber-50 border-amber-200"
    : "bg-slate-50 border-slate-200";

  // Compact single-row banner (collapsed state)
  if (collapsed) {
    return (
      <div className={`rounded-xl border px-3 py-2 flex items-center gap-2 ${wrapCls}`}>
        <KeyRound className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <span className="text-xs text-amber-800 flex-1 leading-snug">
          {t("aiQuotaExhausted")}
        </span>
        <button
          onClick={() => setCollapsed(false)}
          className="text-xs text-amber-700 hover:text-amber-900 font-medium inline-flex items-center gap-0.5 shrink-0"
        >
          {t("aiKeySave")}
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-3 sm:p-4 text-sm space-y-2 ${wrapCls}`}>
      <div className="flex items-center gap-2 font-medium text-slate-800">
        <KeyRound className="w-4 h-4 text-amber-600" />
        <span>{t("aiKeyLabel")}</span>
        {userKey && (
          <span className="text-[11px] text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">
            ●●●●{userKey.slice(-4)}
          </span>
        )}
        {forced && (
          <button
            onClick={() => setCollapsed(true)}
            className="ml-auto text-slate-400 hover:text-slate-600"
            title="접기"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        )}
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        {forced ? t("aiQuotaExhausted") : t("aiQuotaUsingOwnKey")}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("aiKeyPlaceholder")}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={() => { setUserKey(draft.trim()); setCollapsed(false); }}
          disabled={!draft.trim() || draft.trim() === userKey}
          className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm px-3 py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
        >
          <Check className="w-4 h-4" />
          {t("aiKeySave")}
        </button>
        {userKey && (
          <button
            onClick={() => {
              setDraft("");
              setUserKey("");
            }}
            className="text-slate-500 hover:text-red-600 text-sm px-3 py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" />
            {t("aiKeyClear")}
          </button>
        )}
      </div>
      {providers.length > 0 && (
        <div className="bg-white/70 border border-slate-200 rounded-lg p-2.5 space-y-1.5">
          <label className="block text-[11px] font-medium text-slate-700">
            {t("aiProviderLabel")}
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.defaultModel}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {t("aiProviderHint")}
          </p>
        </div>
      )}
      <p className="text-[11px] text-slate-500">{t("aiKeyHint")}</p>
    </div>
  );
}

function splitReasoning(raw: string): { reasoning: string; answer: string } {
  if (!raw) return { reasoning: "", answer: "" };
  const parts: string[] = [];
  let work = raw;
  const closed = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
  work = work.replace(closed, (_m, inner: string) => {
    parts.push(inner.trim());
    return "";
  });
  const unclosed = /<think(?:ing)?>([\s\S]*)$/i;
  const m = work.match(unclosed);
  if (m) {
    parts.push(m[1].trim());
    work = work.replace(unclosed, "");
  }
  const stray = /<\/think(?:ing)?>/gi;
  work = work.replace(stray, "");
  return { reasoning: parts.join("\n\n").trim(), answer: work.trim() };
}

function PhaseChip({ turn }: { turn: Turn }) {
  const { t } = useLang();
  if (turn.status !== "streaming") return null;
  const lastEvt = [...turn.events].reverse().find((e) => e.kind !== "tool_result");
  let label = t("aiPhaseThinking");
  if (lastEvt?.kind === "tool_call") label = `${t("aiPhaseToolCall")} ${lastEvt.tool}`;
  else if (lastEvt?.kind === "status" && lastEvt.phase === "synthesizing") label = t("aiPhaseSynthesizing");
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
      <Loader2 className="w-3 h-3 animate-spin" />
      {label}
    </span>
  );
}

function TraceTimeline({ turn }: { turn: Turn }) {
  const { t } = useLang();
  if (turn.events.length === 0 && !turn.errorMessage) return null;

  // Group consecutive tool_call + tool_result pairs together
  const items: Array<{ call?: TraceEvent & { kind: "tool_call" }; result?: TraceEvent & { kind: "tool_result" }; status?: TraceEvent & { kind: "status" } }> = [];
  for (let i = 0; i < turn.events.length; i++) {
    const e = turn.events[i];
    if (e.kind === "status") {
      items.push({ status: e as TraceEvent & { kind: "status" } });
    } else if (e.kind === "tool_call") {
      const next = turn.events[i + 1];
      if (next?.kind === "tool_result" && next.tool === e.tool) {
        items.push({ call: e as TraceEvent & { kind: "tool_call" }, result: next as TraceEvent & { kind: "tool_result" } });
        i++;
      } else {
        items.push({ call: e as TraceEvent & { kind: "tool_call" } });
      }
    } else if (e.kind === "tool_result") {
      items.push({ result: e as TraceEvent & { kind: "tool_result" } });
    }
  }

  return (
    <ol className="space-y-2">
      {items.map((item, i) => {
        if (item.status) {
          return (
            <li key={i} className="text-[11.5px] text-slate-500 flex items-center gap-1.5">
              <CircleDot className="w-2.5 h-2.5 text-slate-400 fill-slate-400 shrink-0" />
              {item.status.phase === "thinking" ? t("aiPhaseThinking") : t("aiPhaseSynthesizing")}
              {item.status.loop > 0 && (
                <span className="text-[10px] text-slate-400">· loop {item.status.loop}</span>
              )}
            </li>
          );
        }

        const call = item.call;
        const result = item.result;
        return (
          <li key={i} className="rounded-lg border border-blue-100 bg-blue-50/50 overflow-hidden">
            {call && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-blue-100">
                <Wrench className="w-3 h-3 text-blue-600 shrink-0" />
                <code className="font-mono text-[11.5px] text-blue-800 font-medium">{call.tool}</code>
                {Object.keys(call.args).length > 0 && (
                  <span className="text-[11px] text-blue-500 truncate">
                    ({Object.entries(call.args)
                      .slice(0, 4)
                      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                      .join(", ")})
                  </span>
                )}
              </div>
            )}
            {result && (
              <div className="px-2.5 py-1.5">
                <div className="flex items-center gap-1 mb-1 text-[11px] text-emerald-700">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                  <span>{t("aiToolResultPreview")}</span>
                </div>
                <pre className="whitespace-pre-wrap font-mono text-[10.5px] leading-snug text-slate-600 bg-white border border-slate-100 rounded p-2 max-h-48 overflow-y-auto">
                  {result.preview}
                </pre>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function AssistantBubble({ turn }: { turn: Turn }) {
  const { t } = useLang();
  const [traceOpen, setTraceOpen] = useState(true);
  // Keep trace open while streaming; stay open after done so user can inspect.
  useEffect(() => {
    if (turn.status === "streaming") setTraceOpen(true);
  }, [turn.status]);

  const { reasoning, answer } = splitReasoning(turn.finalAnswer || turn.liveTokens);
  const visibleAnswer = turn.status === "done" ? (answer || turn.finalAnswer) : answer;
  const hasTrace = turn.events.length > 0 || reasoning;

  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-full bg-purple-100 shrink-0 flex items-center justify-center mt-0.5">
        <Bot className="w-4 h-4 text-purple-700" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {/* Phase indicator while streaming */}
        {turn.status === "streaming" && (
          <div className="flex items-center gap-2">
            <PhaseChip turn={turn} />
          </div>
        )}

        {/* Collapsible reasoning trace */}
        {hasTrace && (
          <div className="rounded-lg border border-purple-100 bg-purple-50/40">
            <button
              onClick={() => setTraceOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[11.5px] text-purple-800 hover:bg-purple-50 rounded-lg"
            >
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Brain className="w-3.5 h-3.5" />
                {t("aiLiveTrace")}
                {turn.events.length > 0 && (
                  <span className="text-[10.5px] text-purple-500 font-normal">
                    ({turn.events.filter((e) => e.kind === "tool_call").length} {t("aiToolsUsed").toLowerCase()})
                  </span>
                )}
              </span>
              {traceOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            {traceOpen && (
              <div className="px-3 pb-2.5 pt-1 space-y-2">
                <TraceTimeline turn={turn} />
                {reasoning && (
                  <div className="mt-2 border-t border-purple-100 pt-2">
                    <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] text-purple-700 font-medium">
                      <Brain className="w-3.5 h-3.5" />
                      {t("aiReasoning")}
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-slate-600 bg-white/70 border border-purple-100 rounded-lg p-2.5 max-h-96 overflow-y-auto">
                      {reasoning}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Final answer / error */}
        {turn.status === "error" ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-3.5 py-2.5 inline-flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{turn.errorMessage || t("aiTurnError")}</span>
          </div>
        ) : (visibleAnswer || turn.status === "streaming") ? (
          <div className="text-[14px] whitespace-pre-wrap leading-relaxed text-slate-800 bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5 shadow-sm">
            {visibleAnswer || (
              <span className="text-slate-400 text-xs">{t("aiPhaseThinking")}</span>
            )}
            {turn.status === "streaming" && visibleAnswer && (
              <span className="inline-block w-1.5 h-4 bg-purple-500 align-middle ml-0.5 animate-pulse" />
            )}
          </div>
        ) : null}

        {turn.status === "done" && visibleAnswer && (
          <div className="px-1">
            <CopyButton text={visibleAnswer} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function AiQuery() {
  const { t, lang } = useLang();
  const EXAMPLES = EXAMPLES_BY_LANG[lang];
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [model, setModel] = useState<string>("");
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [userKey, setUserKeyState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(USER_KEY_STORAGE) ?? "";
  });
  const [provider, setProviderState] = useState<string>(() => {
    if (typeof window === "undefined") return "openai";
    return localStorage.getItem(USER_PROVIDER_STORAGE) ?? "openai";
  });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function setUserKey(k: string) {
    setUserKeyState(k);
    if (typeof window !== "undefined") {
      if (k) localStorage.setItem(USER_KEY_STORAGE, k);
      else localStorage.removeItem(USER_KEY_STORAGE);
    }
  }

  function setProvider(p: string) {
    setProviderState(p);
    if (typeof window !== "undefined") localStorage.setItem(USER_PROVIDER_STORAGE, p);
  }

  useEffect(() => {
    fetch(apiUrl("/api/ai/status"))
      .then((r) => r.json())
      .then((d: AiStatus) => {
        setStatus(d.configured ? "online" : "offline");
        if (d.model) setModel(d.model);
        if (d.quota) setQuota(d.quota);
        if (Array.isArray(d.providers)) setProviders(d.providers);
      })
      .catch(() => setStatus("offline"));
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  // Auto-scroll chat to bottom as new tokens / events arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const quotaExhausted = !userKey && quota != null && quota.remaining <= 0;
  const inputsDisabled = streaming || status === "offline" || quotaExhausted;

  function patchTurn(id: string, patch: (tr: Turn) => Turn) {
    setTurns((prev) => prev.map((tr) => (tr.id === id ? patch(tr) : tr)));
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || streaming || quotaExhausted) return;
    setInput("");
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const turn: Turn = {
      id,
      question: q,
      status: "streaming",
      events: [],
      liveTokens: "",
      finalAnswer: "",
      toolsUsed: [],
      createdAt: Date.now(),
    };
    setTurns((prev) => [...prev, turn]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (userKey) {
      headers["X-User-Api-Key"] = userKey;
      if (provider) headers["X-User-Api-Provider"] = provider;
    }

    try {
      const res = await fetch(apiUrl("/api/ai/ask/stream"), {
        method: "POST",
        headers,
        body: JSON.stringify({ question: q }),
        signal: ac.signal,
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        if (data?.quota) setQuota(data.quota);
        patchTurn(id, (tr) => ({
          ...tr,
          status: "error",
          errorMessage: t("aiQuotaLimitReached"),
        }));
        setKeyPanelOpen(true);
        return;
      }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        patchTurn(id, (tr) => ({
          ...tr,
          status: "error",
          errorMessage: data?.error ?? `HTTP ${res.status}`,
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = block.split("\n");
          let event = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(dataStr); } catch { continue; }

          if (event === "status") {
            patchTurn(id, (tr) => ({
              ...tr,
              events: [
                ...tr.events,
                {
                  kind: "status",
                  phase: (data.phase as "thinking" | "synthesizing") ?? "thinking",
                  loop: Number(data.loop ?? 0),
                },
              ],
            }));
          } else if (event === "token") {
            const txt = String(data.text ?? "");
            patchTurn(id, (tr) => ({ ...tr, liveTokens: tr.liveTokens + txt }));
          } else if (event === "tool_call") {
            patchTurn(id, (tr) => ({
              ...tr,
              events: [
                ...tr.events,
                {
                  kind: "tool_call",
                  tool: String(data.tool ?? ""),
                  args: (data.args as Record<string, unknown>) ?? {},
                },
              ],
            }));
          } else if (event === "tool_result") {
            patchTurn(id, (tr) => ({
              ...tr,
              events: [
                ...tr.events,
                {
                  kind: "tool_result",
                  tool: String(data.tool ?? ""),
                  preview: String(data.preview ?? ""),
                },
              ],
            }));
          } else if (event === "done") {
            const answer = String(data.answer ?? "");
            const toolsUsed = (data.toolsUsed as ToolUsage[]) ?? [];
            if (data.quota) setQuota(data.quota as QuotaInfo);
            patchTurn(id, (tr) => ({
              ...tr,
              status: "done",
              finalAnswer: answer || tr.liveTokens,
              toolsUsed,
            }));
          } else if (event === "error") {
            patchTurn(id, (tr) => ({
              ...tr,
              status: "error",
              errorMessage: String(data.error ?? t("aiTurnError")),
            }));
          }
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      patchTurn(id, (tr) => ({
        ...tr,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Defensive refresh: re-sync quota even if `done` event was missed.
      try {
        const r = await fetch(apiUrl("/api/ai/status"));
        if (r.ok) {
          const d: AiStatus = await r.json();
          if (d.quota) setQuota(d.quota);
        }
      } catch { /* ignore */ }
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] sm:h-[calc(100vh-6rem)] space-y-3">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <BrainCircuit className="w-6 h-6 text-purple-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t("aiTitle")}</h1>
            <StatusBadge status={status} />
            {!userKey && quota && (
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  quota.remaining > 1
                    ? "bg-emerald-100 text-emerald-700"
                    : quota.remaining > 0
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"
                }`}
                title={t("aiQuotaHeading")}
              >
                {t("aiQuotaRemaining").replace("{n}", String(quota.remaining))}
              </span>
            )}
            {userKey && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1">
                <KeyRound className="w-3 h-3" />
                ●●●●{userKey.slice(-4)}
              </span>
            )}
            {turns.length > 0 && (
              <button
                onClick={() => {
                  abortRef.current?.abort();
                  setTurns([]);
                }}
                className="ml-auto text-[11px] text-slate-400 hover:text-red-600 inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                {t("newConversation")}
              </button>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("aiSubtitle")}
          </p>
        </div>
      </div>

      <InfoCard source={t("aiSource")} method={t("aiMethod")} />

      {(quotaExhausted || keyPanelOpen || userKey) ? (
        <KeyPanel
          userKey={userKey}
          setUserKey={setUserKey}
          provider={provider}
          setProvider={setProvider}
          providers={providers}
          forced={quotaExhausted}
        />
      ) : (
        <button
          onClick={() => setKeyPanelOpen(true)}
          className="self-start text-xs text-slate-500 hover:text-amber-700 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-amber-50"
        >
          <KeyRound className="w-3.5 h-3.5" />
          {t("aiKeyOption")}
          <ChevronDown className="w-3 h-3" />
        </button>
      )}
      {!quotaExhausted && !userKey && keyPanelOpen && (
        <button
          onClick={() => setKeyPanelOpen(false)}
          className="self-start -mt-2 text-[11px] text-slate-400 hover:text-slate-600 inline-flex items-center gap-1"
        >
          <ChevronUp className="w-3 h-3" />
          {t("aiPlanCancel")}
        </button>
      )}

      {/* Single chat thread */}
      <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-5 min-h-0">
          {turns.length === 0 && (
            <div className="max-w-md mx-auto text-center py-6 sm:py-10 space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-50">
                <Sparkles className="w-6 h-6 text-purple-500" />
              </div>
              <p className="text-sm text-slate-600 font-medium">
                {t("trySomething")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EXAMPLES.map((e) => (
                  <button
                    key={e}
                    onClick={() => ask(e)}
                    disabled={inputsDisabled}
                    className="text-left text-[12.5px] px-3 py-2 rounded-xl border border-slate-200 hover:border-purple-300 hover:bg-purple-50 text-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((tr) => (
            <div key={tr.id} className="space-y-3">
              {/* User question bubble */}
              <div className="flex items-start gap-2.5 justify-end">
                <div className="max-w-[85%] text-[14px] leading-relaxed text-white bg-purple-600 rounded-2xl rounded-tr-md px-3.5 py-2 shadow-sm whitespace-pre-wrap">
                  {tr.question}
                </div>
                <div className="w-7 h-7 rounded-full bg-slate-200 shrink-0 flex items-center justify-center mt-0.5">
                  <User className="w-4 h-4 text-slate-600" />
                </div>
              </div>

              {/* Assistant bubble (trace + answer combined) */}
              <AssistantBubble turn={tr} />
            </div>
          ))}
        </div>

        {/* Input bar */}
        <div className="p-2.5 border-t border-slate-200 flex gap-2 items-end bg-slate-50/50 rounded-b-2xl">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder={t("inputPlaceholder")}
            disabled={inputsDisabled}
            rows={1}
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:opacity-60 resize-none leading-snug bg-white"
            style={{ maxHeight: 120 }}
          />
          <button
            onClick={() => ask(input)}
            disabled={inputsDisabled || !input.trim()}
            className="bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-2 rounded-xl disabled:opacity-50 shrink-0 inline-flex items-center gap-1.5"
            aria-label={t("send")}
          >
            <Send className="w-4 h-4" />
            <span className="text-sm hidden sm:inline">{t("send")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
