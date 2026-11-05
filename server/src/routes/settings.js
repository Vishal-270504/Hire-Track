import { needCan } from '../auth/guard.js';
import { allPolicy, savePolicy, resetPolicy } from '../policy/index.js';
import { DEFAULTS } from '../policy/defaults.js';
import { BLOCK_SCHEMAS, BLOCK_NAMES } from '../policy/schemas.js';
import { audit } from '../audit/index.js';
import { notFound } from '../errors.js';

export async function settingsRoutes(app) {
  app.get('/api/settings', async (req) => {
    needCan(req, 'settings.read');
    const { values, customised } = allPolicy(app.db);
    return { values, defaults: DEFAULTS, customised };
  });

  app.put('/api/settings/:block', async (req) => {
    const actor = needCan(req, 'settings.write');
    const block = req.params.block;
    if (!BLOCK_NAMES.includes(block)) throw notFound('That settings area');
    const value = BLOCK_SCHEMAS[block].parse(req.body ?? {});
    const at = app.clock.now().toISOString();
    savePolicy(app.db, block, value, at);
    audit(app.db, { at, userId: actor.id, action: 'settings.update', entity: 'settings', entityId: null, detail: { block } });
    return { block, value };
  });

  app.post('/api/settings/:block/reset', async (req) => {
    const actor = needCan(req, 'settings.write');
    const block = req.params.block;
    if (!BLOCK_NAMES.includes(block)) throw notFound('That settings area');
    resetPolicy(app.db, block);
    audit(app.db, { at: app.clock.now().toISOString(), userId: actor.id, action: 'settings.reset', entity: 'settings', detail: { block } });
    return { block, value: DEFAULTS[block] };
  });
}
