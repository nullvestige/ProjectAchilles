import type { AgentTask, TaskStatus } from '@/types/agent';

export type TaskStatusVariant = 'default' | 'primary' | 'warning' | 'success' | 'destructive';

export interface TaskStatusDisplay {
  label: string;
  variant: TaskStatusVariant;
}

const BASE: Record<TaskStatus, TaskStatusDisplay> = {
  pending: { label: 'Pending', variant: 'default' },
  assigned: { label: 'Assigned', variant: 'primary' },
  downloading: { label: 'Downloading', variant: 'primary' },
  executing: { label: 'Executing', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'default' },
};

// Security-test exit codes that are conclusive outcomes, not failures.
// 126/105/127 = endpoint protection blocked the technique (PROTECTED).
// 101 = technique executed without prevention (UNPROTECTED).
// These are valid test results and must not display as "Failed".
const CONCLUSIVE_TEST_EXIT_CODES = new Set([101, 105, 126, 127]);

/**
 * The honest status of a task. A task the agent reports as "completed" but
 * whose command exited non-zero did NOT succeed — surface it as Failed,
 * UNLESS the exit code is a conclusive security-test outcome (101/105/126/127).
 * A task with no result yet is not treated as a failure.
 */
export function resolveTaskStatusDisplay(
  task: Pick<AgentTask, 'status' | 'type' | 'result'>,
): TaskStatusDisplay {
  if (task.status === 'completed' && task.result != null && task.result.exit_code !== 0) {
    if (task.type === 'execute_test' && CONCLUSIVE_TEST_EXIT_CODES.has(task.result.exit_code)) {
      return BASE.completed;
    }
    return { label: 'Failed', variant: 'destructive' };
  }
  return BASE[task.status];
}
