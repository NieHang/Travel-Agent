import { StringOutputParser } from '@langchain/core/output_parsers';
import { createChatModel } from './model.factory.js';
import { buildRequirementPrompt } from './requirement.prompt-builder.js';

const requirementPrompt = buildRequirementPrompt();
const model = createChatModel();

export const requirementChain = requirementPrompt
  .pipe(model)
  .pipe(new StringOutputParser());
