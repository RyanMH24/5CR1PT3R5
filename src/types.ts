/** Shared domain types for 5CR1PT3R5. */

/** Model alias passed to `claude --model`. Full model ids (claude-*) are also accepted. */
export type Model = string;

export type Effort = 'low' | 'medium' | 'high';

export type Team = 'Leadership' | 'Engineering' | 'Languages';

export interface AgentProfile {
  team: Team;
  /** Stable id used on the command line, e.g. `powershell`. */
  id: string;
  /** Short alternate ids, e.g. `ps`, `pwsh`. */
  aliases: string[];
  /** Human name shown on the board. */
  name: string;
  title: string;
  specialty: string;
  /** Default model tier; chosen as the cheapest model that does this role well. */
  model: Model;
  effort?: Effort;
  /** Hard spend cap per job, forwarded to `--max-budget-usd`. */
  budgetUsd: number;
  /** Built-in Claude Code tools the agent may use (`--tools`). */
  tools: string[];
  /** Pre-approved permission rules (`--allowedTools`). Anything else is denied. */
  allow: string[];
  /** Role-specific instructions appended to the shared persona. */
  brief: string;
  /**
   * Reviewers (lead, security, QA) can open every agent's folder in Agents Work and get an index
   * of recent team work with each task, so "review what Jade wrote" needs no path.
   */
  seesAllWork?: boolean;
  /**
   * Gets the ui-ux-pro-max design database through `bin/design-search.mjs`. Given to one agent
   * only: the persona lines cost tokens on every turn, so agents who don't design don't get them.
   */
  designSearch?: boolean;
}

export type JobKind = 'task' | 'plan';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'blocked';

export const ACTIVE_STATES: readonly JobState[] = ['queued', 'running'];

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

/** Live view of what an agent is doing, folded from the Claude Code event stream. */
export interface Progress {
  activity: string;
  todos: TodoItem[];
  filesTouched: string[];
  toolCalls: number;
  turns: number;
  /** Actions the sandbox refused, so the user can see why something is unverified. */
  blocked: string[];
  lastText?: string;
}

export interface JobResult {
  summary: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  isError: boolean;
}

export interface Job {
  id: number;
  kind: JobKind;
  agentId: string;
  task: string;
  /** Absolute path of the folder the agent is confined to. */
  workspace: string;
  model: Model;
  budgetUsd: number;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Jobs that must finish successfully before this one may start. */
  dependsOn: number[];
  /** Set on subtasks created by a Tech Lead plan. */
  planId?: number;
  /** Claude Code session id; reused by `office reply` to continue the conversation. */
  sessionId: string;
  /** True when this job continues an earlier session rather than starting fresh. */
  resume: boolean;
  workerPid?: number;
  progress: Progress;
  result?: JobResult;
  error?: string;
}

export interface NewJob {
  kind: JobKind;
  agentId: string;
  task: string;
  workspace: string;
  model: Model;
  budgetUsd: number;
  dependsOn?: number[];
  planId?: number;
  sessionId: string;
  resume?: boolean;
}
