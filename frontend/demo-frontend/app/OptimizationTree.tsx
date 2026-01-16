"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import { ProtocolNode } from "@/lib/types";

type TreeNode = ProtocolNode & {
  x: number;
  y: number;
  children: TreeNode[];
};

type OptimizationTreeProps = {
  nodes: ProtocolNode[];
  bestPath: string[];
  selectedNodeId: string | null;
  onNodeClick: (node: ProtocolNode) => void;
  isRunning: boolean;
  currentRound: number;
  totalRounds: number;
};

export function OptimizationTree({
  nodes,
  bestPath,
  selectedNodeId,
  onNodeClick,
  isRunning,
  currentRound,
  totalRounds,
}: OptimizationTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const bestPathSet = useMemo(() => new Set(bestPath), [bestPath]);

  // Build tree structure from flat nodes
  const { treeRoot, layoutInfo } = useMemo(() => {
    if (nodes.length === 0) {
      return { treeRoot: null, layoutInfo: { width: 800, height: 600 } };
    }

    const nodeMap = new Map<string, TreeNode>();

    // Create TreeNode objects
    nodes.forEach((node) => {
      nodeMap.set(node.id, { ...node, x: 0, y: 0, children: [] });
    });

    // Build parent-child relationships
    let root: TreeNode | null = null;
    nodeMap.forEach((treeNode) => {
      if (treeNode.parent_id === null) {
        root = treeNode;
      } else {
        const parent = nodeMap.get(treeNode.parent_id);
        if (parent) {
          parent.children.push(treeNode);
        }
      }
    });

    if (!root) {
      return { treeRoot: null, layoutInfo: { width: 800, height: 600 } };
    }

    // Layout the tree - calculate positions
    const NODE_WIDTH = 140;
    const NODE_HEIGHT = 80;
    const LEVEL_HEIGHT = 160;
    const NODE_SPACING = 20;

    // Group nodes by round
    const roundGroups = new Map<number, TreeNode[]>();
    nodeMap.forEach((node) => {
      const round = node.round_index;
      if (!roundGroups.has(round)) {
        roundGroups.set(round, []);
      }
      roundGroups.get(round)!.push(node);
    });

    // Calculate positions
    let maxWidth = 0;
    roundGroups.forEach((roundNodes, round) => {
      // Sort nodes: best path node first, then by tokens
      roundNodes.sort((a, b) => {
        const aIsBest = bestPathSet.has(a.id) ? 0 : 1;
        const bIsBest = bestPathSet.has(b.id) ? 0 : 1;
        if (aIsBest !== bIsBest) return aIsBest - bIsBest;
        return a.communication_tokens - b.communication_tokens;
      });

      const totalWidth = roundNodes.length * NODE_WIDTH + (roundNodes.length - 1) * NODE_SPACING;
      maxWidth = Math.max(maxWidth, totalWidth);

      roundNodes.forEach((node, index) => {
        node.x = index * (NODE_WIDTH + NODE_SPACING) + NODE_WIDTH / 2;
        node.y = round * LEVEL_HEIGHT + NODE_HEIGHT / 2 + 40;
      });
    });

    // Center all rounds
    roundGroups.forEach((roundNodes) => {
      const roundWidth = roundNodes.length * NODE_WIDTH + (roundNodes.length - 1) * NODE_SPACING;
      const offset = (maxWidth - roundWidth) / 2;
      roundNodes.forEach((node) => {
        node.x += offset;
      });
    });

    const maxRound = Math.max(...Array.from(roundGroups.keys()));
    const height = (maxRound + 1) * LEVEL_HEIGHT + 100;
    const width = Math.max(maxWidth + 80, 800);

    return {
      treeRoot: root,
      layoutInfo: { width, height }
    };
  }, [nodes, bestPathSet]);

  // Collect all edges
  const edges = useMemo(() => {
    const result: { from: TreeNode; to: TreeNode; isBestPath: boolean }[] = [];

    const traverse = (node: TreeNode) => {
      node.children.forEach((child) => {
        const isBestPath = bestPathSet.has(node.id) && bestPathSet.has(child.id);
        result.push({ from: node, to: child, isBestPath });
        traverse(child);
      });
    };

    if (treeRoot) {
      traverse(treeRoot);
    }

    return result;
  }, [treeRoot, bestPathSet]);

  // Collect all nodes for rendering
  const allNodes = useMemo(() => {
    const result: TreeNode[] = [];

    const traverse = (node: TreeNode) => {
      result.push(node);
      node.children.forEach(traverse);
    };

    if (treeRoot) {
      traverse(treeRoot);
    }

    return result;
  }, [treeRoot]);

  // Auto-scroll to latest node
  useEffect(() => {
    if (containerRef.current && allNodes.length > 0) {
      const latestNode = allNodes[allNodes.length - 1];
      containerRef.current.scrollTo({
        top: Math.max(0, latestNode.y - 200),
        behavior: "smooth",
      });
    }
  }, [allNodes.length]);

  const getNodeColor = useCallback((node: TreeNode) => {
    const isBest = bestPathSet.has(node.id);
    const isSelected = node.id === selectedNodeId;

    if (isSelected) {
      return {
        bg: "from-amber-400 to-orange-500",
        border: "ring-amber-300",
        glow: "shadow-amber-400/50",
      };
    }
    if (isBest) {
      return {
        bg: "from-emerald-400 to-teal-500",
        border: "ring-emerald-300",
        glow: "shadow-emerald-400/40",
      };
    }
    return {
      bg: "from-slate-600 to-slate-700",
      border: "ring-slate-500",
      glow: "shadow-slate-600/20",
    };
  }, [bestPathSet, selectedNodeId]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-24 w-24 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center mb-4">
            <svg className="h-12 w-12 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-indigo-200 text-lg font-medium">
            {isRunning ? "Starting optimization..." : "Run optimization to see the tree"}
          </p>
          <p className="text-indigo-300/60 text-sm mt-2">
            The optimization tree will appear here as nodes are evaluated
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* Progress indicator */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
        <div className="rounded-full bg-black/40 backdrop-blur-sm px-4 py-2 ring-1 ring-white/10">
          <div className="flex items-center gap-2">
            {isRunning && (
              <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
            <span className="text-sm font-medium text-white">
              Round {currentRound} / {totalRounds}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-24 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-all duration-500"
              style={{ width: `${(currentRound / Math.max(totalRounds, 1)) * 100}%` }}
            />
          </div>
        </div>
        <div className="rounded-full bg-black/40 backdrop-blur-sm px-3 py-1.5 ring-1 ring-white/10">
          <span className="text-xs text-indigo-200">{nodes.length} nodes</span>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-4 right-4 z-10 rounded-xl bg-black/40 backdrop-blur-sm p-3 ring-1 ring-white/10">
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500" />
            <span className="text-emerald-200">Best path</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-gradient-to-br from-amber-400 to-orange-500" />
            <span className="text-amber-200">Selected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-gradient-to-br from-slate-600 to-slate-700" />
            <span className="text-slate-300">Other</span>
          </div>
        </div>
      </div>

      {/* Tree container */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20"
        style={{ scrollBehavior: "smooth" }}
      >
        <svg
          ref={svgRef}
          width={layoutInfo.width}
          height={layoutInfo.height}
          className="min-w-full"
        >
          <defs>
            {/* Gradient for best path edges */}
            <linearGradient id="bestPathGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.8" />
            </linearGradient>
            {/* Gradient for normal edges */}
            <linearGradient id="normalGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#64748b" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#475569" stopOpacity="0.4" />
            </linearGradient>
            {/* Glow filter */}
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Render edges */}
          <g className="edges">
            {edges.map(({ from, to, isBestPath }, index) => {
              const midY = (from.y + to.y) / 2;
              const path = `M ${from.x} ${from.y + 30}
                           C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - 30}`;

              return (
                <g key={`edge-${index}`}>
                  {/* Shadow/glow for best path */}
                  {isBestPath && (
                    <path
                      d={path}
                      fill="none"
                      stroke="#34d399"
                      strokeWidth="6"
                      strokeOpacity="0.3"
                      filter="url(#glow)"
                      className="animate-pulse"
                    />
                  )}
                  <path
                    d={path}
                    fill="none"
                    stroke={isBestPath ? "url(#bestPathGradient)" : "url(#normalGradient)"}
                    strokeWidth={isBestPath ? 3 : 2}
                    strokeLinecap="round"
                    className={`transition-all duration-500 ${isBestPath ? "" : "opacity-60"}`}
                  />
                  {/* Animated dot on best path */}
                  {isBestPath && isRunning && (
                    <circle r="4" fill="#34d399" filter="url(#glow)">
                      <animateMotion dur="2s" repeatCount="indefinite" path={path} />
                    </circle>
                  )}
                </g>
              );
            })}
          </g>

          {/* Render nodes */}
          <g className="nodes">
            {allNodes.map((node, index) => {
              const colors = getNodeColor(node);
              const isBest = bestPathSet.has(node.id);
              const isSelected = node.id === selectedNodeId;
              const isLatest = index === allNodes.length - 1 && isRunning;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className={`cursor-pointer transition-transform duration-300 hover:scale-105 ${
                    isLatest ? "animate-[fadeIn_0.5s_ease-out]" : ""
                  }`}
                  onClick={() => onNodeClick(node)}
                  style={{
                    animation: isLatest ? "fadeIn 0.5s ease-out" : undefined,
                  }}
                >
                  {/* Glow effect for best/selected */}
                  {(isBest || isSelected) && (
                    <ellipse
                      cx="0"
                      cy="0"
                      rx="70"
                      ry="35"
                      fill={isSelected ? "#f59e0b" : "#34d399"}
                      opacity="0.2"
                      filter="url(#glow)"
                      className={isLatest ? "animate-pulse" : ""}
                    />
                  )}

                  {/* Node background */}
                  <rect
                    x="-60"
                    y="-30"
                    width="120"
                    height="60"
                    rx="12"
                    className={`fill-slate-800 stroke-2 ${
                      isSelected
                        ? "stroke-amber-400"
                        : isBest
                          ? "stroke-emerald-400"
                          : "stroke-slate-600"
                    }`}
                  />

                  {/* Node gradient overlay */}
                  <rect
                    x="-58"
                    y="-28"
                    width="116"
                    height="56"
                    rx="10"
                    className={`fill-gradient opacity-20`}
                    style={{
                      fill: isSelected
                        ? "url(#selectedGrad)"
                        : isBest
                          ? "url(#bestGrad)"
                          : "transparent",
                    }}
                  />

                  {/* Round indicator */}
                  <text
                    x="0"
                    y="-12"
                    textAnchor="middle"
                    className="fill-slate-400 text-[10px] font-medium uppercase tracking-wider"
                  >
                    Round {node.round_index}
                  </text>

                  {/* Token count */}
                  <text
                    x="0"
                    y="8"
                    textAnchor="middle"
                    className={`text-lg font-bold ${
                      isSelected
                        ? "fill-amber-300"
                        : isBest
                          ? "fill-emerald-300"
                          : "fill-slate-200"
                    }`}
                  >
                    {node.communication_tokens.toFixed(0)}
                  </text>

                  {/* Token label */}
                  <text
                    x="0"
                    y="22"
                    textAnchor="middle"
                    className="fill-slate-500 text-[9px] uppercase tracking-wider"
                  >
                    tokens
                  </text>

                  {/* Best badge */}
                  {isBest && !isSelected && (
                    <g transform="translate(45, -25)">
                      <circle r="10" className="fill-emerald-500" />
                      <text
                        x="0"
                        y="4"
                        textAnchor="middle"
                        className="fill-white text-[10px] font-bold"
                      >
                        ✓
                      </text>
                    </g>
                  )}

                  {/* Latest indicator */}
                  {isLatest && (
                    <g transform="translate(-45, -25)">
                      <circle r="6" className="fill-indigo-500 animate-ping" />
                      <circle r="4" className="fill-indigo-400" />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Fade overlays for scroll indication */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-slate-900/80 to-transparent" />

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-20px) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

type NodeDetailPanelProps = {
  node: ProtocolNode | null;
  isBest: boolean;
  onClose: () => void;
};

export function NodeDetailPanel({ node, isBest, onClose }: NodeDetailPanelProps) {
  if (!node) return null;

  return (
    <div className="absolute bottom-4 left-4 right-4 z-20 animate-[slideUp_0.3s_ease-out]">
      <div className="rounded-2xl bg-slate-800/95 backdrop-blur-lg ring-1 ring-white/10 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${isBest ? "bg-emerald-400" : "bg-slate-500"}`} />
            <span className="text-sm font-medium text-white">
              Round {node.round_index} {isBest && "- Best Path"}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
              {node.communication_tokens.toFixed(1)} tokens
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-48 overflow-y-auto p-4">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Protocol Rule</p>
          <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
            {node.rule}
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
