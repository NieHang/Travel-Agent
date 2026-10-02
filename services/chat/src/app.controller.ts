import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
} from '@nestjs/common';
import type { RequirementResult } from '@autix/contracts';
import { AppService } from './app.service.js';
import { RequirementService } from './llm/requirement.service.js';

@Controller()
export class AppController {
  constructor(
    @Inject(AppService) private readonly appService: AppService,
    @Inject(RequirementService)
    private readonly requirementService: RequirementService,
  ) {}

  @Post('requirement/extract')
  extractRequirement(
    @Body() body: { input: string },
  ): Promise<RequirementResult> {
    if (typeof body?.input !== 'string') {
      throw new BadRequestException('input must be a string');
    }
    return this.requirementService.extract(body.input);
  }

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('hello')
  getHello() {
    return this.appService.getHello();
  }
}
