import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';

/** Traces carry conversation content to Langfuse, so nothing is exported unless the keys are configured. */
export const langfuseEnabled = Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

if (langfuseEnabled) {
  new NodeSDK({
    serviceName: 'hilda-chat',
    // The detected resource puts the host user name and local paths on every observation.
    autoDetectResources: false,
    // Evals write to the same project; the environment keeps app traces apart from them.
    spanProcessors: [new LangfuseSpanProcessor({ environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development' })],
  }).start();
}
