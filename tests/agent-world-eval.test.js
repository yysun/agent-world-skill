/*
  Eval runner coverage for Agent World.

  Recent changes:
  - Exercises the deterministic eval harness against temporary generated worlds.
  - Covers passing routing contracts and failed expected-result reporting.
*/

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const skillRoot = path.resolve(__dirname, '..');
const evalRunner = path.join(skillRoot, 'scripts', 'agent-world-eval.js');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writePromptFiles(worldDir) {
  const promptsDir = path.join(worldDir, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.writeFileSync(path.join(promptsDir, 'intake.md'), [
    'You are @intake.',
    'Use paragraph-start @mentions for handoffs.',
    'Mention @architect at paragraph start when ready.',
    'Do not execute tools.'
  ].join('\n'));
  fs.writeFileSync(path.join(promptsDir, 'architect.md'), [
    'You are @architect.',
    'Use paragraph-start @mentions for handoffs.',
    'Mention @final at paragraph start when ready.',
    'Do not execute tools.'
  ].join('\n'));
  fs.writeFileSync(path.join(promptsDir, 'final.md'), [
    'You are @final.',
    'Use paragraph-start @mentions only if the workflow requires a handoff.',
    'Do not execute tools.',
    'End final responses with <world>pass</world>.'
  ].join('\n'));
}

function makeEvalWorld(evalMarkdown) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-eval-test-'));
  const worldDir = path.join(cwd, '.agent-world');
  const configPath = path.join(worldDir, 'world.json');
  const evalPath = path.join(worldDir, 'world.eval.md');
  fs.mkdirSync(worldDir, { recursive: true });
  writePromptFiles(worldDir);
  writeJson(configPath, {
    world: {
      id: 'eval-test-world',
      name: 'eval-test-world',
      stopToken: '<world>pass</world>',
      turnLimit: 8,
      mode: 'host_delegated'
    },
    workflow: {
      type: 'dag',
      entry: 'intake',
      entryAgent: 'intake',
      enforceEdges: true,
      nodes: {
        intake: {
          agent: 'intake',
          instruction: 'Frame the request.'
        },
        architect: {
          agent: 'architect',
          instruction: 'Design the response.'
        },
        final: {
          agent: 'final',
          instruction: 'Finish with the stop token.'
        }
      },
      edges: {
        intake: ['architect'],
        architect: ['final'],
        final: []
      }
    },
    agents: {
      intake: {
        role: 'intake',
        promptPath: 'prompts/intake.md'
      },
      architect: {
        role: 'architect',
        promptPath: 'prompts/architect.md'
      },
      final: {
        role: 'final',
        promptPath: 'prompts/final.md'
      }
    }
  });
  fs.writeFileSync(evalPath, evalMarkdown);
  return {
    cwd,
    configPath,
    evalPath,
    outDir: path.join(worldDir, 'eval-runs')
  };
}

function runEval(world) {
  return spawnSync(process.execPath, [
    evalRunner,
    '--config', world.configPath,
    '--eval', world.evalPath,
    '--out', world.outDir
  ], {
    cwd: world.cwd,
    encoding: 'utf8'
  });
}

test('eval runner passes deterministic routing cases and writes a report', () => {
  const world = makeEvalWorld(`# Agent World Eval

## Routing Cases

\`\`\`json
{
  "name": "human message routes to entry node",
  "input": {
    "command": "user",
    "content": "Build a small todo app"
  },
  "expect": {
    "type": "agent_instruction",
    "agent": "intake",
    "workflowNode": "intake"
  }
}
\`\`\`

\`\`\`json
{
  "name": "entry agent hands off to architect",
  "given": [
    {
      "command": "user",
      "content": "Build a small todo app"
    }
  ],
  "complete": {
    "agent": "intake",
    "content": "@architect\\nPlease design the app."
  },
  "expect": {
    "type": "agent_instruction",
    "agent": "architect",
    "workflowNode": "architect"
  }
}
\`\`\`

\`\`\`json
{
  "name": "invalid edge is blocked",
  "given": [
    {
      "command": "user",
      "content": "Build a small todo app"
    }
  ],
  "complete": {
    "agent": "intake",
    "content": "@final\\nSkip the workflow."
  },
  "expect": {
    "type": "blocked",
    "code": "workflow_edge_blocked"
  }
}
\`\`\`

\`\`\`json
{
  "name": "final stop token completes world",
  "given": [
    {
      "command": "user",
      "content": "Build a small todo app"
    },
    {
      "completeAgent": "intake",
      "content": "@architect\\nPlease design the app."
    },
    {
      "completeAgent": "architect",
      "content": "@final\\nPlease finish."
    }
  ],
  "complete": {
    "agent": "final",
    "content": "Done.\\n\\n<world>pass</world>"
  },
  "expect": {
    "type": "done"
  }
}
\`\`\`
`);

  const result = runEval(world);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Agent World eval PASS/);
  const latest = fs.readFileSync(path.join(world.outDir, 'latest.md'), 'utf8');
  assert.match(latest, /Result: PASS/);
  assert.match(latest, /PASS human message routes to entry node/);
  assert.match(latest, /PASS final stop token completes world/);
});

test('eval runner fails when expected routing output does not match', () => {
  const world = makeEvalWorld(`# Agent World Eval

## Routing Cases

\`\`\`json
{
  "name": "wrong expected agent fails",
  "input": {
    "command": "user",
    "content": "Build a small todo app"
  },
  "expect": {
    "type": "agent_instruction",
    "agent": "final",
    "workflowNode": "final"
  }
}
\`\`\`
`);

  const result = runEval(world);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Agent World eval FAIL/);
  const latest = fs.readFileSync(path.join(world.outDir, 'latest.md'), 'utf8');
  assert.match(latest, /Result: FAIL/);
  assert.match(latest, /FAIL wrong expected agent fails: expected agent final/);
});
