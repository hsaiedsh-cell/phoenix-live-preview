process.env.NODE_ENV = 'test';
process.env.PHOENIX_AUTH_MODE = 'dev-header';

let passed = 0;

function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

async function main(): Promise<void> {
  const [{ default: app }, { default: config }] = await Promise.all([
    import('../../api/index'),
    import('../../vercel.json'),
  ]);

  check(typeof app === 'function', 'Vercel entry exports the Express application');
  check(config.rewrites?.[0]?.destination === '/api/index', 'all hosted paths rewrite to the Express function');
  check(config.functions?.['api/index.ts']?.maxDuration === 30, 'function duration is explicitly bounded');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed.`);
  // eslint-disable-next-line no-console
  console.log('RESULT: PHX-LAUNCH-002-R8 VERCEL BACKEND ENTRY QA PASSED');
}

void main();
