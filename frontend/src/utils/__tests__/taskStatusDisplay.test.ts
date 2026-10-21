import { describe, it, expect } from 'vitest';
import { resolveTaskStatusDisplay } from '../taskStatusDisplay';
import type { AgentTask, TaskResult } from '@/types/agent';

const result = (exit_code: number): TaskResult => ({
  exit_code, stdout: '', stderr: '', started_at: '', completed_at: '', execution_duration_ms: 0, hostname: '',
} as TaskResult);

type TaskLike = Pick<AgentTask, 'status' | 'type' | 'result'>;
const task = (status: AgentTask['status'], r: TaskResult | null = null, type: AgentTask['type'] = 'execute_test'): TaskLike => ({ status, type, result: r });

describe('resolveTaskStatusDisplay — honesty rule', () => {
  it('completed with exit_code 0 → Completed / success', () => {
    const d = resolveTaskStatusDisplay(task('completed', result(0)));
    expect(d).toEqual({ label: 'Completed', variant: 'success' });
  });

  it('completed with exit_code 1 → Failed / destructive (the bug)', () => {
    const d = resolveTaskStatusDisplay(task('completed', result(1)));
    expect(d.variant).toBe('destructive');
    expect(d.label).toBe('Failed');
  });

  it('completed with exit_code 255 → Failed / destructive', () => {
    expect(resolveTaskStatusDisplay(task('completed', result(255))).variant).toBe('destructive');
  });

  it('completed with no result yet → Completed / success (no result is not a failure)', () => {
    expect(resolveTaskStatusDisplay(task('completed', null)).variant).toBe('success');
  });

  it('failed status → Failed / destructive regardless of result', () => {
    expect(resolveTaskStatusDisplay(task('failed', null))).toEqual({ label: 'Failed', variant: 'destructive' });
  });

  it('executing → Executing / warning', () => {
    expect(resolveTaskStatusDisplay(task('executing'))).toEqual({ label: 'Executing', variant: 'warning' });
  });

  it('assigned/downloading → primary', () => {
    expect(resolveTaskStatusDisplay(task('assigned')).variant).toBe('primary');
    expect(resolveTaskStatusDisplay(task('downloading')).variant).toBe('primary');
  });

  it('pending/expired → default', () => {
    expect(resolveTaskStatusDisplay(task('pending')).variant).toBe('default');
    expect(resolveTaskStatusDisplay(task('expired')).variant).toBe('default');
  });

  // Security-test conclusive exit codes
  it('execute_test with exit 126 (PROTECTED) → Completed / success', () => {
    const d = resolveTaskStatusDisplay(task('completed', result(126)));
    expect(d).toEqual({ label: 'Completed', variant: 'success' });
  });

  it('execute_test with exit 101 (UNPROTECTED) → Completed / success', () => {
    const d = resolveTaskStatusDisplay(task('completed', result(101)));
    expect(d).toEqual({ label: 'Completed', variant: 'success' });
  });

  it('execute_test with exit 105 (PROTECTED) → Completed / success', () => {
    expect(resolveTaskStatusDisplay(task('completed', result(105))).variant).toBe('success');
  });

  it('execute_test with exit 127 (PROTECTED) → Completed / success', () => {
    expect(resolveTaskStatusDisplay(task('completed', result(127))).variant).toBe('success');
  });

  it('execute_command with exit 126 → still Failed (not a security test)', () => {
    const d = resolveTaskStatusDisplay(task('completed', result(126), 'execute_command'));
    expect(d.variant).toBe('destructive');
    expect(d.label).toBe('Failed');
  });
});
