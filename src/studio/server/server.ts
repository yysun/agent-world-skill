// The Studio HTTP surface: the token handshake, static client assets, the
// independently persisted world/layout APIs, validation/prompt API, and the
// SSE event stream. Layout writes use raw-file revision tokens so autosave
// cannot silently overwrite an external edit.
//
// Ownership boundary (REQ, plan Decisions -> "Ownership boundary is enforced,
// not assumed"): this file must never register a route that starts, stops,
// or continues a run, and must never accept a client-supplied command, path,
// or shell string. The only router capability used anywhere in the server is
// `loadConfig`, reached indirectly through Workspace -> Validator.
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import type { Workspace } from './workspace.js';
import { PathEscapeError, UnknownAgentError, PromptNotFoundError } from './workspace.js';
import type { EventBus } from './sse.js';
import type { WorldDocument, Layout } from '../shared/models.js';
import type { LayoutWriteMode } from '../shared/api.js';

const SESSION_COOKIE = 'studio_session';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export interface CreateServerOptions {
  workspace: Workspace;
  bus: EventBus;
  clientDistDir: string;
  sessionToken?: string;
}

export interface StudioServerHandle {
  app: express.Express;
  sessionToken: string;
}

export function createServer(options: CreateServerOptions): StudioServerHandle {
  const { workspace, bus, clientDistDir } = options;
  const sessionToken = options.sessionToken ?? crypto.randomBytes(24).toString('hex');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  // Token handshake: GET /?token=<token> sets an HttpOnly, SameSite=Strict
  // cookie and redirects to / so the token never lingers in the address bar.
  // With no token query param this falls through to static serving, so the
  // client shell always loads (only /api/* requires the session).
  app.get('/', (req: Request, res: Response, next: NextFunction) => {
    const token = req.query.token;
    if (typeof token !== 'string') {
      next();
      return;
    }
    if (token !== sessionToken) {
      res.status(401).send('Invalid session token.');
      return;
    }
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`
    );
    res.redirect(302, '/');
  });

  function requireSession(req: Request, res: Response, next: NextFunction): void {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[SESSION_COOKIE] === sessionToken) {
      next();
      return;
    }
    res.status(401).json({ errors: [{ pointer: '', message: 'Unauthorized: missing or invalid session.' }] });
  }

  const api = express.Router();
  api.use(requireSession);

  api.get('/workspace', (_req: Request, res: Response) => {
    res.json({ projectRoot: workspace.projectRoot, hasWorld: workspace.hasWorld() });
  });

  api.get('/world', (_req: Request, res: Response) => {
    const { exists, world } = workspace.readWorld();
    res.json({ exists, world });
  });

  api.put('/world', async (req: Request, res: Response) => {
    const body = req.body as { world?: WorldDocument } | undefined;
    if (!body || typeof body.world !== 'object' || body.world === null) {
      res.status(400).json({ errors: [{ pointer: 'world', message: 'Request body must include a world object.' }] });
      return;
    }
    const result = await workspace.saveWorld(body.world);
    if (!result.ok) {
      res.status(400).json({ errors: result.errors });
      return;
    }
    bus.publish({ type: 'world.saved', hash: result.hash });
    res.json({ hash: result.hash });
  });

  api.get('/layout', (_req: Request, res: Response) => {
    res.json(workspace.readLayout());
  });

  api.put('/layout', async (req: Request, res: Response) => {
    const body = req.body as { layout?: Layout; expectedRevision?: string | null; mode?: LayoutWriteMode } | undefined;
    if (!body || typeof body.layout !== 'object' || body.layout === null) {
      res.status(400).json({ errors: [{ pointer: 'layout', message: 'Request body must include a layout object.' }] });
      return;
    }
    if (body.expectedRevision !== null && typeof body.expectedRevision !== 'string') {
      res.status(400).json({ errors: [{ pointer: 'expectedRevision', message: 'Expected revision must be a string or null.' }] });
      return;
    }
    if (body.mode !== undefined && body.mode !== 'merge' && body.mode !== 'replace') {
      res.status(400).json({ errors: [{ pointer: 'mode', message: 'Layout write mode must be merge or replace.' }] });
      return;
    }

    const result = await workspace.saveLayout(body.layout, body.expectedRevision, body.mode ?? 'merge');
    if (!result.ok) {
      if (result.kind === 'conflict') {
        res.status(409).json({
          currentRevision: result.currentRevision,
          errors: [{ pointer: 'layout', message: 'Layout changed outside Studio.' }]
        });
      } else {
        res.status(400).json({ errors: result.errors });
      }
      return;
    }
    res.json({ layout: result.layout, revision: result.revision });
  });

  api.post('/validate', async (req: Request, res: Response) => {
    const body = req.body as { world?: WorldDocument } | undefined;
    if (!body || typeof body.world !== 'object' || body.world === null) {
      res.status(400).json({ errors: [{ pointer: 'world', message: 'Request body must include a world object.' }] });
      return;
    }
    const result = await workspace.validateCandidate(body.world);
    bus.publish({ type: 'validation.completed', valid: result.valid, errors: result.errors });
    res.json(result);
  });

  api.get('/prompts/:agentId', async (req: Request, res: Response) => {
    const agentId = String(req.params.agentId);
    try {
      const content = await workspace.readPrompt(agentId);
      res.json({ agentId, content });
    } catch (err) {
      handlePromptError(err, res);
    }
  });

  api.put('/prompts/:agentId', async (req: Request, res: Response) => {
    const agentId = String(req.params.agentId);
    const body = req.body as { content?: string } | undefined;
    if (!body || typeof body.content !== 'string') {
      res.status(400).json({ errors: [{ pointer: 'content', message: 'Request body must include content as a string.' }] });
      return;
    }
    try {
      await workspace.writePrompt(agentId, body.content);
      res.json({ ok: true });
    } catch (err) {
      handlePromptError(err, res);
    }
  });

  api.get('/events', (req: Request, res: Response) => {
    bus.addClient(res);
  });

  app.use('/api', api);

  app.use(express.static(clientDistDir));

  // Express 5 forwards a rejected async handler's error here automatically.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: unknown }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({ errors: [{ pointer: '', message: 'Invalid JSON request body.' }] });
      return;
    }
    res.status(500).json({ errors: [{ pointer: '', message: err instanceof Error ? err.message : 'Internal error' }] });
  });

  return { app, sessionToken };
}

function handlePromptError(err: unknown, res: Response): void {
  if (err instanceof UnknownAgentError) {
    res.status(404).json({ errors: [{ pointer: 'agentId', message: err.message }] });
    return;
  }
  if (err instanceof PromptNotFoundError) {
    res.status(404).json({ errors: [{ pointer: 'promptPath', message: err.message }] });
    return;
  }
  if (err instanceof PathEscapeError) {
    res.status(400).json({ errors: [{ pointer: 'promptPath', message: err.message }] });
    return;
  }
  throw err;
}
