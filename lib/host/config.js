/**
 * Deployment configuration for the Laya Go Launcher decision plugin.
 *
 * Every value a deployment could reasonably need differently is a field here
 * with a schema default, so nothing behavioural is baked into the code. The
 * two mode-specific groups are the launcher flags (`executable`, `args`,
 * `serverCwd`, `env`) and the interaction budgets (`startTimeoutMs`,
 * `requestTimeoutMs`, `maxConcurrent`, ...).
 *
 * @module dsh-laya-go-decision/host/config
 */
import Schema from '@deepseek-ai/schemastery';
import { LayaGoError } from "./errors.js";
/** Loader schema: validates config at plugin load and fills every default. */
export const Config = Schema.object({
    mode: Schema.union(['managed', 'external']).default('managed')
        .description('managed starts the launcher process; external only talks to one already running.'),
    baseUrl: Schema.string().default('http://127.0.0.1:8420')
        .description('Origin (and optional path prefix) of the Laya HTTP API.'),
    executable: Schema.string().default('layatrt-server.exe')
        .description('Launcher executable: an absolute path, or a bare name resolved against PATH.'),
    args: Schema.array(Schema.string()).default([])
        .description('Launcher flags; --addr is derived from baseUrl unless present here.'),
    serverCwd: Schema.string()
        .description('Working directory for the launcher process.'),
    env: Schema.dict(Schema.string()).default({})
        .description('Extra environment entries for the launcher process.'),
    autoStart: Schema.boolean().default(true)
        .description('Start the launcher on the first call that needs a model.'),
    startTimeoutMs: Schema.number().min(1000).default(180_000)
        .description('How long a managed start may take before it is reported as start_timeout.'),
    loadIdleGraceMs: Schema.number().min(0).default(15_000)
        .description('How long a listening launcher may stay idle before the start reports what it found.'),
    readyPollMs: Schema.number().min(50).default(500)
        .description('Poll interval while waiting for the model to become ready.'),
    requestTimeoutMs: Schema.number().min(100).default(15_000)
        .description('Per-request timeout for Laya API calls.'),
    shutdownGraceMs: Schema.number().min(100).default(10_000)
        .description('Grace period handed to the subprocess provider when terminating the launcher.'),
    maxConcurrent: Schema.natural().min(1).default(2)
        .description('Maximum Laya prediction requests in flight; further callers wait their turn.'),
    maxQuestions: Schema.natural().min(1).default(16)
        .description('Maximum questions in one decision.'),
    maxStateChars: Schema.natural().min(100).default(20_000)
        .description('Maximum characters of state accepted by one decision.'),
    confidenceThreshold: Schema.percent().default(0.5)
        .description('Answers at or above this confidence are reported as certain.'),
    adminToken: Schema.string()
        .description('Bearer token for the launcher admin endpoints, when one is configured.'),
    logBytes: Schema.natural().min(256).default(16_384)
        .description('Bytes of launcher stdout/stderr retained for diagnostics.'),
});
/**
 * Parse and normalize the configured origin.
 * @param raw - configured base URL.
 * @returns the normalized origin and its `host:port` form.
 * @throws LayaGoError `invalid_config` when the value is not an http(s) origin.
 */
function parseBaseUrl(raw) {
    let url;
    try {
        url = new URL(raw.trim());
    }
    catch (cause) {
        throw new LayaGoError('invalid_config', `baseUrl is not a valid URL: ${JSON.stringify(raw)}`, {
            hint: 'Use an origin such as http://127.0.0.1:8420.',
            cause,
        });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new LayaGoError('invalid_config', `baseUrl must be http or https, got ${url.protocol}`, {
            hint: 'Use an origin such as http://127.0.0.1:8420.',
        });
    }
    let path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('/api/v1'))
        path = path.slice(0, -'/api/v1'.length);
    const baseUrl = `${url.origin}${path}`;
    const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
    return { baseUrl, endpoint: `${url.hostname}:${port}` };
}
/**
 * Validate and normalize one loader-resolved configuration.
 * @param config - configuration with schema defaults applied.
 * @returns the same configuration with derived values resolved.
 * @throws LayaGoError `invalid_config` for an unusable base URL.
 */
export function normalizeConfig(config) {
    const { baseUrl, endpoint } = parseBaseUrl(config.baseUrl);
    const executable = config.executable.trim();
    if (executable === '') {
        throw new LayaGoError('invalid_config', 'executable must not be empty', {
            hint: 'Point it at the Laya Go Launcher binary, for example C:\\laya-go-launcher\\layatrt-server.exe.',
        });
    }
    const env = Object.keys(config.env ?? {}).length === 0 ? undefined : { ...config.env };
    const maxStateChars = Math.max(100, Math.floor(config.maxStateChars));
    const requestTimeoutMs = Math.max(100, Math.floor(config.requestTimeoutMs));
    return {
        mode: config.mode,
        baseUrl,
        apiBaseUrl: `${baseUrl}/api/v1`,
        endpoint,
        executable,
        args: [...config.args],
        serverCwd: config.serverCwd === undefined || config.serverCwd.trim() === '' ? undefined : config.serverCwd,
        env,
        autoStart: config.autoStart,
        startTimeoutMs: Math.max(1000, Math.floor(config.startTimeoutMs)),
        loadIdleGraceMs: Math.max(0, Math.floor(config.loadIdleGraceMs)),
        readyPollMs: Math.max(50, Math.floor(config.readyPollMs)),
        requestTimeoutMs,
        shutdownGraceMs: Math.max(100, Math.floor(config.shutdownGraceMs)),
        maxConcurrent: Math.max(1, Math.floor(config.maxConcurrent)),
        maxQuestions: Math.max(1, Math.floor(config.maxQuestions)),
        maxStateChars,
        confidenceThreshold: Math.min(1, Math.max(0, config.confidenceThreshold)),
        adminToken: config.adminToken === undefined || config.adminToken === '' ? undefined : config.adminToken,
        logBytes: Math.max(256, Math.floor(config.logBytes)),
        probeTimeoutMs: Math.min(2000, requestTimeoutMs),
    };
}
/** Flags that already name the listen address, in every spelling Go's flag package accepts. */
const ADDR_FLAGS = ['--addr', '-addr'];
/**
 * Build the launcher argv tail, keeping `baseUrl` the single source of truth for
 * the listen address unless the deployment spelled `--addr` itself.
 * @param config - normalized configuration.
 * @returns the flags to append after the executable.
 */
export function serverArgs(config) {
    const args = [...config.args];
    const hasAddr = args.some(argument => ADDR_FLAGS.some(flag => argument === flag || argument.startsWith(`${flag}=`)));
    return hasAddr ? args : [...args, '--addr', config.endpoint];
}
//# sourceMappingURL=config.js.map