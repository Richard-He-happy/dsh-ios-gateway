/**
 * DSH iOS Gateway - Host half.
 *
 * Runs the mobile gateway together with the DSH desktop host: when this plugin
 * is enabled in DSH, the gateway starts automatically and is torn down with it.
 * The user no longer has to double-click a start script.
 */
export { name, inject, apply } from './src/host/plugin.js'
