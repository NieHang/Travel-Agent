import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';
import { MemoryController } from './memory/memory.controller.js';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';
import { TrimmedMemoryService } from './memory/trimmed-memory.service.js';
import { FilesystemController } from './filesystem/filesystem.controller.js';
import { FilesystemService } from './filesystem/filesystem.service.js';

@Module({
  controllers: [LlmController, MemoryController, FilesystemController],
  providers: [
    FilesystemService,
    LlmService,
    RequirementService,
    RunnableMemoryService,
    TrimmedMemoryService,
  ],
  exports: [
    FilesystemService,
    LlmService,
    RequirementService,
    RunnableMemoryService,
    TrimmedMemoryService,
  ],
})
export class LlmModule {}
