'use strict';

require('dotenv/config');

const disabled = ['true', '1', 'yes'].includes(
	(process.env.OTEL_SDK_DISABLED || '').toLowerCase().trim(),
);
if (disabled) {
	console.log('[OTEL] OTEL_SDK_DISABLED: skipping Node auto-instrumentation');
} else {
	const endpoint =
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
		process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
		'http://localhost:4317';
	process.env.OTEL_TRACES_EXPORTER = 'otlp';
	process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
	process.env.OTEL_EXPORTER_OTLP_COMPRESSION = process.env.OTEL_EXPORTER_OTLP_COMPRESSION || 'none';
	process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = endpoint;
	process.env.OTEL_EXPORTER_OTLP_INSECURE = process.env.OTEL_EXPORTER_OTLP_INSECURE || 'true';
	delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
	process.env.OTEL_RESOURCE_ATTRIBUTES =
		process.env.OTEL_RESOURCE_ATTRIBUTES ||
		'service.name=svelte-chatbot,cx.application.name=svelte-chatbot,cx.subsystem.name=chat-api,service.namespace=svelterum';
	process.env.OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'svelte-chatbot';
	process.env.OTEL_NODE_RESOURCE_DETECTORS = 'env,host,os,process';
	console.log('[OTEL] Exporting traces to local OTLP collector at', endpoint);

	const { NodeSDK } = require('@opentelemetry/sdk-node');
	const {
		getNodeAutoInstrumentations,
		getResourceDetectors
	} = require('@opentelemetry/auto-instrumentations-node');

	/** K8s readiness/liveness — do not export probe traffic as APM spans. */
	function isHealthPath(pathname) {
		if (!pathname) return false;
		const p = String(pathname).split('?')[0];
		return p === '/healthz' || p === '/livez' || p === '/health' || p.endsWith('/health');
	}

	const sdk = new NodeSDK({
		resourceDetectors: getResourceDetectors(),
		instrumentations: [
			getNodeAutoInstrumentations({
				'@opentelemetry/instrumentation-http': {
					ignoreIncomingRequestHook: (req) => isHealthPath(req.url),
					ignoreOutgoingRequestHook: (options) => {
						const path = options.path || options.pathname || '';
						return isHealthPath(typeof path === 'string' ? path : '');
					}
				}
			})
		]
	});
	sdk.start();
	process.on('SIGTERM', () => sdk.shutdown().catch(() => {}));
	process.once('beforeExit', () => sdk.shutdown().catch(() => {}));
}
