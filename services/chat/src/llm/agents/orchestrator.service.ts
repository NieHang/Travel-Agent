import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createSubAgents, type AgentName } from './sub-agents.js';

const requirementsSchema = z.object({
  goal: z.string(),
  users: z.array(z.string()),
  features: z.array(z.string()),
  constraints: z.array(z.string()),
  unknowns: z.array(z.string()),
});
const clarificationSchema = z
  .object({
    needsClarification: z.boolean(),
    clarificationQuestions: z.array(z.string().trim().min(1)),
  })
  .refine(
    (value) =>
      value.needsClarification === value.clarificationQuestions.length > 0,
  );
const textSchema = z.string().trim().min(1);

export interface AgentStep {
  agent: AgentName;
  status: 'completed' | 'failed';
  output: unknown;
  error?: string;
}

export interface OrchestrationResult {
  mode: 'fixed';
  status: 'completed' | 'needs_clarification' | 'failed';
  clarificationQuestions: string[];
  usedAgents: AgentName[];
  fallback: 'manual_review' | null;
  steps: AgentStep[];
  report: string | null;
}

@Injectable()
export class OrchestratorService {
  async orchestrate(input: string): Promise<OrchestrationResult> {
    if (typeof input !== 'string' || !input.trim()) {
      throw new BadRequestException('input must be a non-empty string');
    }
    const result: OrchestrationResult = {
      mode: 'fixed',
      status: 'failed',
      clarificationQuestions: [],
      usedAgents: [],
      fallback: null,
      steps: [],
      report: null,
    };

    const run = async <T>(
      agent: AgentName,
      action: () => Promise<T>,
    ): Promise<T> => {
      result.usedAgents.push(agent);
      const step: AgentStep = { agent, status: 'failed', output: null };
      result.steps.push(step);
      try {
        const output = await action();
        step.status = 'completed';
        step.output = output;
        return output;
      } catch (error) {
        // Do not expose upstream errors, which may contain configuration or credentials.
        step.error = 'Agent execution or output validation failed';
        throw error;
      }
    };

    try {
      let agents: ReturnType<typeof createSubAgents>;
      const requirements = await run('extractAgent', async () => {
        agents = createSubAgents();
        return requirementsSchema.parse(
          JSON.parse(await agents.extractAgent.invoke({ input })),
        );
      });
      const context = { input, requirements: JSON.stringify(requirements) };
      const clarification = await run('clarifyAgent', async () =>
        clarificationSchema.parse(
          JSON.parse(await agents.clarifyAgent.invoke(context)),
        ),
      );
      if (clarification.needsClarification) {
        result.status = 'needs_clarification';
        result.clarificationQuestions = clarification.clarificationQuestions;
        return result;
      }

      const parallelContext = {
        ...context,
        clarification: JSON.stringify(clarification),
      };
      // Settle both branches before returning, so the returned steps are complete and stable.
      const branches = await Promise.allSettled([
        run('analysisAgent', async () =>
          textSchema.parse(await agents.analysisAgent.invoke(parallelContext)),
        ),
        run('riskAgent', async () =>
          textSchema.parse(await agents.riskAgent.invoke(parallelContext)),
        ),
      ]);
      const [analysis, risk] = branches;
      if (analysis.status === 'rejected' || risk.status === 'rejected') {
        result.fallback = 'manual_review';
        return result;
      }
      result.report = await run('summaryAgent', async () =>
        textSchema.parse(
          await agents.summaryAgent.invoke({
            ...parallelContext,
            analysis: analysis.value,
            risk: risk.value,
          }),
        ),
      );
      result.status = 'completed';
      return result;
    } catch {
      result.fallback = 'manual_review';
      return result;
    }
  }
}
