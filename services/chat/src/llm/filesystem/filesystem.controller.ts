import { Body, Controller, Inject, Post } from '@nestjs/common';
import { FilesystemService } from './filesystem.service.js';

@Controller('api/files')
export class FilesystemController {
  constructor(
    @Inject(FilesystemService)
    private readonly filesystemService: FilesystemService,
  ) {}

  @Post('chat')
  chat(@Body() body: { input?: string } = {}) {
    return this.filesystemService.chat(body?.input ?? '');
  }
}
