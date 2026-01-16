"use client";

import ReactMarkdown from "react-markdown";
import { streamOptimizeProtocol, streamRunSimulation } from "@/lib/api";
import {
  AgentMessageEvent,
  FinalEvent,
  OptimizeRequest,
  OptimizeStreamEvent,
  ProtocolNode,
  RunEvent,
  RunRequest,
  RunResponse,
} from "@/lib/types";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeDetailPanel, OptimizationTree } from "./OptimizationTree";

type Tab = "settings" | "simulate" | "optimize";

const defaultAgent1Prompt = `You are an scheduling assistant for Tom. Here is Tom's schedule:
Monday: 9am-11am Team Meeting, 2pm-3pm Client Call
Tuesday: 10am-12pm Project Review
Wednesday: Free
Thursday: 1pm-2pm One-on-One with Manager
Friday: 3pm-4pm Team Standup

You can only use the communication channel once, therefore include all the relevant information, and make decision without confirming with the other agent.`;

const defaultAgent2Prompt = `You are an scheduling assistant for Jerry. Here is Jerry's schedule:
Monday: 10am-12pm Design Review, 3pm-5pm Workshop
Tuesday: Free
Wednesday: 9am-10am All Hands, 2pm-4pm Focus Time
Thursday: 11am-12pm Lunch Meeting
Friday: Free

You can only use the communication channel once, therefore include all the relevant information, and make decision without confirming with the other agent.`;

const defaultProtocol = `This is a communication channel between Tom and Jerry's agents.
When you communicate, avoid extra greetings.`;

export default function Home() {
  const [tab, setTab] = useState<Tab>("simulate");
  const [agent1Prompt, setAgent1Prompt] = useState(defaultAgent1Prompt);
  const [agent2Prompt, setAgent2Prompt] = useState(defaultAgent2Prompt);
  const [protocol, setProtocol] = useState(defaultProtocol);
  const [userInput, setUserInput] = useState(
    "Find a meeting time with Jerry this week.",
  );

  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const streamCancelRef = useRef<(() => void) | null>(null);

  const [optPrompts, setOptPrompts] = useState(
    ["I need to schedule a meeting with Jerry this week."].join("\n"),
  );
  const [optRounds, setOptRounds] = useState(3);
  const [optBranch, setOptBranch] = useState(5);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const optCancelRef = useRef<(() => void) | null>(null);

  // Streaming optimization state
  const [optNodes, setOptNodes] = useState<ProtocolNode[]>([]);
  const [optBestPath, setOptBestPath] = useState<string[]>([]);
  const [optBestNode, setOptBestNode] = useState<ProtocolNode | null>(null);
  const [optCurrentRound, setOptCurrentRound] = useState(0);
  const [selectedOptNode, setSelectedOptNode] = useState<ProtocolNode | null>(null);
  const [optConfigCollapsed, setOptConfigCollapsed] = useState(false);

  const messageEvents = useMemo(
    () =>
      events.filter((e) => e.type === "agent_message") as AgentMessageEvent[],
    [events],
  );

  const finalEvent = useMemo(
    () => events.find((e) => e.type === "final") as FinalEvent | undefined,
    [events],
  );

  const lastMessage = messageEvents[messageEvents.length - 1];
  const speakingAgent =
    lastMessage?.direction === "outbound"
      ? "agent1"
      : lastMessage?.direction === "return"
        ? "agent2"
        : null;

  useEffect(
    () => () => {
      streamCancelRef.current?.();
      optCancelRef.current?.();
    },
    [],
  );

  const handleRun = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    streamCancelRef.current?.();
    setRunLoading(true);
    setRunError(null);
    setRunResult(null);
    setEvents([]);

    const payload: RunRequest = {
      agent1Prompt,
      agent2Prompt,
      protocol,
      userInput,
    };

    streamCancelRef.current = streamRunSimulation(payload, {
      onEvent: (evt) => {
        setEvents((prev) => [...prev, evt]);
        if (evt.type === "final") {
          setRunResult({
            final: evt.message,
            communicationTokens: evt.tokens ?? 0,
            events: [],
          });
        }
      },
      onError: (err) => {
        setRunError(err.message);
        setRunLoading(false);
      },
      onClose: () => {
        setRunLoading(false);
      },
    });
  };

  const handleOptimizeEvent = useCallback((event: OptimizeStreamEvent) => {
    switch (event.type) {
      case "base_evaluated":
        setOptNodes([event.node]);
        setOptBestPath(event.best_path);
        setOptBestNode(event.node);
        setOptCurrentRound(0);
        break;
      case "candidate_evaluated":
        setOptNodes((prev) => [...prev, event.node]);
        setOptCurrentRound(event.round_index);
        break;
      case "best_updated":
        setOptBestPath(event.best_path);
        setOptBestNode(event.node);
        break;
      case "done":
        setOptNodes(event.tree);
        setOptBestPath(event.best_path);
        setOptBestNode(event.best_node);
        setProtocol(event.best_node.rule);
        break;
      case "error":
        setOptError(event.message);
        break;
    }
  }, [setProtocol]);

  const handleOptimize = () => {
    optCancelRef.current?.();
    setOptLoading(true);
    setOptError(null);
    setOptNodes([]);
    setOptBestPath([]);
    setOptBestNode(null);
    setOptCurrentRound(0);
    setSelectedOptNode(null);
    setOptConfigCollapsed(true);

    const prompts = optPrompts
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    const payload: OptimizeRequest = {
      agent1Prompt,
      agent2Prompt,
      protocol,
      inputPrompts: prompts,
      rounds: optRounds,
      variationCount: optBranch,
    };

    optCancelRef.current = streamOptimizeProtocol(payload, {
      onEvent: handleOptimizeEvent,
      onError: (err) => {
        setOptError(err.message);
        setOptLoading(false);
      },
      onClose: () => {
        setOptLoading(false);
      },
    });
  };

  const handleNodeClick = useCallback((node: ProtocolNode) => {
    setSelectedOptNode((prev) => (prev?.id === node.id ? null : node));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-slate-900">
      <div className="h-screen flex flex-col px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => setTab("settings")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === "settings"
                ? "bg-white text-slate-900 shadow-lg"
                : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
            }`}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setTab("simulate")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === "simulate"
                ? "bg-white text-slate-900 shadow-lg"
                : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
            }`}
          >
            Simulation
          </button>
          <button
            type="button"
            onClick={() => setTab("optimize")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === "optimize"
                ? "bg-white text-slate-900 shadow-lg"
                : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
            }`}
          >
            Optimization
          </button>
        </div>
        <div className="flex-1 overflow-hidden">

        {tab === "settings" && (
          <section className="h-full overflow-auto space-y-4 content-start">
            {/* Agent prompts section - top with side by side layout */}
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold text-white">
                Agent prompts
              </h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-white/10 p-5 ring-1 ring-white/10 backdrop-blur">
                <Field
                  label="Agent 1 prompt"
                  value={agent1Prompt}
                  onChange={setAgent1Prompt}
                  placeholder="Describe the role and context for agent 1"
                  rows={10}
                />
              </div>
              <div className="rounded-2xl bg-white/10 p-5 ring-1 ring-white/10 backdrop-blur">
                <Field
                  label="Agent 2 prompt"
                  value={agent2Prompt}
                  onChange={setAgent2Prompt}
                  placeholder="Describe the role and context for agent 2"
                  rows={10}
                />
              </div>
            </div>

            {/* Communication protocol section - bottom spanning full width */}
            <div className="rounded-2xl bg-white/10 p-5 ring-1 ring-white/10 backdrop-blur mt-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">
                  Communication protocol
                </h2>
              </div>
              <div className="mt-4 space-y-4">
                <Field
                  label="Protocol"
                  value={protocol}
                  onChange={setProtocol}
                  placeholder="Outline how the agents should communicate"
                />
              </div>
            </div>
          </section>
        )}

        {tab === "simulate" && (
          <section className="h-full flex flex-col">
            <div className="relative flex-1 overflow-hidden rounded-2xl bg-white/5 text-white ring-1 ring-white/10">
              <div className="pointer-events-none absolute -left-10 top-0 h-56 w-56 rounded-full bg-indigo-500/20 blur-3xl" />
              <div className="pointer-events-none absolute right-6 -bottom-10 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />

              <div className="relative h-full flex flex-col p-6">
                {/* Status bar */}
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        runLoading
                          ? "bg-indigo-500/30 text-indigo-100"
                          : events.length
                            ? "bg-emerald-500/30 text-emerald-100"
                            : "bg-white/10 text-white/60"
                      }`}
                    >
                      {runLoading ? "Streaming..." : events.length ? "Complete" : "Idle"}
                    </span>
                    {(finalEvent?.tokens ?? runResult?.communicationTokens) ? (
                      <span className="text-xs text-white/50">
                        {finalEvent?.tokens ?? runResult?.communicationTokens} tokens
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Main agent visualization - takes most of the space */}
                <div className="flex-1 flex items-center justify-center gap-8 min-h-0">
                  <AgentCard
                    name="Agent 1"
                    accent="from-indigo-400 to-cyan-300"
                    active={speakingAgent === "agent1" || runLoading}
                    note={speakingAgent === "agent1" ? "Speaking" : "Listening"}
                  />
                  <div className="flex-1 max-w-4xl h-full">
                    <MessageArc events={messageEvents} running={runLoading} />
                  </div>
                  <AgentCard
                    name="Agent 2"
                    accent="from-emerald-400 to-lime-300"
                    active={speakingAgent === "agent2" || runLoading}
                    note={speakingAgent === "agent2" ? "Speaking" : "Listening"}
                  />
                </div>

                {/* Bottom section - input and result stacked vertically */}
                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className="flex flex-col gap-4">
                    <form onSubmit={handleRun}>
                      <div className="flex gap-3 items-end">
                        <div className="flex-1">
                          <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Message to Agent 1</label>
                          <input
                            className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 outline-none ring-1 ring-white/10 focus:ring-indigo-400/50"
                            value={userInput}
                            placeholder="What should Agent 1 ask?"
                            onChange={(e) => setUserInput(e.target.value)}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={runLoading}
                          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-500"
                        >
                          {runLoading ? "Streaming..." : "Send"}
                        </button>
                      </div>
                      {runError && (
                        <span className="text-xs text-rose-300 mt-1 block">{runError}</span>
                      )}
                    </form>
                    <div className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
                      <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Final Response</p>
                      <div className="text-sm leading-relaxed text-white/90 max-h-32 overflow-auto prose prose-invert prose-sm max-w-none">
                        {finalEvent?.message ? (
                          <ReactMarkdown>{finalEvent.message}</ReactMarkdown>
                        ) : (
                          <p>{runLoading ? "Waiting for agents..." : "Run a simulation to see the result."}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "optimize" && (
          <section className="h-full relative">
            {/* Full-screen tree visualization */}
            <div className="relative h-full overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
              {/* Decorative elements */}
              <div className="pointer-events-none absolute -left-20 -top-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
              <div className="pointer-events-none absolute -right-20 -bottom-20 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

              {/* Tree visualization */}
              <OptimizationTree
                nodes={optNodes}
                bestPath={optBestPath}
                selectedNodeId={selectedOptNode?.id ?? null}
                onNodeClick={handleNodeClick}
                isRunning={optLoading}
                currentRound={optCurrentRound}
                totalRounds={optRounds}
              />

              {/* Node detail panel */}
              <NodeDetailPanel
                node={selectedOptNode}
                isBest={selectedOptNode ? optBestPath.includes(selectedOptNode.id) : false}
                onClose={() => setSelectedOptNode(null)}
              />

              {/* Collapsible config panel */}
              <div className={`absolute left-4 transition-all duration-300 ease-out ${
                optConfigCollapsed ? "top-20" : "top-20"
              }`}>
                <div className={`rounded-2xl bg-white/95 backdrop-blur-lg shadow-2xl ring-1 ring-slate-200 transition-all duration-300 overflow-hidden ${
                  optConfigCollapsed ? "w-12" : "w-80"
                }`}>
                  {/* Toggle button */}
                  <button
                    onClick={() => setOptConfigCollapsed(!optConfigCollapsed)}
                    className="absolute -right-3 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    <svg
                      className={`h-3 w-3 text-slate-600 transition-transform duration-300 ${optConfigCollapsed ? "" : "rotate-180"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  {optConfigCollapsed ? (
                    // Collapsed state - just icon
                    <div className="p-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50">
                        <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                        </svg>
                      </div>
                    </div>
                  ) : (
                    // Expanded state - full config
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-slate-900">Configuration</h3>
                        <button
                          onClick={() => setTab("settings")}
                          className="text-xs text-indigo-600 hover:text-indigo-700"
                        >
                          Edit prompts
                        </button>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium uppercase tracking-wider text-slate-500">
                            Test prompts
                          </label>
                          <textarea
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-inner outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                            rows={3}
                            value={optPrompts}
                            onChange={(e) => setOptPrompts(e.target.value)}
                            placeholder="One prompt per line"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-slate-500">
                              Rounds
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={optRounds}
                              onChange={(e) => setOptRounds(Number(e.target.value))}
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-inner outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-slate-500">
                              Branches
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={optBranch}
                              onChange={(e) => setOptBranch(Number(e.target.value))}
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-inner outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                            />
                          </div>
                        </div>

                        <button
                          onClick={handleOptimize}
                          disabled={optLoading}
                          className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-400"
                        >
                          {optLoading ? (
                            <span className="flex items-center justify-center gap-2">
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Optimizing...
                            </span>
                          ) : (
                            "Start Optimization"
                          )}
                        </button>

                        {optError && (
                          <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2 py-1">{optError}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Best rule preview panel */}
              {optBestNode && (
                <div className="absolute right-4 top-20 w-72">
                  <div className="rounded-2xl bg-gradient-to-br from-emerald-500/90 to-teal-600/90 backdrop-blur-lg p-4 shadow-2xl ring-1 ring-white/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-emerald-100">
                        Best Protocol
                      </span>
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold text-white">
                        {optBestNode.communication_tokens.toFixed(0)} tokens
                      </span>
                    </div>
                    <div className="rounded-xl bg-black/20 p-3 max-h-40 overflow-y-auto">
                      <p className="text-xs leading-relaxed text-white/90 whitespace-pre-wrap">
                        {optBestNode.rule.length > 300
                          ? optBestNode.rule.slice(0, 300) + "..."
                          : optBestNode.rule}
                      </p>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex -space-x-1">
                        {optBestPath.map((_, idx) => (
                          <div
                            key={idx}
                            className="h-2 w-2 rounded-full bg-white/60 ring-1 ring-emerald-600"
                          />
                        ))}
                      </div>
                      <span className="text-xs text-emerald-100">
                        {optBestPath.length} rounds completed
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
        </div>
      </div>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  singleLine?: boolean;
  rows?: number;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  singleLine = false,
  rows = 5,
}: FieldProps) {
  return (
    <label className="group relative block">
      <span className="text-xs font-semibold uppercase tracking-[0.25em] text-white/50">
        {label}
      </span>
      {singleLine ? (
        <input
          className="mt-2 w-full rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 outline-none ring-1 ring-white/10 transition focus:ring-indigo-400/50"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <textarea
          className="mt-2 w-full rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 outline-none ring-1 ring-white/10 transition focus:ring-indigo-400/50"
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

type NumberInputProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: NumberInputProps) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-sm text-slate-900 shadow-inner outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}

type AgentCardProps = {
  name: string;
  accent: string;
  active?: boolean;
  note?: string;
};

function AgentCard({ name, accent, active = false, note }: AgentCardProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/5 p-4 text-center ring-1 ring-white/10">
      <div
        className={`mx-auto h-16 w-16 rounded-full bg-gradient-to-br ${accent} shadow-lg shadow-black/30 ${active ? "animate-[pulse_2s_ease-in-out_infinite]" : ""}`}
      />
      <div className="mt-3">
        <p className="text-xs uppercase tracking-[0.25em] text-indigo-100">
          Agent
        </p>
        <p className="text-sm font-semibold text-white">{name}</p>
        {note && (
          <p className="mt-1 text-xs text-indigo-100/70">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

type MessageArcProps = {
  events: AgentMessageEvent[];
  running: boolean;
};

function MessageArc({ events, running }: MessageArcProps) {
  // Get the latest message for each direction (only show one per direction)
  const outboundMessage = events.filter(e => e.direction === "outbound").slice(-1)[0];
  const returnMessage = events.filter(e => e.direction === "return").slice(-1)[0];

  return (
    <div className="relative h-full w-full min-h-[300px]">
      {/* SVG for arc paths */}
      <svg
        viewBox="0 0 400 300"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Gradient and filter definitions */}
        <defs>
          <linearGradient id="topArcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <linearGradient id="bottomArcGradient" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Top arc path (Agent 1 -> Agent 2) - endpoints offset up */}
        <path
          d="M 40 135 Q 200 30, 360 135"
          fill="none"
          stroke="url(#topArcGradient)"
          strokeWidth="2"
          strokeDasharray={outboundMessage ? "none" : "8 4"}
          opacity={outboundMessage ? 0.6 : 0.2}
        />

        {/* Bottom arc path (Agent 2 -> Agent 1) - endpoints offset down */}
        <path
          d="M 360 165 Q 200 270, 40 165"
          fill="none"
          stroke="url(#bottomArcGradient)"
          strokeWidth="2"
          strokeDasharray={returnMessage ? "none" : "8 4"}
          opacity={returnMessage ? 0.6 : 0.2}
        />

        {/* Animated dot for top arc (outbound) - inside SVG for proper scaling */}
        {outboundMessage && (
          <circle
            key={`outbound-${events.filter(e => e.direction === "outbound").length}`}
            className="arc-dot-top"
            r="6"
            fill="#818cf8"
            filter="url(#glow)"
          />
        )}

        {/* Animated dot for bottom arc (return) - inside SVG for proper scaling */}
        {returnMessage && (
          <circle
            key={`return-${events.filter(e => e.direction === "return").length}`}
            className="arc-dot-bottom"
            r="6"
            fill="#34d399"
            filter="url(#glow)"
          />
        )}
      </svg>

      {/* Top message content (outbound: Agent 1 -> Agent 2) */}
      {outboundMessage && (
        <div
          key={`outbound-msg-${events.filter(e => e.direction === "outbound").length}`}
          className="message-fade-in absolute left-1/2 top-2 -translate-x-1/2 transform w-full max-w-[90%] px-4"
        >
          <div className="rounded-xl border border-indigo-400/30 bg-indigo-950/90 px-4 py-3 shadow-lg shadow-indigo-500/20 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold text-indigo-300">
              <span>{outboundMessage.from}</span>
              <ArrowIcon direction="right" />
              <span>{outboundMessage.to}</span>
            </div>
            <p className="text-sm leading-relaxed text-white max-h-24 overflow-auto">
              {outboundMessage.message}
            </p>
          </div>
        </div>
      )}

      {/* Bottom message content (return: Agent 2 -> Agent 1) */}
      {returnMessage && (
        <div
          key={`return-msg-${events.filter(e => e.direction === "return").length}`}
          className="message-fade-in absolute bottom-2 left-1/2 -translate-x-1/2 transform w-full max-w-[90%] px-4"
        >
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-950/90 px-4 py-3 shadow-lg shadow-emerald-500/20 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-300">
              <span>{returnMessage.from}</span>
              <ArrowIcon direction="left" />
              <span>{returnMessage.to}</span>
            </div>
            <p className="text-sm leading-relaxed text-white max-h-24 overflow-auto">
              {returnMessage.message}
            </p>
          </div>
        </div>
      )}

      {/* Idle state message */}
      {!events.length && !running && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-indigo-100/60">
            Trigger a simulation to watch messages flow between agents
          </p>
        </div>
      )}

      {/* Streaming indicator when no messages yet */}
      {!events.length && running && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-indigo-100/80">
            Streaming... messages will appear shortly
          </p>
        </div>
      )}
    </div>
  );
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  const rotation = direction === "right" ? "rotate-0" : "rotate-180";
  return (
    <svg
      className={`h-4 w-4 ${rotation}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

type SettingsBadgeProps = {
  title: string;
  text: string;
};

function SettingsBadge({ title, text }: SettingsBadgeProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-inner">
      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
        {title}
      </p>
      <p className="mt-2 max-h-28 overflow-hidden whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
        {text}
      </p>
    </div>
  );
}
