/**
 * Agent Task History Tab - Paginated table of all tasks for this agent.
 * Clicking a row expands an inline detail panel with stdout, stderr, and logs.
 */

import { useEffect, useState, Fragment } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/ui/Table';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Loading } from '@/components/shared/ui/Spinner';
import { TaskStatusBadge } from '@/components/endpoints/tasks/TaskStatusBadge';
import { agentApi } from '@/services/api/agent';
import { reportsApi } from '@/services/api/reports';
import type { AgentTask } from '@/types/agent';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';

interface AgentTaskHistoryTabProps {
  agentId: string;
}

const PAGE_SIZE = 20;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  return new Date(normalized).toLocaleString();
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function OutputSection({ label, text }: { label: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <div>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

export default function AgentTaskHistoryTab({ agentId }: AgentTaskHistoryTabProps) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await agentApi.listTasks({
          agent_id: agentId,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        });
        if (!cancelled) {
          setTasks(result.tasks);
          setTotal(result.total);
        }
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [agentId, page]);

  if (loading && tasks.length === 0) {
    return <div className="py-8"><Loading message="Loading tasks..." /></div>;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4">
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8"></TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Test / Command</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Exit Code</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <p className="text-muted-foreground">No tasks found for this agent</p>
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => {
                const isExpanded = expandedId === task.id;
                const hasOutput = task.result && (task.result.stdout || task.result.stderr || task.result.logs);
                return (
                  <Fragment key={task.id}>
                    <TableRow
                      className={hasOutput ? 'cursor-pointer' : undefined}
                      onClick={() => {
                        if (hasOutput) setExpandedId(isExpanded ? null : task.id);
                      }}
                    >
                      <TableCell className="w-8 pr-0">
                        {hasOutput && (
                          isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <TaskStatusBadge task={task} className="text-xs" />
                          {(task.retry_count ?? 0) > 0 && (
                            <Badge variant="warning" className="text-xs">
                              Retry {task.retry_count}/{task.max_retries}
                            </Badge>
                          )}
                          {task.original_task_id && (
                            <span className="text-[10px] text-muted-foreground font-mono" title={`Retry of ${task.original_task_id}`}>
                              retried
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{task.type}</TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {task.type === 'execute_command'
                          ? (task.payload.command ?? 'Command')
                          : (task.payload.test_name || '-')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(task.created_at)}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {task.result?.execution_duration_ms != null
                          ? formatDurationMs(task.result.execution_duration_ms)
                          : '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {task.result?.exit_code != null ? (
                          <span className={task.result.exit_code === 0 ? 'text-accent' : 'text-danger'}>
                            {task.result.exit_code}
                          </span>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {task.type === 'execute_test' && task.status === 'completed' && task.result && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Export SB Report (JSON)"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await reportsApi.downloadSbTaskExport(task.id);
                              } catch (err) {
                                console.error('SB Export failed:', err);
                                alert(`SB Export failed: ${err instanceof Error ? err.message : 'unknown error'}`);
                              }
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && task.result && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="p-0">
                          <div className="border-t border-border bg-surface/50 px-4 py-3 space-y-3">
                            <OutputSection label="stdout" text={task.result.stdout} />
                            <OutputSection label="stderr" text={task.result.stderr} />
                            <OutputSection label="logs (test_execution_log.json)" text={task.result.logs} />
                            {!task.result.stdout && !task.result.stderr && !task.result.logs && (
                              <p className="text-sm text-muted-foreground">No output captured.</p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            {total} task{total !== 1 ? 's' : ''} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
