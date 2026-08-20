import { useMemo, useState } from "react";
import { Network } from "lucide-react";

export interface KgNode {
  nodeId: number;
  nodeType: string;
  externalId: string;
  label: string;
  properties?: Record<string, unknown> | null;
}

export interface KgEdge {
  edgeId?: number;
  fromNode: number;
  toNode: number;
  edgeType: string;
}

interface Props {
  rootNodeId: number | null;
  nodes: KgNode[];
  edges: KgEdge[];
  height?: number;
  onNodeClick?: (node: KgNode) => void;
  expandedNodeIds?: Set<number>;
  loadingNodeId?: number | null;
  canExpand?: (node: KgNode) => boolean;
}

const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  Species: { fill: "#d1fae5", stroke: "#059669", text: "#065f46" },
  Taxon: { fill: "#dbeafe", stroke: "#3b82f6", text: "#1e40af" },
  TAXON: { fill: "#dbeafe", stroke: "#3b82f6", text: "#1e40af" },
  Region: { fill: "#fef3c7", stroke: "#d97706", text: "#92400e" },
  REGION: { fill: "#fef3c7", stroke: "#d97706", text: "#92400e" },
  Threat: { fill: "#fee2e2", stroke: "#ef4444", text: "#7f1d1d" },
  THREAT: { fill: "#fee2e2", stroke: "#ef4444", text: "#7f1d1d" },
  Kingdom: { fill: "#ede9fe", stroke: "#7c3aed", text: "#4c1d95" },
  Phylum: { fill: "#fce7f3", stroke: "#db2777", text: "#831843" },
  Class: { fill: "#e0f2fe", stroke: "#0284c7", text: "#0c4a6e" },
  Order: { fill: "#f0fdf4", stroke: "#22c55e", text: "#14532d" },
  Family: { fill: "#fff7ed", stroke: "#f97316", text: "#7c2d12" },
  Genus: { fill: "#f5f3ff", stroke: "#8b5cf6", text: "#4c1d95" },
  default: { fill: "#f1f5f9", stroke: "#64748b", text: "#1e293b" },
};

const EDGE_COLORS: Record<string, string> = {
  BELONGS_TO: "#94a3b8",
  HAS_THREAT: "#ef4444",
  OCCURS_IN: "#f97316",
  CO_OCCURS_WITH: "#3b82f6",
  default: "#cbd5e1",
};

function truncateLabel(label: string, maxLen = 18): string {
  if (!label) return "?";
  return label.length > maxLen ? label.slice(0, maxLen - 1) + "…" : label;
}

function getNodeColor(nodeType: string) {
  return NODE_COLORS[nodeType] ?? NODE_COLORS.default;
}

function getEdgeColor(edgeType: string) {
  return EDGE_COLORS[edgeType] ?? EDGE_COLORS.default;
}

interface PositionedNode extends KgNode {
  x: number;
  y: number;
  radius: number;
  depth: number;
}

export function KgGraph({
  rootNodeId,
  nodes,
  edges,
  height = 400,
  onNodeClick,
  expandedNodeIds,
  loadingNodeId,
  canExpand,
}: Props) {
  const [tooltip, setTooltip] = useState<{ node: KgNode; x: number; y: number } | null>(null);

  const { positioned, edgeLines } = useMemo(() => {
    if (!nodes.length) return { positioned: [] as PositionedNode[], edgeLines: [] };

    const cx = 50;
    const cy = 50;

    // BFS to assign depth from root
    const adjacency = new Map<number, Set<number>>();
    for (const e of edges) {
      if (!adjacency.has(e.fromNode)) adjacency.set(e.fromNode, new Set());
      if (!adjacency.has(e.toNode)) adjacency.set(e.toNode, new Set());
      adjacency.get(e.fromNode)!.add(e.toNode);
      adjacency.get(e.toNode)!.add(e.fromNode);
    }

    const depthMap = new Map<number, number>();
    const startId = rootNodeId ?? nodes[0].nodeId;
    depthMap.set(startId, 0);
    const queue: number[] = [startId];
    while (queue.length) {
      const cur = queue.shift()!;
      const curDepth = depthMap.get(cur)!;
      for (const next of adjacency.get(cur) ?? []) {
        if (!depthMap.has(next)) {
          depthMap.set(next, curDepth + 1);
          queue.push(next);
        }
      }
    }

    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const positioned: PositionedNode[] = [];

    const rootNode = byId.get(startId) ?? nodes[0];
    positioned.push({ ...rootNode, x: cx, y: cy, radius: 22, depth: 0 });

    const byDepth = new Map<number, KgNode[]>();
    for (const n of nodes) {
      if (n.nodeId === rootNode.nodeId) continue;
      const d = depthMap.get(n.nodeId) ?? 1;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(n);
    }

    const depthRadii = [0, 28, 42, 47];
    const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b);
    for (const d of sortedDepths) {
      const ringNodes = byDepth.get(d)!;
      const count = ringNodes.length;
      const r = depthRadii[Math.min(d, depthRadii.length - 1)] ?? 47;
      const radius = d === 1 ? 16 : 12;
      ringNodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2 + d * 0.15;
        const jitter = count > 8 ? (i % 2) * 4 : 0;
        positioned.push({
          ...n,
          x: cx + (r + jitter) * Math.cos(angle),
          y: cy + (r + jitter) * Math.sin(angle),
          radius,
          depth: d,
        });
      });
    }

    const nodeById = new Map(positioned.map((n) => [n.nodeId, n]));
    const edgeLines = edges
      .map((e) => {
        const src = nodeById.get(e.fromNode);
        const tgt = nodeById.get(e.toNode);
        if (!src || !tgt) return null;
        return { ...e, x1: src.x, y1: src.y, x2: tgt.x, y2: tgt.y };
      })
      .filter(Boolean) as (KgEdge & { x1: number; y1: number; x2: number; y2: number })[];

    return { positioned, edgeLines };
  }, [nodes, edges, rootNodeId]);

  if (!nodes.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
        <Network className="w-8 h-8" />
        <p className="text-sm">No graph data available</p>
      </div>
    );
  }

  return (
    <div className="relative select-none" style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full"
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          {Object.entries(EDGE_COLORS).map(([k, color]) => (
            <marker
              key={k}
              id={`arrow-${k}`}
              markerWidth="4"
              markerHeight="4"
              refX="3"
              refY="2"
              orient="auto"
            >
              <path d="M0,0 L4,2 L0,4 Z" fill={color} opacity="0.7" />
            </marker>
          ))}
        </defs>

        {edgeLines.map((e, i) => {
          const color = getEdgeColor(e.edgeType);
          const markerId = EDGE_COLORS[e.edgeType] ? e.edgeType : "default";
          return (
            <line
              key={e.edgeId ?? i}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={color}
              strokeWidth="0.4"
              strokeOpacity="0.55"
              markerEnd={`url(#arrow-${markerId})`}
            />
          );
        })}

        {positioned.map((node) => {
          const colors = getNodeColor(node.nodeType);
          const isRoot = node.nodeId === rootNodeId;
          const isExpanded = expandedNodeIds?.has(node.nodeId) ?? false;
          const isLoading = loadingNodeId === node.nodeId;
          const expandable = !!onNodeClick && (canExpand ? canExpand(node) : true) && !isExpanded;
          return (
            <g
              key={node.nodeId}
              transform={`translate(${node.x},${node.y})`}
              className={expandable ? "cursor-pointer" : "cursor-default"}
              onMouseEnter={(e) => {
                const svgRect = e.currentTarget.closest("svg")!.getBoundingClientRect();
                const scale = svgRect.width / 100;
                setTooltip({
                  node,
                  x: node.x * scale,
                  y: node.y * scale,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => {
                if (expandable && !isLoading) onNodeClick?.(node);
              }}
            >
              <circle
                r={node.radius}
                fill={colors.fill}
                stroke={colors.stroke}
                strokeWidth={isRoot ? 1.5 : 0.8}
                opacity={isLoading ? 0.5 : 1}
              />
              {isRoot && (
                <circle r={node.radius + 2} fill="none" stroke={colors.stroke} strokeWidth="0.4" strokeDasharray="2 1" />
              )}
              {isExpanded && !isRoot && (
                <circle r={node.radius + 1.5} fill="none" stroke={colors.stroke} strokeWidth="0.3" strokeOpacity="0.6" />
              )}
              {expandable && (
                <g transform={`translate(${node.radius - 2}, ${-node.radius + 2})`}>
                  <circle r="2.5" fill={colors.stroke} />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="3.4"
                    fill="white"
                    style={{ pointerEvents: "none", fontWeight: 700 }}
                  >
                    +
                  </text>
                </g>
              )}
              {isLoading && (
                <circle r={node.radius + 3} fill="none" stroke={colors.stroke} strokeWidth="0.5" strokeDasharray="1.5 1.5">
                  <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite" />
                </circle>
              )}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={isRoot ? 3.5 : 2.8}
                fill={colors.text}
                style={{ pointerEvents: "none", fontWeight: isRoot ? 700 : 500 }}
              >
                {truncateLabel(node.label, isRoot ? 16 : 11)}
              </text>
              <text
                y={node.radius + 2.8}
                textAnchor="middle"
                fontSize="1.9"
                fill="#94a3b8"
                style={{ pointerEvents: "none" }}
              >
                {node.nodeType}
              </text>
            </g>
          );
        })}
      </svg>

      {tooltip && (
        <div
          className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-3 max-w-[220px] pointer-events-none text-xs"
          style={{ left: Math.min(tooltip.x, (height || 400) - 230), top: Math.max(tooltip.y - 80, 0) }}
        >
          <p className="font-semibold text-slate-900 break-words">{tooltip.node.label}</p>
          <p className="text-slate-500 mt-0.5">Type: {tooltip.node.nodeType}</p>
          <p className="text-slate-400 mt-0.5 break-all">{tooltip.node.externalId}</p>
          {!!onNodeClick && (canExpand ? canExpand(tooltip.node) : true) && !expandedNodeIds?.has(tooltip.node.nodeId) && (
            <p className="text-emerald-600 mt-1 italic">Click to expand neighbours</p>
          )}
          {tooltip.node.properties && Object.keys(tooltip.node.properties).length > 0 && (
            <div className="mt-1.5 border-t border-slate-100 pt-1.5 space-y-0.5">
              {Object.entries(tooltip.node.properties)
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .slice(0, 4)
                .map(([k, v]) => (
                  <p key={k} className="text-slate-500">
                    <span className="font-medium">{k}:</span> {String(v)}
                  </p>
                ))}
            </div>
          )}
        </div>
      )}

      <div className="absolute bottom-2 right-2 flex flex-wrap gap-1 max-w-[200px] justify-end">
        {Array.from(new Set(positioned.map((n) => n.nodeType))).map((type) => {
          const colors = getNodeColor(type);
          return (
            <span
              key={type}
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: colors.fill, color: colors.text, border: `1px solid ${colors.stroke}` }}
            >
              {type}
            </span>
          );
        })}
      </div>
    </div>
  );
}
