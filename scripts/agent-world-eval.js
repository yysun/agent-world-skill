#!/usr/bin/env node
/*
  Deterministic Agent World eval harness.

  This script validates the generated world contract and drives the existing
  router through file-based handoff with mocked agent completions. It does not
  call a model and does not reimplement routing decisions.

  Recent changes:
  - Added contract checks for world.json, prompt files, graph references, and
    prompt protocol language.
  - Added markdown JSON routing-case parsing for .agent-world/world.eval.md.
  - Added report writing under .agent-world/eval-runs.
*/

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const routerPath = path.join(__dirname, 'agent-world-router.js');
const { loadConfig } = require(routerPath);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', 'Z');
}

function slugify(value) {
  return String(value || 'case')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'case';
}

function normalizeLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferProjectRoot(configPath) {
  const configDir = path.dirname(configPath);
  return path.basename(configDir) === '.agent-world'
    ? path.dirname(configDir)
    : process.cwd();
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function rawAgentEntries(rawConfig) {
  const rawAgents = rawConfig && rawConfig.agents || {};
  if (Array.isArray(rawAgents)) {
    return rawAgents.map(agent => [agent.id || agent.name, agent]);
  }
  return Object.entries(rawAgents);
}

function checkPromptMentionProtocol(prompt) {
  const lower = String(prompt || '').toLowerCase();
  const mentionsMention = /@mentions?|@[a-z][a-z0-9_.-]*/i.test(prompt);
  const mentionsBoundary = /paragraph|handoff|start/.test(lower);
  return mentionsMention && mentionsBoundary;
}

function checkPromptToolProtocol(prompt) {
  const normalized = String(prompt || '').replace(/[*_`~]/g, '');
  return /do not (call|execute|run|use) tools/i.test(normalized)
    || /never run tools directly/i.test(normalized)
    || /must not directly (edit|run|execute)/i.test(normalized)
    || /request host actions? only/i.test(normalized);
}

function finalWorkflowNodes(config) {
  const edges = config.workflow.edges || {};
  return Object.keys(config.workflow.nodes || {}).filter(nodeId => asArray(edges[nodeId]).length === 0);
}

function addCheck(checks, category, name, fn) {
  try {
    fn();
    checks.push({ category, name, status: 'PASS' });
    return true;
  } catch (err) {
    checks.push({ category, name, status: 'FAIL', reason: err.message });
    return false;
  }
}

function parseRoutingCases(markdown) {
  const cases = [];
  const errors = [];
  const blockPattern = /```json\s*([\s\S]*?)```/g;
  let match;
  let blockNumber = 0;

  while ((match = blockPattern.exec(markdown)) !== null) {
    blockNumber += 1;
    const raw = match[1].trim();
    if (!raw) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      errors.push(`json block ${blockNumber}: ${err.message}`);
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of candidates) {
      if (item && item.name && item.expect && (item.input || item.given || item.complete)) {
        cases.push(item);
      }
    }
  }

  return { cases, errors };
}

function describeResult(result) {
  if (!result) return '(no result)';
  const parts = [`type=${result.type}`];
  if (result.agent) parts.push(`agent=${result.agent}`);
  if (result.workflow && result.workflow.node) parts.push(`workflowNode=${result.workflow.node}`);
  if (result.code) parts.push(`code=${result.code}`);
  return parts.join(', ');
}

function actualAgentAliases(result, config) {
  const aliases = new Set();
  if (!result) return aliases;
  if (result.agent) aliases.add(normalizeLabel(result.agent));

  const nodeId = result.workflow && result.workflow.node;
  const node = nodeId && config.workflow.nodes[nodeId];
  if (node && node.agent) {
    aliases.add(normalizeLabel(node.agent));
    const agent = config.agents[node.agent];
    if (agent && agent.name) aliases.add(normalizeLabel(agent.name));
  }

  for (const [agentId, agent] of Object.entries(config.agents || {})) {
    if (agent.name && result.agent && normalizeLabel(agent.name) === normalizeLabel(result.agent)) {
      aliases.add(normalizeLabel(agentId));
    }
  }

  return aliases;
}

function assertExpectedAgent(expected, result, config) {
  const expectedAlias = normalizeLabel(expected);
  const aliases = actualAgentAliases(result, config);
  if (!aliases.has(expectedAlias)) {
    throw new Error(`expected agent ${expected}, got ${result && result.agent ? result.agent : '(none)'}`);
  }
}

function assertExpectation(expect, result, config) {
  if (expect.type !== undefined && result.type !== expect.type) {
    throw new Error(`expected type ${expect.type}, got ${result.type}`);
  }
  if (expect.agent !== undefined) {
    assertExpectedAgent(expect.agent, result, config);
  }
  if (expect.workflowNode !== undefined) {
    const actualNode = result.workflow && result.workflow.node;
    if (actualNode !== expect.workflowNode) {
      throw new Error(`expected workflowNode ${expect.workflowNode}, got ${actualNode || '(none)'}`);
    }
  }
  if (expect.code !== undefined && result.code !== expect.code) {
    throw new Error(`expected code ${expect.code}, got ${result.code || '(none)'}`);
  }
}

function runRouterFile(projectRoot, requestDir, request) {
  runRouterFile.counter = (runRouterFile.counter || 0) + 1;
  const index = String(runRouterFile.counter).padStart(3, '0');
  const requestPath = path.join(requestDir, `request-${index}.json`);
  const resultPath = path.join(requestDir, `result-${index}.json`);
  writeJsonFile(requestPath, { resultPath, ...request });

  const result = spawnSync(process.execPath, [routerPath, 'file', '--request', requestPath, '--result', resultPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env }
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(stderr || stdout || `router exited with status ${result.status}`);
  }
  if (!fs.existsSync(resultPath)) {
    throw new Error(`router did not write result file: ${resultPath}`);
  }
  return readJsonFile(resultPath);
}

function assertPendingAgent(step, current, config) {
  const expectedAgent = step.agent || step.completeAgent;
  if (!expectedAgent) return;
  if (!current || current.type !== 'agent_instruction') {
    throw new Error(`expected pending agent ${expectedAgent}, got ${describeResult(current)}`);
  }
  assertExpectedAgent(expectedAgent, current, config);
}

function runUserStep(context, step) {
  const content = step.content !== undefined ? step.content : step.message;
  if (!String(content || '').trim()) throw new Error('user step is missing content');
  return runRouterFile(context.projectRoot, context.requestDir, {
    command: 'user',
    configPath: context.configPath,
    statePath: context.statePath,
    content
  });
}

function runCompleteStep(context, step, current) {
  if (!current || current.type !== 'agent_instruction') {
    throw new Error(`complete step requires a pending agent_instruction, got ${describeResult(current)}`);
  }
  assertPendingAgent(step, current, context.config);
  if (step.content === undefined) throw new Error('complete step is missing content');
  return runRouterFile(context.projectRoot, context.requestDir, {
    command: 'complete',
    configPath: context.configPath,
    statePath: context.statePath,
    turnId: step.turnId || current.turnId,
    content: step.content
  });
}

function runStep(context, step, current) {
  const command = step.command || (step.completeAgent || step.agent || step.turnId ? 'complete' : 'user');
  if (command === 'user' || command === 'ingest') return runUserStep(context, step);
  if (command === 'complete') return runCompleteStep(context, step, current);
  throw new Error(`unsupported eval step command: ${command}`);
}

function runCase(caseItem, config, configPath, projectRoot) {
  const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-world-eval-${slugify(caseItem.name)}-`));
  const context = {
    config,
    configPath,
    projectRoot,
    requestDir: caseDir,
    statePath: path.join(caseDir, 'state.json')
  };

  try {
    runRouterFile(projectRoot, caseDir, {
      command: 'reset',
      configPath,
      statePath: context.statePath
    });

    let current = null;
    for (const step of asArray(caseItem.given)) {
      current = runStep(context, step, current);
    }
    if (caseItem.input) {
      current = runStep(context, caseItem.input, current);
    }
    if (caseItem.complete) {
      current = runCompleteStep(context, caseItem.complete, current);
    }

    if (!current) {
      throw new Error('case did not execute any routing step');
    }

    assertExpectation(caseItem.expect || {}, current, config);
    return {
      name: caseItem.name,
      status: 'PASS',
      actual: describeResult(current)
    };
  } catch (err) {
    return {
      name: caseItem.name,
      status: 'FAIL',
      reason: err.message
    };
  } finally {
    fs.rmSync(caseDir, { recursive: true, force: true });
  }
}

function validateWorldContract(checks, rawConfig, config, configPath) {
  const configDir = path.dirname(configPath);

  addCheck(checks, 'config', 'all agents use promptPath', () => {
    const entries = rawAgentEntries(rawConfig);
    if (entries.length === 0) throw new Error('agents is empty');
    const missing = entries.filter(([, agent]) => !agent || !agent.promptPath).map(([id]) => id || '(missing id)');
    if (missing.length > 0) throw new Error(`missing promptPath: ${missing.join(', ')}`);
  });

  addCheck(checks, 'config', 'every promptPath exists', () => {
    const missing = rawAgentEntries(rawConfig)
      .filter(([, agent]) => agent && agent.promptPath && !fs.existsSync(path.resolve(configDir, agent.promptPath)))
      .map(([id, agent]) => `${id}: ${agent.promptPath}`);
    if (missing.length > 0) throw new Error(`missing prompts: ${missing.join(', ')}`);
  });

  addCheck(checks, 'config', 'workflow.entry exists', () => {
    if (!config.workflow.entry || !config.workflow.nodes[config.workflow.entry]) {
      throw new Error(`missing workflow entry node: ${config.workflow.entry || '(none)'}`);
    }
  });

  addCheck(checks, 'config', 'workflow.entryAgent matches entry node agent', () => {
    const entryNode = config.workflow.nodes[config.workflow.entry];
    if (!entryNode) throw new Error('workflow entry node is missing');
    if (config.workflow.entryAgent !== entryNode.agent) {
      throw new Error(`entryAgent ${config.workflow.entryAgent || '(none)'} does not match ${config.workflow.entry}.agent ${entryNode.agent}`);
    }
  });

  addCheck(checks, 'prompt', 'prompts mention paragraph-start @mentions', () => {
    const failing = Object.entries(config.agents)
      .filter(([, agent]) => !checkPromptMentionProtocol(agent.systemPrompt))
      .map(([id]) => id);
    if (failing.length > 0) throw new Error(`prompts missing paragraph-start @mention protocol: ${failing.join(', ')}`);
  });

  addCheck(checks, 'prompt', 'prompts tell agents not to call tools directly', () => {
    const failing = Object.entries(config.agents)
      .filter(([, agent]) => !checkPromptToolProtocol(agent.systemPrompt))
      .map(([id]) => id);
    if (failing.length > 0) throw new Error(`prompts missing direct-tool prohibition: ${failing.join(', ')}`);
  });

  addCheck(checks, 'prompt', 'final prompts mention the stop token', () => {
    const stopToken = config.world.stopToken || '<world>pass</world>';
    const failing = finalWorkflowNodes(config)
      .map(nodeId => [nodeId, config.workflow.nodes[nodeId]])
      .filter(([, node]) => node && config.agents[node.agent])
      .filter(([, node]) => {
        const prompt = config.agents[node.agent].systemPrompt || '';
        return !prompt.includes(stopToken) && !/<world>\s*(STOP|DONE|PASS)\s*<\/world>/i.test(prompt);
      })
      .map(([nodeId]) => nodeId);
    if (failing.length > 0) throw new Error(`final nodes missing stop-token prompt guidance: ${failing.join(', ')}`);
  });
}

function reportLine(item) {
  if (item.status === 'PASS') return `- PASS ${item.category ? `${item.category}: ` : ''}${item.name}`;
  return `- FAIL ${item.category ? `${item.category}: ` : ''}${item.name}: ${item.reason}`;
}

function renderReport({ result, generatedAt, configPath, evalPath, checks, cases }) {
  const lines = [
    '# Agent World Eval Report',
    '',
    `Result: ${result}`,
    `Generated: ${generatedAt}`,
    '',
    '## Target',
    '',
    `- config: \`${configPath}\``,
    `- eval: \`${evalPath}\``,
    '',
    '## Checks',
    '',
    ...(checks.length > 0 ? checks.map(reportLine) : ['- FAIL eval: no checks ran']),
    '',
    '## Routing Cases',
    '',
    ...(cases.length > 0 ? cases.map(reportLine) : ['- FAIL routing: no routing cases found'])
  ];
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaultConfigPath = path.resolve(process.cwd(), '.agent-world', 'world.json');
  const configPath = path.resolve(args.config || defaultConfigPath);
  const projectRoot = inferProjectRoot(configPath);
  const evalPath = path.resolve(args.eval || path.join(projectRoot, '.agent-world', 'world.eval.md'));
  const outDir = path.resolve(args.out || path.join(projectRoot, '.agent-world', 'eval-runs'));
  const generatedAt = new Date().toISOString();
  const checks = [];
  let rawConfig = null;
  let config = null;
  let markdown = '';
  let cases = [];

  addCheck(checks, 'config', 'world.json is valid JSON', () => {
    rawConfig = readJsonFile(configPath);
  });

  addCheck(checks, 'config', 'router config loads and graph references validate', () => {
    config = loadConfig(configPath);
  });

  if (rawConfig && config) {
    validateWorldContract(checks, rawConfig, config, configPath);
  }

  addCheck(checks, 'eval', 'world.eval.md exists', () => {
    if (!fs.existsSync(evalPath)) throw new Error(`missing eval contract: ${evalPath}`);
    markdown = fs.readFileSync(evalPath, 'utf8');
  });

  if (markdown) {
    const parsed = parseRoutingCases(markdown);
    cases = parsed.cases;
    for (const error of parsed.errors) {
      checks.push({ category: 'eval', name: 'parse routing case JSON', status: 'FAIL', reason: error });
    }
    addCheck(checks, 'eval', 'world.eval.md contains routing cases', () => {
      if (cases.length === 0) throw new Error('no fenced json routing cases with name and expect were found');
    });
  }

  const caseResults = config
    ? cases.map(caseItem => runCase(caseItem, config, configPath, projectRoot))
    : [];

  const failed = checks.some(check => check.status === 'FAIL')
    || caseResults.some(caseResult => caseResult.status === 'FAIL')
    || caseResults.length === 0;
  const result = failed ? 'FAIL' : 'PASS';
  const report = renderReport({
    result,
    generatedAt,
    configPath,
    evalPath,
    checks,
    cases: caseResults
  });

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `${timestampSlug(new Date(generatedAt))}.md`);
  const latestPath = path.join(outDir, 'latest.md');
  fs.writeFileSync(reportPath, report);
  fs.writeFileSync(latestPath, report);

  process.stdout.write(`Agent World eval ${result}: ${reportPath}\n`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  parseRoutingCases,
  runCase
};
