import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';
import { MemoryController } from './memory/memory.controller.js';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import { TrimmedMemoryService } from './memory/trimmed-memory.service.js';
import { FilesystemController } from './filesystem/filesystem.controller.js';
import { FilesystemService } from './filesystem/filesystem.service.js';
import { EmbeddingController } from './embedding/embedding.controller.js';
import { EmbeddingService } from './embedding/embedding.service.js';
import { VectorStoreService } from './embedding/vector-store.service.js';
import { AgentsController } from './agents/agents.controller.js';
import { OrchestratorService } from './agents/orchestrator.service.js';

@Module({
  controllers: [
    AgentsController,
    LlmController,
    MemoryController,
    FilesystemController,
    EmbeddingController,
  ],
  providers: [
    OrchestratorService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    LlmService,
    RequirementService,
    RunnableMemoryService,
    TrimmedMemoryService,
  ],
  exports: [
    OrchestratorService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    LlmService,
    RequirementService,
    RunnableMemoryService,
    TrimmedMemoryService,
  ],
})
export class LlmModule {}
