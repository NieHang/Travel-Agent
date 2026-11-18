import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import type { RequirementResult } from '@autix/contracts';
import { RequirementService } from './requirement.service.js';

@Controller('requirement')
export class RequirementController {
  constructor(
    @Inject(RequirementService) private readonly requirementService: RequirementService,
  ) {}

  @Post('extract')
  extractRequirement(
    @Body() body: { input: string },
  ): Promise<RequirementResult> {
    if (typeof body?.input !== 'string') {
      throw new BadRequestException('input must be a string');
    }
    return this.requirementService.extract(body.input);
  }
}
