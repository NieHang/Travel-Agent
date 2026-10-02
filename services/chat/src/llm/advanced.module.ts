import { Module } from '@nestjs/common';
import { AdvancedAnalysisService } from './advanced-analysis.service.js';
import {
  AdvancedController,
  AgentsController,
  EmbeddingController,
  FilesystemController,
  MemoryController,
} from './advanced.controller.js';
import { OrchestratorService } from './agents/orchestrator.service.js';
import { EmbeddingService } from './embedding/embedding.service.js';
import { VectorStoreService } from './embedding/vector-store.service.js';
import { FilesystemService } from './filesystem/filesystem.service.js';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import { TrimmedMemoryService } from './memory/trimmed-memory.service.js';

@Module({
  controllers: [
    MemoryController,
    FilesystemController,
    EmbeddingController,
    AgentsController,
    AdvancedController,
  ],
  providers: [
    TrimmedMemoryService,
    RunnableMemoryService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
  exports: [
    RunnableMemoryService,
    TrimmedMemoryService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
})
export class AdvancedModule {}
