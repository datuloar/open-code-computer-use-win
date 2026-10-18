process.env.DSH_CU_THEME = 'opencode';
const { serve } = await import('../src/mcp.js');
serve();
