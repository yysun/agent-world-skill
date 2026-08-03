// One chokidar watcher per server process, shared by every SSE client via
// the single EventBus. Watches world.json, world.layout.json, and the
// prompts/ directory (recursively, filtered to .md files) -- NOT
// world.eval.md, which the REQ Non-Goals reserve as "any surface for the
// evaluation contract file".
//
// chokidar 5 dropped built-in glob-to-directory expansion (verified
// empirically: a glob string such as "prompts/**/*.md" fires no events at
// all), so concrete targets are watched directly instead: chokidar tracks a
// path that does not exist yet and fires `add` once it's created, which
// covers both a not-yet-created world.layout.json and a not-yet-created
// prompts/ directory on a brand new project.
import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import type { Workspace } from './workspace.js';
import type { EventBus } from './sse.js';

export class Watcher {
  private readonly instance: FSWatcher;

  constructor(private readonly workspace: Workspace, private readonly bus: EventBus) {
    this.instance = chokidar.watch(
      [workspace.worldPath, workspace.layoutPath, workspace.promptsDir],
      { ignoreInitial: true }
    );
    this.instance.on('add', p => this.handleChange(p));
    this.instance.on('change', p => this.handleChange(p));
  }

  private handleChange(changedPath: string): void {
    const resolved = path.resolve(changedPath);
    const isPrompt = resolved.startsWith(this.workspace.promptsDir + path.sep);
    if (isPrompt && !resolved.endsWith('.md')) {
      return;
    }

    let content: Buffer;
    try {
      content = fs.readFileSync(resolved);
    } catch {
      return;
    }

    const source = this.workspace.isSelfWrite(resolved, content) ? 'studio' : 'external';
    this.bus.publish({ type: 'file.changed', path: resolved, source });
  }

  async close(): Promise<void> {
    await this.instance.close();
  }
}
