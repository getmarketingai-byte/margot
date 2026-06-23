"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Trash2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface FaultReport {
  id: string;
  userId: string | null;
  type: string;
  statusCode: number | null;
  path: string;
  message: string;
  stack: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  notes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | "open" | "investigating" | "resolved" | "wont_fix";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "destructive" },
  investigating: { label: "Investigating", color: "secondary" },
  resolved: { label: "Resolved", color: "default" },
  wont_fix: { label: "Won't Fix", color: "outline" },
};

const TYPE_LABELS: Record<string, string> = {
  "404": "404 Not Found",
  "500": "500 Server Error",
  client_error: "Client Error",
  api_error: "API Error",
  unknown: "Unknown",
};

function FaultRow({ fault, onUpdate, onDelete }: {
  fault: FaultReport;
  onUpdate: (id: string, updates: { status?: string; notes?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(fault.notes ?? "");
  const [saving, setSaving] = useState(false);

  const statusInfo = STATUS_LABELS[fault.status] ?? { label: fault.status, color: "outline" };

  async function handleStatusChange(newStatus: string) {
    setSaving(true);
    await onUpdate(fault.id, { status: newStatus });
    setSaving(false);
  }

  async function handleSaveNotes() {
    setSaving(true);
    await onUpdate(fault.id, { notes });
    setSaving(false);
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant={statusInfo.color as "default" | "secondary" | "destructive" | "outline"}>
              {statusInfo.label}
            </Badge>
            <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded">
              {TYPE_LABELS[fault.type] ?? fault.type}
            </span>
            {fault.statusCode && (
              <span className="text-xs text-muted-foreground">HTTP {fault.statusCode}</span>
            )}
          </div>
          <p className="text-sm font-medium truncate">{fault.path}</p>
          <p className="text-xs text-muted-foreground truncate">{fault.message}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date(fault.createdAt).toLocaleString()}
            {fault.userId && " · authenticated user"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t p-4 space-y-4 bg-muted/20">
          {/* Status actions */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-medium text-muted-foreground self-center">Status:</span>
            {Object.entries(STATUS_LABELS).map(([key, { label }]) => (
              <Button
                key={key}
                variant={fault.status === key ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                disabled={saving || fault.status === key}
                onClick={(e) => { e.stopPropagation(); handleStatusChange(key); }}
              >
                {label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
              disabled={saving}
              onClick={(e) => { e.stopPropagation(); onDelete(fault.id); }}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </div>

          {/* Path + user agent */}
          <div className="space-y-1 text-xs">
            <div><span className="font-medium">Path:</span> <code className="bg-muted px-1 rounded">{fault.path}</code></div>
            {fault.userAgent && (
              <div className="truncate"><span className="font-medium">User Agent:</span> {fault.userAgent}</div>
            )}
            {fault.userId && (
              <div><span className="font-medium">User ID:</span> {fault.userId}</div>
            )}
          </div>

          {/* Stack trace */}
          {fault.stack && (
            <div>
              <p className="text-xs font-medium mb-1">Stack trace:</p>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                {fault.stack}
              </pre>
            </div>
          )}

          {/* Metadata */}
          {fault.metadata && Object.keys(fault.metadata).length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Metadata:</p>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-32 overflow-y-auto">
                {JSON.stringify(fault.metadata, null, 2)}
              </pre>
            </div>
          )}

          {/* Notes */}
          <div onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-medium mb-1">Investigation notes:</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this fault..."
              className="w-full text-xs p-2 rounded border bg-background resize-none h-20 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button
              size="sm"
              className="mt-1 h-7 text-xs"
              disabled={saving || notes === (fault.notes ?? "")}
              onClick={handleSaveNotes}
            >
              Save notes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FaultsDashboard() {
  const [faults, setFaults] = useState<FaultReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");

  const loadFaults = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === "all" ? "/api/faults" : `/api/faults?status=${statusFilter}`;
      const res = await fetch(url);
      if (res.ok) {
        setFaults(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadFaults();
  }, [loadFaults]);

  const handleUpdate = async (id: string, updates: { status?: string; notes?: string }) => {
    const res = await fetch(`/api/faults/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const updated = await res.json();
      setFaults((prev) => prev.map((f) => (f.id === id ? updated : f)));
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/faults/${id}`, { method: "DELETE" });
    setFaults((prev) => prev.filter((f) => f.id !== id));
  };

  const openCount = faults.filter((f) => f.status === "open").length;
  const investigatingCount = faults.filter((f) => f.status === "investigating").length;

  const filters: { key: StatusFilter; label: string; icon: React.ReactNode }[] = [
    { key: "open", label: "Open", icon: <XCircle className="h-4 w-4" /> },
    { key: "investigating", label: "Investigating", icon: <Clock className="h-4 w-4" /> },
    { key: "resolved", label: "Resolved", icon: <CheckCircle className="h-4 w-4" /> },
    { key: "wont_fix", label: "Won't Fix", icon: <AlertTriangle className="h-4 w-4" /> },
    { key: "all", label: "All", icon: null },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fault Reports</h1>
          <p className="text-sm text-muted-foreground">
            Automatically captured errors from the app
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadFaults} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">
              {faults.filter((f) => f.status === "open").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Investigating</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-yellow-600">
              {faults.filter((f) => f.status === "investigating").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Resolved</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">
              {faults.filter((f) => f.status === "resolved").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{faults.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {filters.map(({ key, label, icon }) => (
          <Button
            key={key}
            variant={statusFilter === key ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(key)}
          >
            {icon && <span className="mr-1.5">{icon}</span>}
            {label}
          </Button>
        ))}
      </div>

      {/* Fault list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : faults.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No faults found</p>
            <p className="text-sm text-muted-foreground">
              {statusFilter === "open"
                ? "No open faults — the app is running clean."
                : `No faults with status "${statusFilter}".`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {faults.map((fault) => (
            <FaultRow
              key={fault.id}
              fault={fault}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
