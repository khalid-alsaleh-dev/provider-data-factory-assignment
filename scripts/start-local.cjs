const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MongoClient } = require('mongodb');
const Redis = require('ioredis');

const root = path.resolve(__dirname, '..');
process.chdir(root);
if (fs.existsSync('.env')) process.loadEnvFile('.env');

const settings = {
  ...process.env,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:43179',
  PORT: process.env.PORT || '3000',
};
let redisProcess, app;
let stopping = false;

function redisExecutable() {
  if (process.env.REDIS_SERVER_PATH) return process.env.REDIS_SERVER_PATH;
  const directory = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'redis');
  if (process.platform === 'win32' && fs.existsSync(directory)) {
    for (const name of fs.readdirSync(directory)) {
      const executable = path.join(directory, name, 'redis-server.exe');
      if (fs.existsSync(executable)) return executable;
    }
  }
  return 'redis-server';
}

async function pingRedis() {
  const client = new Redis(settings.REDIS_URL, {
    lazyConnect: true, retryStrategy: () => null, connectTimeout: 500,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

async function start() {
  const mongo = new MongoClient(settings.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    await mongo.connect();
    await mongo.db('admin').command({ ping: 1 });
  } finally {
    await mongo.close();
  }

  if (!await pingRedis()) {
    const url = new URL(settings.REDIS_URL);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('Configured Redis server is unavailable');
    }
    const directory = path.join(root, '.runtime', 'redis');
    fs.mkdirSync(directory, { recursive: true });
    redisProcess = spawn(redisExecutable(), [
      '--port', url.port || '6379', '--bind', '127.0.0.1',
      '--appendonly', 'yes', '--maxmemory-policy', 'noeviction', '--logfile', 'redis.log',
    ], { cwd: directory, windowsHide: true, stdio: 'ignore' });
    redisProcess.on('error', error => stop(1, error.message));
    redisProcess.on('exit', code => { if (!stopping) stop(1, `Redis stopped (${code})`); });
    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      ready = await pingRedis();
    }
    if (!ready) throw new Error('Redis did not start. Check REDIS_SERVER_PATH.');
  }

  app = spawn(process.execPath, ['dist/src/main.js'], {
    cwd: root, env: settings, windowsHide: true, stdio: 'inherit',
  });
  app.on('error', error => stop(1, error.message));
  app.on('exit', code => stop(code || 0));
  console.log(`Starting app at http://localhost:${settings.PORT}. Press Ctrl+C to stop.`);
}

function stop(code = 0, message) {
  if (stopping) return;
  stopping = true;
  if (message) console.error(message);
  app?.kill();
  redisProcess?.kill();
  process.exitCode = code;
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
start().catch(error => stop(1, error.message));
