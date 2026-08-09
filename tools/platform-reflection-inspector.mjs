#!/usr/bin/env node

import fs from 'node:fs/promises';
import process from 'node:process';

import {
  inspectSpacecloudDirectReservation,
  openSpacecloudContext,
} from './spacecloud-playwright-uploader.mjs';
import { inspectNaverAvailability } from './naver-playwright-availability.mjs';

function usage() {
  return `Usage:
  node tools/platform-reflection-inspector.mjs --tasks <json> --profile-dir <path> [--task-ids <ids>] [--headless]

The JSON file must contain an array of rhythmjoy_spacecloud_tasks-compatible rows.
This command only reads platform state; it never submits, saves, deletes, or updates DB rows.`;
}

function parseArgs(argv) {
  const args = {
    tasks: '',
    profileDir: '/Users/inteyeo/.spacecloud-automation',
    taskIds: new Set(),
    headless: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--headless') {
      args.headless = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    index += 1;
    if (arg === '--tasks') args.tasks = value;
    else if (arg === '--profile-dir') args.profileDir = value;
    else if (arg === '--task-ids') {
      args.taskIds = new Set(value.split(',').map((id) => Number(id.trim())).filter(Number.isFinite));
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function classify(task, inspection) {
  const taskType = task.task_type || task.taskType || '';
  if (inspection.status === 'failed') return { ok: false, reason: inspection.error || 'inspection-failed' };
  if (taskType === 'upload') {
    return inspection.status === 'identity-matched'
      ? { ok: true, reason: 'spacecloud-identity-matched' }
      : { ok: false, reason: inspection.status === 'candidate-only' ? 'spacecloud-candidate-identity-unverified' : 'spacecloud-event-absent' };
  }
  if (taskType === 'delete') {
    return inspection.status === 'absent'
      ? { ok: true, reason: 'spacecloud-event-absent' }
      : { ok: false, reason: 'spacecloud-event-still-visible' };
  }
  if (taskType === 'naver_block') {
    const statuses = (inspection.slots || []).map((slot) => slot.status);
    return statuses.length > 0 && statuses.every((status) => status === 'suspended')
      ? { ok: true, reason: 'naver-slots-unavailable' }
      : { ok: false, reason: `naver-slot-status:${statuses.join(',') || 'none'}` };
  }
  if (taskType === 'naver_restore') {
    const statuses = (inspection.slots || []).map((slot) => slot.status);
    return statuses.length > 0 && statuses.every((status) => status === 'available')
      ? { ok: true, reason: 'naver-slots-available' }
      : { ok: false, reason: `naver-slot-status:${statuses.join(',') || 'none'}` };
  }
  return { ok: false, reason: `unsupported-task-type:${taskType}` };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.tasks) throw new Error('--tasks is required');
  const input = JSON.parse(await fs.readFile(args.tasks, 'utf8'));
  if (!Array.isArray(input)) throw new Error('tasks JSON must be an array');
  const taskOrder = { upload: 0, delete: 0, naver_block: 1, naver_restore: 1 };
  const tasks = input
    .filter((task) => args.taskIds.size === 0 || args.taskIds.has(Number(task.id || task.taskId)))
    .sort((left, right) => {
      const leftType = left.task_type || left.taskType || '';
      const rightType = right.task_type || right.taskType || '';
      return (taskOrder[leftType] ?? 9) - (taskOrder[rightType] ?? 9)
        || String(left.room_key || left.roomKey || '').localeCompare(String(right.room_key || right.roomKey || ''))
        || String(left.reservation_date || left.date || '').localeCompare(String(right.reservation_date || right.date || ''))
        || Number(left.id || left.taskId) - Number(right.id || right.taskId);
    });
  const context = await openSpacecloudContext({ profileDir: args.profileDir, headless: args.headless });
  const rows = [];
  try {
    for (const task of tasks) {
      const taskType = task.task_type || task.taskType || '';
      let inspection;
      try {
        if (taskType === 'upload' || taskType === 'delete') {
          inspection = await inspectSpacecloudDirectReservation(context, task);
        } else if (taskType === 'naver_block' || taskType === 'naver_restore') {
          inspection = await inspectNaverAvailability(context, task);
        } else {
          inspection = { status: 'failed', error: `unsupported task type: ${taskType}` };
        }
      } catch (error) {
        inspection = { status: 'failed', error: String(error?.message || error) };
      }
      rows.push({
        taskId: Number(task.id || task.taskId),
        taskType,
        roomKey: task.room_key || task.roomKey || '',
        date: task.reservation_date || task.date || '',
        startTime: task.start_time || task.startTime || '',
        endTime: task.end_time || task.endTime || '',
        dbStatus: task.status || '',
        classification: classify(task, inspection),
        inspection,
      });
      process.stderr.write(`checked ${rows.length}/${tasks.length} task=${Number(task.id || task.taskId)} ok=${rows.at(-1).classification.ok}\n`);
    }
  } finally {
    await context.close();
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    checked: rows.length,
    ok: rows.filter((row) => row.classification.ok).length,
    issues: rows.filter((row) => !row.classification.ok).length,
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
