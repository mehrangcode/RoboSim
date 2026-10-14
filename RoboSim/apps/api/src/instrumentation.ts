// Load with `node --import ./dist/instrumentation.js dist/main.js`. Tracing is enabled only when an OTLP
// endpoint is configured (NFR-OBS-01); the ESM loader hook lets auto-instrumentation patch ESM modules.
import { register } from 'node:module';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'robosim-api',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
    ],
  });
  sdk.start();
  const shutdown = () => void sdk.shutdown().finally(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
