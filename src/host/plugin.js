/**
 * DSH iOS Gateway - Host half.
 *
 * Runs the local mobile gateway as a child of the DSH desktop host so that:
 *   - opening DSH is enough, no Windows script / Startup entry is required;
 *   - the gateway stops when DSH exits;
 *   - a crash of the gateway is retried automatically.
 *
 * The gateway itself is the same `gateway/mobile-gateway.cjs` used by the
 * standalone scripts, so both installation modes share one implementation.
 */
import { spawn } from 'node:child_process'
import { existsSync, openSync, closeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:http'
import process from 'node:process'

export const name = 'ios-gateway'
export const inject = []

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..', '..')
const gatewayScript = join(packageRoot, 'gateway', 'mobile-gateway.cjs')
const logFile = join(packageRoot, 'gateway.log')

function resolveNode(config) {
  const candidates = []
  if (config && typeof config.node === 'string' && config.node) candidates.push(config.node)
  if (process.env.DSH_NODE) candidates.push(process.env.DSH_NODE)
  const exeDir = dirname(process.execPath)
  candidates.push(
    join(exeDir, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    join(exeDir, 'resources', 'runtime', 'dependencies', 'node', 'bin', 'node.exe'),
  )
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return { command: candidate, env: {} }
    } catch {
      /* ignore */
    }
  }
  // Electron host without a bundled node.exe: reuse the Electron binary as Node.
  if (/DeepSeek Harness\.exe$/i.test(process.execPath)) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  return { command: 'node', env: {} }
}

function checkHealth(port, timeout = 900) {
  return new Promise((resolve) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/__dsh_mobile/health', method: 'GET', timeout },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

export function apply(ctx, config) {
  const options = config && typeof config === 'object' ? config : {}
  const autoStart = options.autoStart !== false
  const port = Number(options.port) || 50108
  if (!autoStart) {
    ctx?.effect?.(() => () => {}, 'dsh-ios-gateway: disabled')
    return
  }

  let child = null
  let disposed = false
  let restartTimer = null

  const log = (...args) => {
    try {
      console.info('[dsh-ios-gateway]', ...args)
    } catch {
      /* ignore */
    }
  }

  const start = async () => {
    if (disposed) return
    if (await checkHealth(port)) {
      log(`gateway already listening on ${port}, skipping spawn`)
      return
    }
    if (!existsSync(gatewayScript)) {
      log(`gateway script not found: ${gatewayScript}`)
      return
    }
    const { command, env: extraEnv } = resolveNode(options)
    const env = {
      ...process.env,
      ...extraEnv,
      DSH_MOBILE_PORT: String(port),
    }
    if (options.host) env.DSH_MOBILE_HOST = String(options.host)
    if (options.loopback === false) env.DSH_MOBILE_LOOPBACK = '0'
    let out = 'ignore'
    try {
      out = openSync(logFile, 'a')
    } catch {
      out = 'ignore'
    }
    log(`starting gateway (${command}) on port ${port}`)
    try {
      child = spawn(command, [gatewayScript], {
        cwd: packageRoot,
        env,
        windowsHide: true,
        detached: false,
        stdio: ['ignore', out, out],
      })
    } catch (error) {
      log('spawn failed:', error?.message || error)
      child = null
    } finally {
      if (typeof out === 'number') {
        try {
          closeSync(out)
        } catch {
          /* ignore */
        }
      }
    }
    child?.on('exit', (code, signal) => {
      log(`gateway exited code=${code} signal=${signal}`)
      child = null
      if (disposed) return
      clearTimeout(restartTimer)
      restartTimer = setTimeout(() => void start(), 5000)
    })
    child?.on('error', (error) => {
      log('gateway process error:', error?.message || error)
    })
  }

  const stop = () => {
    disposed = true
    clearTimeout(restartTimer)
    if (child) {
      log('stopping gateway')
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      child = null
    }
  }

  ctx?.effect?.(() => {
    void start()
    // If a stale standalone gateway was running when the plugin started, take
    // over once that process is gone (the plugin's child is then started here).
    const monitor = setInterval(() => {
      if (disposed || child) return
      void checkHealth(port).then((alive) => {
        if (!alive && !disposed && !child) void start()
      })
    }, 10000)
    if (typeof monitor.unref === 'function') monitor.unref()
    return () => {
      clearInterval(monitor)
      stop()
    }
  }, 'dsh-ios-gateway: mobile gateway')
}
