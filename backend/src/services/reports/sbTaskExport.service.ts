// SB-PC-2026-001 compliance report built from SQLite task results — no
// Elasticsearch required.  Reads the bundle_results JSON stored in the
// tasks.result column and maps each control to the SB execution row format.
//
// Standalone (non-bundle) tests are also supported: the task's exit_code is
// mapped to an SB outcome using test catalog metadata for techniques/tactics.
//
// Outcome mapping (mirrors sbReport.service.ts rules, minus EDR enrichment
// which is unavailable without ES):
//   exit 126/105/127                        -> PREVENTED
//   exit 101 (or 0), exfiltration/impact    -> EXPOSED
//   exit 101 (or 0), other tactics          -> MISSED
//   skipped: true                           -> NOT_RUN
//   anything else                           -> ERROR

import { getDatabase } from '../agent/database.js';
import { getTestMetadata } from '../agent/test-catalog.service.js';
import {
  SB_BUNDLE_ID,
  SB_BUNDLE_NAME,
  SB_STAGE_LABELS,
  type SbOutcome,
  type SbReport,
  type SbReportExecutionRow,
} from './sbReport.service.js';
import type { BundleResults, BundleControlResult, TaskResult } from '../../types/agent.js';
import { getTechniqueName } from './mitreTechniques.js';

const TACTIC_TO_TA: Record<string, string> = {
  'reconnaissance': 'TA0043',
  'resource-development': 'TA0042',
  'initial-access': 'TA0001',
  'execution': 'TA0002',
  'persistence': 'TA0003',
  'privilege-escalation': 'TA0004',
  'defense-evasion': 'TA0005',
  'credential-access': 'TA0006',
  'discovery': 'TA0007',
  'lateral-movement': 'TA0008',
  'collection': 'TA0009',
  'exfiltration': 'TA0010',
  'command-and-control': 'TA0011',
  'impact': 'TA0040',
};

const PREVENTED_EXIT_CODES = new Set([126, 105, 127]);
const EXECUTED_EXIT_CODES = new Set([101, 0]);
const EXPOSED_TACTICS = new Set(['exfiltration', 'impact', 'TA0010', 'TA0040']);

function mapOutcome(control: BundleControlResult): SbOutcome {
  if (control.skipped) return 'NOT_RUN';
  if (PREVENTED_EXIT_CODES.has(control.exit_code)) return 'PREVENTED';
  if (EXECUTED_EXIT_CODES.has(control.exit_code)) {
    if (control.tactics.some((t) => EXPOSED_TACTICS.has(t))) return 'EXPOSED';
    return 'MISSED';
  }
  return 'ERROR';
}

function mapStandaloneOutcome(exitCode: number, tactics: string[]): SbOutcome {
  if (PREVENTED_EXIT_CODES.has(exitCode)) return 'PREVENTED';
  if (EXECUTED_EXIT_CODES.has(exitCode)) {
    if (tactics.some((t) => EXPOSED_TACTICS.has(t))) return 'EXPOSED';
    return 'MISSED';
  }
  return 'ERROR';
}

function parseObjectiveNumber(name: string): number | undefined {
  const m = name.match(/Obj\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : undefined;
}

interface TaskRow {
  id: string;
  result: string;
  created_at: string;
  completed_at: string | null;
}

interface SbTaskExportParams {
  taskId: string;
  orgCode?: string;
  vendor?: string;
}

export function generateSbReportFromTask(params: SbTaskExportParams): SbReport {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT id, result, created_at, completed_at FROM tasks WHERE id = ?',
  ).get(params.taskId) as TaskRow | undefined;

  if (!row) {
    throw new Error(`Task ${params.taskId} not found`);
  }
  if (!row.result) {
    throw new Error(`Task ${params.taskId} has no result yet`);
  }

  const result: TaskResult = JSON.parse(row.result);

  const executions = result.bundle_results
    ? buildRows(result.bundle_results, result, row)
    : buildStandaloneRow(result, row);

  const completedDate = result.completed_at || row.completed_at || row.created_at;
  const startedDate = result.started_at || row.created_at;

  return {
    meta: {
      organization: params.orgCode || 'unknown',
      vendor: params.vendor || 'ProjectAchilles',
      window: {
        from: startedDate.split('T')[0],
        to: completedDate.split('T')[0],
      },
      generatedAt: new Date().toISOString(),
    },
    executions,
  };
}

function buildRows(
  bundle: BundleResults,
  result: TaskResult,
  task: TaskRow,
): SbReportExecutionRow[] {
  return bundle.controls.flatMap((control, index) => {
    const stage = parseStageNumber(control.validator) ?? index + 1;
    const outcome = mapOutcome(control);
    const tactics = control.tactics.map((t) => TACTIC_TO_TA[t] ?? t);
    const techniques = control.techniques.length > 0 ? control.techniques : ['unknown'];

    return techniques.map((technique) => ({
      sourceEventId: `${task.id}::${technique}`,
      timestamp: result.started_at || task.created_at,
      bundleId: SB_BUNDLE_ID,
      bundleName: SB_BUNDLE_NAME,
      testName: `${getTechniqueName(technique)} (${technique})`,
      hostname: result.hostname || 'unknown',
      stage,
      stageLabel: SB_STAGE_LABELS[stage] || control.control_name || `Stage ${stage}`,
      techniques: [technique],
      tactics,
      outcome,
      isProtected: outcome === 'PREVENTED' || outcome === 'DETECTED',
      preventedBy: outcome === 'PREVENTED' ? ['Endpoint Protection'] : [],
      detectedBy: [],
      evidenceRef: `task:${task.id}`,
    }));
  });
}

function buildStandaloneRow(
  result: TaskResult,
  task: TaskRow,
): SbReportExecutionRow[] {
  const meta = getTestMetadata(result.test_uuid);
  const techniques = meta?.techniques ?? [];
  const rawTactics = meta?.tactics ?? [];
  const tactics = rawTactics.map((t) => TACTIC_TO_TA[t] ?? t);
  const testName = meta?.name ?? result.test_uuid;

  const stage = parseObjectiveNumber(testName) ?? 0;
  const outcome = mapStandaloneOutcome(result.exit_code, rawTactics);

  if (techniques.length === 0) {
    techniques.push('unknown');
  }

  return techniques.map((technique) => ({
    sourceEventId: `${task.id}::${technique}`,
    timestamp: result.started_at || task.created_at,
    bundleId: SB_BUNDLE_ID,
    bundleName: SB_BUNDLE_NAME,
    testName: `${getTechniqueName(technique)} (${technique})`,
    hostname: result.hostname || 'unknown',
    stage,
    stageLabel: SB_STAGE_LABELS[stage] || testName,
    techniques: [technique],
    tactics,
    outcome,
    isProtected: outcome === 'PREVENTED' || outcome === 'DETECTED',
    preventedBy: outcome === 'PREVENTED' ? ['Endpoint Protection'] : [],
    detectedBy: [],
    evidenceRef: `task:${task.id}`,
  }));
}

function parseStageNumber(validator: string): number | undefined {
  const m = validator.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
}

// ── Multi-task report ────────────────────────────────────────────

export interface SbMultiTaskExportParams {
  taskIds: string[];
  orgCode?: string;
  vendor?: string;
}

export function generateSbReportFromTasks(params: SbMultiTaskExportParams): SbReport {
  const allExecutions: SbReportExecutionRow[] = [];
  let earliest = '';
  let latest = '';

  for (const taskId of params.taskIds) {
    const single = generateSbReportFromTask({ taskId, orgCode: params.orgCode, vendor: params.vendor });
    allExecutions.push(...single.executions);
    const w = single.meta.window;
    if (!earliest || w.from < earliest) earliest = w.from;
    if (!latest || w.to > latest) latest = w.to;
  }

  allExecutions.sort((a, b) =>
    a.hostname.localeCompare(b.hostname)
    || a.timestamp.localeCompare(b.timestamp)
    || a.stage - b.stage);

  return {
    meta: {
      organization: params.orgCode || 'unknown',
      vendor: params.vendor || 'ProjectAchilles',
      window: { from: earliest, to: latest },
      generatedAt: new Date().toISOString(),
    },
    executions: allExecutions,
  };
}
