import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';

const processor = new LangfuseSpanProcessor();
const sdk = new NodeSDK({ spanProcessors: [processor] });
sdk.start();

export async function flush(): Promise<void> {
  await processor.forceFlush();
}

export async function shutdown(): Promise<void> {
  await sdk.shutdown();
}
