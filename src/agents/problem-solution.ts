/**
 * ProblemSolution Agent — extracts (problem, solution) pairs where both parts
 * are present in the window. Especially useful for debugging sessions.
 */
import { defineExtractor } from './extractors-common.js';
import { registerAgent } from './registry.js';

export const PROBLEM_SOLUTION_AGENT = defineExtractor({
  name: 'problemSolution',
  allowedKinds: ['problem', 'solution'],
  systemPrompt: `You extract PROBLEM and SOLUTION facts from a developer/AI conversation.

Emit a "problem" fact when a concrete failure, bug, or undesired behavior is
described (error message, broken behavior, slowness, regression). Emit a matching
"solution" fact when the conversation describes how it was (or will be) fixed.

Pair them by giving the solution's summary a clear "fixes <problem title>" or
similar phrasing. If only the problem is stated and no fix is given, emit just
the problem. Avoid duplicates: if multiple turns restate the same issue, emit one.

Each fact's title is short (≤ 12 words). evidence_text quotes the smallest
supporting passage (an error line, a fix description, a stack frame).
If neither a problem nor solution is present, return {"facts": []}.`,
});

registerAgent(PROBLEM_SOLUTION_AGENT);
