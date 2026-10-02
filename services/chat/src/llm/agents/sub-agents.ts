import { StringOutputParser } from '@langchain/core/output_parsers';
import { createChatModel } from '../model.factory.js';
import {
  extractPrompt,
  clarifyPrompt,
  analysisPrompt,
  riskPrompt,
  summaryPrompt,
} from '../prompts/requirement.prompts.js';

// Build lazily so configuration/model initialization failures enter the workflow fallback.
export function createSubAgents() {
  const model = createChatModel();
  const extractAgent = extractPrompt.pipe(model).pipe(new StringOutputParser());
  const clarifyAgent = clarifyPrompt.pipe(model).pipe(new StringOutputParser());
  const analysisAgent = analysisPrompt
    .pipe(model)
    .pipe(new StringOutputParser());
  const riskAgent = riskPrompt.pipe(model).pipe(new StringOutputParser());
  const summaryAgent = summaryPrompt.pipe(model).pipe(new StringOutputParser());
  return { extractAgent, clarifyAgent, analysisAgent, riskAgent, summaryAgent };
}

export type SubAgents = ReturnType<typeof createSubAgents>;
export type AgentName = keyof SubAgents;
